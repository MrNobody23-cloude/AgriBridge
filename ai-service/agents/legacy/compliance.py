import os
import random
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns

from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.metrics import confusion_matrix, precision_score, recall_score, f1_score, roc_auc_score, accuracy_score
from sklearn.model_selection import train_test_split

from utils import save_pickle, load_pickle, save_metrics_json, save_eda_notes, get_agent_results_dir, ensure_directories, DATA_DIR

# --- Realistic MRL (Maximum Residue Limit) thresholds in mg/kg per crop & market ---
# Source basis: EU Regulation 396/2005 & Codex Alimentarius (approximate values)
# EU has stricter limits than Indian domestic market for most pesticides
MRL_THRESHOLDS = {
    "Mango":  {"EU": 0.10, "Domestic": 0.50, "Gulf": 0.20},  # EU is strictest for mangoes
    "Tomato": {"EU": 0.20, "Domestic": 1.00, "Gulf": 0.50},  # Tomatoes allowed higher domestic
    "Potato": {"EU": 0.05, "Domestic": 0.30, "Gulf": 0.10},  # Potatoes very restricted in EU
    "Banana": {"EU": 0.10, "Domestic": 0.40, "Gulf": 0.20},
    "Onion":  {"EU": 0.30, "Domestic": 1.50, "Gulf": 0.70},
}

CROPS = list(MRL_THRESHOLDS.keys())
MARKETS = ["EU", "Domestic", "Gulf"]

def generate_data(n_samples: int = 1500) -> pd.DataFrame:
    """Builds and returns a realistic synthetic dataset for Compliance checking."""
    np.random.seed(42)
    random.seed(42)

    rows = []

    for i in range(n_samples):
        batch_id = f"C-BATCH-{3000 + i}"
        crop = random.choice(CROPS)
        market = random.choice(MARKETS)
        mrl_limit = MRL_THRESHOLDS[crop][market]

        # ~80% batches comfortably within limits; ~20% at-risk (near or over limit)
        if random.random() < 0.80:
            # Comfortably within limit: residue 10%–85% of MRL
            residue = random.uniform(mrl_limit * 0.10, mrl_limit * 0.85)
        else:
            # At-risk: residue 75%–200% of MRL (some breach, some borderline)
            residue = random.uniform(mrl_limit * 0.75, mrl_limit * 2.00)

        # Add realistic sensor/lab measurement noise
        residue = max(0.001, residue + np.random.normal(0, mrl_limit * 0.05))

        # Certificate validity: ~85% valid, ~15% expired/invalid
        cert_valid = 1 if random.random() < 0.85 else 0
        # Remaining days: valid certs have 1–365 days left; invalid have -180 to 0
        if cert_valid:
            cert_expiry_days = random.randint(1, 365)
        else:
            cert_expiry_days = random.randint(-180, 0)

        # Compliance label: PASS if residue is within MRL AND cert is valid
        passes_residue = residue <= mrl_limit
        passes_cert = (cert_valid == 1) and (cert_expiry_days > 0)
        compliance_pass = 1 if (passes_residue and passes_cert) else 0

        # Add 3% noise to label (rare borderline judgment calls)
        if random.random() < 0.03:
            compliance_pass = 1 - compliance_pass

        rows.append({
            "batch_id": batch_id,
            "crop_type": crop,
            "pesticide_residue_level": round(residue, 4),
            "certification_valid": cert_valid,
            "certificate_expiry_days_remaining": cert_expiry_days,
            "destination_market": market,
            "mrl_limit": round(mrl_limit, 3),       # included for EDA; NOT fed to model
            "compliance_pass": compliance_pass
        })

    df = pd.DataFrame(rows)
    ensure_directories()
    df.to_csv(os.path.join(DATA_DIR, "compliance_dataset.csv"), index=False)
    return df

