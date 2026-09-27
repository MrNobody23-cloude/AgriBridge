"""
AgriBridge AI — ML Inference Engine
Provides SHAP-explained predictions for all models.
"""
import logging
from typing import Any

import numpy as np

logger = logging.getLogger("agribridge.ml.inference")

CROP_INDEX = {
    "mango": 0, "alphonso mango": 0,
    "grapes": 1, "nashik grapes": 1,
    "rice": 2, "basmati rice": 2,
    "saffron": 3, "kesar saffron": 3,
    "tea": 4, "darjeeling tea": 4,
}
CROP_PARAMS = {
    0: {"name": "Mango",   "base_shelf": 14,  "opt_min": 11, "opt_max": 14},
    1: {"name": "Grapes",  "base_shelf": 21,  "opt_min": 1,  "opt_max": 4},
    2: {"name": "Rice",    "base_shelf": 365, "opt_min": 15, "opt_max": 30},
    3: {"name": "Saffron", "base_shelf": 180, "opt_min": 15, "opt_max": 25},
    4: {"name": "Tea",     "base_shelf": 180, "opt_min": 15, "opt_max": 25},
}
RISK_LABELS = {0: "LOW", 1: "MEDIUM", 2: "HIGH", 3: "CRITICAL"}
QUALITY_GRADES = {0: "C", 1: "B", 2: "A", 3: "A+"}


def _get_shap_values(model, X: np.ndarray, feature_names: list[str], model_type: str) -> list[dict]:
    """Compute SHAP values and return top contributing features.

    SHAP's return shape changed across versions, and both forms occur in the
    wild for a multi-class XGBoost model:

        shap < 0.45   -> list of arrays, one per class, each (n_samples, n_features)
        shap >= 0.45  -> single array of (n_samples, n_features, n_classes)

    The old code only handled the list form. Given the newer array it took
    `shap_values[0]`, which is the (n_features, n_classes) matrix rather than a
    feature vector, and then indexed it with a float — raising
    "only integer scalar arrays can be converted to a scalar index". The
    exception was swallowed and every prediction shipped with an empty
    `top_features`, so the model was never actually explained to anyone.
    """
    try:
        import shap
        if model_type not in ("xgboost",):
            return []
        explainer = shap.TreeExplainer(model)
        shap_values = explainer.shap_values(X)

        if isinstance(shap_values, list):
            # One array per class: collapse to per-feature max |value|.
            per_feature = np.max([np.abs(np.asarray(s)) for s in shap_values], axis=0)[0]
        else:
            arr = np.asarray(shap_values)
            if arr.ndim == 3:
                # (n_samples, n_features, n_classes) -> max |value| across classes.
                per_feature = np.abs(arr[0]).max(axis=1)
            elif arr.ndim == 2:
                per_feature = np.abs(arr[0])
            else:
                return []

        # Guard against a feature-count mismatch (e.g. a model refitted on a
        # different feature list) rather than raising deep in the index loop.
        n = min(len(per_feature), len(feature_names), X.shape[1])
        if n == 0:
            return []
        top_indices = np.argsort(per_feature[:n])[::-1][:5]
        return [
            {
                "feature": feature_names[i],
                "importance": round(float(per_feature[i]), 6),
                "value": round(float(X[0][i]), 4),
            }
            for i in top_indices
        ]
    except Exception as e:
        logger.warning(f"SHAP computation failed: {e}")
        return []


