"""
Tests for the six trained agents.

What these tests deliberately do NOT do
---------------------------------------
They never unpickle an artifact. `pickle.load` executes code embedded in the
file, so a test suite that loads one is a test suite that can only run on a
machine that has decided to trust every `.pkl` in the tree. Instead they
exercise everything around the load — the digest gate, the input mapping, the
refusal paths — which is where the honesty guarantees actually live, and they
use a fake loader to drive the agent bodies.

The one thing that needs the real artifacts is `test_registry_reports_every
_agent`, which asserts the loader's *status*, not a prediction, and is skipped
when the artifacts are absent.
"""
import hashlib
import json

import pandas as pd
import pytest
from agents import (
    AGENT_NAMES,
    compliance_agent,
    fraud_agent,
    quality_agent,
    spoilage_agent,
    traceability_agent,
    trust_agent,
)
from agents.base import MissingFeatures
from agents.constants import CROP_SPOILAGE_THRESHOLDS
from agents.loader import DIGEST_FILE, MODEL_DIR, AgentModelLoader
from agents.mapping import (
    IN_DOMAIN,
    MATCHED,
    OUT_OF_DOMAIN,
    InDomain,
    require_crop,
    resolve_crop,
    temperature_stats,
)


class FakeLoader:
    """Stands in for AgentModelLoader. Records what an agent asked for."""

    def __init__(self, available=True, model=None):
        self._available = available
        self._model = model
        self.requested = []

    def get(self, name):
        self.requested.append(name)
        if not self._available:
            raise RuntimeError("not loaded")
        return self._model


# ── Crop resolution ──────────────────────────────────────────────────────────

class TestCropResolution:
    def test_trained_crops_match(self):
        for name in ("Mango", "Tomato", "Potato", "Banana", "Onion"):
            res = resolve_crop(name)
            assert res["ok"] and res["crop_type"] == name
            assert res["mapping"] == MATCHED

    def test_seeded_catalogue_resolves(self):
        # AgriBridge's own product catalogue, none of which is a trained crop
        # name except Alphonso Mango.
        for name in ("Alphonso Mango", "Basmati Rice", "Nashik Grapes",
                     "Kesar Saffron", "Darjeeling Tea"):
            res = resolve_crop(name)
            assert res["ok"], f"{name} should resolve to a trained profile"
            assert res["crop_type"] in CROP_SPOILAGE_THRESHOLDS

    def test_unknown_crop_is_refused_not_guessed(self):
        res = resolve_crop("Kashmiri Walnut")
        assert not res["ok"]
        assert res["mapping"] == OUT_OF_DOMAIN
        with pytest.raises(InDomain):
            require_crop("Kashmori Walnut")

    def test_missing_name_refuses(self):
        assert not resolve_crop(None)["ok"]
        assert not resolve_crop("")["ok"]

    def test_transfers_are_labelled(self):
        res = resolve_crop("Nashik Grapes")
        assert res["mapping"] == IN_DOMAIN
        assert "grapes" in res["note"].lower()


# ── Feature assembly ─────────────────────────────────────────────────────────

class TestFeatureAssembly:
    def test_no_logs_means_no_temperature(self):
        stats = temperature_stats([])
        assert stats["available"] is False
        assert stats["current_temperature"] is None
        assert stats["humidity"] is None

    def test_latest_reading_is_current(self):
        # Prisma is asked for `timestamp desc`, so logs arrive newest-first and
        # "current" is the head of the list.
        logs = [{"temperature": 30.0, "humidity": 80.0}, {"temperature": 4.0, "humidity": 75.0}]
        stats = temperature_stats(logs)
        assert stats["current_temperature"] == 30.0
        assert stats["temperature_variance"] > 0

    def test_simulated_readings_are_flagged(self):
        stats = temperature_stats([{"temperature": 5.0, "isSimulated": True}])
        assert stats["simulated_only"] is True

    def test_real_readings_are_not_flagged_simulated(self):
        stats = temperature_stats([{"temperature": 5.0, "isSimulated": False}])
        assert stats["simulated_only"] is False


# ── Refusals: the load-bearing behaviour ─────────────────────────────────────

