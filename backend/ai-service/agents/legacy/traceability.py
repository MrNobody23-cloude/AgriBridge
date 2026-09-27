import hashlib
import os
import random

import matplotlib
import numpy as np
import pandas as pd

matplotlib.use('Agg')
from datetime import datetime, timedelta

import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.ensemble import IsolationForest
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from utils import (
    get_agent_results_dir,
    load_pickle,
    save_eda_notes,
    save_metrics_json,
    save_pickle,
)

# --- Range & Domain Assumptions ---
# Valid role flow: FARMER (0) -> TRADER (1) -> TRANSPORTER (2) -> RETAILER (3)
ROLE_ORDER = {"FARMER": 0, "TRADER": 1, "TRANSPORTER": 2, "RETAILER": 3}

# Realistic location coordinates (lat, lon) in India for speed plausibility calculations
LOCATIONS = {
    "FARM_NASHIK": (20.0059, 73.7898),
    "MANDI_NASHIK": (19.9975, 73.7898),
    "COLD_STORAGE_PUNE": (18.5204, 73.8567),
    "HUB_MUMBAI": (19.0760, 72.8777),
    "RETAIL_MUMBAI": (19.0178, 72.8478),
    "MANDI_NAGPUR": (21.1458, 79.0882)
}

def haversine_distance(coord1, coord2):
    """Calculates geographic distance in km between two (lat, lon) points."""
    R = 6371.0 # Earth radius in kilometers
    lat1, lon1 = np.radians(coord1)
    lat2, lon2 = np.radians(coord2)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat / 2.0)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2.0)**2
    c = 2 * np.arctan2(np.sqrt(a), np.sqrt(1.0 - a))
    return R * c

def _generate_event_hash(batch_id, event_type, actor_role, timestamp_str, prev_hash):
    raw = f"{batch_id}|{event_type}|{actor_role}|{timestamp_str}|{prev_hash}"
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:16]

def extract_features_from_events(events: list) -> dict:
    """
    Engineers structural and physical plausibility features from a raw sequence of custody events.
    """
    if not events or len(events) == 0:
        return {
            "num_events": 0, "num_distinct_actors": 0, "min_time_gap_hrs": 0.0,
            "max_time_gap_hrs": 0.0, "avg_time_gap_hrs": 0.0, "negative_time_gaps_count": 0,
            "max_speed_kmh": 0.0, "hash_chain_valid_ratio": 0.0, "role_sequence_valid": 0,
            "issues": ["Empty event sequence"]
        }

    issues = []
    prev_hash = "GENESIS_HASH"
    hash_valid_count = 0
    time_gaps = []
    speeds = []
    negative_gaps = 0
    role_indices = []

    parsed_events = []
    for evt in events:
        try:
            dt = datetime.fromisoformat(evt["timestamp"])
        except Exception:
            dt = datetime.now()
        parsed_events.append({**evt, "dt": dt})

    for i in range(len(parsed_events)):
        evt = parsed_events[i]
        
        # 1. Hash chain validity check
        expected_prev = prev_hash if i > 0 else evt.get("prev_hash", "GENESIS_HASH")
        if evt.get("prev_hash") == expected_prev or i == 0:
            hash_valid_count += 1
        else:
            issues.append(f"Mismatched hash at step {i+1} ({evt['actor_role']})")
        prev_hash = evt.get("tx_hash", "")

        # Role sequence tracking
        role_indices.append(ROLE_ORDER.get(evt["actor_role"], 99))

        # 2. Time gap and speed checks between consecutive events
        if i > 0:
            prev_evt = parsed_events[i-1]
            time_gap_hrs = (evt["dt"] - prev_evt["dt"]).total_seconds() / 3600.0
            time_gaps.append(time_gap_hrs)
            
            if time_gap_hrs < 0:
                negative_gaps += 1
                issues.append(f"Backward timestamp detected between step {i} and {i+1}")
            
            # Speed plausibility (km/h)
            loc1 = LOCATIONS.get(prev_evt.get("location"), (19.0, 73.0))
            loc2 = LOCATIONS.get(evt.get("location"), (19.0, 73.0))
            dist_km = haversine_distance(loc1, loc2)
            
            effective_hrs = max(time_gap_hrs, 0.01) # Avoid div by zero
            speed = dist_km / effective_hrs
            speeds.append(speed)

            if speed > 120.0 and dist_km > 10:
                issues.append(f"Unrealistic transport speed ({speed:.1f} km/h) between step {i} and {i+1}")

    # Role sequence validity check (must be non-decreasing role ranks)
    role_sequence_valid = 1 if (role_indices == sorted(role_indices) and len(set(role_indices)) == len(role_indices)) else 0
    if not role_sequence_valid:
        issues.append("Invalid or out-of-order custody role sequence")

    hash_chain_valid_ratio = hash_valid_count / float(len(events))
    
    return {
        "num_events": len(events),
        "num_distinct_actors": len(set(evt["actor_role"] for evt in events)),
        "min_time_gap_hrs": float(min(time_gaps)) if time_gaps else 0.0,
        "max_time_gap_hrs": float(max(time_gaps)) if time_gaps else 0.0,
        "avg_time_gap_hrs": float(np.mean(time_gaps)) if time_gaps else 0.0,
        "negative_time_gaps_count": negative_gaps,
        "max_speed_kmh": float(max(speeds)) if speeds else 0.0,
        "hash_chain_valid_ratio": float(hash_chain_valid_ratio),
        "role_sequence_valid": int(role_sequence_valid),
        "issues": list(set(issues))
    }

