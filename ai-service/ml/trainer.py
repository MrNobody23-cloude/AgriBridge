"""
AgriBridge AI — Default Model Trainer

Trains XGBoost and Isolation Forest models on synthetic-but-realistic
agricultural supply chain data.

IMPORTANT: These are trained on SYNTHETIC DATA generated to represent
realistic cold-chain conditions. They are suitable for prototype/academic
demonstration. For production, replace with validated real-world datasets.

Dataset transparency:
- Spoilage: ~5,000 synthetic samples across mango, grapes, rice, saffron, tea
- Quality: ~3,000 synthetic samples
- Shelf life: ~3,000 synthetic samples
- Fraud: ~2,000 normal + ~400 anomalous samples (Isolation Forest)
"""
import json
import logging
import numpy as np
import pandas as pd
from datetime import datetime
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score, roc_auc_score,
    mean_absolute_error, mean_squared_error, r2_score,
)
from xgboost import XGBClassifier, XGBRegressor
from sklearn.ensemble import IsolationForest

logger = logging.getLogger("agribridge.ml.trainer")

# ── Crop parameters for synthetic data generation ─────────────────────────────

CROP_PARAMS = {
    "mango":    {"base_shelf": 14,  "opt_temp_min": 11, "opt_temp_max": 14, "humidity_ideal": 85},
    "grapes":   {"base_shelf": 21,  "opt_temp_min": 1,  "opt_temp_max": 4,  "humidity_ideal": 90},
    "rice":     {"base_shelf": 365, "opt_temp_min": 15, "opt_temp_max": 30, "humidity_ideal": 60},
    "saffron":  {"base_shelf": 180, "opt_temp_min": 15, "opt_temp_max": 25, "humidity_ideal": 40},
    "tea":      {"base_shelf": 180, "opt_temp_min": 15, "opt_temp_max": 25, "humidity_ideal": 45},
}


def _generate_spoilage_dataset(n_samples=5000) -> pd.DataFrame:
    """
    Synthetic spoilage dataset.
    Features: temperature, humidity, transit_days, days_since_harvest,
              crop_type_encoded, distance_km, cold_chain_deviations
    Target (classification): 0=LOW, 1=MEDIUM, 2=HIGH, 3=CRITICAL
    """
    rng = np.random.default_rng(42)
    crops = list(CROP_PARAMS.keys())
    rows = []

    for _ in range(n_samples):
        crop = rng.choice(crops)
        params = CROP_PARAMS[crop]
        base_shelf = params["base_shelf"]
        opt_max = params["opt_temp_max"]
        opt_min = params["opt_temp_min"]

        transit_days = int(rng.integers(1, min(base_shelf, 30)))
        days_since_harvest = transit_days + int(rng.integers(0, 5))
        temperature = float(rng.uniform(opt_min - 4, opt_max + 8))
        humidity = float(rng.uniform(40, 100))
        distance_km = float(rng.uniform(50, 8000))
        cold_chain_deviations = int(rng.integers(0, 5))

        # Physics-based label
        temp_excess = max(0, temperature - opt_max)
        remaining = base_shelf - days_since_harvest - (temp_excess * 1.5 * (transit_days / 2)) - (cold_chain_deviations * 0.5)
        ratio = max(0, min(1, remaining / base_shelf))

        if ratio > 0.7:
            label = 0  # LOW
        elif ratio > 0.4:
            label = 1  # MEDIUM
        elif ratio > 0.15:
            label = 2  # HIGH
        else:
            label = 3  # CRITICAL

        rows.append({
            "temperature": temperature,
            "humidity": humidity,
            "transit_days": transit_days,
            "days_since_harvest": days_since_harvest,
            "crop_type": crops.index(crop),
            "distance_km": distance_km,
            "cold_chain_deviations": cold_chain_deviations,
            "base_shelf_days": base_shelf,
            "opt_temp_max": opt_max,
            "label": label,
        })

    return pd.DataFrame(rows)