class TestAgentsRefuseRatherThanInvent:
    def test_compliance_refuses_without_residue(self):
        """AgriBridge stores no lab residue result, so this is the normal path."""
        with pytest.raises(MissingFeatures) as exc:
            compliance_agent.predict(FakeLoader(), {
                "product_name": "Alphonso Mango",
                "pesticide_residue_level": None,
                "certificate_expiry_days_remaining": 120,
            })
        assert "pesticide_residue_level" in exc.value.features

    def test_compliance_refuses_without_expiry(self):
        with pytest.raises(MissingFeatures):
            compliance_agent.predict(FakeLoader(), {
                "product_name": "Alphonso Mango",
                "pesticide_residue_level": 0.02,
                "certificate_expiry_days_remaining": None,
            })

    def test_spoilage_refuses_without_transit_eta(self):
        with pytest.raises(MissingFeatures) as exc:
            spoilage_agent.predict(FakeLoader(), {
                "product_name": "Alphonso Mango",
                "current_days_since_harvest": 3.0,
                "remaining_transport_time": None,
                "current_temperature": 13.0,
                "temperature_variance": 1.2,
                "humidity": 85.0,
                "num_temperature_breaches": 0,
            })
        assert "remaining_transport_time" in exc.value.features

    def test_spoilage_refuses_without_telemetry(self):
        with pytest.raises(MissingFeatures) as exc:
            spoilage_agent.predict(FakeLoader(), {
                "product_name": "Alphonso Mango",
                "remaining_transport_time": 24.0,
                "current_temperature": None,
                "temperature_variance": None,
            })
        assert "current_temperature" in exc.value.features

    def test_fraud_refuses_without_shipment(self):
        with pytest.raises(MissingFeatures) as exc:
            fraud_agent.predict(FakeLoader(), {
                "product_name": "Alphonso Mango",
                "has_shipment": False,
            })
        assert exc.value.features

    def test_fraud_refuses_on_unknown_crop(self):
        with pytest.raises(InDomain):
            fraud_agent.predict(FakeLoader(), {
                "product_name": "Kashmiri Walnut",
                "has_shipment": True,
                "quantity_kg": 100, "transport_hours": 10, "distance_km": 200,
                "transaction_value": 5000, "certificate_age_days": 30,
                "ownership_transfers": 3,
            })

    def test_quality_refuses_without_any_reading(self):
        with pytest.raises(MissingFeatures) as exc:
            quality_agent.predict(FakeLoader(), {
                "product_name": "Alphonso Mango",
                "temperature": None, "humidity": None,
                "storage_duration": 3.0, "transportation_duration": 1.0,
                "moisture": None,
            })
        assert "temperature" in exc.value.features

    def test_trust_refuses_without_all_five_upstream(self):
        """A passing default for a missing agent would inflate the verdict."""
        with pytest.raises(MissingFeatures) as exc:
            trust_agent.predict(FakeLoader(), {
                "batch_id": "AG-1",
                "upstream": {"traceability": {"confidence_score": 90}, "quality": {"quality_score": 80}},
            })
        assert set(exc.value.features) == {"spoilage", "fraud", "compliance"}

    def test_traceability_refuses_on_empty_events(self):
        with pytest.raises(MissingFeatures) as exc:
            traceability_agent.predict(FakeLoader(), {"batch_id": "AG-1", "events": []})
        assert "events" in exc.value.features

    def test_traceability_refuses_when_no_tx_hashes(self):
        """Absent hashes are uncheckable links, not valid ones."""
        events = [
            {"eventType": "FARM_REGISTERED", "location": "Nashik", "timestamp": "2026-01-01T00:00:00Z"},
            {"eventType": "HARVESTED", "location": "Nashik", "timestamp": "2026-01-02T00:00:00Z"},
            {"eventType": "EXPORTED", "location": "Mumbai", "timestamp": "2026-01-03T00:00:00Z"},
        ]
        with pytest.raises(MissingFeatures) as exc:
            traceability_agent.predict(FakeLoader(), {"batch_id": "AG-1", "events": events})
        assert "blockchainTransactionHash" in exc.value.features

    def test_traceability_discloses_its_chain_limitation(self):
        assert "prev_hash" in traceability_agent.CHAIN_LIMITATION
        assert "not deployed" in traceability_agent.CHAIN_LIMITATION


# ── Traceability feature extraction ──────────────────────────────────────────

