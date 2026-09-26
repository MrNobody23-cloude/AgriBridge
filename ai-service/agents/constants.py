"""
Domain constants carried over verbatim from the training scripts in
``agents/legacy/``. Kept in one place so the serving path and any retrain use
the same numbers.

  MRL_THRESHOLDS            EU Reg. 396/2005 maximum residue limits, mg/kg
  CROP_SPOILAGE_THRESHOLDS  critical storage temperature and max safe days
  CROP_AGRONOMIC_PROFILES   optimum storage temperature/humidity per crop

`mrl_limit` is NOT fed to the compliance model — it is the label the model was
trained to predict, so passing it in would be leakage. It lives here only so
the router can report the threshold a decision was measured against.
"""

MRL_THRESHOLDS = {
    "Mango":  {"EU": 0.10, "Domestic": 0.50, "Gulf": 0.20},
    "Tomato": {"EU": 0.20, "Domestic": 1.00, "Gulf": 0.50},
    "Potato": {"EU": 0.05, "Domestic": 0.30, "Gulf": 0.10},
    "Banana": {"EU": 0.10, "Domestic": 0.40, "Gulf": 0.20},
    "Onion":  {"EU": 0.30, "Domestic": 1.50, "Gulf": 0.70},
}

MARKETS = ["EU", "Domestic", "Gulf"]

CHECK_TYPE = {
    "EU": "EU pesticide residue check (Reg. 396/2005)",
    "Domestic": "Domestic FSSAI residue and certification check",
    "Gulf": "Gulf GCC market residue and certification check",
}

CROP_SPOILAGE_THRESHOLDS = {
    "Mango":  {"crit_temp": 14.0, "max_safe_days": 12.0},
    "Tomato": {"crit_temp": 13.0, "max_safe_days": 10.0},
    "Potato": {"crit_temp": 10.0, "max_safe_days": 21.0},
    "Banana": {"crit_temp": 15.0, "max_safe_days":  9.0},
    "Onion":  {"crit_temp": 20.0, "max_safe_days": 30.0},
}

CROP_AGRONOMIC_PROFILES = {
    "Mango":  {"opt_temp": 13.0, "temp_sensitivity": 1.8, "opt_hum": 87.5, "hum_sensitivity": 0.5},
    "Tomato": {"opt_temp": 12.0, "temp_sensitivity": 2.2, "opt_hum": 92.5, "hum_sensitivity": 0.6},
    "Potato": {"opt_temp":  8.5, "temp_sensitivity": 1.5, "opt_hum": 92.5, "hum_sensitivity": 0.4},
    "Banana": {"opt_temp": 14.0, "temp_sensitivity": 2.5, "opt_hum": 87.5, "hum_sensitivity": 0.7},
    "Onion":  {"opt_temp": 15.0, "temp_sensitivity": 1.0, "opt_hum": 60.0, "hum_sensitivity": 0.8},
}

ALGORITHM = {
    "traceability": "IsolationForest (contamination=0.15) + deterministic rule score, "
                    "combined 0.6*rule + 0.4*isolation_forest",
    "quality": "RandomForestRegressor (n_estimators=100, max_depth=12)",
    "spoilage": "RandomForestClassifier (class_weight='balanced')",
    "fraud": "RandomForestClassifier on a StandardScaler pipeline (class_weight='balanced')",
    "compliance": "RandomForestClassifier (n_estimators=100, max_depth=10, class_weight='balanced')",
    "trust": "LogisticRegression (class_weight='balanced', C=1.0) — chosen so the "
             "coefficients are directly interpretable",
}


def mrl_limit(crop_type: str, market: str) -> float | None:
    return MRL_THRESHOLDS.get(crop_type, {}).get(market)
