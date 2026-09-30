# ============================================================
# AGRIBRIDGE AI - ML ENGINE TRAINING SCRIPT
# ============================================================
# Models trained:
#   1. Quality Prediction       -> Random Forest Regressor
#   2. Spoilage Prediction      -> Random Forest Classifier
#   3. Fraud Detection          -> Isolation Forest
#
# Run this script ONCE to bootstrap the model files:
#   cd ai-service
#   python -m ml_engine.train
#
# Trained models are saved to: ai-service/models/
# This demo uses synthetic data.
# Replace the synthetic data sections with real data when
# your dataset is available.
# ============================================================

import os
import joblib
import numpy as np
import pandas as pd
# matplotlib / seaborn are optional — used only for diagnostic plots
try:
    import matplotlib
    import matplotlib.pyplot as plt
    import seaborn as sns
    matplotlib.use("Agg")  # non-interactive backend
    _PLOTS_AVAILABLE = True
except ImportError:
    _PLOTS_AVAILABLE = False
    print("[WARNING] matplotlib/seaborn not installed — plots will be skipped.")
    print("          Run: pip install matplotlib seaborn  to enable plots.\n")

from sklearn.model_selection import train_test_split
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.ensemble import (
    RandomForestRegressor,
    RandomForestClassifier,
    IsolationForest,
)
from sklearn.metrics import (
    mean_absolute_error,
    mean_squared_error,
    r2_score,
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    classification_report,
    confusion_matrix,
)

# ------------------------------------------------------------
# PATHS
# ------------------------------------------------------------

# Resolve paths relative to this file so the script works
# regardless of the working directory it is called from.
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_DIR = os.path.join(BASE_DIR, "models")
PLOT_DIR = os.path.join(BASE_DIR, "plots")

os.makedirs(MODEL_DIR, exist_ok=True)
os.makedirs(PLOT_DIR, exist_ok=True)

np.random.seed(42)


# ============================================================
# PART A  —  QUALITY PREDICTION
# ============================================================

print("\n" + "=" * 70)
print("1. QUALITY PREDICTION MODEL")
print("=" * 70)

# ------------------------------------------------------------
# Generate synthetic quality data
# ------------------------------------------------------------

N_QUALITY = 1500
CROP_TYPES = ["Mango", "Tomato", "Onion", "Potato", "Apple"]

quality_data = pd.DataFrame(
    {
        "crop_type": np.random.choice(CROP_TYPES, N_QUALITY),
        # Temperature during storage / transport (°C)
        "temperature_c": np.random.uniform(2, 20, N_QUALITY),
        # Relative humidity (%)
        "humidity_percent": np.random.uniform(45, 95, N_QUALITY),
        # Number of days in storage
        "storage_days": np.random.randint(1, 20, N_QUALITY),
        # Transportation duration (hours)
        "transport_hours": np.random.uniform(2, 72, N_QUALITY),
        # Moisture content (%)
        "moisture_percent": np.random.uniform(30, 90, N_QUALITY),
        # Initial quality score at harvest (0–100)
        "initial_quality": np.random.uniform(70, 100, N_QUALITY),
    }
)

# Derived quality score (replace with real labels in production)
quality_score = (
    quality_data["initial_quality"]
    - np.maximum(quality_data["temperature_c"] - 8, 0) * 2.0
    - np.maximum(quality_data["humidity_percent"] - 80, 0) * 0.25
    - quality_data["storage_days"] * 1.2
    - quality_data["transport_hours"] * 0.10
    - np.maximum(quality_data["moisture_percent"] - 75, 0) * 0.15
    - np.maximum(40 - quality_data["moisture_percent"], 0) * 0.10
    + np.random.normal(0, 3, N_QUALITY)
)
quality_data["quality_score"] = np.clip(quality_score, 0, 100)

# Features / target
X_quality = quality_data.drop(columns=["quality_score"])
y_quality = quality_data["quality_score"]

X_train_q, X_test_q, y_train_q, y_test_q = train_test_split(
    X_quality, y_quality, test_size=0.20, random_state=42
)

# Preprocessing
quality_preprocessor = ColumnTransformer(
    transformers=[
        (
            "categorical",
            OneHotEncoder(handle_unknown="ignore"),
            ["crop_type"],
        ),
        (
            "numeric",
            StandardScaler(),
            [
                "temperature_c",
                "humidity_percent",
                "storage_days",
                "transport_hours",
                "moisture_percent",
                "initial_quality",
            ],
        ),
    ]
)

