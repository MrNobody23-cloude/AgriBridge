"""
Compliance Agent — RandomForestClassifier, EU Reg. 396/2005 MRL screening.

Model input (5 features, exactly the training contract):
    crop_type, pesticide_residue_level, certification_valid,
    certificate_expiry_days_remaining, destination_market

`mrl_limit` is deliberately absent: it is the quantity the model was trained to
predict, so feeding it in would be label leakage. It is reported alongside the
decision for transparency only.

When AgriBridge holds no measured residue level, the model is still run on the
certification and expiry signals alone, and `residue_source` says so. That is a
narrower question than a full MRL test and the response says which one it is.
"""
from typing import Any

from agents.base import ok, require, to_frame
from agents.constants import CHECK_TYPE, mrl_limit
from agents.mapping import require_crop

FEATURES = [
    "crop_type",
    "pesticide_residue_level",
    "certification_valid",
    "certificate_expiry_days_remaining",
    "destination_market",
]


def predict(loader, inputs: dict[str, Any]) -> dict[str, Any]:
    crop = require_crop(inputs.get("product_name"))
    market = inputs.get("destination_market") or "Domestic"

    row = {
        "batch_id": inputs.get("batch_id", "C-UNKNOWN"),
        "crop_type": crop["crop_type"],
        "pesticide_residue_level": inputs.get("pesticide_residue_level"),
        "certification_valid": int(inputs.get("certification_valid") or 0),
        "certificate_expiry_days_remaining": inputs.get("certificate_expiry_days_remaining"),
        "destination_market": market,
    }

    # expiry_days is only genuinely required when there is a certificate to expire.
    require(
        row,
        ["pesticide_residue_level", "certificate_expiry_days_remaining"],
        reason=(
            "AgriBridge records no laboratory pesticide-residue measurement and this "
            "batch has no certificate expiry date, so a Reg. 396/2005 MRL decision "
            "cannot be made from the ledger. Supply a measured residue level or upload "
            "a certificate."
        ),
    )

    model = loader.get("compliance")
    frame = to_frame({k: row[k] for k in FEATURES})

    probs = model.predict_proba(frame)[0]
    predicted_class = int(model.predict(frame)[0])
    status = "PASS" if predicted_class == 1 else "FAIL"

    limit = mrl_limit(crop["crop_type"], market)
    return ok(
        "compliance",
        {
            "batch_id": row["batch_id"],
            "compliance_status": status,
            "check_type": CHECK_TYPE.get(market, "Standard pesticide residue check"),
            "confidence_score": int(round(probs[predicted_class] * 100.0)),
        },
        crop_mapping=crop["mapping"],
        crop_note=crop["note"],
        mrl_limit_mg_kg=limit,
        residue_source=inputs.get("residue_source", "measured"),
        measured_against_mrl=(
            None if inputs.get("pesticide_residue_level") is None or limit is None
            else round(float(inputs["pesticide_residue_level"]) / limit, 3)
        ),
        inputs_used={k: row[k] for k in FEATURES},
    )
