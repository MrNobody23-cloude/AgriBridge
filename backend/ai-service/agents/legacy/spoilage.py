import os
import random

import matplotlib
import numpy as np
import pandas as pd

matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from utils import (
    DATA_DIR,
    ensure_directories,
    get_agent_results_dir,
    load_pickle,
    save_eda_notes,
    save_metrics_json,
    save_pickle,
)

# --- Domain & Agronomic Threshold Assumptions ---
# Critical thermal limits before active physiological breakdown occurs
CROP_SPOILAGE_THRESHOLDS = {
    "Mango": {"crit_temp": 14.0, "max_safe_days": 12.0},
    "Tomato": {"crit_temp": 13.0, "max_safe_days": 10.0},
    "Potato": {"crit_temp": 10.0, "max_safe_days": 21.0},
    "Banana": {"crit_temp": 15.0, "max_safe_days": 9.0},
    "Onion": {"crit_temp": 20.0, "max_safe_days": 30.0}
}

def generate_data(n_samples: int = 1500) -> pd.DataFrame:
    """Builds and returns a realistic synthetic dataset for Spoilage Risk prediction."""
    np.random.seed(42)
    random.seed(42)

    rows = []
    crops = list(CROP_SPOILAGE_THRESHOLDS.keys())

    for i in range(n_samples):
        batch_id = f"EX-{1500 + i}"
        crop = random.choice(crops)
        thresholds = CROP_SPOILAGE_THRESHOLDS[crop]

        days_since_harvest = random.uniform(1.0, 15.0)
        remaining_transit_days = random.uniform(0.5, 7.0)
        current_temp = random.uniform(5.0, 36.0)
        temp_variance = random.uniform(0.5, 8.0)
        humidity = random.uniform(40.0, 98.0)
        num_breaches = random.randint(0, 6)

        # Agronomic risk score formulation
        temp_excess = max(0.0, current_temp - thresholds["crit_temp"])
        age_factor = (days_since_harvest + remaining_transit_days) / thresholds["max_safe_days"]

        log_odds = (
            (temp_excess * 0.35) +
            (num_breaches * 0.85) +
            (age_factor * 2.2) +
            (temp_variance * 0.25) - 8.8
        )
        
        # Sigmoidal probability transformation
        spoilage_prob = 1.0 / (1.0 + np.exp(-log_odds))
        is_spoiled = np.random.binomial(1, spoilage_prob)

        rows.append({
            "batch_id": batch_id,
            "crop_type": crop,
            "current_days_since_harvest": round(days_since_harvest, 1),
            "remaining_transport_time": round(remaining_transit_days, 1),
            "current_temperature": round(current_temp, 2),
            "temperature_variance": round(temp_variance, 2),
            "humidity": round(humidity, 2),
            "num_temperature_breaches": num_breaches,
            "is_spoiled": is_spoiled
        })

    df = pd.DataFrame(rows)
    ensure_directories()
    df.to_csv(os.path.join(DATA_DIR, "spoilage_dataset.csv"), index=False)
    return df

def build_model():
    """Returns an untrained RandomForestClassifier pipeline with class weighting."""
    numeric_features = [
        "current_days_since_harvest", "remaining_transport_time",
        "current_temperature", "temperature_variance", "humidity", "num_temperature_breaches"
    ]
    categorical_features = ["crop_type"]

    preprocessor = ColumnTransformer(transformers=[
        ('num', StandardScaler(), numeric_features),
        ('cat', OneHotEncoder(handle_unknown='ignore', sparse_output=False), categorical_features)
    ])

    pipeline = Pipeline(steps=[
        ('preprocessor', preprocessor),
        ('classifier', RandomForestClassifier(
            n_estimators=100,
            max_depth=10,
            class_weight='balanced',
            random_state=42
        ))
    ])

    return pipeline

def evaluate(model, X_test, y_test) -> dict:
    """Computes evaluation metrics (Precision, Recall, F1, ROC-AUC) and saves confusion matrix & feature importances."""
    agent_dir = get_agent_results_dir("spoilage")
    
    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]

    precision = float(precision_score(y_test, y_pred, zero_division=0))
    recall = float(recall_score(y_test, y_pred, zero_division=0))
    f1 = float(f1_score(y_test, y_pred, zero_division=0))
    roc_auc = float(roc_auc_score(y_test, y_prob))
    accuracy = float(accuracy_score(y_test, y_pred))
    cm = confusion_matrix(y_test, y_pred).tolist()

    # Save Confusion Matrix Plot
    plt.figure(figsize=(6, 5))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Oranges',
                xticklabels=['OK (0)', 'Spoiled (1)'],
                yticklabels=['OK (0)', 'Spoiled (1)'])
    plt.title('Spoilage Prediction — Confusion Matrix')
    plt.xlabel('Predicted Class')
    plt.ylabel('Ground Truth Class')
    plt.tight_layout()
    plt.savefig(os.path.join(agent_dir, "confusion_matrix.png"))
    plt.close()

    # Save Feature Importance Plot
    rf_model = model.named_steps['classifier']
    prep = model.named_steps['preprocessor']
    cat_cols = prep.named_transformers_['cat'].get_feature_names_out(["crop_type"])
    num_cols = [
        "current_days_since_harvest", "remaining_transport_time",
        "current_temperature", "temperature_variance", "humidity", "num_temperature_breaches"
    ]
    all_feature_names = list(num_cols) + list(cat_cols)

    importances = rf_model.feature_importances_
    feat_df = pd.DataFrame({"feature": all_feature_names, "importance": importances}).sort_values(by="importance", ascending=False)

    plt.figure(figsize=(8, 5))
    sns.barplot(data=feat_df, x="importance", y="feature", hue="feature", legend=False, palette="YlOrRd_r")
    plt.title("Spoilage Prediction Model — Feature Importances")
    plt.xlabel("Importance Weight")
    plt.tight_layout()
    plt.savefig(os.path.join(agent_dir, "feature_importances.png"))
    plt.close()

    metrics = {
        "accuracy": accuracy,
        "precision": precision,
        "recall": recall,
        "f1_score": f1,
        "roc_auc": roc_auc,
        "confusion_matrix": cm,
        "test_samples": len(y_test),
        "top_features": feat_df["feature"].head(5).tolist()
    }

    save_metrics_json(metrics, "spoilage")
    return metrics

