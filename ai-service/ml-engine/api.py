"""
api.py — FastAPI Service for AgriBridge ML Engine
One POST endpoint per agent. Each model is loaded ONCE at startup (not per-request).
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List, Any
import uvicorn

from agents import traceability, quality, spoilage, fraud, compliance, trust

# ── Load models once at startup ──────────────────────────────────────────────
try:
    from utils import load_pickle
    _traceability_model = load_pickle("traceability_model.pkl")
    _quality_model      = load_pickle("quality_model.pkl")
    _spoilage_model     = load_pickle("spoilage_model.pkl")
    _fraud_model        = load_pickle("fraud_model.pkl")
    _compliance_model   = load_pickle("compliance_model.pkl")
    _trust_model        = load_pickle("trust_model.pkl")
    print("✓ All 6 agent models loaded successfully.")
except FileNotFoundError as e:
    print(f"⚠  Model file not found: {e}. Run train.py first.")

# ── FastAPI App ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="AgriBridge ML Engine API",
    description="Six AI agents for agricultural supply chain intelligence",
    version="1.0.0"
)

# ── Request / Response Schemas ────────────────────────────────────────────────

class TraceabilityEvent(BaseModel):
    event_type: str
    actor_role: str
    timestamp: str
    location: str
    prev_hash: str
    tx_hash: str

class TraceabilityRequest(BaseModel):
    batch_id: str = Field(..., example="AG-2847")
    events: List[TraceabilityEvent]

class QualityRequest(BaseModel):
    batch_id: str = Field(..., example="AG-8821")
    crop_type: str = Field(..., example="Mango")
    temperature: float = Field(..., example=18.5)
    humidity: float = Field(..., example=85.0)
    storage_duration: float = Field(..., example=3.0)
    transportation_duration: float = Field(..., example=2.0)
    moisture: Optional[float] = Field(None, example=82.0)

class SpoilageRequest(BaseModel):
    batch_id: str = Field(..., example="EX-1917")
    crop_type: str = Field(..., example="Mango")
    current_days_since_harvest: float = Field(..., example=6.0)
    remaining_transport_time: float = Field(..., example=3.5)
    current_temperature: float = Field(..., example=28.0)
    temperature_variance: float = Field(..., example=4.0)
    humidity: float = Field(..., example=75.0)
    num_temperature_breaches: int = Field(..., example=3)

class FraudRequest(BaseModel):
    batch_id: str = Field(..., example="EX-1923")
    quantity_kg: float = Field(..., example=5000.0)
    transport_hours: float = Field(..., example=10.0)
    distance_km: float = Field(..., example=400.0)
    transaction_value: float = Field(..., example=12000.0)
    certificate_age_days: int = Field(..., example=45)
    ownership_transfers: int = Field(..., example=3)

class ComplianceRequest(BaseModel):
    batch_id: str = Field(..., example="EX-1923")
    crop_type: str = Field(..., example="Mango")
    pesticide_residue_level: float = Field(..., example=0.08)
    certification_valid: int = Field(..., example=1)
    certificate_expiry_days_remaining: int = Field(..., example=120)
    destination_market: str = Field(..., example="EU")

class TrustRequest(BaseModel):
    batch_id: str = Field(..., example="AG-2835")
    traceability_confidence: float = Field(..., example=96.0)
    quality_score: float = Field(..., example=82.0)
    spoilage_risk_pct: float = Field(..., example=15.0)
    fraud_flagged: Any = Field(False, example=False)
    compliance_status: Any = Field("PASS", example="PASS")

# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/", tags=["Health"])
def root():
    return {"service": "AgriBridge ML Engine", "status": "online", "agents": 6}

@app.get("/health", tags=["Health"])
def health():
    return {"status": "healthy", "service": "agribridge-ml-engine"}

@app.post("/predict/traceability", tags=["Agents"])
def predict_traceability(req: TraceabilityRequest):
    try:
        input_dict = {
            "batch_id": req.batch_id,
            "events": [e.model_dump() for e in req.events]
        }
        return traceability.predict(input_dict)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/predict/quality", tags=["Agents"])
def predict_quality(req: QualityRequest):
    try:
        return quality.predict(req.model_dump())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/predict/spoilage", tags=["Agents"])
def predict_spoilage(req: SpoilageRequest):
    try:
        return spoilage.predict(req.model_dump())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/predict/fraud", tags=["Agents"])
def predict_fraud(req: FraudRequest):
    try:
        return fraud.predict(req.model_dump())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/predict/compliance", tags=["Agents"])
def predict_compliance(req: ComplianceRequest):
    try:
        return compliance.predict(req.model_dump())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/predict/trust", tags=["Agents"])
def predict_trust(req: TrustRequest):
    try:
        return trust.predict(req.model_dump())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run("api:app", host="0.0.0.0", port=8001, reload=False)