def _generate_shelf_life_dataset(n_samples=3000) -> pd.DataFrame:
    """
    Synthetic shelf-life regression dataset.
    Target: remaining_days (continuous)
    """
    rng = np.random.default_rng(43)
    crops = list(CROP_PARAMS.keys())
    rows = []

    for _ in range(n_samples):
        crop = rng.choice(crops)
        params = CROP_PARAMS[crop]
        base_shelf = params["base_shelf"]
        opt_max = params["opt_temp_max"]
        opt_min = params["opt_temp_min"]

        days_since_harvest = int(rng.integers(1, base_shelf))
        temperature = float(rng.uniform(opt_min - 2, opt_max + 6))
        humidity = float(rng.uniform(40, 100))
        cold_chain_deviations = int(rng.integers(0, 4))
        transit_days = int(rng.integers(0, min(days_since_harvest, 15)))

        temp_excess = max(0, temperature - opt_max)
        remaining = max(0.0, base_shelf - days_since_harvest - (temp_excess * 1.5) - (cold_chain_deviations * 0.3))
        noise = rng.normal(0, 0.5)
        remaining = max(0.0, remaining + noise)

        rows.append({
            "temperature": temperature,
            "humidity": humidity,
            "transit_days": transit_days,
            "days_since_harvest": days_since_harvest,
            "crop_type": crops.index(crop),
            "cold_chain_deviations": cold_chain_deviations,
            "base_shelf_days": base_shelf,
            "remaining_days": remaining,
        })

    return pd.DataFrame(rows)


def _generate_quality_dataset(n_samples=3000) -> pd.DataFrame:
    """
    Synthetic quality prediction dataset.
    Target (classification): 0=Grade C, 1=Grade B, 2=Grade A, 3=Grade A+
    """
    rng = np.random.default_rng(44)
    crops = list(CROP_PARAMS.keys())
    rows = []

    for _ in range(n_samples):
        crop = rng.choice(crops)
        params = CROP_PARAMS[crop]
        opt_max = params["opt_temp_max"]

        temperature = float(rng.uniform(0, opt_max + 10))
        humidity = float(rng.uniform(30, 100))
        days_since_harvest = int(rng.integers(0, 20))
        cold_chain_deviations = int(rng.integers(0, 5))
        num_certificates = int(rng.integers(0, 4))
        has_organic_cert = int(rng.choice([0, 1], p=[0.6, 0.4]))

        # Quality score (0-100)
        quality = 100.0
        quality -= max(0, temperature - opt_max) * 3
        quality -= days_since_harvest * 2
        quality -= cold_chain_deviations * 5
        quality += num_certificates * 3
        quality += has_organic_cert * 5
        quality = max(0, min(100, quality + rng.normal(0, 3)))

        if quality >= 85:
            label = 3  # A+
        elif quality >= 70:
            label = 2  # A
        elif quality >= 50:
            label = 1  # B
        else:
            label = 0  # C

        rows.append({
            "temperature": temperature,
            "humidity": humidity,
            "days_since_harvest": days_since_harvest,
            "cold_chain_deviations": cold_chain_deviations,
            "num_certificates": num_certificates,
            "has_organic_cert": has_organic_cert,
            "crop_type": crops.index(crop),
            "quality_score": quality,
            "label": label,
        })

    return pd.DataFrame(rows)


def _generate_fraud_dataset(n_normal=2000, n_anomalous=400) -> pd.DataFrame:
    """
    Synthetic fraud anomaly dataset for Isolation Forest.
    Normal = legitimate supply chain patterns.
    Anomalous = suspicious patterns (quantity inflation, impossible timestamps, etc.)
    """
    rng = np.random.default_rng(45)
    rows = []

    # Normal samples
    for _ in range(n_normal):
        rows.append({
            "quantity_ratio": float(rng.uniform(0.95, 1.05)),   # shipment vs farm quantity
            "cert_age_days": float(rng.integers(0, 365)),
            "ownership_transfers": float(rng.integers(1, 5)),
            "time_farm_to_export_days": float(rng.integers(3, 30)),
            "temp_breach_count": float(rng.integers(0, 2)),
            "duplicate_cert_score": float(rng.uniform(0, 0.1)),
            "route_deviation_km": float(rng.uniform(0, 200)),
            "label": 1,  # normal
        })

    # Anomalous samples
    for _ in range(n_anomalous):
        rows.append({
            "quantity_ratio": float(rng.choice([rng.uniform(1.5, 5.0), rng.uniform(0.1, 0.4)])),
            "cert_age_days": float(rng.integers(365, 1000)),
            "ownership_transfers": float(rng.integers(6, 15)),
            "time_farm_to_export_days": float(rng.choice([rng.integers(0, 1), rng.integers(100, 365)])),
            "temp_breach_count": float(rng.integers(5, 20)),
            "duplicate_cert_score": float(rng.uniform(0.7, 1.0)),
            "route_deviation_km": float(rng.uniform(500, 5000)),
            "label": -1,  # anomaly
        })

    return pd.DataFrame(rows)


