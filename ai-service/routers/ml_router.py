"""
ML Inference Router
Endpoints for spoilage, quality, shelf-life, and fraud prediction.
All predictions come from trained XGBoost / Isolation Forest models.
"""
import time
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

router = APIRouter()


class SpoilageRequest(BaseModel):
    batchId: str = Field(..., description="Batch ID or batch code")
    crop: str = Field(..., description="Crop name e.g. 'mango', 'grapes'")
    temperature: float = Field(..., ge=-20, le=60, description="Current temperature °C")
    humidity: Optional[float] = Field(75.0, ge=0, le=100)
    transit_days: int = Field(..., ge=0, le=365)
    days_since_harvest: Optional[int] = None
    distance_km: Optional[float] = None
    cold_chain_deviations: Optional[int] = 0


class ShelfLifeRequest(BaseModel):
    batchId: str
    crop: str
    temperature: float = Field(..., ge=-20, le=60)
    humidity: Optional[float] = 75.0
    transit_days: int = Field(..., ge=0)
    days_since_harvest: Optional[int] = None
    cold_chain_deviations: Optional[int] = 0


class QualityRequest(BaseModel):
    batchId: str
    crop: str
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    days_since_harvest: Optional[int] = None
    cold_chain_deviations: Optional[int] = 0
    num_certificates: Optional[int] = 1
    has_organic_cert: Optional[bool] = False


class FraudRequest(BaseModel):
    batchId: str
    quantity_ratio: float = Field(1.0, description="Shipment quantity / farm quantity")
    cert_age_days: float = Field(30.0)
    ownership_transfers: int = Field(2)
    time_farm_to_export_days: float = Field(10.0)
    temp_breach_count: int = Field(0)
    duplicate_cert_score: float = Field(0.0, ge=0, le=1)
    route_deviation_km: float = Field(50.0)


@router.post("/spoilage/predict")
async def predict_spoilage(req: SpoilageRequest, request: Request):
    registry = request.app.state.model_registry
    try:
        model = registry.get("spoilage")
        metadata = registry.get_metadata("spoilage")
    except KeyError as e:
        raise HTTPException(status_code=503, detail=str(e).strip('"').strip('"'))

    from ml.inference import predict_spoilage
    result = predict_spoilage(model, metadata, {
        "crop": req.crop,
        "temperature": req.temperature,
        "humidity": req.humidity or 75.0,
        "transit_days": req.transit_days,
        "days_since_harvest": req.days_since_harvest or req.transit_days,
        "distance_km": req.distance_km or 500.0,
        "cold_chain_deviations": req.cold_chain_deviations or 0,
    })
    return {"success": True, "batchId": req.batchId, **result, "computedAt": _now()}


@router.post("/shelf-life/predict")
async def predict_shelf_life(req: ShelfLifeRequest, request: Request):
    registry = request.app.state.model_registry
    try:
        model = registry.get("shelf_life")
        metadata = registry.get_metadata("shelf_life")
    except KeyError as e:
        raise HTTPException(status_code=503, detail=str(e).strip('"'))

    from ml.inference import predict_shelf_life
    result = predict_shelf_life(model, metadata, {
        "crop": req.crop,
        "temperature": req.temperature,
        "humidity": req.humidity or 75.0,
        "transit_days": req.transit_days,
        "days_since_harvest": req.days_since_harvest or req.transit_days,
        "cold_chain_deviations": req.cold_chain_deviations or 0,
    })
    return {"success": True, "batchId": req.batchId, **result, "computedAt": _now()}


@router.post("/quality/predict")
async def predict_quality(req: QualityRequest, request: Request):
    registry = request.app.state.model_registry
    try:
        model = registry.get("quality")
        metadata = registry.get_metadata("quality")
    except KeyError as e:
        raise HTTPException(status_code=503, detail=str(e).strip('"'))

    from ml.inference import predict_quality
    result = predict_quality(model, metadata, {
        "crop": req.crop,
        "temperature": req.temperature or 12.0,
        "humidity": req.humidity or 75.0,
        "days_since_harvest": req.days_since_harvest or 3,
        "cold_chain_deviations": req.cold_chain_deviations or 0,
        "num_certificates": req.num_certificates or 1,
        "has_organic_cert": req.has_organic_cert or False,
    })
    return {"success": True, "batchId": req.batchId, **result, "computedAt": _now()}


@router.post("/fraud/analyze")
async def analyze_fraud(req: FraudRequest, request: Request):
    registry = request.app.state.model_registry
    try:
        model = registry.get("fraud")
        metadata = registry.get_metadata("fraud")
    except KeyError as e:
        raise HTTPException(status_code=503, detail=str(e).strip('"'))

    from ml.inference import detect_fraud_anomaly
    result = detect_fraud_anomaly(model, metadata, req.model_dump())
    return {"success": True, "batchId": req.batchId, **result, "computedAt": _now()}


@router.get("/models")
async def list_models(request: Request):
    """
    What is actually loaded.

    Models with no artifact on disk are reported under `notConfigured` with
    the reason, rather than being quietly omitted or trained up front so they
    would appear to be working.
    """
    registry = request.app.state.model_registry
    return {
        "success": True,
        "models": {
            name: registry.get_metadata(name)
            for name in ["spoilage", "quality", "shelf_life", "fraud"]
            if name in registry.models
        },
        "notConfigured": getattr(registry, "missing", {}),
    }


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
