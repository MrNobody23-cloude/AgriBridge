import os
import random
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns

from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split

from utils import save_pickle, load_pickle, save_metrics_json, save_eda_notes, get_agent_results_dir, ensure_directories, DATA_DIR

# --- Domain & Agronomic Threshold Assumptions ---
# Real-world post-harvest physiological optimal ranges per crop
CROP_AGRONOMIC_PROFILES = {
    "Mango": {"opt_temp": 13.0, "temp_sensitivity": 1.8, "opt_hum": 87.5, "hum_sensitivity": 0.5},
    "Tomato": {"opt_temp": 12.0, "temp_sensitivity": 2.2, "opt_hum": 92.5, "hum_sensitivity": 0.6},
    "Potato": {"opt_temp": 8.5, "temp_sensitivity": 1.5, "opt_hum": 92.5, "hum_sensitivity": 0.4},
    "Banana": {"opt_temp": 14.0, "temp_sensitivity": 2.5, "opt_hum": 87.5, "hum_sensitivity": 0.7},
    "Onion": {"opt_temp": 15.0, "temp_sensitivity": 1.0, "opt_hum": 60.0, "hum_sensitivity": 0.8}
}

def generate_data(n_samples: int = 1500) -> pd.DataFrame:
    """Builds and returns a realistic synthetic dataset for produce Quality scoring."""
    np.random.seed(42)
    random.seed(42)

    rows = []
    crops = list(CROP_AGRONOMIC_PROFILES.keys())

    for i in range(n_samples):
        batch_id = f"Q-BATCH-{1000 + i}"
        crop = random.choice(crops)
        profile = CROP_AGRONOMIC_PROFILES[crop]

        # Realistic storage & transport durations (in days)
        storage_dur_days = random.uniform(1.0, 14.0)       # 1 to 14 days in warehouse
        transport_dur_days = random.uniform(0.5, 7.0)      # 0.5 to 7 days transit
        total_time_days = storage_dur_days + transport_dur_days

        # Realistic transit & storage environmental conditions
        temperature = random.uniform(4.0, 35.0)            # 4°C cold store to 35°C ambient heat
        humidity = random.uniform(40.0, 98.0)               # 40% dry air to 98% moisture
        
        # Moisture content (%): realistic crop moisture ranges with 5% missing (nulls)
        if random.random() < 0.05:
            moisture = np.nan
        else:
            moisture = random.uniform(65.0, 92.0)

        # Base harvest quality score (92 - 100)
        base_quality = random.uniform(92.0, 100.0)

        # Thermal stress penalty: accelerates above optimal threshold
        temp_diff = max(0.0, temperature - profile["opt_temp"])
        temp_penalty = (temp_diff ** 1.3) * profile["temp_sensitivity"] * (total_time_days / 5.0)

        # Humidity stress penalty: deviation from optimal relative humidity
        hum_diff = abs(humidity - profile["opt_hum"])
        hum_penalty = hum_diff * profile["hum_sensitivity"] * 0.15 * (total_time_days / 5.0)

        # Time decay penalty (physiological respiration loss)
        time_penalty = total_time_days * 1.8

        # Add Gaussian noise (simulating micro-climate variance & sensor inaccuracy)
        noise = np.random.normal(0.0, 2.5)

        raw_quality = base_quality - (temp_penalty + hum_penalty + time_penalty) + noise
        quality_score = float(np.clip(raw_quality, 10.0, 100.0))

        rows.append({
            "batch_id": batch_id,
            "crop_type": crop,
            "temperature": round(temperature, 2),
            "humidity": round(humidity, 2),
            "storage_duration": round(storage_dur_days, 2),
            "transportation_duration": round(transport_dur_days, 2),
            "moisture": round(moisture, 2) if not np.isnan(moisture) else np.nan,
            "quality_score": round(quality_score, 2)
        })

    df = pd.DataFrame(rows)
    ensure_directories()
    df.to_csv(os.path.join(DATA_DIR, "quality_dataset.csv"), index=False)
    return df

def build_model():
    """Returns an untrained RandomForestRegressor pipeline with categorical and numeric preprocessing."""
    numeric_features = ["temperature", "humidity", "storage_duration", "transportation_duration", "moisture"]
    categorical_features = ["crop_type"]

    numeric_transformer = Pipeline(steps=[
        ('imputer', SimpleImputer(strategy='median')),
        ('scaler', StandardScaler())
    ])

    categorical_transformer = Pipeline(steps=[
        ('onehot', OneHotEncoder(handle_unknown='ignore', sparse_output=False))
    ])

    preprocessor = ColumnTransformer(transformers=[
        ('num', numeric_transformer, numeric_features),
        ('cat', categorical_transformer, categorical_features)
    ])

    pipeline = Pipeline(steps=[
        ('preprocessor', preprocessor),
        ('regressor', RandomForestRegressor(n_estimators=100, max_depth=12, random_state=42))
    ])

    return pipeline