class TestTraceabilityFeatures:
    def test_repeated_tx_hash_is_an_issue(self):
        events = [
            {"eventType": "FARM_REGISTERED", "location": "Nashik", "timestamp": "2026-01-01T00:00:00Z",
             "blockchainTransactionHash": "0xaaa"},
            {"eventType": "HARVESTED", "location": "Nashik", "timestamp": "2026-01-02T00:00:00Z",
             "blockchainTransactionHash": "0xaaa"},
        ]
        prepared, _ = traceability_agent.prepare_events(events)
        feats = traceability_agent.extract_features(prepared)
        assert feats["hash_chain_available"] is True
        # A duplicate is a *broken* link. Scoring it as intact once inverted
        # this condition handed the -40 deduction to every real batch and a
        # clean bill to the tampered one.
        assert feats["hash_chain_valid_ratio"] == 0.0
        assert any("repeats the transaction hash" in i for i in feats["issues"])

    def test_distinct_tx_hashes_are_an_intact_link(self):
        events = [
            {"eventType": "FARM_REGISTERED", "location": "Nashik", "timestamp": "2026-01-01T00:00:00Z",
             "blockchainTransactionHash": "0xaaa"},
            {"eventType": "HARVESTED", "location": "Nashik", "timestamp": "2026-01-02T00:00:00Z",
             "blockchainTransactionHash": "0xbbb"},
        ]
        feats = traceability_agent.extract_features(traceability_agent.prepare_events(events)[0])
        assert feats["hash_chain_valid_ratio"] == 1.0
        assert not any("transaction hash" in i for i in feats["issues"])

    def test_ratio_counts_only_comparable_links(self):
        """
        One checkable link and one uncheckable link: the ratio describes the link
        that can actually be verified, and the gap is reported separately rather
        than dragging the ratio down to a false alarm.

        The two hash-bearing events have to be *adjacent* — a lone hash in the
        middle of a chain forms no comparable pair at all, because both of its
        links are then uncheckable.
        """
        events = [
            {"eventType": "FARM_REGISTERED", "location": "Nashik", "timestamp": "2026-01-01T00:00:00Z",
             "blockchainTransactionHash": "0xaaa"},
            {"eventType": "HARVESTED", "location": "Nashik", "timestamp": "2026-01-02T00:00:00Z",
             "blockchainTransactionHash": "0xbbb"},
            {"eventType": "INSPECTED", "location": "Nashik", "timestamp": "2026-01-03T00:00:00Z"},
        ]
        feats = traceability_agent.extract_features(traceability_agent.prepare_events(events)[0])
        assert feats["hash_chain_valid_ratio"] == 1.0, "one comparable link, and it is intact"
        assert feats["links_total"] == 1
        assert feats["links_uncheckable"] == 1

    def test_a_lone_hash_yields_no_comparable_link(self):
        """Neither link is checkable, so the ratio stays empty rather than 1.0."""
        events = [
            {"eventType": "FARM_REGISTERED", "location": "Nashik", "timestamp": "2026-01-01T00:00:00Z",
             "blockchainTransactionHash": "0xaaa"},
            {"eventType": "INSPECTED", "location": "Nashik", "timestamp": "2026-01-02T00:00:00Z"},
            {"eventType": "HARVESTED", "location": "Nashik", "timestamp": "2026-01-03T00:00:00Z"},
        ]
        feats = traceability_agent.extract_features(traceability_agent.prepare_events(events)[0])
        assert feats["links_total"] == 0
        assert feats["hash_chain_available"] is False

    def test_backward_timestamp_detected(self):
        """
        A record back-dated ahead of its predecessor must be reported.

        Note the chain is supplied *out of* chronological order on purpose, and
        `prepare_events` must not tidy it up: re-sorting by the very field being
        checked would make this failure impossible to express, and would let a
        back-dated custody record be silently laundered into a clean chain.
        """
        events = [
            {"eventType": "FARM_REGISTERED", "location": "Nashik", "timestamp": "2026-01-05T00:00:00Z",
             "blockchainTransactionHash": "0xaaa"},
            {"eventType": "HARVESTED", "location": "Nashik", "timestamp": "2026-01-02T00:00:00Z",
             "blockchainTransactionHash": "0xbbb"},
        ]
        prepared, _ = traceability_agent.prepare_events(events)
        assert [e["event_type"] for e in prepared] == ["FARM_REGISTERED", "HARVESTED"], \
            "prepare_events must preserve the order the events were recorded in"

        feats = traceability_agent.extract_features(prepared)
        assert feats["negative_time_gaps_count"] == 1
        assert feats["min_time_gap_hrs"] < 0
        assert feats["hash_chain_valid_ratio"] == 1.0

    def test_offset_timestamps_are_compared_as_instants(self):
        """
        A record stamped 09:00+05:30 is 03:30 UTC; one stamped 08:00-05:00 is
        13:00 UTC. Comparing the *text* would call the 13:00Z record the
        earlier of the two, because "09:00+05:30" sorts before "08:00-05:00"
        only by coincidence of the hour digits. The gap must come from the
        parsed instants.
        """
        events = [
            # Recorded first, but actually LATER (13:00 UTC).
            {"eventType": "FARM_REGISTERED", "location": "Nashik",
             "timestamp": "2026-01-05T08:00:00-05:00", "blockchainTransactionHash": "0xaaa"},
            # Recorded second, but actually EARLIER (03:30 UTC).
            {"eventType": "HARVESTED", "location": "Nashik",
             "timestamp": "2026-01-05T09:00:00+05:30", "blockchainTransactionHash": "0xbbb"},
        ]
        prepared, _ = traceability_agent.prepare_events(events)
        # The chain genuinely runs backwards by 9.5 hours, and saying so is
        # correct — a lexical comparison would have missed it entirely.
        feats = traceability_agent.extract_features(prepared)
        assert feats["min_time_gap_hrs"] == pytest.approx(-9.5)
        assert feats["negative_time_gaps_count"] == 1

    def test_offsets_written_in_true_order_are_clean(self):
        """
        The same two records supplied in the order they really happened must
        come out clean. Without instant-based arithmetic the two cases above
        and here are indistinguishable, and a clean chain picks up a 50-point
        deduction for a timezone rendering.
        """
        events = [
            {"eventType": "HARVESTED", "location": "Nashik",
             "timestamp": "2026-01-05T09:00:00+05:30", "blockchainTransactionHash": "0xbbb"},
            {"eventType": "FARM_REGISTERED", "location": "Nashik",
             "timestamp": "2026-01-05T08:00:00-05:00", "blockchainTransactionHash": "0xaaa"},
        ]
        feats = traceability_agent.extract_features(traceability_agent.prepare_events(events)[0])
        assert feats["negative_time_gaps_count"] == 0
        assert feats["min_time_gap_hrs"] == pytest.approx(9.5)

    def test_unparseable_timestamp_takes_no_part_in_gap_maths(self):
        events = [
            {"eventType": "FARM_REGISTERED", "location": "Nashik",
             "timestamp": "not-a-date", "blockchainTransactionHash": "0xaaa"},
            {"eventType": "HARVESTED", "location": "Nashik",
             "timestamp": "2026-01-02T00:00:00Z", "blockchainTransactionHash": "0xbbb"},
        ]
        prepared, _ = traceability_agent.prepare_events(events)
        # It keeps its place rather than being dropped or silently relocated.
        assert [e["event_type"] for e in prepared] == ["FARM_REGISTERED", "HARVESTED"]
        # ...and it must not manufacture a gap in either direction.
        assert traceability_agent.extract_features(prepared)["negative_time_gaps_count"] == 0

    def test_order_limitation_is_disclosed(self):
        assert "immutable event-creation time" in traceability_agent.ORDER_LIMITATION

    def test_out_of_order_roles_detected(self):
        events = [
            {"eventType": "EXPORTED", "actorRole": "TRANSPORTER", "location": "Mumbai",
             "timestamp": "2026-01-01T00:00:00Z", "blockchainTransactionHash": "0xaaa"},
            {"eventType": "FARM_REGISTERED", "actorRole": "FARMER", "location": "Nashik",
             "timestamp": "2026-01-02T00:00:00Z", "blockchainTransactionHash": "0xbbb"},
        ]
        prepared, _ = traceability_agent.prepare_events(events)
        feats = traceability_agent.extract_features(prepared)
        assert feats["role_sequence_valid"] == 0

    def test_unresolvable_location_is_not_evaluated_not_zero(self):
        events = [
            {"eventType": "FARM_REGISTERED", "location": "Atlantis", "timestamp": "2026-01-01T00:00:00Z",
             "blockchainTransactionHash": "0xaaa"},
            {"eventType": "EXPORTED", "location": "Narnia", "timestamp": "2026-01-05T00:00:00Z",
             "blockchainTransactionHash": "0xbbb"},
        ]
        prepared, _ = traceability_agent.prepare_events(events)
        feats = traceability_agent.extract_features(prepared)
        assert feats["speed_check_evaluated"] is False
        assert feats["max_speed_kmh"] == traceability_agent.NEG_INF

    def test_geofence_resolution(self):
        assert traceability_agent.resolve_location("FARM_NASHIK")[1] == "exact_geofence"
        assert traceability_agent.resolve_location("Nashik, Maharashtra")[1] == "city_match"
        assert traceability_agent.resolve_location("Atlantis")[0] is None
        assert traceability_agent.resolve_location(None)[0] is None


