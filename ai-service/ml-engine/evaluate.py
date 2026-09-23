"""
evaluate.py — Master Evaluation Script for AgriBridge ML Engine
Loads each trained model pickle and runs evaluate() to regenerate all metrics and plots.
Use this AFTER training to produce fresh results without re-training.
"""
import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from sklearn.model_selection import train_test_split
from agents import traceability, quality, spoilage, fraud, compliance, trust
from utils import load_pickle, get_agent_results_dir, RESULTS_DIR

AGENT_CONFIGS = {
    "traceability": {
        "module": traceability,
        "model_file": "traceability_model.pkl",
        "feature_cols": [
            "num_events", "num_distinct_actors", "min_time_gap_hrs",
            "max_time_gap_hrs", "avg_time_gap_hrs", "negative_time_gaps_count",
            "max_speed_kmh", "hash_chain_valid_ratio", "role_sequence_valid"
        ],
        "label_col": "is_broken",
        "stratify": True,
        "task": "anomaly"
    },
    "quality": {
        "module": quality,
        "model_file": "quality_model.pkl",
        "feature_cols": ["crop_type", "temperature", "humidity", "storage_duration", "transportation_duration", "moisture"],
        "label_col": "quality_score",
        "stratify": False,
        "task": "regression"
    },
    "spoilage": {
        "module": spoilage,
        "model_file": "spoilage_model.pkl",
        "feature_cols": [
            "crop_type", "current_days_since_harvest", "remaining_transport_time",
            "current_temperature", "temperature_variance", "humidity", "num_temperature_breaches"
        ],
        "label_col": "is_spoiled",
        "stratify": True,
        "task": "classification"
    },
    "fraud": {
        "module": fraud,
        "model_file": "fraud_model.pkl",
        "feature_cols": [
            "quantity_kg", "transport_hours", "distance_km",
            "transaction_value", "certificate_age_days", "ownership_transfers"
        ],
        "label_col": "is_fraud",
        "stratify": True,
        "task": "classification"
    },
    "compliance": {
        "module": compliance,
        "model_file": "compliance_model.pkl",
        "feature_cols": [
            "crop_type", "pesticide_residue_level", "certification_valid",
            "certificate_expiry_days_remaining", "destination_market"
        ],
        "label_col": "compliance_pass",
        "stratify": True,
        "task": "classification"
    },
    "trust": {
        "module": trust,
        "model_file": "trust_model.pkl",
        "feature_cols": [
            "traceability_confidence", "quality_score", "spoilage_risk_pct",
            "fraud_flagged", "compliance_status"
        ],
        "label_col": "is_authentic",
        "stratify": True,
        "task": "classification"
    }
}

def evaluate_all():
    all_results = {}

    for agent_name, config in AGENT_CONFIGS.items():
        print(f"\n{'='*60}")
        print(f"Evaluating: {agent_name.upper()}")
        print(f"{'='*60}")

        try:
            module = config["module"]
            df = module.generate_data()
            X = df[config["feature_cols"]]
            y = df[config["label_col"]]

            stratify_arg = y if config["stratify"] else None
            _, X_test, _, y_test = train_test_split(
                X, y, test_size=0.2, random_state=42, stratify=stratify_arg
            )

            model = load_pickle(config["model_file"])
            metrics = module.evaluate(model, X_test, y_test)
            all_results[agent_name] = metrics
            print(f"✓ {agent_name}: {metrics}")

        except Exception as e:
            print(f"✗ {agent_name} evaluation failed: {e}")
            all_results[agent_name] = {"error": str(e)}

    # Save combined summary report
    summary_path = os.path.join(RESULTS_DIR, "evaluation_summary.json")
    os.makedirs(RESULTS_DIR, exist_ok=True)
    with open(summary_path, 'w') as f:
        json.dump(all_results, f, indent=4)
    print(f"\n✓ Evaluation summary saved to {summary_path}")
    return all_results

if __name__ == "__main__":
    evaluate_all()
