"""
Fraud Agent — RandomForestClassifier over a StandardScaler pipeline.

Model input (6 features, exactly the training contract):
    quantity_kg, transport_hours, distance_km, transaction_value,
    certificate_age_days, ownership_transfers

`fraud_type` is NOT a model output. It is a post-hoc heuristic applied to an
already-flagged batch so an investigator gets a lead, and it is labelled
`fraud_type_inference` in the response so nobody mistakes it for a prediction.
"""
from typing import Any, Dict, List

from agents.base import MissingFeatures, ok, require, to_frame
from agents.mapping import require_crop

FEATURES = [
    "quantity_kg",
    "transport_hours",
    "distance_km",
    "transaction_value",
    "certificate_age_days",
    "ownership_transfers",
]


def _infer_fraud_type(row: Dict[str, Any]) -> str:
    """
    Heuristic triage for an already-flagged batch. Mirrors the training script's
    post-hoc categorisation; the model itself only predicts flagged / not-flagged.
    """
    unit_price = row["transaction_value"] / max(row["quantity_kg"], 1.0)
    speed_kmh = row["distance_km"] / max(row["transport_hours"], 0.1)

    if row["certificate_age_days"] > 365:
        return "EXPIRED_CERTIFICATE"
    if unit_price > 12.0 or unit_price < 0.1:
        return "PRICE_MANIPULATION"
    if speed_kmh > 140.0 or row["ownership_transfers"] >= 8:
        return "LOGISTICS_ANOMALY"
    if row["quantity_kg"] > 70000.0:
        return "QUANTITY_ANOMALY"
    return "ANOMALOUS_PATTERN"


def predict(loader, inputs: Dict[str, Any]) -> Dict[str, Any]:
    require_crop(inputs.get("product_name"))

    row = {
        "batch_id": inputs.get("batch_id", "EX-UNKNOWN"),
        "quantity_kg": inputs.get("quantity_kg"),
        "transport_hours": inputs.get("transport_hours"),
        "distance_km": inputs.get("distance_km"),
        "transaction_value": inputs.get("transaction_value"),
        "certificate_age_days": inputs.get("certificate_age_days"),
        "ownership_transfers": inputs.get("ownership_transfers"),
    }

    if not inputs.get("has_shipment"):
        raise MissingFeatures(
            ["transaction_value", "transport_hours", "distance_km"],
            reason=(
                "No shipment exists for this batch. Unit price is a third of this "
                "model's signal, and transit hours and distance are only known once "
                "a shipment has departed — running it now would score the batch against "
                "invented logistics."
            ),
        )

    require(row, FEATURES)

    model = loader.get("fraud")
    frame = to_frame({k: row[k] for k in FEATURES})

    probs = model.predict_proba(frame)[0]
    fraud_prob = float(probs[1])
    flagged = bool(fraud_prob >= 0.5)
    confidence = int(round(probs[1 if flagged else 0] * 100.0))

    signals: List[Dict[str, Any]] = []
    if flagged:
        unit_price = row["transaction_value"] / max(row["quantity_kg"], 1.0)
        speed_kmh = row["distance_km"] / max(row["transport_hours"], 0.1)
        if row["certificate_age_days"] > 365:
            signals.append({"signal": "EXPIRED_CERTIFICATE",
                            "detail": f"Certificate is {row['certificate_age_days']:.0f} days old"})
        if unit_price > 12.0:
            signals.append({"signal": "PRICE_MANIPULATION",
                            "detail": f"Unit price {unit_price:.2f} per kg is far above market"})
        elif unit_price < 0.1:
            signals.append({"signal": "PRICE_MANIPULATION",
                            "detail": f"Unit price {unit_price:.3f} per kg is implausibly low"})
        if speed_kmh > 140.0:
            signals.append({"signal": "LOGISTICS_ANOMALY",
                            "detail": f"Implied transit speed {speed_kmh:.0f} km/h"})
        if row["ownership_transfers"] >= 8:
            signals.append({"signal": "EXCESSIVE_CUSTODY_TRANSFERS",
                            "detail": f"{row['ownership_transfers']} custody events on one batch"})
        if row["quantity_kg"] > 70000.0:
            signals.append({"signal": "QUANTITY_ANOMALY",
                            "detail": f"Declared quantity {row['quantity_kg']:,.0f} kg is far above typical lot size"})

    return ok(
        "fraud",
        {
            "batch_id": row["batch_id"],
            "flagged": flagged,
            "fraud_type": _infer_fraud_type(row) if flagged else "NONE",
            "confidence_score": confidence,
        },
        fraud_probability=round(fraud_prob, 4),
        # Named so the UI can present it as a lead, not a prediction.
        fraud_type_inference="heuristic applied after the model flagged the batch",
        signals=signals,
        recommended_action="HALT_AND_INVESTIGATE" if flagged else "PROCEED",
        inputs_used={k: row[k] for k in FEATURES},
    )