# ── Digest gate ──────────────────────────────────────────────────────────────

class TestDigestGate:
    def test_digest_file_exists_and_covers_every_agent(self):
        assert DIGEST_FILE.exists(), (
            "run `python agents/generate_digests.py` — without recorded digests the "
            "loader refuses to deserialise any artifact"
        )
        with open(DIGEST_FILE, encoding="utf-8") as f:
            recorded = json.load(f)["models"]
        assert set(recorded) == set(AGENT_NAMES)
        for name, entry in recorded.items():
            assert len(entry["sha256"]) == 64

    @pytest.mark.skipif(
        not (MODEL_DIR / "trust_model.pkl").exists(),
        reason="trust artifact not present",
    )
    def test_recorded_digest_matches_artifact_on_disk(self):
        with open(DIGEST_FILE, encoding="utf-8") as f:
            recorded = json.load(f)["models"]
        for name in AGENT_NAMES:
            path = MODEL_DIR / f"{name}_model.pkl"
            if not path.exists():
                continue
            h = hashlib.sha256()
            with open(path, "rb") as fh:
                for chunk in iter(lambda: fh.read(1 << 20), b""):
                    h.update(chunk)
            assert h.hexdigest() == recorded[name]["sha256"], f"{name} was modified"


# ── Registry status, without loading anything ────────────────────────────────

