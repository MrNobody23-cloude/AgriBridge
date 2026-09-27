"""
Quality Agent — RandomForestRegressor producing a 0-100 produce quality score.

Model input (6 features, exactly the training contract):
    crop_type, temperature, humidity, storage_duration,
    transportation_duration, moisture

`moisture` was null in ~5% of the training rows, so the pipeline carries a
SimpleImputer and omitting it is a supported path rather than a gap.

Confidence comes from the standard deviation of the individual trees'
predictions: tight agreement between trees -> high confidence. That is a real
dispersion measure, not a calibrated probability, and is reported as such.
"""
from typing import Any

import numpy as np

from agents.base import ok, require, to_frame
from agents.constants import CROP_AGRONOMIC_PROFILES
from agents.mapping import require_crop

FEATURES = [
    "crop_type",
    "temperature",
    "humidity",
    "storage_duration",
    "transportation_duration",
    "moisture",
]

OPTIONAL = {"moisture"}


def _grade(score: float) -> str:
    if score >= 80.0:
        return "Good"
    if score >= 50.0:
        return "Moderate"
    return "Poor"


def _top_influential_features(model, frame, top_n: int = 4) -> list[dict[str, Any]]:
    """Permutation-style importance read straight off the fitted regressor."""
    try:
        names = getattr(model, "feature_names_in_", None)
        regressor = model.named_steps["regressor"]
        importances = regressor.feature_importances_
        # The regressor sees preprocessed columns, so map back by position only
        # when the widths line up; otherwise report the raw feature list.
        if names is not None and len(names) == len(importances):
            pairs = list(zip(list(names), importances))
        else:
            pairs = [(f"feature_{i}", v) for i, v in enumerate(importances)]
        pairs.sort(key=lambda kv: kv[1], reverse=True)
        return [{"feature": f, "importance": round(float(v), 4)} for f, v in pairs[:top_n]]
    except Exception:
        return []


def predict(loader, inputs: dict[str, Any]) -> dict[str, Any]:
    crop = require_crop(inputs.get("product_name"))

    row = {
        "batch_id": inputs.get("batch_id", "Q-UNKNOWN"),
        "crop_type": crop["crop_type"],
        "temperature": inputs.get("temperature"),
        "humidity": inputs.get("humidity"),
        "storage_duration": inputs.get("storage_duration"),
        "transportation_duration": inputs.get("transportation_duration"),
        "moisture": inputs.get("moisture"),
    }

    # moisture is imputed by the pipeline, so only genuinely-required features gate.
    require(
        row,
        [f for f in FEATURES if f not in OPTIONAL],
        reason=(
            "No IoT temperature/humidity readings are on record for this batch, so "
            "storage conditions cannot be scored. The model needs at least a "
            "temperature reading."
        ),
    )

    model = loader.get("quality")
    frame = to_frame({k: row[k] for k in FEATURES})

    pred_score = float(np.clip(float(model.predict(frame)[0]), 0.0, 100.0))

    preprocessed = model.named_steps["preprocessor"].transform(frame)
    tree_predictions = [t.predict(preprocessed)[0] for t in model.named_steps["regressor"].estimators_]
    std_dev = float(np.std(tree_predictions))
    confidence = int(round(float(np.clip(100.0 - (std_dev * 4.0), 50.0, 99.0))))

    profile = CROP_AGRONOMIC_PROFILES.get(crop["crop_type"], {})
    return ok(
        "quality",
        {
            "batch_id": row["batch_id"],
            "quality_score": int(round(pred_score)),
            "quality": _grade(pred_score),
            "confidence_score": confidence,
        },
        confidence_method="100 - 4x(per-tree prediction std dev), clipped to [50, 99]",
        tree_prediction_std=round(std_dev, 3),
        crop_mapping=crop["mapping"],
        crop_note=crop["note"],
        optimum_storage=(
            {"temperature_c": profile.get("opt_temp"), "humidity_pct": profile.get("opt_hum")}
            if profile else None
        ),
        top_features=_top_influential_features(model, frame),
        inputs_used={k: row[k] for k in FEATURES},
        data_source=(
            "simulated sensor readings" if inputs.get("simulated_only")
            else ("IoT sensor readings" if inputs.get("temperature") is not None else "harvest date only")
        ),
    )