# Pipeline
quality_model = Pipeline(
    steps=[
        ("preprocessor", quality_preprocessor),
        (
            "model",
            RandomForestRegressor(
                n_estimators=200,
                max_depth=12,
                random_state=42,
            ),
        ),
    ]
)

quality_model.fit(X_train_q, y_train_q)

# Evaluate
quality_predictions = quality_model.predict(X_test_q)
mae  = mean_absolute_error(y_test_q, quality_predictions)
rmse = np.sqrt(mean_squared_error(y_test_q, quality_predictions))
r2   = r2_score(y_test_q, quality_predictions)

print(f"\nMAE  : {mae:.2f}")
print(f"RMSE : {rmse:.2f}")
print(f"R²   : {r2:.3f}")

# Save model
joblib.dump(quality_model, os.path.join(MODEL_DIR, "quality_prediction_model.pkl"))
print("\nQuality model saved  ->  models/quality_prediction_model.pkl")

# Plot: Actual vs Predicted
if _PLOTS_AVAILABLE:
    plt.figure(figsize=(7, 6))
    plt.scatter(y_test_q, quality_predictions, alpha=0.6)
    plt.plot([0, 100], [0, 100], "r--")
    plt.xlabel("Actual Quality Score")
    plt.ylabel("Predicted Quality Score")
    plt.title("Quality Prediction — Actual vs Predicted")
    plt.tight_layout()
    plt.savefig(os.path.join(PLOT_DIR, "quality_prediction.png"), dpi=150)
    plt.close()
    print("Plot saved           ->  plots/quality_prediction.png")
else:
    print("[SKIP] Quality plot skipped (matplotlib not installed).")


# ============================================================
# PART B  —  SPOILAGE PREDICTION
# ============================================================

print("\n" + "=" * 70)
print("2. SPOILAGE PREDICTION MODEL")
print("=" * 70)

N_SPOILAGE = 2000

spoilage_data = pd.DataFrame(
    {
        "crop_type": np.random.choice(CROP_TYPES, N_SPOILAGE),
        "temperature_c": np.random.uniform(2, 25, N_SPOILAGE),
        "humidity_percent": np.random.uniform(40, 98, N_SPOILAGE),
        "storage_days": np.random.randint(1, 25, N_SPOILAGE),
        "transport_hours": np.random.uniform(2, 96, N_SPOILAGE),
        "moisture_percent": np.random.uniform(30, 95, N_SPOILAGE),
    }
)

# Risk score → sigmoid probability
risk_score = (
    -8
    + 0.35 * spoilage_data["temperature_c"]
    + 0.09 * spoilage_data["humidity_percent"]
    + 0.18 * spoilage_data["storage_days"]
    + 0.025 * spoilage_data["transport_hours"]
    + 0.035 * spoilage_data["moisture_percent"]
)
spoilage_probability = 1 / (1 + np.exp(-risk_score / 3))
spoilage_data["spoilage"] = (
    np.random.random(N_SPOILAGE) < spoilage_probability
).astype(int)

X_spoilage = spoilage_data.drop(columns=["spoilage"])
y_spoilage = spoilage_data["spoilage"]

X_train_s, X_test_s, y_train_s, y_test_s = train_test_split(
    X_spoilage,
    y_spoilage,
    test_size=0.20,
    random_state=42,
    stratify=y_spoilage,
)

spoilage_preprocessor = ColumnTransformer(
    transformers=[
        (
            "categorical",
            OneHotEncoder(handle_unknown="ignore"),
            ["crop_type"],
        ),
        (
            "numeric",
            StandardScaler(),
            [
                "temperature_c",
                "humidity_percent",
                "storage_days",
                "transport_hours",
                "moisture_percent",
            ],
        ),
    ]
)

spoilage_model = Pipeline(
    steps=[
        ("preprocessor", spoilage_preprocessor),
        (
            "model",
            RandomForestClassifier(
                n_estimators=200,
                max_depth=12,
                random_state=42,
                class_weight="balanced",
            ),
        ),
    ]
)

spoilage_model.fit(X_train_s, y_train_s)

# Evaluate
spoilage_predictions = spoilage_model.predict(X_test_s)

print(f"\nAccuracy  : {accuracy_score(y_test_s, spoilage_predictions):.3f}")
print(f"Precision : {precision_score(y_test_s, spoilage_predictions):.3f}")
print(f"Recall    : {recall_score(y_test_s, spoilage_predictions):.3f}")
print(f"F1 Score  : {f1_score(y_test_s, spoilage_predictions):.3f}")
print("\nClassification Report:")
print(classification_report(y_test_s, spoilage_predictions))