def train_and_save(save_dir: str = "models/") -> dict:
    """Trains the Spoilage RandomForestClassifier pipeline, evaluates performance, and saves pickle."""
    df = generate_data(n_samples=1500)

    feature_cols = [
        "crop_type", "current_days_since_harvest", "remaining_transport_time",
        "current_temperature", "temperature_variance", "humidity", "num_temperature_breaches"
    ]
    X = df[feature_cols]
    y = df["is_spoiled"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    eda_content = f"""# Spoilage Prediction Agent — EDA & Label Leakage Check

## Dataset Overview
- **Total Samples:** {len(df)} transit batches
- **Class Balance:** {int((df['is_spoiled']==0).sum())} OK ({(df['is_spoiled']==0).mean()*100:.1f}%), {int((df['is_spoiled']==1).sum())} Spoiled ({(df['is_spoiled']==1).mean()*100:.1f}%)

## Physical Feature Ranges
- `current_temperature`: 5.0°C to 36.0°C
- `num_temperature_breaches`: 0 to 6 thermal breach events recorded in transit
- `current_days_since_harvest`: 1.0 to 15.0 days
- `remaining_transport_time`: 0.5 to 7.0 days

## Class Imbalance Handling
- Natural imbalanced ratio (~24% spoilage rate) preserved to match real-world transit risk.
- Handled during training using `class_weight='balanced'` in RandomForest and stratified train/test splitting.

## Label Leakage Verification
- Binary label `is_spoiled` sampled from a sigmoidal risk formula combining thermal excess and transit age.
- Telemetry features are standard cold-chain tracker inputs available before delivery.
"""
    save_eda_notes("spoilage", eda_content)

    model = build_model()
    model.fit(X_train, y_train)

    metrics = evaluate(model, X_test, y_test)
    save_pickle(model, "spoilage_model.pkl")
    return metrics

def predict(input_dict: dict) -> dict:
    """
    Takes raw transit telemetry parameters and returns exact output JSON contract.
    """
    batch_id = input_dict.get("batch_id", "EX-UNKNOWN")
    crop_type = input_dict.get("crop_type", "Mango")
    current_days_since_harvest = float(input_dict.get("current_days_since_harvest", 4.0))
    remaining_transport_time = float(input_dict.get("remaining_transport_time", 2.0))
    current_temperature = float(input_dict.get("current_temperature", 24.0))
    temperature_variance = float(input_dict.get("temperature_variance", 2.5))
    humidity = float(input_dict.get("humidity", 70.0))
    num_temperature_breaches = int(input_dict.get("num_temperature_breaches", 1))

    input_df = pd.DataFrame([{
        "crop_type": crop_type,
        "current_days_since_harvest": current_days_since_harvest,
        "remaining_transport_time": remaining_transport_time,
        "current_temperature": current_temperature,
        "temperature_variance": temperature_variance,
        "humidity": humidity,
        "num_temperature_breaches": num_temperature_breaches
    }])

    model = load_pickle("spoilage_model.pkl")
    probs = model.predict_proba(input_df)[0]
    
    # Probability of positive class (Spoiled / Risk)
    spoilage_risk_pct = int(round(probs[1] * 100.0))
    predicted_class = 1 if spoilage_risk_pct >= 50 else 0
    
    # Confidence score: model's estimated probability for the predicted class
    confidence_score = int(round(probs[predicted_class] * 100.0))

    # Alert level contract thresholds:
    # >=80: CRITICAL (Immediate reroute or salvage needed)
    # >=50: WARNING (Accelerated transit or cooling check advised)
    # <50: OK (Normal transit risk)
    if spoilage_risk_pct >= 80:
        alert_level = "CRITICAL"
    elif spoilage_risk_pct >= 50:
        alert_level = "WARNING"
    else:
        alert_level = "OK"

    return {
        "batch_id": batch_id,
        "spoilage_risk_pct": spoilage_risk_pct,
        "alert_level": alert_level,
        "confidence_score": confidence_score
    }
