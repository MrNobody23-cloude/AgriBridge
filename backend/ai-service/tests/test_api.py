"""
AgriBridge AI Service — pytest integration tests.

All tests use the session-scoped `client` fixture from conftest.py,
which runs the FastAPI lifespan so ML models are trained and the
RAG pipeline is initialised before any request is made.

No real API keys are required — GEMINI_API_KEY is empty so the RAG
pipeline falls back to retrieval-only answers and the agents router
uses local fallback text.
"""
import pytest

# ── Health ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_health(client):
    response = await client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    # Status is "healthy" or "degraded" (never "ok")
    assert data["status"] in ("healthy", "degraded")
    # Top-level service map must be present
    assert "services" in data
    assert "ml_models" in data["services"]
    assert "rag_pipeline" in data["services"]


# ── Legacy /api/ml/* — not configured ─────────────────────────────────────────
#
# These four endpoints read the XGBoost/IsolationForest artifacts in
# ml/model_registry.py. Those artifacts are not in the repository: the registry
# records them as missing at startup and `get()` raises KeyError, which the
# router turns into a 503 naming the path it looked for.
#
# These tests used to assert `status_code == 200` plus a plausible-looking
# prediction. That is the behaviour this project must not have: an endpoint with
# no model behind it has nothing to predict, and returning a made-up risk score
# or quality grade would be indistinguishable, to every caller including the UI,
# from a real one. So they now assert the refusal, and the refusal has to name
# the reason — a bare 503 is not an honest answer, it is an absence of one.
#
# The trained agent pack in `models/agents/` is a separate surface with its own
# real models, served under /api/agents/v2 and covered by
# tests/test_agents_v2.py. Nothing here is a stand-in for it.


def _assert_declined(response, model_name):
    """The endpoint refused, said why, and returned no prediction."""
    assert response.status_code == 503, (
        f"{model_name} has no artifact in ml/model_registry, so this endpoint must "
        f"refuse. A 200 here would be a fabricated prediction."
    )
    detail = response.json()["detail"]
    assert model_name in detail
    assert "not configured" in detail
    # The message must point at the artifact that is missing, not just shrug.
    assert "no artifact at" in detail
    # Nothing that could be mistaken for a result.
    assert "prediction" not in response.json()


@pytest.mark.asyncio
async def test_ml_spoilage_prediction_declines_without_a_model(client):
    payload = {
        "batchId": "TEST-BATCH-SPOILAGE",
        "crop": "mango",
        "temperature": 26.5,
        "humidity": 85.0,
        "transit_days": 4,
        "days_since_harvest": 4,
        "cold_chain_deviations": 1,
    }
    _assert_declined(await client.post("/api/ml/spoilage/predict", json=payload), "spoilage")


@pytest.mark.asyncio
async def test_ml_quality_prediction_declines_without_a_model(client):
    payload = {
        "batchId": "TEST-BATCH-QUALITY",
        "crop": "mango",
        "temperature": 12.0,
        "humidity": 90.0,
        "days_since_harvest": 2,
        "cold_chain_deviations": 0,
        "num_certificates": 2,
        "has_organic_cert": True,
    }
    _assert_declined(await client.post("/api/ml/quality/predict", json=payload), "quality")


@pytest.mark.asyncio
async def test_ml_shelf_life_prediction_declines_without_a_model(client):
    payload = {
        "batchId": "TEST-BATCH-SHELF",
        "crop": "grapes",
        "temperature": 3.0,
        "humidity": 90.0,
        "transit_days": 7,
        "days_since_harvest": 7,
        "cold_chain_deviations": 0,
    }
    _assert_declined(await client.post("/api/ml/shelf-life/predict", json=payload), "shelf_life")


@pytest.mark.asyncio
async def test_ml_fraud_detection_declines_without_a_model(client):
    # Extreme values that a model would read as an anomaly — which is exactly
    # why this must not answer: there is nothing here to read them.
    payload = {
        "batchId": "TEST-BATCH-FRAUD",
        "quantity_ratio": 2.5,
        "cert_age_days": 400.0,
        "ownership_transfers": 8,
        "time_farm_to_export_days": 0.5,
        "temp_breach_count": 10,
        "duplicate_cert_score": 0.9,
        "route_deviation_km": 600.0,
    }
    _assert_declined(await client.post("/api/ml/fraud/analyze", json=payload), "fraud")


@pytest.mark.asyncio
async def test_ml_models_endpoint_names_every_unconfigured_model(client):
    """
    GET /api/ml/models is the discovery surface for the four above.

    It must list them as unconfigured, so a caller can find out *before* issuing
    a prediction request that there is nothing behind the endpoint.
    """
    response = await client.get("/api/ml/models")
    assert response.status_code == 200
    data = response.json()

    not_configured = data.get("notConfigured", data.get("not_configured", {}))
    for name in ("spoilage", "quality", "shelf_life", "fraud"):
        assert name in not_configured, (
            f"{name} has no artifact and must be reported as unconfigured"
        )
        assert not_configured[name], f"{name} must say why it is not configured"


# ── RAG Compliance Check ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_rag_compliance_check(client):
    payload = {
        "country": "EU",
        "crop": "Table Grapes",
        "batchId": "AGR-2026-EU-001",
    }
    response = await client.post("/api/rag/compliance/check", json=payload)
    assert response.status_code == 200
    data = response.json()

    # Country echoed back
    assert data["country"] == "EU"

    # Answer must be present (retrieval-only fallback is acceptable)
    assert "answer" in data
    assert len(data["answer"]) > 10

    # Sources list must be non-empty (FAISS retrieval should find regulation chunks)
    assert len(data.get("sources", [])) > 0


# ── Agent Orchestration ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_agent_orchestrate(client):
    payload = {
        "batchId": "AGR-2026-UK-123456",
        "batchData": {
            "batchCode": "AGR-2026-UK-123456",
            "product": {"name": "Basmati Rice"},
            "location": "Punjab, India",
            "harvestDate": "2026-09-01T00:00:00.000Z",
            "status": "IN_TRANSIT",
            "trustScore": 88,
            "blockchainHash": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            "destinationCountry": "UK",
            "events": [{"eventType": "HARVESTED", "actorRole": "FARMER", "location": "Punjab"}],
            "certificates": [{"certificateType": "ORGANIC", "verificationStatus": "VERIFIED"}],
            "fraudAlerts": [],
            "temperatureLogs": [{"temperature": 18.0, "humidity": 60.0}],
            "shipments": [],
            "chainVerification": {"verified": True, "status": "CONFIRMED_ON_CHAIN"},
        },
        "sensorData": [{"temperature": 18.0, "humidity": 60.0}],
    }
    response = await client.post("/api/agents/orchestrate", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert "agentResponses" in data
    # Supervisor must return exactly 6 agents (the 5 analysis agents + Consumer Trust)
    assert len(data["agentResponses"]) == 6

    agent_types = {r["agentType"] for r in data["agentResponses"]}
    assert agent_types == {"traceability", "fraud", "spoilage", "quality", "compliance", "consumer"}