def build_model():
    """Returns an untrained RandomForestClassifier pipeline for Compliance classification."""
    numeric_features = [
        "pesticide_residue_level", "certificate_expiry_days_remaining", "certification_valid"
    ]
    categorical_features = ["crop_type", "destination_market"]

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
    """Computes evaluation metrics and saves confusion matrix & feature importance plots."""
    agent_dir = get_agent_results_dir("compliance")

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
    sns.heatmap(cm, annot=True, fmt='d', cmap='Greens',
                xticklabels=['FAIL (0)', 'PASS (1)'],
                yticklabels=['FAIL (0)', 'PASS (1)'])
    plt.title('Compliance Agent — Confusion Matrix')
    plt.xlabel('Predicted')
    plt.ylabel('Ground Truth')
    plt.tight_layout()
    plt.savefig(os.path.join(agent_dir, "confusion_matrix.png"))
    plt.close()

    # Save Feature Importance Plot
    rf_model = model.named_steps['classifier']
    prep = model.named_steps['preprocessor']
    cat_cols = list(prep.named_transformers_['cat'].get_feature_names_out(["crop_type", "destination_market"]))
    num_cols = ["pesticide_residue_level", "certificate_expiry_days_remaining", "certification_valid"]
    all_feature_names = num_cols + cat_cols

    importances = rf_model.feature_importances_
    feat_df = pd.DataFrame({"feature": all_feature_names, "importance": importances}).sort_values(by="importance", ascending=False)

    plt.figure(figsize=(9, 5))
    sns.barplot(data=feat_df, x="importance", y="feature", hue="feature", legend=False, palette="Greens_r")
    plt.title("Compliance Agent — Feature Importances")
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

    save_metrics_json(metrics, "compliance")
    return metrics

def train_and_save(save_dir: str = "models/") -> dict:
    """Trains the Compliance RandomForestClassifier pipeline, evaluates, and saves pickle."""
    df = generate_data(n_samples=1500)

    feature_cols = [
        "crop_type", "pesticide_residue_level", "certification_valid",
        "certificate_expiry_days_remaining", "destination_market"
    ]
    X = df[feature_cols]
    y = df["compliance_pass"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    eda_content = f"""# Compliance Agent — EDA & Label Leakage Check

## Dataset Overview
- **Total Samples:** {len(df)} produce batches
- **Class Balance:** {int((df['compliance_pass']==0).sum())} FAIL ({(df['compliance_pass']==0).mean()*100:.1f}%), {int((df['compliance_pass']==1).sum())} PASS ({(df['compliance_pass']==1).mean()*100:.1f}%)

## MRL Thresholds Used (mg/kg, approximate from EU Reg. 396/2005)
| Crop   | EU   | Domestic | Gulf |
|--------|------|----------|------|
| Mango  | 0.10 | 0.50     | 0.20 |
| Tomato | 0.20 | 1.00     | 0.50 |
| Potato | 0.05 | 0.30     | 0.10 |
| Banana | 0.10 | 0.40     | 0.20 |
| Onion  | 0.30 | 1.50     | 0.70 |

## Physical Feature Ranges
- `pesticide_residue_level`: 0.001 mg/kg to 2× MRL limit (with sensor noise)
- `certificate_expiry_days_remaining`: -180 to 365 days
- `certification_valid`: Binary (0/1)

## Label Leakage Verification
- `mrl_limit` column NOT fed to model (would trivially leak label).
- Model must learn crop-specific + market-specific thresholds implicitly from residue levels.
- 3% random label noise added to simulate borderline regulatory judgment calls.
"""
    save_eda_notes("compliance", eda_content)

    model = build_model()
    model.fit(X_train, y_train)

    metrics = evaluate(model, X_test, y_test)
    save_pickle(model, "compliance_model.pkl")
    return metrics

def predict(input_dict: dict) -> dict:
    """
    Takes raw batch compliance parameters and returns exact output JSON contract.
    """
    batch_id = input_dict.get("batch_id", "C-UNKNOWN")
    crop_type = input_dict.get("crop_type", "Mango")
    pesticide_residue_level = float(input_dict.get("pesticide_residue_level", 0.05))
    certification_valid = int(input_dict.get("certification_valid", 1))
    certificate_expiry_days_remaining = int(input_dict.get("certificate_expiry_days_remaining", 90))
    destination_market = input_dict.get("destination_market", "EU")

    input_df = pd.DataFrame([{
        "crop_type": crop_type,
        "pesticide_residue_level": pesticide_residue_level,
        "certification_valid": certification_valid,
        "certificate_expiry_days_remaining": certificate_expiry_days_remaining,
        "destination_market": destination_market
    }])

    model = load_pickle("compliance_model.pkl")
    probs = model.predict_proba(input_df)[0]

    # Index 1 = PASS class
    predicted_class = int(model.predict(input_df)[0])
    compliance_status = "PASS" if predicted_class == 1 else "FAIL"
    confidence_score = int(round(probs[predicted_class] * 100.0))

    # Describe the check type based on market for contextual output
    check_type_map = {
        "EU": "EU pesticide residue check (Reg. 396/2005)",
        "Domestic": "Domestic FSSAI residue and certification check",
        "Gulf": "Gulf GCC market residue and certification check"
    }
    check_type = check_type_map.get(destination_market, "Standard pesticide residue check")

    return {
        "batch_id": batch_id,
        "compliance_status": compliance_status,
        "check_type": check_type,
        "confidence_score": confidence_score
    }
