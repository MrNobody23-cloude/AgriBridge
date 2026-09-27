"""
Router-level tests for /api/agents/v2.

The loader is stubbed to report every agent unavailable, so nothing is
deserialised: what is under test is the router's own behaviour — that a missing
artifact becomes an UNAVAILABLE status carrying a reason, that the three agent
outcomes pass through distinct, and that the input builders pass through what
the caller actually supplied rather than filling gaps.

These tests drive the ASGI app through `asyncio.run` rather than relying on
pytest-asyncio, so they run on a bare interpreter that has pytest, fastapi and
httpx but not the async plugin.
"""
import asyncio

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from routers import agents_v2_router as v2


class OfflineLoader:
    """Reports every agent as unavailable, so nothing is ever deserialised."""

    def is_available(self, name):
        return False

    def is_loaded(self):
        return True

    def available_agents(self):
        return []

    def get(self, name):
        raise RuntimeError("unavailable in this stub")

    # The registry endpoint reads this directly, one entry per agent.
    status_map = {
        name: {
            "loaded": False,
            "reason": f"no artifact recorded for {name}",
            "algorithm": "RandomForestClassifier",
            "artifact": f"models/agents/{name}_model.pkl",
            "sklearn_version": None,
        }
        for name in v2.AGENTS
    }

    def status(self):
        return {
            "registryLoaded": True,
            "totalAgents": 6,
            "availableAgents": 0,
            "agents": [],
        }


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setattr(v2, "get_loader", lambda: OfflineLoader())
    test_app = FastAPI()
    test_app.include_router(v2.router, prefix="/api/agents/v2")
    return test_app


def _post(app, path, body):
    async def run():
        async with AsyncClient(transport=ASGITransport(app), base_url="http://test") as ac:
            res = await ac.post(path, json=body)
            return res.status_code, res.json()

    return asyncio.run(run())


def _get(app, path):
    async def run():
        async with AsyncClient(transport=ASGITransport(app), base_url="http://test") as ac:
            res = await ac.get(path)
            return res.status_code, res.json()

    return asyncio.run(run())


class TestUnavailableIsReportedNotFaked:
    @pytest.mark.parametrize("agent", sorted(v2.AGENTS))
    def test_every_agent_reports_unavailable_with_a_reason(self, app, agent):
        status, body = _post(app, f"/api/agents/v2/{agent}", {"batchId": "AG-1"})
        assert status == 200
        assert body["status"] == "UNAVAILABLE"
        assert body["prediction"] is None
        assert body["reason"], "an unavailable agent must say why"
        assert body["modelLoaded"] is False

    def test_registry_lists_all_six_with_status(self, app):
        status, body = _get(app, "/api/agents/v2/registry")
        assert status == 200
        assert body["success"] is True
        assert body["totalAgents"] == 6
        assert {a["agent"] for a in body["agents"]} == set(v2.AGENTS)
        for entry in body["agents"]:
            assert entry["status"] in ("OK", "UNAVAILABLE")
            assert entry["label"]
            if entry["status"] != "OK":
                assert entry["reason"]

    def test_analyze_reports_every_agent_it_ran(self, app):
        """
        `analyze` must account for all six agents and must not turn a batch it
        cannot judge into a 500. With every artifact missing, the five upstream
        agents decline, which leaves the meta-agent with no signal — it must
        decline too, naming what it was missing, rather than being scored on
        defaults.
        """
        status, body = _post(app, "/api/agents/v2/analyze", {"context": {"batchId": "AG-1"}})
        assert status == 200
        assert set(body["upstream"]) == set(v2.UPSTREAM)
        for name, res in body["upstream"].items():
            assert res["status"] == "UNAVAILABLE", name
            assert res["prediction"] is None, name

        trust = body["trust"]
        assert trust["status"] in ("UNAVAILABLE", "NOT_APPLICABLE")
        assert trust["prediction"] is None, "no verdict may be invented"
        assert trust["reason"], "the meta-agent must say why it cannot judge"
        assert set(trust["declined_agents"]) == set(v2.UPSTREAM)
        assert trust["upstream_status"]["quality"] == "UNAVAILABLE"

    def test_standalone_trust_declines_rather_than_scoring_on_nothing(self, app):
        """`POST /trust` with no upstream results has no five inputs to score."""
        status, body = _post(app, "/api/agents/v2/trust", {"batchId": "AG-1"})
        assert status == 200
        assert body["status"] != "OK"
        assert body["prediction"] is None