def _eval_classification(y_true, y_pred, y_prob=None) -> dict:
    metrics = {
        "accuracy": round(accuracy_score(y_true, y_pred), 4),
        "precision_macro": round(precision_score(y_true, y_pred, average="macro", zero_division=0), 4),
        "recall_macro": round(recall_score(y_true, y_pred, average="macro", zero_division=0), 4),
        "f1_macro": round(f1_score(y_true, y_pred, average="macro", zero_division=0), 4),
    }
    return metrics


def _eval_regression(y_true, y_pred) -> dict:
    return {
        "mae": round(float(mean_absolute_error(y_true, y_pred)), 4),
        "rmse": round(float(np.sqrt(mean_squared_error(y_true, y_pred))), 4),
        "r2": round(float(r2_score(y_true, y_pred)), 4),
    }


def train_default_model(model_name: str):
    """Train the specified model on synthetic data and return (model, metadata)."""
    logger.info(f"🔧 Training default model: {model_name} (synthetic data)")

    timestamp = datetime.utcnow().isoformat()
    feature_names = []
    model = None
    metrics = {}

    if model_name == "spoilage":
        df = _generate_spoilage_dataset()
        features = ["temperature", "humidity", "transit_days", "days_since_harvest",
                    "crop_type", "distance_km", "cold_chain_deviations", "base_shelf_days", "opt_temp_max"]
        X = df[features].values
        y = df["label"].values
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
        model = XGBClassifier(
            n_estimators=200, max_depth=6, learning_rate=0.1, subsample=0.8,
            colsample_bytree=0.8, use_label_encoder=False, eval_metric="mlogloss",
            random_state=42, verbosity=0,
        )
        model.fit(X_train, y_train)
        metrics = _eval_classification(y_test, model.predict(X_test))
        feature_names = features
        model_type = "xgboost"

    elif model_name == "shelf_life":
        df = _generate_shelf_life_dataset()
        features = ["temperature", "humidity", "transit_days", "days_since_harvest",
                    "crop_type", "cold_chain_deviations", "base_shelf_days"]
        X = df[features].values
        y = df["remaining_days"].values
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        model = XGBRegressor(
            n_estimators=200, max_depth=5, learning_rate=0.1, subsample=0.8,
            colsample_bytree=0.8, random_state=42, verbosity=0,
        )
        model.fit(X_train, y_train)
        metrics = _eval_regression(y_test, model.predict(X_test))
        feature_names = features
        model_type = "xgboost"

    elif model_name == "quality":
        df = _generate_quality_dataset()
        features = ["temperature", "humidity", "days_since_harvest", "cold_chain_deviations",
                    "num_certificates", "has_organic_cert", "crop_type"]
        X = df[features].values
        y = df["label"].values
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
        model = XGBClassifier(
            n_estimators=150, max_depth=5, learning_rate=0.1, subsample=0.8,
            colsample_bytree=0.8, use_label_encoder=False, eval_metric="mlogloss",
            random_state=42, verbosity=0,
        )
        model.fit(X_train, y_train)
        metrics = _eval_classification(y_test, model.predict(X_test))
        feature_names = features
        model_type = "xgboost"

    elif model_name == "fraud":
        df = _generate_fraud_dataset()
        features = ["quantity_ratio", "cert_age_days", "ownership_transfers",
                    "time_farm_to_export_days", "temp_breach_count",
                    "duplicate_cert_score", "route_deviation_km"]
        X = df[features].values
        # Isolation Forest is unsupervised; train on ALL data (it finds outliers internally)
        model = IsolationForest(
            n_estimators=200, contamination=0.15, max_samples="auto",
            random_state=42, n_jobs=-1,
        )
        model.fit(X)
        # Evaluate on labeled subset
        y_true_binary = (df["label"].values == 1).astype(int)
        scores = -model.score_samples(X)  # higher = more anomalous
        threshold = np.percentile(scores, 85)
        y_pred_binary = (scores > threshold).astype(int)
        metrics = _eval_classification(y_true_binary, y_pred_binary)
        feature_names = features
        model_type = "isolation_forest"

    else:
        raise ValueError(f"Unknown model: {model_name}")

    metadata = {
        "model_name": model_name,
        "model_type": model_type,
        "version": "1.0.0",
        "training_date": timestamp,
        "dataset_version": "synthetic_v1",
        "dataset_type": "SYNTHETIC — for prototype/academic use only",
        "features": feature_names,
        "num_features": len(feature_names),
        "metrics": metrics,
        "notes": (
            "Model trained on synthetically generated agricultural supply chain data. "
            "Suitable for prototype and academic demonstration. "
            "For production deployment, replace with validated real-world datasets."
        ),
    }

    logger.info(f"✅ Trained {model_name}: {metrics}")
    return model, metadata