def test_loader_rejects_a_tampered_artifact_before_deserialising(tmp_path, monkeypatch):
    """
    The security property, tested without executing a single artifact.

    A file whose bytes do not match its recorded digest must be rejected
    *before* `pickle.load` sees it. To prove the ordering, the "artifact" here
    is not a pickle at all — if the loader ever tried to deserialise it, the
    test would fail with an unpickling error rather than a checksum error.
    """
    import agents.loader as loader_mod

    model_dir = tmp_path / "models"
    model_dir.mkdir()
    (model_dir / "trust_model.pkl").write_bytes(b"not a pickle at all")

    # Record the *real* digest, then swap the bytes underneath it.
    reg = AgentModelLoader()
    monkeypatch.setattr(loader_mod, "MODEL_DIR", model_dir)
    monkeypatch.setattr(loader_mod, "DIGEST_FILE", model_dir / "DIGESTS.json")
    reg.write_digests()
    assert (model_dir / "trust_model.pkl").exists()
    (model_dir / "trust_model.pkl").write_bytes(b"tampered")

    reg.load_all()

    status = {a["agent"]: a for a in reg.status()["agents"]}
    assert status["trust"]["loaded"] is False
    assert "SHA-256 mismatch" in status["trust"]["reason"]
    # Every other agent had no artifact at all, and says so rather than raising.
    assert status["quality"]["loaded"] is False
    assert "missing" in status["quality"]["reason"]


def test_loader_refuses_artifacts_with_no_recorded_digest(tmp_path, monkeypatch):
    """
    An artifact nobody has vouched for is not loaded, even if it is a valid
    pickle. This is what stops a `.pkl` dropped into the folder by accident —
    or by someone who found the directory — from being executed at startup.
    """
    import agents.loader as loader_mod

    model_dir = tmp_path / "models"
    model_dir.mkdir()
    (model_dir / "trust_model.pkl").write_bytes(b"anything")
    # No DIGESTS.json written at all.

    reg = AgentModelLoader()
    monkeypatch.setattr(loader_mod, "MODEL_DIR", model_dir)
    monkeypatch.setattr(loader_mod, "DIGEST_FILE", model_dir / "DIGESTS.json")
    reg.load_all()

    assert reg.available_agents() == []
    assert reg.is_loaded(), "the registry must still finish, so the service starts"
    for entry in reg.status()["agents"]:
        assert entry["loaded"] is False
        assert "digest" in entry["reason"] or "missing" in entry["reason"]


def test_registry_status_shape():
    """Six entries, each with the fields the Agents page renders."""
    reg = AgentModelLoader()
    reg._loaded = True
    for name in AGENT_NAMES:
        reg._mark(name, False, "not loaded in this test")
    reg.models.clear()

    status = reg.status()
    assert status["totalAgents"] == 6
    assert status["availableAgents"] == 0
    assert {a["agent"] for a in status["agents"]} == set(AGENT_NAMES)
    for entry in status["agents"]:
        assert set(entry) >= {"agent", "loaded", "reason", "algorithm", "artifact"}
        assert entry["reason"], "an unavailable agent must say why"


# ── Response envelope ────────────────────────────────────────────────────────

class TestResponseEnvelope:
    def test_ok_predicts_have_a_prediction(self):
        from agents.base import not_applicable, ok, unavailable
        assert ok("quality", {"x": 1})["status"] == "OK"
        assert not_applicable("quality", "no data")["prediction"] is None
        assert unavailable("quality", "no artifact")["prediction"] is None

    def test_to_frame_preserves_order(self):
        from agents.base import to_frame
        frame = to_frame({"b": 1, "a": 2})
        assert list(frame.columns) == ["b", "a"]
        assert isinstance(frame, pd.DataFrame)