# Save model
joblib.dump(spoilage_model, os.path.join(MODEL_DIR, "spoilage_prediction_model.pkl"))
print("Spoilage model saved ->  models/spoilage_prediction_model.pkl")

# Plot: Confusion Matrix
if _PLOTS_AVAILABLE:
    plt.figure(figsize=(6, 5))
    cm = confusion_matrix(y_test_s, spoilage_predictions)
    sns.heatmap(cm, annot=True, fmt="d", cmap="Blues")
    plt.title("Spoilage Prediction — Confusion Matrix")
    plt.xlabel("Predicted")
    plt.ylabel("Actual")
    plt.tight_layout()
    plt.savefig(os.path.join(PLOT_DIR, "spoilage_confusion_matrix.png"), dpi=150)
    plt.close()
    print("Plot saved           ->  plots/spoilage_confusion_matrix.png")
else:
    print("[SKIP] Confusion matrix plot skipped (matplotlib not installed).")


# ============================================================
# PART C  —  FRAUD / ANOMALY DETECTION
# ============================================================

print("\n" + "=" * 70)
print("3. FRAUD / ANOMALY DETECTION MODEL")
print("=" * 70)

NORMAL_N  = 1500
FRAUD_N   = 100

normal_data = pd.DataFrame(
    {
        "quantity_kg": np.random.normal(500, 80, NORMAL_N).clip(100, 1000),
        "transport_hours": np.random.normal(15, 5, NORMAL_N).clip(2, 40),
        "distance_km": np.random.normal(300, 80, NORMAL_N).clip(50, 700),
        "transaction_value": np.random.normal(25000, 5000, NORMAL_N).clip(5000, 50000),
        "certificate_age_days": np.random.normal(15, 8, NORMAL_N).clip(1, 60),
        "ownership_transfers": np.random.normal(2, 1, NORMAL_N).clip(1, 6),
    }
)

fraud_data_raw = pd.DataFrame(
    {
        "quantity_kg": np.random.uniform(1200, 4000, FRAUD_N),
        "transport_hours": np.random.uniform(1, 3, FRAUD_N),
        "distance_km": np.random.uniform(20, 80, FRAUD_N),
        "transaction_value": np.random.uniform(100000, 500000, FRAUD_N),
        "certificate_age_days": np.random.uniform(180, 1000, FRAUD_N),
        "ownership_transfers": np.random.uniform(10, 30, FRAUD_N),
    }
)

fraud_all = pd.concat([normal_data, fraud_data_raw], ignore_index=True)
fraud_labels = np.array([0] * NORMAL_N + [1] * FRAUD_N)

FRAUD_FEATURES = [
    "quantity_kg",
    "transport_hours",
    "distance_km",
    "transaction_value",
    "certificate_age_days",
    "ownership_transfers",
]

fraud_scaler = StandardScaler()
X_fraud_scaled = fraud_scaler.fit_transform(fraud_all[FRAUD_FEATURES])

fraud_model = IsolationForest(
    n_estimators=200,
    contamination=0.06,
    random_state=42,
)
fraud_model.fit(X_fraud_scaled)

raw_preds = fraud_model.predict(X_fraud_scaled)
fraud_predictions = np.where(raw_preds == -1, 1, 0)

print("\nFraud Detection Metrics:")
print(
    classification_report(
        fraud_labels,
        fraud_predictions,
        target_names=["Normal", "Fraud/Anomaly"],
    )
)

# Save fraud model + scaler
joblib.dump(fraud_model,  os.path.join(MODEL_DIR, "fraud_detection_model.pkl"))
joblib.dump(fraud_scaler, os.path.join(MODEL_DIR, "fraud_scaler.pkl"))
print("Fraud model saved    ->  models/fraud_detection_model.pkl")
print("Fraud scaler saved   ->  models/fraud_scaler.pkl")


# ============================================================
# PART D  —  QUICK SMOKE TEST
# ============================================================

print("\n" + "=" * 70)
print("4. SMOKE TEST — NEW BATCH PREDICTION")
print("=" * 70)