class TestVersionSkewIsDisclosed:
    """
    A pickle stores the class layout of the scikit-learn that fitted it.

    An artifact trained under a different version still deserialises and still
    looks healthy, so nothing else would notice — its predictions may quietly be
    wrong, or a supported input may raise. The registry has to say so, because
    "loaded" is not the same claim as "trustworthy".
    """

    def test_mismatch_is_flagged_per_agent(self, app, monkeypatch):
        monkeypatch.setattr(v2, "running_sklearn", lambda: "1.8.0")
        stub = OfflineLoader()
        stub.status_map = {
            name: {
                "loaded": True,
                "reason": "",
                "algorithm": "RandomForestRegressor",
                "artifact": f"models/agents/{name}_model.pkl",
                "sklearn_version": "1.7.1",
            }
            for name in v2.AGENTS
        }
        monkeypatch.setattr(v2, "get_loader", lambda: stub)

        status, body = _get(app, "/api/agents/v2/registry")
        assert status == 200
        assert body["sklearnMismatch"] == 6
        for entry in body["agents"]:
            assert entry["sklearnVersion"] == "1.7.1"
            assert entry["runningSklearnVersion"] == "1.8.0"
            assert entry["sklearnMismatch"] is True, entry["agent"]
            # It is still reported as loaded — the skew is a separate fact.
            assert entry["status"] == "OK", entry["agent"]

    def test_matching_versions_are_not_flagged(self, app, monkeypatch):
        monkeypatch.setattr(v2, "running_sklearn", lambda: "1.7.1")
        stub = OfflineLoader()
        stub.status_map = {
            name: {**OfflineLoader.status_map[name], "loaded": True, "reason": "",
                   "sklearn_version": "1.7.1"}
            for name in v2.AGENTS
        }
        monkeypatch.setattr(v2, "get_loader", lambda: stub)

        status, body = _get(app, "/api/agents/v2/registry")
        assert status == 200
        assert body["sklearnMismatch"] == 0
        assert all(a["sklearnMismatch"] is False for a in body["agents"])

    def test_unrecorded_version_is_not_claimed_to_match(self, app, monkeypatch):
        """
        An unknown training version must not read as "fine" — and must not read
        as a mismatch either, because the loader has no evidence of one.
        """
        monkeypatch.setattr(v2, "running_sklearn", lambda: "1.8.0")
        stub = OfflineLoader()
        stub.status_map = {
            name: {**OfflineLoader.status_map[name], "loaded": True, "reason": ""}
            for name in v2.AGENTS
        }
        monkeypatch.setattr(v2, "get_loader", lambda: stub)

        status, body = _get(app, "/api/agents/v2/registry")
        assert status == 200
        assert body["sklearnMismatch"] == 0
        for entry in body["agents"]:
            assert entry["sklearnVersion"] is None
            assert entry["sklearnMismatch"] is False


# ── Input building: what passes through, and what does not ───────────────────

class TestInputBuilding:
    def test_missing_fields_stay_missing(self):
        """Absent data must not be coerced to a number the model would believe."""
        ctx = v2.BatchContext(batchId="AG-1", productName="Alphonso Mango")
        inputs = v2.build_inputs("quality", ctx)
        assert inputs["temperature"] is None
        assert inputs["humidity"] is None
        assert inputs["moisture"] is None
        # storage_duration is a real derivation from harvestDate, so it is a
        # number; that is a computation, not a substituted measurement.
        assert isinstance(inputs["storage_duration"], float)

    def test_measured_residue_is_passed_through(self):
        ctx = v2.BatchContext(
            batchId="AG-1", productName="Alphonso Mango", pesticideResidueLevel=0.04
        )
        inputs = v2.build_inputs("compliance", ctx)
        assert inputs["pesticide_residue_level"] == 0.04
        assert inputs["residue_source"] == "measured"

    def test_unmeasured_residue_says_so(self):
        ctx = v2.BatchContext(batchId="AG-1", productName="Alphonso Mango")
        inputs = v2.build_inputs("compliance", ctx)
        assert inputs["pesticide_residue_level"] is None
        assert inputs["residue_source"] == "not_recorded"

    def test_fraud_marks_absence_of_shipment(self):
        ctx = v2.BatchContext(batchId="AG-1", productName="Alphonso Mango")
        inputs = v2.build_inputs("fraud", ctx)
        assert inputs["has_shipment"] is False

    def test_spoilage_remaining_time_needs_an_eta(self):
        ctx = v2.BatchContext(
            batchId="AG-1", productName="Alphonso Mango",
            shipment={"estimatedArrival": "2026-01-05T00:00:00Z", "departureDate": "2026-01-01T00:00:00Z"},
        )
        inputs = v2.build_inputs("spoilage", ctx)
        assert inputs["remaining_transport_time"] is not None
        assert inputs["remaining_transport_time"] > 0

    def test_spoilage_remaining_time_is_none_without_eta(self):
        ctx = v2.BatchContext(batchId="AG-1", productName="Alphonso Mango")
        assert v2.build_inputs("spoilage", ctx)["remaining_transport_time"] is None

    def test_explicit_remaining_time_wins(self):
        ctx = v2.BatchContext(batchId="AG-1", remainingTransportTime=12.0)
        assert v2.build_inputs("spoilage", ctx)["remaining_transport_time"] == 12.0

    def test_events_reach_the_traceability_agent(self):
        ctx = v2.BatchContext(
            batchId="AG-1",
            events=[{"eventType": "HARVESTED", "location": "Nashik",
                     "timestamp": "2026-01-01T00:00:00Z", "blockchainTransactionHash": "0x1"}],
        )
        assert len(v2.build_inputs("traceability", ctx)["events"]) == 1
