"""
Trained Agent Pack Router — six real scikit-learn agents over real batch data.

This is the serving surface for the artifacts in `models/agents/`. It mounts
at `/api/agents/v2` and is **additive**: the existing `/api/ml/*` endpoints and
`/api/agents/orchestrate` are untouched and keep their exact response shapes,
because the Next.js API routes and `tests/test_api.py` depend on them.

Where the data comes from
-------------------------
The Python service holds no database connection — AgriBridge's data layer is
Prisma, inside the Next.js app. So the caller assembles a `context` from the
ledger and posts it here. Python does inference and nothing else: it cannot
read a batch, cannot invent a batch, and cannot reach around the Next.js
authorization layer.

The one exception is `POST /analyze`, which composes the six agents for a
consumer-facing verdict.

Response contract
-----------------
Every agent answers with one of three statuses and the caller keys off
`status`, never off the presence of a number:

    OK               the model ran; `prediction` holds real output
    NOT_APPLICABLE   a required input does not exist, or the crop is out of
                     the trained domain; `prediction` is null
    UNAVAILABLE      the artifact is missing, failed its checksum, or is
                     otherwise not loaded; `prediction` is null

An agent that cannot answer returns 200 with a non-OK status, not a 200 with a
made-up score. 4xx/5xx is reserved for a malformed request.
"""
import logging
import time
from typing import Any

from agents import (
    OK,
    UNAVAILABLE,
    AgentUnavailable,
    MissingFeatures,
    NotApplicable,
    compliance_agent,
    fraud_agent,
    get_loader,
    not_applicable,
    quality_agent,
    running_sklearn,
    spoilage_agent,
    traceability_agent,
    trust_agent,
    unavailable,
)
from agents.constants import CROP_SPOILAGE_THRESHOLDS
from agents.mapping import resolve_crop
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

logger = logging.getLogger("agribridge.agents.v2")

router = APIRouter()

# agent name -> (module, human label)
AGENTS = {
    "traceability": (traceability_agent, "Traceability Agent"),
    "quality": (quality_agent, "Quality Agent"),
    "spoilage": (spoilage_agent, "Spoilage Agent"),
    "fraud": (fraud_agent, "Fraud Agent"),
    "compliance": (compliance_agent, "Compliance Agent"),
    "trust": (trust_agent, "Consumer Trust Agent"),
}

# The five that must run before Consumer Trust can reason over them.
UPSTREAM = ["traceability", "quality", "spoilage", "fraud", "compliance"]


# ── Request bodies ───────────────────────────────────────────────────────────

class BatchContext(BaseModel):
    """
    Everything an agent may read about a batch, assembled by the caller.

    Every field is optional. A field the caller does not have is the same as a
    field that does not exist in the database, and the agent treats it that way.
    """
    batchId: str = Field(..., description="Batch ID (for echoing back)")

    productName: str | None = None
    quantityKg: float | None = None
    harvestDate: str | None = None
    unitPrice: float | None = None

    destinationMarket: str | None = None
    pesticideResidueLevel: float | None = Field(
        None, description="Measured residue mg/kg. Omit if never lab-tested — "
                          "the agent will not substitute a number for it."
    )

    certificates: list[dict[str, Any]] = Field(default_factory=list)
    shipment: dict[str, Any] | None = None
    events: list[dict[str, Any]] = Field(default_factory=list)
    temperatureLogs: list[dict[str, Any]] = Field(default_factory=list)

    blockchainStatus: str | None = None
    blockchainVerified: bool | None = None

    remainingTransportTime: float | None = Field(
        None, description="Hours of transit left. Falls back to the shipment ETA."
    )


class AnalyzeRequest(BaseModel):
    """Runs the five upstream agents, then the Consumer Trust meta-agent."""
    context: BatchContext


# ── Context -> model input ────────────────────────────────────────────────────

