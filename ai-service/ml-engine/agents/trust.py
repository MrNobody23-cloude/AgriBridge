import os
import random
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns

from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.metrics import accuracy_score
from sklearn.metrics import confusion_matrix, precision_score, recall_score, f1_score, roc_auc_score
from sklearn.model_selection import train_test_split

from utils import save_pickle, load_pickle, save_metrics_json, save_eda_notes, get_agent_results_dir, ensure_directories, DATA_DIR

def generate_data(n_samples: int = 1500) -> pd.DataFrame:
    """
    Builds and returns a realistic synthetic dataset for the Consumer Trust meta-classifier.
    Inputs are simulated outputs from the other 5 agents for the same batch.
    """
    np.random.seed(42)
    random.seed(42)

    rows = []

    for i in range(n_samples):
        batch_id = f"AG-{5000 + i}"

        # Simulate upstream agent signals for a batch
        traceability_confidence = random.uniform(20.0, 100.0)   # 0-100 composite score
        quality_score = random.uniform(10.0, 100.0)             # 0-100 quality score
        spoilage_risk_pct = random.uniform(0.0, 100.0)          # 0-100 risk %
        fraud_flagged = 1 if random.random() < 0.12 else 0      # ~12% fraud rate
        compliance_pass = 1 if random.random() < 0.70 else 0    # ~70% compliance pass rate

        # Derive is_authentic label from business logic:
        # Authentic = high traceability confidence + not fraud flagged + compliance passed
        # with some signal from quality and spoilage
        auth_score = (
            (traceability_confidence / 100.0) * 3.0     # Traceability is highest weight
            + (1 - fraud_flagged) * 3.5                 # Not being fraud-flagged is critical
            + (compliance_pass) * 2.5                   # Compliance pass is required
            + (quality_score / 100.0) * 1.0             # Quality adds mild signal
            + ((100.0 - spoilage_risk_pct) / 100.0) * 1.0  # Low spoilage risk adds mild signal
        )
        # Max possible auth_score = 11.0, threshold for authentic at ~7.5
        raw_prob = 1.0 / (1.0 + np.exp(-(auth_score - 7.5)))
        
        # Add 4% label noise to prevent trivial rule-based separation
        is_authentic = np.random.binomial(1, raw_prob)
        if random.random() < 0.04:
            is_authentic = 1 - is_authentic

        rows.append({
            "batch_id": batch_id,
            "traceability_confidence": round(traceability_confidence, 2),
            "quality_score": round(quality_score, 2),
            "spoilage_risk_pct": round(spoilage_risk_pct, 2),
            "fraud_flagged": fraud_flagged,
            "compliance_status": compliance_pass,   # 1=PASS, 0=FAIL (encoded)
            "is_authentic": int(is_authentic)
        })

    df = pd.DataFrame(rows)
    ensure_directories()
    df.to_csv(os.path.join(DATA_DIR, "trust_dataset.csv"), index=False)
    return df

def build_model():
    """
    Returns an untrained Logistic Regression pipeline.
    Logistic Regression is deliberately chosen here (over RandomForest) because:
    - It's interpretable: coefficients show how much each upstream agent's signal matters
    - Odds-ratio coefficients can be explained clearly in a viva
    - This agent is an aggregator, not a deep learner
    """
    pipeline = Pipeline(steps=[
        ('scaler', StandardScaler()),
        ('classifier', LogisticRegression(
            class_weight='balanced',
            max_iter=1000,
            random_state=42,
            C=1.0       # L2 regularization to prevent overfitting on 5 input features
        ))
    ])
    return pipeline

def evaluate(model, X_test, y_test) -> dict:
    """Computes evaluation metrics and saves confusion matrix & coefficient importance plot."""
    agent_dir = get_agent_results_dir("trust")

    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]

    precision = float(precision_score(y_test, y_pred, zero_division=0))
    recall = float(recall_score(y_test, y_pred, zero_division=0))
    f1 = float(f1_score(y_test, y_pred, zero_division=0))
    roc_auc = float(roc_auc_score(y_test, y_prob))
    accuracy = accuracy_score(y_test, y_pred)
    cm = confusion_matrix(y_test, y_pred).tolist()

    # Save Confusion Matrix Plot
    plt.figure(figsize=(6, 5))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Purples',
                xticklabels=['Not Authentic (0)', 'Authentic (1)'],
                yticklabels=['Not Authentic (0)', 'Authentic (1)'])
    plt.title('Consumer Trust Agent — Confusion Matrix')
    plt.xlabel('Predicted')
    plt.ylabel('Ground Truth')
    plt.tight_layout()
    plt.savefig(os.path.join(agent_dir, "confusion_matrix.png"))
    plt.close()

    # Save Logistic Regression Coefficients as feature importance proxy
    feature_cols = [
        "traceability_confidence", "quality_score", "spoilage_risk_pct",
        "fraud_flagged", "compliance_status"
    ]
    coefficients = model.named_steps['classifier'].coef_[0]
    coef_df = pd.DataFrame({"feature": feature_cols, "coefficient": coefficients}).sort_values(
        by="coefficient", key=abs, ascending=False
    )

    colors = ['steelblue' if c > 0 else 'tomato' for c in coef_df["coefficient"]]
    plt.figure(figsize=(8, 5))
    plt.barh(coef_df["feature"], coef_df["coefficient"], color=colors)
    plt.axvline(0, color='black', linewidth=0.8)
    plt.title("Consumer Trust Agent — Logistic Regression Coefficients\n(Blue = increases authenticity, Red = decreases)")
    plt.xlabel("Coefficient Value (log-odds contribution)")
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
        "top_features_by_coefficient": coef_df["feature"].tolist(),
        "coefficients": [round(float(c), 4) for c in coef_df["coefficient"].tolist()]
    }

    save_metrics_json(metrics, "trust")
    return metrics