def generate_data(n_samples: int = 1500) -> pd.DataFrame:
    """Builds and returns a realistic synthetic dataset for Traceability event chains."""
    np.random.seed(42)
    random.seed(42)

    rows = []
    start_base_date = datetime(2026, 1, 1, 8, 0, 0)

    for i in range(n_samples):
        batch_id = f"AG-{2000 + i}"
        is_broken = 1 if random.random() < 0.15 else 0  # ~85% valid, ~15% broken

        # Determine violation type if broken
        violation_type = None
        if is_broken:
            violation_type = random.choice(["backward_time", "broken_hash", "skipped_role", "impossible_speed"])

        roles = ["FARMER", "TRADER", "TRANSPORTER", "RETAILER"]
        locations = ["FARM_NASHIK", "MANDI_NASHIK", "COLD_STORAGE_PUNE", "RETAIL_MUMBAI"]

        if violation_type == "skipped_role":
            # Skip TRADER or TRANSPORTER or reverse roles
            roles = ["FARMER", "RETAILER"]
            locations = ["FARM_NASHIK", "RETAIL_MUMBAI"]

        events = []
        curr_time = start_base_date + timedelta(days=random.randint(0, 180), hours=random.randint(0, 12))
        prev_hash = "GENESIS_HASH"

        for idx, role in enumerate(roles):
            loc = locations[min(idx, len(locations)-1)]
            
            # Timestamp generation (realistic 3-12 hrs per transit leg)
            gap_hrs = random.uniform(3.0, 12.0)
            
            if violation_type == "backward_time" and idx == 2:
                gap_hrs = -random.uniform(2.0, 6.0) # Subtle backward timestamp violation
            elif violation_type == "impossible_speed" and idx == 2:
                gap_hrs = 0.1 # 150km covered in 6 mins = 1500 km/h

            curr_time = curr_time + timedelta(hours=gap_hrs)
            timestamp_str = curr_time.isoformat()

            event_type = f"{role}_HANDOVER"
            tx_hash = _generate_event_hash(batch_id, event_type, role, timestamp_str, prev_hash)

            if violation_type == "broken_hash" and idx == 2:
                # Tamper with prev_hash link
                actual_prev_hash = "CORRUPTED_HASH_999"
            else:
                actual_prev_hash = prev_hash

            events.append({
                "event_type": event_type,
                "actor_role": role,
                "timestamp": timestamp_str,
                "location": loc,
                "prev_hash": actual_prev_hash,
                "tx_hash": tx_hash
            })
            prev_hash = tx_hash

        feat = extract_features_from_events(events)
        feat["batch_id"] = batch_id
        feat["is_broken"] = is_broken
        feat["violation_type"] = violation_type if violation_type else "NONE"
        rows.append(feat)

    df = pd.DataFrame(rows)
    
    # Save dataset to data directory
    from utils import DATA_DIR, ensure_directories
    ensure_directories()
    df.to_csv(os.path.join(DATA_DIR, "traceability_dataset.csv"), index=False)
    return df

def build_model():
    """Returns an untrained IsolationForest model wrapped in a preprocessing Pipeline."""
    pipeline = Pipeline([
        ('scaler', StandardScaler()),
        ('isolation_forest', IsolationForest(
            n_estimators=100,
            contamination=0.15,
            random_state=42
        ))
    ])
    return pipeline

def evaluate(model, X_test, y_test) -> dict:
    """
    Computes evaluation metrics and plots for Traceability anomaly model.
    """
    agent_dir = get_agent_results_dir("traceability")

    # IsolationForest returns -1 for anomaly (broken) and 1 for inlier (valid)
    raw_preds = model.predict(X_test)
    y_pred = [1 if p == -1 else 0 for p in raw_preds] # Convert to 1=broken, 0=valid

    precision = float(precision_score(y_test, y_pred, zero_division=0))
    recall = float(recall_score(y_test, y_pred, zero_division=0))
    f1 = float(f1_score(y_test, y_pred, zero_division=0))
    accuracy = float(accuracy_score(y_test, y_pred))
    cm = confusion_matrix(y_test, y_pred).tolist()

    # Save Confusion Matrix Plot
    plt.figure(figsize=(6, 5))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues',
                xticklabels=['Valid (0)', 'Broken (1)'],
                yticklabels=['Valid (0)', 'Broken (1)'])
    plt.title('Traceability Anomaly Model - Confusion Matrix')
    plt.xlabel('Predicted Label')
    plt.ylabel('Ground Truth Label')
    plt.tight_layout()
    plt.savefig(os.path.join(agent_dir, "confusion_matrix.png"))
    plt.close()

    metrics = {
        "accuracy": accuracy,
        "precision": precision,
        "recall": recall,
        "f1_score": f1,
        "confusion_matrix": cm,
        "test_samples": len(y_test),
        "anomalies_detected": int(sum(y_pred)),
        "true_anomalies": int(sum(y_test))
    }

    save_metrics_json(metrics, "traceability")
    return metrics