def _cert_dates(certs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalise the certificate fields the compliance input needs."""
    out = []
    for c in certs or []:
        out.append({
            "expiryDate": c.get("expiryDate"),
            "issueDate": c.get("issueDate"),
            "verificationStatus": c.get("verificationStatus"),
        })
    return out


def _remaining_transport_hours(ctx: BatchContext) -> float | None:
    """
    Hours of transit still to go.

    Read from the shipment's estimated arrival when one exists. Absent, it
    stays None — the spoilage agent treats that as a first-class missing
    input and declines, because a transit window is a model feature and
    guessing it would manufacture the prediction.
    """
    if ctx.remainingTransportTime is not None:
        return float(ctx.remainingTransportTime)

    ship = ctx.shipment or {}
    eta = ship.get("estimatedArrival") or ship.get("arrivalDate")
    departure = ship.get("departureDate")
    if not eta or not departure:
        return None
    from agents.mapping import hours_since
    depart_h = hours_since(departure)
    arrive_h = hours_since(eta)
    if depart_h is None or arrive_h is None:
        return None
    return max(0.0, depart_h - arrive_h)


def _crop_thresholds(product_name: str | None) -> dict[str, Any]:
    """
    The crop's spoilage thresholds, via the same resolution the agents use.

    Falls back to an empty dict for an unrecognised crop, which makes
    `crit_temp` None and the breach count 0 — the model still runs, it simply
    has no crop-specific thermal band to count breaches against, and the
    response reports that band as null.
    """
    res = resolve_crop(product_name)
    if not res.get("ok"):
        return {}
    return CROP_SPOILAGE_THRESHOLDS.get(res["crop_type"], {})


def build_inputs(
    agent: str, ctx: BatchContext, upstream: dict[str, Any] | None = None
) -> dict[str, Any]:
    """
    Assemble the `inputs` dict one agent expects from a BatchContext.

    `upstream` is the meta-agent's only input: Consumer Trust is scored from
    what the other five concluded, so the predictions are handed to it rather
    than re-derived. It carries no direct BatchContext features of its own.
    """
    from agents.mapping import (
        compliance_inputs,
        fraud_inputs,
        quality_inputs,
        spoilage_inputs,
    )

    certs = _cert_dates(ctx.certificates)
    base: dict[str, Any] = {"batch_id": ctx.batchId, "product_name": ctx.productName}

    if agent == "compliance":
        return {
            **base,
            **compliance_inputs(
                {"batchCode": ctx.batchId, "quantity": ctx.quantityKg, "unitPrice": ctx.unitPrice},
                certs,
                ctx.destinationMarket or "Domestic",
                residue_override=ctx.pesticideResidueLevel,
            ),
            # compliance_inputs keys on batchCode; the agent reads batch_id.
            "batch_id": ctx.batchId,
        }

    if agent == "fraud":
        return {
            **base,
            **fraud_inputs(
                {"batchCode": ctx.batchId, "quantity": ctx.quantityKg, "unitPrice": ctx.unitPrice},
                ctx.shipment,
                certs,
                ctx.events,
            ),
        }

    if agent == "quality":
        return {**base, **quality_inputs(
            {"batchCode": ctx.batchId, "harvestDate": ctx.harvestDate}, ctx.temperatureLogs, certs,
        )}

    if agent == "spoilage":
        thresholds = _crop_thresholds(ctx.productName)
        return {
            **base,
            **spoilage_inputs(
                {"batchCode": ctx.batchId, "harvestDate": ctx.harvestDate},
                ctx.temperatureLogs,
                thresholds.get("crit_temp", 10.0),
            ),
            "remaining_transport_time": _remaining_transport_hours(ctx),
        }

    if agent == "traceability":
        return {
            **base,
            "events": ctx.events,
            "blockchain_status": ctx.blockchainStatus,
            "blockchain_verified": ctx.blockchainVerified,
        }

    if agent == "trust":
        return {**base, "upstream": upstream or {}}

    raise ValueError(f"no input builder for agent {agent!r}")


# ── The one place an agent is invoked ─────────────────────────────────────────

def run_agent(
    agent: str, ctx: BatchContext, upstream: dict[str, Any] | None = None
) -> dict[str, Any]:
    """
    Run one agent, converting every refusal into a status the caller can read.

    Nothing is caught and swallowed: each of these three exceptions means a
    specific, reportable thing, and the response says which.

    `upstream` carries the five agent predictions into the meta-agent.
    """
    loader = get_loader()
    module, label = AGENTS[agent]

    if not loader.is_available(agent):
        reason = loader.status_map.get(agent, {}).get("reason") or "artifact not loaded"
        return unavailable(agent, reason, label=label, modelLoaded=False)

    try:
        inputs = build_inputs(agent, ctx, upstream=upstream)
    except ValueError as exc:
        return unavailable(agent, str(exc), label=label, modelLoaded=True)

    try:
        result = module.predict(loader, inputs)
    except NotApplicable as exc:
        return not_applicable(agent, str(exc), label=label, modelLoaded=True)
    except MissingFeatures as exc:
        return not_applicable(
            agent, exc.reason, label=label, modelLoaded=True, missingFeatures=exc.features,
        )
    except AgentUnavailable as exc:
        return unavailable(agent, str(exc), label=label, modelLoaded=False)
    except Exception as exc:  # a real failure inside the model — surfaced, not hidden
        logger.exception("Agent %s failed", agent)
        return unavailable(agent, f"{type(exc).__name__}: {exc}", label=label, modelLoaded=True)

    result.setdefault("label", label)
    return result


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/registry")
async def registry(request: Request):
    """
    Real per-agent status. The UI renders this instead of assuming every agent
    is operational — an agent whose artifact is missing or unverified is
    reported as unavailable here, with the reason, rather than being displayed
    as running.
    """
    loader = get_loader()
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ")
    running = running_sklearn()
    agents = []

    for name, (module, label) in AGENTS.items():
        status = loader.status_map.get(name, {})
        loaded = bool(status.get("loaded"))
        metrics = _read_metrics(name)
        trained_on = status.get("sklearn_version")
        # An artifact fitted under a different scikit-learn still deserialises and
        # still looks healthy, but its predictions may be wrong or may raise — the
        # quality agent does exactly this under 1.8.0. Reported per agent so the
        # UI can show it rather than implying every loaded model is trustworthy.
        version_mismatch = bool(
            loaded and running and trained_on and trained_on != running
        )
        agents.append({
            "agent": name,
            "label": label,
            "status": OK if loaded else UNAVAILABLE,
            "modelLoaded": loaded,
            "algorithm": status.get("algorithm"),
            "sklearnVersion": trained_on,
            "runningSklearnVersion": running,
            "sklearnMismatch": version_mismatch,
            "artifact": status.get("artifact"),
            "reason": status.get("reason") or None,
            "requiredFeatures": list(getattr(module, "FEATURES", [])),
            "evaluation": metrics,
        })

    counts = {
        "ok": sum(1 for a in agents if a["status"] == OK),
        "unavailable": sum(1 for a in agents if a["status"] == UNAVAILABLE),
        "sklearnMismatch": sum(1 for a in agents if a["sklearnMismatch"]),
    }
    return {
        "success": True,
        "registryLoaded": loader.is_loaded(),
        "totalAgents": len(AGENTS),
        **counts,
        "agents": agents,
        "note": (
            "An agent reports OK only when its artifact passed its SHA-256 check and "
            "the model actually ran. NOT_APPLICABLE at request time means the input "
            "for that batch was missing, not that the agent is broken. "
            "sklearnMismatch marks an artifact fitted under a different scikit-learn "
            "than the service is running: it loads, but its predictions are not "
            "trustworthy and some inputs raise."
        ),
        "timestamp": now,
    }


@router.post("/traceability")
async def run_traceability(ctx: BatchContext, request: Request):
    return {"success": True, **run_agent("traceability", ctx), "computedAt": _now()}


@router.post("/quality")
async def run_quality(ctx: BatchContext, request: Request):
    return {"success": True, **run_agent("quality", ctx), "computedAt": _now()}


@router.post("/spoilage")
async def run_spoilage(ctx: BatchContext, request: Request):
    return {"success": True, **run_agent("spoilage", ctx), "computedAt": _now()}


@router.post("/fraud")
async def run_fraud(ctx: BatchContext, request: Request):
    return {"success": True, **run_agent("fraud", ctx), "computedAt": _now()}


@router.post("/compliance")
async def run_compliance(ctx: BatchContext, request: Request):
    return {"success": True, **run_agent("compliance", ctx), "computedAt": _now()}


@router.post("/trust")
async def run_trust(ctx: BatchContext, request: Request):
    return {"success": True, **run_agent("trust", ctx), "computedAt": _now()}


@router.post("/analyze")
async def analyze(req: AnalyzeRequest, request: Request):
    """
    The Consumer Trust verdict, composed.

    The five upstream agents run first and the meta-agent reads only what they
    concluded. Agents that decline are reported as declined: the trust agent
    then has no signal for that dimension and says so, rather than being fed a
    passing default that would inflate the verdict.
    """
    ctx = req.context
    upstream: dict[str, Any] = {}
    responses: list[dict[str, Any]] = []

    for name in UPSTREAM:
        res = run_agent(name, ctx)
        responses.append(res)
        if res.get("status") == OK:
            upstream[name] = res["prediction"]

    # The meta-agent reads only what the five concluded. When any of them
    # declined, its input is incomplete and it will decline too — so it goes
    # through the same converter as the rest. Calling `trust_agent.predict`
    # directly here raised MissingFeatures out of the handler, turning an
    # honest "cannot judge this batch" into a 500.
    trust = run_agent("trust", ctx, upstream=upstream)
    if trust.get("status") != OK:
        trust["upstream_status"] = {n: r["status"] for n, r in zip(UPSTREAM, responses)}
        trust["declined_agents"] = [
            n for n, r in zip(UPSTREAM, responses) if r["status"] != OK
        ]

    return {
        "success": True,
        "trust": trust,
        "upstream": {n: r for n, r in zip(UPSTREAM, responses)},
        "computedAt": _now(),
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _read_metrics(agent: str) -> dict[str, Any] | None:
    """Offline evaluation numbers, read from the repo — not recomputed at runtime."""
    import json
    from pathlib import Path
    path = Path(__file__).resolve().parent.parent / "agents" / f"metrics_{agent}.json"
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