def train_and_save(save_dir: str = "models/") -> dict:
    """Trains the Consumer Trust Logistic Regression pipeline, evaluates, and saves pickle."""
    df = generate_data(n_samples=1500)

    feature_cols = [
        "traceability_confidence", "quality_score", "spoilage_risk_pct",
        "fraud_flagged", "compliance_status"
    ]
    X = df[feature_cols]
    y = df["is_authentic"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    eda_content = f"""# Consumer Trust Agent — EDA & Label Leakage Check

## Dataset Overview
- **Total Samples:** {len(df)} batch authenticity assessments
- **Class Balance:** {int((df['is_authentic']==0).sum())} Not Authentic ({(df['is_authentic']==0).mean()*100:.1f}%), {int((df['is_authentic']==1).sum())} Authentic ({(df['is_authentic']==1).mean()*100:.1f}%)

## Input Features (upstream agent outputs)
- `traceability_confidence`: 0–100 composite chain score from Agent 1
- `quality_score`: 0–100 produce quality score from Agent 2
- `spoilage_risk_pct`: 0–100 spoilage risk % from Agent 3
- `fraud_flagged`: Binary 0/1 from Agent 4
- `compliance_status`: Binary 1=PASS, 0=FAIL from Agent 5

## Label Derivation Logic
- Authentic label derived via weighted logistic formula:
  - Traceability confidence (weight 3.0) + Not fraud-flagged (weight 3.5) + Compliance pass (weight 2.5)
  - Quality & low spoilage risk add mild secondary signal (weight 1.0 each)
  - 4% random noise injected to prevent trivial rule learning

## Label Leakage Verification
- No feature directly encodes the label — each is an independent upstream agent signal.
- The logistic regression must learn the weight of each agent signal from co-occurrence patterns.

## Why Logistic Regression (not RandomForest)?
- 5 numeric/binary features only — linear separability is sufficient and interpretable
- Coefficients = direct viva explanation: "fraud_flagged has the highest negative coefficient"
"""
    save_eda_notes("trust", eda_content)

    model = build_model()
    model.fit(X_train, y_train)

    metrics = evaluate(model, X_test, y_test)
    save_pickle(model, "trust_model.pkl")
    return metrics

def predict(input_dict: dict) -> dict:
    """
    Takes aggregated upstream agent outputs for a batch and returns exact output JSON contract.
    """
    batch_id = input_dict.get("batch_id", "AG-UNKNOWN")
    traceability_confidence = float(input_dict.get("traceability_confidence", 80.0))
    quality_score = float(input_dict.get("quality_score", 70.0))
    spoilage_risk_pct = float(input_dict.get("spoilage_risk_pct", 20.0))
    fraud_flagged_raw = input_dict.get("fraud_flagged", False)
    fraud_flagged = 1 if (fraud_flagged_raw is True or str(fraud_flagged_raw).lower() == 'true' or fraud_flagged_raw == 1) else 0
    compliance_status_raw = input_dict.get("compliance_status", "PASS")
    compliance_status = 1 if (str(compliance_status_raw).upper() == "PASS" or compliance_status_raw == 1 or compliance_status_raw is True) else 0

    input_df = pd.DataFrame([{
        "traceability_confidence": traceability_confidence,
        "quality_score": quality_score,
        "spoilage_risk_pct": spoilage_risk_pct,
        "fraud_flagged": fraud_flagged,
        "compliance_status": compliance_status
    }])

    model = load_pickle("trust_model.pkl")
    probs = model.predict_proba(input_df)[0]
    predicted_class = int(model.predict(input_df)[0])

    is_authentic = bool(predicted_class == 1)
    confidence_score = int(round(probs[predicted_class] * 100.0))

    return {
        "batch_id": batch_id,
        "is_authentic": is_authentic,
        "answer": "Yes" if is_authentic else "No",
        "confidence_score": confidence_score
    }
