# Traceability Agent — EDA & Label Leakage Check

## Dataset Overview
- **Total Samples:** 1500 batch event chains
- **Class Balance:** 1267 Valid (85%), 233 Broken/Tampered (15%)

## Feature Ranges & Plausibility
- `min_time_gap_hrs`: Real-world transport legs range between 3.0h and 12.0h; negative values indicate timestamp tampering.
- `max_speed_kmh`: Speeds > 120 km/h flag impossible transit speed.
- `hash_chain_valid_ratio`: Ratio of valid block hashes in event chain (1.0 = perfect link).

## Label Leakage Verification
- Features engineered represent standard supply chain logs available prior to evaluation.
- No single feature trivially leaks `is_broken` (e.g. subtle negative time gaps vs impossible speed are multi-variate).
