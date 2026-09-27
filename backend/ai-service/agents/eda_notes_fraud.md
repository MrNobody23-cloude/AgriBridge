# Fraud Detection Agent — EDA & Label Leakage Check

## Dataset Overview
- **Total Samples:** 1500 financial/logistics transactions
- **Class Balance:** 1328 Normal (88.5%), 172 Fraud (11.5%)

## Physical Feature Ranges
- `quantity_kg`: 500 kg to 15,000 kg (up to 200,000 kg for quantity anomalies)
- `transaction_value`: $400 to $65,000 (abnormal spikes for price manipulation)
- `transport_hours`: 0.3 to 48.0 hours
- `certificate_age_days`: 5 to 180 days (380 to 720 days for expired certs)

## Class Imbalance Handling
- Natural imbalanced fraud rate (~12% fraud) preserved.
- Handled during training using `class_weight='balanced'` in RandomForest and stratified train/test split.

## Label Leakage Verification
- Features engineered are standard trade invoice and logistics metadata prior to approval.
- Overlapping distributions between fraud types enforce true machine learning pattern recognition.