def predict_spoilage(model, metadata: dict, request: dict) -> dict[str, Any]:
    """
    Predict spoilage risk using XGBoost.
    Returns: risk level, probability, remaining days, SHAP explanation.
    """
    crop_name = request.get("crop", "mango").lower()
    crop_idx = CROP_INDEX.get(crop_name, 0)
    crop_info = CROP_PARAMS.get(crop_idx, CROP_PARAMS[0])

    temperature = float(request.get("temperature", 12.0))
    humidity = float(request.get("humidity", 75.0))
    transit_days = int(request.get("transit_days", 3))
    days_since_harvest = int(request.get("days_since_harvest", transit_days))
    distance_km = float(request.get("distance_km", 500.0))
    cold_chain_deviations = int(request.get("cold_chain_deviations", 0))

    features = metadata.get("features", [])
    X = np.array([[
        temperature,
        humidity,
        transit_days,
        days_since_harvest,
        crop_idx,
        distance_km,
        cold_chain_deviations,
        crop_info["base_shelf"],
        crop_info["opt_max"],
    ]])

    pred_class = int(model.predict(X)[0])
    pred_proba = model.predict_proba(X)[0]
    confidence = float(pred_proba[pred_class])

    risk_label = RISK_LABELS[pred_class]

    # Estimate remaining days from XGBoost probability distribution
    remaining_est = max(0, int(crop_info["base_shelf"] * (1 - pred_proba[2] - pred_proba[3])))

    shap_features = _get_shap_values(model, X, features, metadata.get("model_type", "xgboost"))

    explanation_parts = []
    for sf in shap_features[:3]:
        explanation_parts.append(f"{sf['feature'].replace('_', ' ').title()} ({sf['value']:.1f})")

    # Say so when the explainer produced nothing, rather than rendering a
    # dangling "Key factors: ." that reads as a formatting bug.
    if explanation_parts:
        summary = f"Spoilage Risk: {risk_label}. Key factors: {', '.join(explanation_parts)}."
    else:
        summary = f"Spoilage Risk: {risk_label}. Feature attribution was unavailable for this prediction."

    return {
        "prediction": {
            "risk": risk_label,
            "riskCode": pred_class,
            "probability": round(confidence, 4),
            "probabilities": {RISK_LABELS[i]: round(float(p), 4) for i, p in enumerate(pred_proba)},
            "estimatedRemainingDays": remaining_est,
            "recommendation": _spoilage_recommendation(risk_label, crop_info),
        },
        "explanation": {
            "summary": summary,
            "top_features": shap_features,
            "methodology": "XGBoost classifier with SHAP TreeExplainer",
        },
        "model": {
            "name": "spoilage-xgboost",
            "version": metadata.get("version", "1.0.0"),
            "metrics": metadata.get("metrics", {}),
            "datasetType": metadata.get("dataset_type", "SYNTHETIC"),
        },
    }


def predict_shelf_life(model, metadata: dict, request: dict) -> dict[str, Any]:
    """Predict remaining shelf life in days (regression)."""
    crop_name = request.get("crop", "mango").lower()
    crop_idx = CROP_INDEX.get(crop_name, 0)
    crop_info = CROP_PARAMS.get(crop_idx, CROP_PARAMS[0])

    temperature = float(request.get("temperature", 12.0))
    humidity = float(request.get("humidity", 75.0))
    transit_days = int(request.get("transit_days", 3))
    days_since_harvest = int(request.get("days_since_harvest", transit_days))
    cold_chain_deviations = int(request.get("cold_chain_deviations", 0))

    X = np.array([[
        temperature,
        humidity,
        transit_days,
        days_since_harvest,
        crop_idx,
        cold_chain_deviations,
        crop_info["base_shelf"],
    ]])

    pred_days = float(model.predict(X)[0])
    pred_days = max(0, round(pred_days, 1))

    features = metadata.get("features", [])
    shap_features = _get_shap_values(model, X, features, "xgboost")

    confidence_interval = (max(0, pred_days - 1.5), pred_days + 1.5)

    return {
        "prediction": {
            "estimatedRemainingDays": pred_days,
            "confidenceIntervalDays": confidence_interval,
            "baseShelfDays": crop_info["base_shelf"],
            "percentRemaining": round(pred_days / crop_info["base_shelf"] * 100, 1),
        },
        "explanation": {
            "top_features": shap_features,
            "methodology": "XGBoost regressor with SHAP TreeExplainer",
        },
        "model": {"name": "shelf-life-xgboost", "version": metadata.get("version", "1.0.0"), "metrics": metadata.get("metrics", {})},
    }


def predict_quality(model, metadata: dict, request: dict) -> dict[str, Any]:
    """Predict quality grade."""
    crop_name = request.get("crop", "mango").lower()
    crop_idx = CROP_INDEX.get(crop_name, 0)

    temperature = float(request.get("temperature", 12.0))
    humidity = float(request.get("humidity", 75.0))
    days_since_harvest = int(request.get("days_since_harvest", 3))
    cold_chain_deviations = int(request.get("cold_chain_deviations", 0))
    num_certificates = int(request.get("num_certificates", 1))
    has_organic_cert = int(bool(request.get("has_organic_cert", False)))

    X = np.array([[temperature, humidity, days_since_harvest, cold_chain_deviations, num_certificates, has_organic_cert, crop_idx]])

    pred_class = int(model.predict(X)[0])
    pred_proba = model.predict_proba(X)[0]
    confidence = float(pred_proba[pred_class])
    quality_score = round(float(pred_proba[3] * 100 + pred_proba[2] * 75 + pred_proba[1] * 50 + pred_proba[0] * 25), 1)

    features = metadata.get("features", [])
    shap_features = _get_shap_values(model, X, features, "xgboost")

    return {
        "prediction": {
            "grade": QUALITY_GRADES[pred_class],
            "gradeCode": pred_class,
            "qualityScore": quality_score,
            "confidence": round(confidence, 4),
            "gradeDistribution": {QUALITY_GRADES[i]: round(float(p), 4) for i, p in enumerate(pred_proba)},
        },
        "explanation": {
            "top_features": shap_features,
            "methodology": "XGBoost classifier with SHAP TreeExplainer",
        },
        "model": {"name": "quality-xgboost", "version": metadata.get("version", "1.0.0"), "metrics": metadata.get("metrics", {})},
    }