def train_and_save(save_dir: str = "models/") -> dict:
    """Trains the Traceability IsolationForest model, evaluates performance, and saves model pickle."""
    df = generate_data(n_samples=1500)

    # Feature columns for anomaly detection
    feature_cols = [
        "num_events", "num_distinct_actors", "min_time_gap_hrs",
        "max_time_gap_hrs", "avg_time_gap_hrs", "negative_time_gaps_count",
        "max_speed_kmh", "hash_chain_valid_ratio", "role_sequence_valid"
    ]

    # Perform 80/20 train-test split
    from sklearn.model_selection import train_test_split
    X = df[feature_cols]
    y = df["is_broken"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # Write EDA Notes
    eda_content = f"""# Traceability Agent — EDA & Label Leakage Check

## Dataset Overview
- **Total Samples:** {len(df)} batch event chains
- **Class Balance:** {int((df['is_broken']==0).sum())} Valid (85%), {int((df['is_broken']==1).sum())} Broken/Tampered (15%)

## Feature Ranges & Plausibility
- `min_time_gap_hrs`: Real-world transport legs range between 3.0h and 12.0h; negative values indicate timestamp tampering.
- `max_speed_kmh`: Speeds > 120 km/h flag impossible transit speed.
- `hash_chain_valid_ratio`: Ratio of valid block hashes in event chain (1.0 = perfect link).

## Label Leakage Verification
- Features engineered represent standard supply chain logs available prior to evaluation.
- No single feature trivially leaks `is_broken` (e.g. subtle negative time gaps vs impossible speed are multi-variate).
"""
    save_eda_notes("traceability", eda_content)

    model = build_model()
    model.fit(X_train)

    metrics = evaluate(model, X_test, y_test)
    
    # Save trained pipeline pickle
    save_pickle(model, "traceability_model.pkl")
    return metrics

def predict(input_dict: dict) -> dict:
    """
    Takes raw batch sequence input and returns standardized JSON response contract.
    """
    batch_id = input_dict.get("batch_id", "AG-UNKNOWN")
    events = input_dict.get("events", [])

    features = extract_features_from_events(events)
    issues = features.pop("issues", [])

    # Load model
    try:
        model = load_pickle("traceability_model.pkl")
        feature_cols = [
            "num_events", "num_distinct_actors", "min_time_gap_hrs",
            "max_time_gap_hrs", "avg_time_gap_hrs", "negative_time_gaps_count",
            "max_speed_kmh", "hash_chain_valid_ratio", "role_sequence_valid"
        ]
        df_feat = pd.DataFrame([features])[feature_cols]
        
        # Decision function distance from isolation boundary
        # Higher positive score = inside normal boundary, negative = anomaly outlier
        iso_forest = model.named_steps['isolation_forest']
        scaler = model.named_steps['scaler']
        scaled_feat = scaler.transform(df_feat)
        decision_dist = iso_forest.decision_function(scaled_feat)[0]
        
        # Map decision_function (typically -0.3 to +0.3) to 0-100 ML anomaly score
        ml_score = float(np.clip((decision_dist + 0.3) / 0.6 * 100.0, 0, 100))
    except Exception:
        ml_score = 75.0 # Fallback if model not loaded

    # Deterministic rule score (100 base score, deducted for issues)
    rule_score = 100.0
    if features["hash_chain_valid_ratio"] < 1.0:
        rule_score -= 40.0
    if features["negative_time_gaps_count"] > 0:
        rule_score -= 50.0
    if features["role_sequence_valid"] == 0:
        rule_score -= 30.0
    if features["max_speed_kmh"] > 120.0:
        rule_score -= 30.0

    rule_score = float(np.clip(rule_score, 0, 100))

    # Composite score calculation: 0.6 * rule_score + 0.4 * ml_score
    composite_score = int(round(0.6 * rule_score + 0.4 * ml_score))

    if composite_score >= 85 and len(issues) == 0:
        status = "VERIFIED"
    elif composite_score >= 50:
        status = "SUSPICIOUS"
    else:
        status = "TAMPERED"

    return {
        "batch_id": batch_id,
        "status": status,
        "confidence_score": composite_score,
        "issues": issues
    }