def evaluate(model, X_test, y_test) -> dict:
    """Computes evaluation metrics (MAE, RMSE, R2) and saves residual & feature importance plots."""
    agent_dir = get_agent_results_dir("quality")
    y_pred = model.predict(X_test)

    mae = float(mean_absolute_error(y_test, y_pred))
    rmse = float(np.sqrt(mean_squared_error(y_test, y_pred)))
    r2 = float(r2_score(y_test, y_pred))

    # Save Actual vs Predicted Scatter Plot
    plt.figure(figsize=(7, 6))
    plt.scatter(y_test, y_pred, alpha=0.6, color='seagreen', edgecolors='k')
    plt.plot([y_test.min(), y_test.max()], [y_test.min(), y_test.max()], 'r--', lw=2)
    plt.title('Quality Intelligence Model — Actual vs Predicted Quality Score')
    plt.xlabel('Actual Quality Score (0-100)')
    plt.ylabel('Predicted Quality Score (0-100)')
    plt.grid(True, linestyle='--', alpha=0.5)
    plt.tight_layout()
    plt.savefig(os.path.join(agent_dir, "actual_vs_predicted.png"))
    plt.close()

    # Save Feature Importance Plot
    rf_model = model.named_steps['regressor']
    prep = model.named_steps['preprocessor']
    cat_cols = prep.named_transformers_['cat'].named_steps['onehot'].get_feature_names_out(["crop_type"])
    num_cols = ["temperature", "humidity", "storage_duration", "transportation_duration", "moisture"]
    all_feature_names = list(num_cols) + list(cat_cols)

    importances = rf_model.feature_importances_
    feat_df = pd.DataFrame({"feature": all_feature_names, "importance": importances}).sort_values(by="importance", ascending=False)

    plt.figure(figsize=(8, 5))
    sns.barplot(data=feat_df, x="importance", y="feature", hue="feature", legend=False, palette="viridis")
    plt.title("Quality Intelligence Model — Feature Importances")
    plt.xlabel("Importance Weight")
    plt.tight_layout()
    plt.savefig(os.path.join(agent_dir, "feature_importances.png"))
    plt.close()

    metrics = {
        "mae": mae,
        "rmse": rmse,
        "r2_score": r2,
        "test_samples": len(y_test),
        "top_features": feat_df["feature"].head(5).tolist()
    }

    save_metrics_json(metrics, "quality")
    return metrics

def train_and_save(save_dir: str = "models/") -> dict:
    """Trains the Quality RandomForestRegressor pipeline, evaluates performance, and saves pickle."""
    df = generate_data(n_samples=1500)

    feature_cols = ["crop_type", "temperature", "humidity", "storage_duration", "transportation_duration", "moisture"]
    X = df[feature_cols]
    y = df["quality_score"]

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    eda_content = f"""# Quality Intelligence Agent — EDA & Label Leakage Check

## Dataset Overview
- **Total Samples:** {len(df)} produce batches
- **Mean Quality Score:** {df['quality_score'].mean():.2f} / 100
- **Quality Score Range:** {df['quality_score'].min():.2f} to {df['quality_score'].max():.2f}

## Physical Feature Ranges
- `temperature`: 4.0°C to 35.0°C (cold storage vs ambient heat)
- `humidity`: 40.0% to 98.0% (dry air vs optimal cold room humidity)
- `storage_duration`: 1.0 to 14.0 days
- `transportation_duration`: 0.5 to 7.0 days
- `moisture`: 65.0% to 92.0% (5% missing values imputed via median)

## Label Leakage Verification
- Target `quality_score` is derived from physiological stress models with non-linear degradation and Gaussian noise.
- Features represent standard environmental telemetry available prior to quality grading.
- No single feature leaks the exact score directly.
"""
    save_eda_notes("quality", eda_content)

    model = build_model()
    model.fit(X_train, y_train)

    metrics = evaluate(model, X_test, y_test)
    save_pickle(model, "quality_model.pkl")
    return metrics

def predict(input_dict: dict) -> dict:
    """
    Takes raw batch produce parameters and returns exact output JSON contract.
    """
    batch_id = input_dict.get("batch_id", "Q-UNKNOWN")
    crop_type = input_dict.get("crop_type", "Mango")
    temperature = float(input_dict.get("temperature", 25.0))
    humidity = float(input_dict.get("humidity", 70.0))
    storage_duration = float(input_dict.get("storage_duration", 3.0))
    transportation_duration = float(input_dict.get("transportation_duration", 2.0))
    moisture = input_dict.get("moisture")
    if moisture is not None:
        moisture = float(moisture)

    input_df = pd.DataFrame([{
        "crop_type": crop_type,
        "temperature": temperature,
        "humidity": humidity,
        "storage_duration": storage_duration,
        "transportation_duration": transportation_duration,
        "moisture": moisture
    }])

    model = load_pickle("quality_model.pkl")
    pred_score = float(model.predict(input_df)[0])
    pred_score = float(np.clip(pred_score, 0.0, 100.0))

    # Derive confidence score from prediction variance across individual trees in RandomForest
    preprocessed_x = model.named_steps['preprocessor'].transform(input_df)
    tree_predictions = [tree.predict(preprocessed_x)[0] for tree in model.named_steps['regressor'].estimators_]
    std_dev = float(np.std(tree_predictions))
    
    # Low tree variance -> High confidence (scaled 0 - 100)
    confidence_score = int(round(np.clip(100.0 - (std_dev * 4.0), 50.0, 99.0)))

    # Grade thresholds:
    # 80-100: Good (Fresh produce, ideal market value)
    # 50-79: Moderate (Slight degradation, suitable for immediate processing/local market)
    # <50: Poor (High degradation/spoilage risk, discount or discard)
    if pred_score >= 80.0:
        quality_grade = "Good"
    elif pred_score >= 50.0:
        quality_grade = "Moderate"
    else:
        quality_grade = "Poor"

    return {
        "batch_id": batch_id,
        "quality_score": int(round(pred_score)),
        "quality": quality_grade,
        "confidence_score": confidence_score
    }
