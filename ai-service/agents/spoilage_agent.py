"""
Spoilage Agent — RandomForestClassifier predicting transit spoilage risk.

Model input (7 features, exactly the training contract):
    crop_type, current_days_since_harvest, remaining_transport_time,
    current_temperature, temperature_variance, humidity,
    num_temperature_breaches

Without a shipment ETA there is no `remaining_transport_time`, which is a
first-class model feature rather than a detail — so the model is not run and
the agent reports NOT_APPLICABLE instead of inventing a transit window.

Known limitation carried over from training: labels were sampled from a
log-odds risk formula, so the model learns that formula's structure well and
real-world spoilage physics less well. It is a triage tool, not a shelf-life
guarantee.
"""
from typing import Any, Dict

from agents.base import MissingFeatures, ok, require, to_frame
from agents.constants import CROP_SPOILAGE_THRESHOLDS
from agents.mapping import require_crop

FEATURES = [
    "crop_type",
    "current_days_since_harvest",
    "remaining_transport_time",
    "current_temperature",
    "temperature_variance",
    "humidity",
    "num_temperature_breaches",
]


def predict(loader, inputs: Dict[str, Any]) -> Dict[str, Any]:
    crop = require_crop(inputs.get("product_name"))

    row = {
        "batch_id": inputs.get("batch_id", "EX-UNKNOWN"),
        "crop_type": crop["crop_type"],
        "current_days_since_harvest": inputs.get("current_days_since_harvest"),
        "remaining_transport_time": inputs.get("remaining_transport_time"),
        "current_temperature": inputs.get("current_temperature"),
        "temperature_variance": inputs.get("temperature_variance"),
        "humidity": inputs.get("humidity"),
        "num_temperature_breaches": inputs.get("num_temperature_breaches"),
    }

    if inputs.get("remaining_transport_time") is None:
        raise MissingFeatures(
            ["remaining_transport_time"],
            reason=(
                "No shipment with an arrival estimate exists for this batch, so the "
                "remaining transit window — a primary model input — is unknown. "
                "Create a shipment to enable spoilage risk scoring."
            ),
        )

    require(
        row,
        ["current_temperature", "temperature_variance"],
        reason=(
            "No cold-chain telemetry is on record for this batch. The model scores "
            "thermal stress, and without temperature readings there is no thermal "
            "stress to score."
        ),
    )

    model = loader.get("spoilage")
    frame = to_frame({k: row[k] for k in FEATURES})

    probs = model.predict_proba(frame)[0]
    risk_pct = int(round(float(probs[1]) * 100.0))
    predicted_class = 1 if risk_pct >= 50 else 0

    if risk_pct >= 80:
        alert = "CRITICAL"
    elif risk_pct >= 50:
        alert = "WARNING"
    else:
        alert = "OK"

    thresholds = CROP_SPOILAGE_THRESHOLDS.get(crop["crop_type"], {})
    max_safe_days = thresholds.get("max_safe_days")
    elapsed = row["current_days_since_harvest"]
    within_safe_window = None if max_safe_days is None else bool(elapsed <= max_safe_days)

    return ok(
        "spoilage",
        {
            "batch_id": row["batch_id"],
            "spoilage_risk_pct": risk_pct,
            "alert_level": alert,
            "confidence_score": int(round(float(probs[predicted_class]) * 100.0)),
        },
        crop_mapping=crop["mapping"],
        crop_note=crop["note"],
        spoilage_probability=round(float(probs[1]), 4),
        critical_temperature_c=thresholds.get("crit_temp"),
        max_safe_days=max_safe_days,
        within_max_safe_window=within_safe_window,
        recommendation=_recommendation(alert, thresholds),
        inputs_used={k: row[k] for k in FEATURES},
        data_source=(
            "simulated sensor readings" if inputs.get("simulated_only")
            else ("IoT sensor readings" if inputs.get("has_sensor_data") else "none")
        ),
    )


def _recommendation(alert: str, thresholds: Dict[str, Any]) -> str:
    crit = thresholds.get("crit_temp")
    if alert == "CRITICAL":
        return (
            f"Immediate action: reroute to the nearest distribution point or switch to "
            f"air freight. Hold at {crit}°C and do not proceed on the planned route."
            if crit else "Immediate action required: salvage or reroute."
        )
    if alert == "WARNING":
        return (
            f"Accelerate transit and verify the reefer is holding {crit}°C before the "
            f"remaining journey."
            if crit else "Accelerate transit and re-check cold chain."
        )
    return f"Normal transit. Maintain cold chain at {crit}°C." if crit else "Normal transit."
