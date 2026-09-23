# Spoilage Prediction Agent — EDA & Label Leakage Check

## Dataset Overview
- **Total Samples:** 1500 transit batches
- **Class Balance:** 863 OK (57.5%), 637 Spoiled (42.5%)

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
