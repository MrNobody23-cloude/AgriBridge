"""
AgriBridge AI — Trained Agent Pack

Six scikit-learn agents, trained offline, served here against live AgriBridge
data. Each module exposes the same entry point:

    predict(loader, inputs: dict) -> dict

The `inputs` dictionary is assembled per request from the database by
`agents.mapping`; the `loader` is an `agents.loader.AgentModelLoader` that has
already verified each artifact's SHA-256 before deserialising it.

An agent never invents a value it was not given. Every agent has three honest
outcomes, distinguished by the `status` key of its response:

    status="ok"                  the model ran and the number is real
    status="not_applicable"      a required input does not exist for this batch
    status="unavailable"         the artifact is missing, unverified, or failed

`status="ok"` is never returned for a number the model did not produce.

Module map
    constants.py     MRL limits, crop thresholds, algorithm strings
    mapping.py       AgriBridge rows -> model feature rows, crop resolution
    base.py          the ok / not_applicable / unavailable response envelope
    loader.py        digest-verified artifact cache
    *_agent.py       one per agent
    generate_digests.py  (re)writes models/agents/DIGESTS.json
"""
from agents.base import (
    NOT_APPLICABLE,
    OK,
    UNAVAILABLE,
    MissingFeatures,
    NotApplicable,
    not_applicable,
    ok,
    require,
    to_frame,
    unavailable,
)
from agents.loader import (
    AgentModelLoader,
    AgentUnavailable,
    record_training_environment,
    running_sklearn,
    trained_on_sklearn,
)

__all__ = [
    "AGENT_NAMES",
    "NOT_APPLICABLE",
    "OK",
    "UNAVAILABLE",
    "AgentModelLoader",
    "AgentUnavailable",
    "MissingFeatures",
    "NotApplicable",
    "get_loader",
    "not_applicable",
    "ok",
    "record_training_environment",
    "require",
    "running_sklearn",
    "to_frame",
    "trained_on_sklearn",
    "unavailable",
]

AGENT_NAMES = ["traceability", "quality", "spoilage", "fraud", "compliance", "trust"]

_loader: AgentModelLoader | None = None


def get_loader() -> AgentModelLoader:
    """
    Process-wide loader, loaded once on first use.

    The FastAPI lifespan calls ``load_all()`` explicitly at startup so a
    slow first request cannot time out; this is the fallback for tests and
    for any caller that reaches an agent without going through the app.
    """
    global _loader
    if _loader is None:
        _loader = AgentModelLoader()
        _loader.load_all()
    return _loader