def detect_fraud_anomaly(model, metadata: dict, request: dict) -> dict[str, Any]:
    """
    Isolation Forest anomaly detection.
    Returns anomaly score, is_anomaly flag, and detected signals.
    """
    quantity_ratio = float(request.get("quantity_ratio", 1.0))
    cert_age_days = float(request.get("cert_age_days", 30))
    ownership_transfers = float(request.get("ownership_transfers", 2))
    time_farm_to_export = float(request.get("time_farm_to_export_days", 10))
    temp_breach_count = float(request.get("temp_breach_count", 0))
    duplicate_cert_score = float(request.get("duplicate_cert_score", 0.0))
    route_deviation_km = float(request.get("route_deviation_km", 50))

    X = np.array([[quantity_ratio, cert_age_days, ownership_transfers, time_farm_to_export,
                   temp_breach_count, duplicate_cert_score, route_deviation_km]])

    raw_score = float(model.score_samples(X)[0])  # more negative = more anomalous
    # Normalise to 0-1 anomaly probability (higher = more suspicious)
    anomaly_probability = max(0.0, min(1.0, 1.0 - (raw_score + 0.5)))
    is_anomaly = model.predict(X)[0] == -1  # IsolationForest: -1 = anomaly

    detected_signals = []
    if quantity_ratio > 1.3:
        detected_signals.append({"signal": "QUANTITY_INFLATION", "detail": f"Shipment quantity {quantity_ratio:.1f}x farm quantity", "severity": "HIGH"})
    if quantity_ratio < 0.5:
        detected_signals.append({"signal": "QUANTITY_SHRINKAGE", "detail": f"Shipment quantity only {quantity_ratio:.0%} of farm quantity", "severity": "MEDIUM"})
    if cert_age_days > 365:
        detected_signals.append({"signal": "EXPIRED_CERTIFICATE", "detail": f"Certificate {cert_age_days:.0f} days old", "severity": "HIGH"})
    if duplicate_cert_score > 0.5:
        detected_signals.append({"signal": "DUPLICATE_CERTIFICATE", "detail": f"Certificate similarity score: {duplicate_cert_score:.2f}", "severity": "CRITICAL"})
    if time_farm_to_export < 1:
        detected_signals.append({"signal": "IMPOSSIBLE_TIMESTAMP", "detail": "Export before harvest completion", "severity": "CRITICAL"})
    if temp_breach_count >= 5:
        detected_signals.append({"signal": "COLD_CHAIN_BREACH", "detail": f"{int(temp_breach_count)} temperature violations", "severity": "HIGH"})
    if route_deviation_km > 500:
        detected_signals.append({"signal": "ROUTE_ANOMALY", "detail": f"{route_deviation_km:.0f}km deviation from expected route", "severity": "MEDIUM"})

    risk_score = int(min(100, anomaly_probability * 100 + len(detected_signals) * 5))

    return {
        "prediction": {
            "isAnomaly": bool(is_anomaly),
            "anomalyProbability": round(anomaly_probability, 4),
            "riskScore": risk_score,
            "riskLevel": "CRITICAL" if risk_score >= 80 else ("HIGH" if risk_score >= 60 else ("MEDIUM" if risk_score >= 30 else "LOW")),
        },
        "detectedSignals": detected_signals,
        "recommendedAction": "HALT_AND_INVESTIGATE" if risk_score >= 70 else ("MANUAL_REVIEW" if risk_score >= 40 else "PROCEED"),
        "model": {"name": "fraud-isolation-forest", "version": metadata.get("version", "1.0.0"), "metrics": metadata.get("metrics", {})},
    }


def _spoilage_recommendation(risk: str, crop_info: dict) -> str:
    if risk == "CRITICAL":
        return "CRITICAL: Immediately redirect to nearest distribution point or expedite air freight. Do not proceed with planned sea route."
    elif risk == "HIGH":
        return f"HIGH RISK: Prioritize delivery. Maintain reefer temperature strictly at {crop_info['opt_min']}°C–{crop_info['opt_max']}°C."
    elif risk == "MEDIUM":
        return f"MODERATE: Increase monitoring frequency. Maintain cold chain at {crop_info['opt_min']}°C–{crop_info['opt_max']}°C."
    else:
        return f"LOW RISK: Standard cold-chain protocols sufficient. Target {crop_info['opt_min']}°C–{crop_info['opt_max']}°C."