def predict_batch(
    crop_type: str,
    temperature_c: float,
    humidity_percent: float,
    storage_days: int,
    transport_hours: float,
    moisture_percent: float,
    initial_quality: float,
    quantity_kg: float,
    distance_km: float,
    transaction_value: float,
    certificate_age_days: float,
    ownership_transfers: float,
) -> dict:
    """
    Run quality, spoilage, and fraud predictions for a single batch.

    Parameters
    ----------
    crop_type : str
        One of Mango | Tomato | Onion | Potato | Apple.
    temperature_c : float
        Storage / transit temperature in Celsius.
    humidity_percent : float
        Relative humidity (%).
    storage_days : int
        Days held in storage.
    transport_hours : float
        Duration of transport in hours.
    moisture_percent : float
        Moisture content of the crop (%).
    initial_quality : float
        Quality score at harvest (0–100).
    quantity_kg : float
        Batch weight in kilograms.
    distance_km : float
        Transit distance in kilometres.
    transaction_value : float
        Declared monetary value of the transaction.
    certificate_age_days : float
        Age of the compliance certificate in days.
    ownership_transfers : float
        Number of times ownership changed hands.

    Returns
    -------
    dict
        quality_score, quality_label, spoilage_probability (%),
        spoilage_status, fraud_status, fraud_anomaly_score.
    """

    # --- Quality ---
    quality_input = pd.DataFrame(
        [
            {
                "crop_type": crop_type,
                "temperature_c": temperature_c,
                "humidity_percent": humidity_percent,
                "storage_days": storage_days,
                "transport_hours": transport_hours,
                "moisture_percent": moisture_percent,
                "initial_quality": initial_quality,
            }
        ]
    )
    predicted_quality = float(
        np.clip(quality_model.predict(quality_input)[0], 0, 100)
    )

    if predicted_quality >= 85:
        quality_label = "Excellent"
    elif predicted_quality >= 70:
        quality_label = "Good"
    elif predicted_quality >= 50:
        quality_label = "Moderate"
    else:
        quality_label = "Poor"

    # --- Spoilage ---
    spoilage_input = pd.DataFrame(
        [
            {
                "crop_type": crop_type,
                "temperature_c": temperature_c,
                "humidity_percent": humidity_percent,
                "storage_days": storage_days,
                "transport_hours": transport_hours,
                "moisture_percent": moisture_percent,
            }
        ]
    )
    spoilage_prob = float(
        spoilage_model.predict_proba(spoilage_input)[0][1]
    )
    spoilage_status = "High Risk" if spoilage_prob >= 0.50 else "Low Risk"

    # --- Fraud ---
    fraud_input_df = pd.DataFrame(
        [
            {
                "quantity_kg": quantity_kg,
                "transport_hours": transport_hours,
                "distance_km": distance_km,
                "transaction_value": transaction_value,
                "certificate_age_days": certificate_age_days,
                "ownership_transfers": ownership_transfers,
            }
        ]
    )
    fraud_scaled = fraud_scaler.transform(fraud_input_df[FRAUD_FEATURES])
    fraud_result = fraud_model.predict(fraud_scaled)[0]
    fraud_score  = float(fraud_model.decision_function(fraud_scaled)[0])
    fraud_status = (
        "Suspicious / Anomaly" if fraud_result == -1 else "Normal"
    )

    return {
        "quality_score": round(predicted_quality, 2),
        "quality_label": quality_label,
        "spoilage_probability": round(spoilage_prob * 100, 2),
        "spoilage_status": spoilage_status,
        "fraud_status": fraud_status,
        "fraud_anomaly_score": round(fraud_score, 4),
    }


sample_result = predict_batch(
    crop_type="Mango",
    temperature_c=14,
    humidity_percent=88,
    storage_days=8,
    transport_hours=30,
    moisture_percent=82,
    initial_quality=92,
    quantity_kg=500,
    distance_km=350,
    transaction_value=28000,
    certificate_age_days=10,
    ownership_transfers=2,
)

print("\nSample Batch — Mango")
print("-" * 50)
for key, value in sample_result.items():
    print(f"  {key.replace('_', ' ').title():<26}: {value}")


print("\n" + "=" * 70)
print("ALL MODELS TRAINED AND SAVED SUCCESSFULLY")
print("=" * 70)
print("\nSaved artefacts:")
print(f"  {MODEL_DIR}/quality_prediction_model.pkl")
print(f"  {MODEL_DIR}/spoilage_prediction_model.pkl")
print(f"  {MODEL_DIR}/fraud_detection_model.pkl")
print(f"  {MODEL_DIR}/fraud_scaler.pkl")
print(f"\nPlots:")
print(f"  {PLOT_DIR}/quality_prediction.png")
print(f"  {PLOT_DIR}/spoilage_confusion_matrix.png")
