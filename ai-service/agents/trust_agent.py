"""
Consumer Trust Agent — LogisticRegression over the five upstream agent outputs.

Model input (5 features, exactly the training order the pickle was fit on):
    traceability_confidence, quality_score, spoilage_risk_pct,
    fraud_flagged, compliance_status

This is the meta-agent: it does not look at raw batch data at all, only at what
the other five concluded. Running it therefore requires all five to have run
first — the router chains them, and this agent refuses to answer on partial
input rather than defaulting a missing signal to a passing default.

`fraud_flagged` and `compliance_status` enter as 0/1. The fitted coefficients
are the model card: fraud_flagged carries by far the largest negative weight
(-0.89), which is the honest headline for this agent — being flagged for fraud
damages consumer trust more than anything else in the feature set.

Known limitation carried over from training: only ~11% of the training set was
fraud-flagged, so the positive class is thin and the ROC AUC of 0.80 reflects a
genuinely harder problem than the other five agents faced.
"""
from typing import Any, Dict, List, Optional

from agents.base import MissingFeatures, ok, require, to_frame
from agents.constants import ALGORITHM

FEATURES = [
    "traceability_confidence",
    "quality_score",
    "spoilage_risk_pct",
    "fraud_flagged",
    "compliance_status",
]


def _dominant_driver(model) -> Optional[Dict[str, Any]]:
    """
    Report the largest-magnitude fitted coefficient.

    This is the point of using LogisticRegression here rather than a forest:
    the weights are directly readable, so the agent can say *why* it answered
    the way it did instead of only that it did.
    """
    try:
        pipe = model
        if hasattr(model, "named_steps"):
            pipe = model.named_steps.get("logisticregression") or list(model.named_steps.values())[-1]
        coefs = [float(c) for c in pipe.coef_[0]]
        if len(coefs) != len(FEATURES):
            return None
        pairs = sorted(zip(FEATURES, coefs), key=lambda kv: abs(kv[1]), reverse=True)
        top_feature, top_coef = pairs[0]
        return {
            "feature": top_feature,
            "coefficient": round(top_coef, 4),
            "direction": "increases" if top_coef > 0 else "decreases",
            "all_coefficients": {f: round(c, 4) for f, c in zip(FEATURES, coefs)},
        }
    except Exception:
        return None


def predict(loader, inputs: Dict[str, Any]) -> Dict[str, Any]:
    upstream = inputs.get("upstream") or {}
    missing = [a for a in ("traceability", "quality", "spoilage", "fraud", "compliance")
               if not upstream.get(a)]
    if missing:
        raise MissingFeatures(
            missing,
            reason=(
                "The Consumer Trust agent reasons over the other five agents and cannot "
                f"substitute defaults for the ones that did not run: {', '.join(missing)}."
            ),
        )

    row = {
        "batch_id": inputs.get("batch_id", "AG-UNKNOWN"),
        "traceability_confidence": float(upstream["traceability"]["confidence_score"]),
        "quality_score": float(upstream["quality"]["quality_score"]),
        "spoilage_risk_pct": float(upstream["spoilage"]["spoilage_risk_pct"]),
        "fraud_flagged": 1 if upstream["fraud"]["flagged"] else 0,
        "compliance_status": 1 if upstream["compliance"]["compliance_status"] == "PASS" else 0,
    }

    model = loader.get("trust")
    frame = to_frame({k: row[k] for k in FEATURES})

    probs = model.predict_proba(frame)[0]
    predicted = int(model.predict(frame)[0])
    is_authentic = bool(predicted == 1)

    return ok(
        "trust",
        {
            "batch_id": row["batch_id"],
            "is_authentic": is_authentic,
            "answer": "Yes" if is_authentic else "No",
            "confidence_score": int(round(float(probs[predicted]) * 100.0)),
        },
        authentic_probability=round(float(probs[1]), 4),
        model_rationale=ALGORITHM["trust"],
        dominant_driver=_dominant_driver(model),
        upstream_inputs={k: row[k] for k in FEATURES},
    )
