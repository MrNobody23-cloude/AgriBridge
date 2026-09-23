# Consumer Trust Agent — EDA & Label Leakage Check

## Dataset Overview
- **Total Samples:** 1500 batch authenticity assessments
- **Class Balance:** 664 Not Authentic (44.3%), 836 Authentic (55.7%)

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
