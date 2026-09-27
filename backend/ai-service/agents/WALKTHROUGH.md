# AgriBridge ML Engine — Agent Walkthrough

Plain-English viva prep guide for all 6 agents. Written for the student to understand and explain each model clearly.

---

## 1. Traceability Agent

**What it predicts:**
Whether a batch's custody chain (Farmer → Trader → Transporter → Retailer) is genuine or has been tampered with. It gives back a VERIFIED / SUSPICIOUS / TAMPERED status with a confidence score.

**Inputs:**
A sequence of custody events for a batch. Each event has: who did it (actor role), when (timestamp), where (location), and cryptographic hash links to the previous event.

**Output:**
```json
{"batch_id": "AG-2847", "status": "VERIFIED", "confidence_score": 98, "issues": []}
```

**Model used & why:**
Two-layer approach:
- **Layer 1 (Deterministic rule checks):** Checks timestamp ordering, role sequence (Farmer before Trader before Transporter before Retailer), hash chain integrity, and geographic speed plausibility. Fast and explainable.
- **Layer 2 (IsolationForest anomaly detection):** Learns subtle statistical patterns across all the engineered features that pure rules might miss. IsolationForest was chosen because there are no explicit "tampered" labels during inference — it detects outliers from what normal chains look like.
- **Combined score:** `0.6 × rule_score + 0.4 × ml_score` so the deterministic checks dominate but the ML layer adds nuance.

**How the target/label was derived (synthetic data logic):**
Generated ~1,500 batch event chains. 85% are fully valid (correct role order, valid hashes, realistic transport speeds of 25–75 km/h). 15% have one of four subtle violations: backward timestamps (off by 2–6 hours, not days), broken hash links, skipped custody roles, or impossible speeds (180+ km/h implying someone lied about the journey time).

**Key metrics achieved:**
- Precision: **100%** (no false alarms)
- Recall: **93.6%** (catches nearly all tampered chains)
- F1-Score: **96.7%**

**Top features driving the prediction:**
`hash_chain_valid_ratio`, `negative_time_gaps_count`, `max_speed_kmh`, `role_sequence_valid`

**Known limitation:**
Recall is not 100% — about 3 in 47 tampered chains (6.4%) slip through as valid, particularly the "impossible speed" violation when the speed delta is marginal. The IsolationForest layer helps but is fundamentally unsupervised. A fully supervised model (if real tampered-chain labels existed) would improve recall.

---

## 2. Quality Intelligence Agent

**What it predicts:**
An overall quality score (0–100) for a produce batch based on environmental conditions it has experienced. 80–100 = Good, 50–79 = Moderate, below 50 = Poor.

**Inputs:**
`crop_type`, `temperature` (°C), `humidity` (%), `storage_duration` (days), `transportation_duration` (days), `moisture` (%, optional — missing values are automatically imputed).

**Output:**
```json
{"batch_id": "AG-8821", "quality_score": 72, "quality": "Moderate", "confidence_score": 70}
```

**Model used & why:**
`RandomForestRegressor` because the target is a continuous number (0–100 score), not a category. Random Forest handles the non-linear relationship between temperature stress and quality decay naturally, and feature importances are easy to explain.

**How the target/label was derived (synthetic data logic):**
Started each batch at a random harvest quality of 92–100. Then applied three degradation penalties:
1. **Thermal stress:** Quality drops faster when temperature exceeds the crop's physiological optimum (e.g. Mango: 13°C, Potato: 8.5°C, Tomato: 12°C). Penalty grows non-linearly (to the power 1.3) with temperature excess.
2. **Humidity stress:** Deviation from ideal relative humidity causes surface desiccation or mould.
3. **Time decay:** Simple linear respiration loss per day in storage + transit.
Gaussian noise (std=2.5) was added to simulate sensor inaccuracy and microclimate variation.

**Key metrics achieved:**
- MAE: **3.92** score points
- RMSE: **6.11** score points
- R² Score: **0.956** (95.6% of variance explained)

**Top features driving the prediction:**
`temperature`, `storage_duration`, `transportation_duration`, `crop_type`

**Known limitation:**
The model learned from the same synthetic degradation formula it was trained on — so R² is high by design. On real sensor data with messier patterns (freezer failures, humidity sensor drift), performance would likely be lower. Also, moisture is 5% missing in training data — imputed by median, which may underperform for crops with very different moisture sensitivities.

---

## 3. Spoilage Prediction Agent

**What it predicts:**
The probability (as a percentage) that a batch will actually spoil before it reaches its destination. This is different from Quality — Quality is the current state of the produce; Spoilage Risk is a forward-looking urgency signal: "Will it make it?".

**Inputs:**
`crop_type`, `current_days_since_harvest`, `remaining_transport_time` (days), `current_temperature` (°C), `temperature_variance`, `humidity` (%), `num_temperature_breaches` (count of cold chain violation events).

**Output:**
```json
{"batch_id": "EX-1917", "spoilage_risk_pct": 82, "alert_level": "CRITICAL", "confidence_score": 82}
```
Alert levels: `≥80 = CRITICAL`, `≥50 = WARNING`, `<50 = OK`.

**Model used & why:**
`RandomForestClassifier` with `class_weight='balanced'` because the label is binary (will spoil / won't spoil) and spoiled cases are the minority. `predict_proba()` gives the risk percentage directly — no need for additional calibration.

**How the target/label was derived (synthetic data logic):**
Computed a log-odds risk score using four contributing factors: temperature excess above the crop's critical physiological threshold, total transit age relative to crop's maximum safe shelf life, number of temperature breach events, and temperature variance. Passed through a sigmoid to get a probability, then randomly sampled (Bernoulli draw) to get the binary label. This matches real-world stochasticity — not every high-risk batch spoils, but probability increases sharply past thresholds.

**Key metrics achieved:**
- Precision: **87.2%**
- Recall: **80.3%**
- F1-Score: **83.6%**
- ROC-AUC: **92.5%**

**Top features driving the prediction:**
`current_temperature`, `num_temperature_breaches`, `current_days_since_harvest`, `temperature_variance`, `humidity`

**Known limitation:**
Recall (80.3%) is lower than precision (87.2%) — the model misses ~20% of batches that will actually spoil, erring on the side of false safety. In a real deployment this is the more dangerous error type (false negatives = undetected spoilage). Calibrating the classification threshold lower (e.g. 40% instead of 50%) would improve recall at the cost of some precision.

---

## 4. Fraud Detection Agent

**What it predicts:**
Whether a batch transaction shows signs of fraud — such as price manipulation, impossible logistics, expired certificates, or abnormal quantities — and if so, what type of fraud pattern it looks like.

**Inputs:**
`quantity_kg`, `transport_hours`, `distance_km`, `transaction_value`, `certificate_age_days`, `ownership_transfers`.

**Output:**
```json
{"batch_id": "EX-1923", "flagged": true, "fraud_type": "EXPIRED_CERTIFICATE", "confidence_score": 99}
```

**Model used & why:**
`RandomForestClassifier` with ground-truth fraud labels (not unsupervised IsolationForest) because the spec allows us to control the synthetic ground truth — this makes proper precision/recall evaluation possible, which is a stronger result for a report than an unsupervised approach.

**How the target/label was derived (synthetic data logic):**
88% of transactions were generated as "normal" with realistic distributions (500 kg to 15,000 kg quantity, $0.80–$4.50/kg price, 25–75 km/h speed). 12% were injected with one of four fraud patterns — each realistic but overlapping with normal ranges:
- **Price Manipulation:** Unit price multiplied by 5×–12× or deflated to 2–8% of market rate.
- **Logistics Anomaly:** Speed >180 km/h (impossible truck speed) or >8 ownership handovers.
- **Expired Certificate:** Certificate age 380–720 days (beyond legal 365-day validity).
- **Quantity Anomaly:** Single-transaction quantity 80,000–200,000 kg (implausible single batch).
Gaussian noise was added so boundaries overlap.

**Key metrics achieved:**
- Precision: **100%** (zero false fraud flags — no innocent batches wrongly flagged)
- Recall: **85.3%**
- F1-Score: **92.1%**
- ROC-AUC: **99.8%**

**Top features driving the prediction:**
`transaction_value`, `certificate_age_days`, `quantity_kg`, `transport_hours`, `ownership_transfers`

**Known limitation:**
Precision is perfect but recall is 85.3% — 5 in 34 fraudulent batches escape detection. These are likely borderline price manipulation cases where the inflated price stays within a plausible-looking range. More sophisticated fraud generation (e.g. split transactions) would challenge the model further.

---

## 5. Compliance Agent

**What it predicts:**
Whether a produce batch passes or fails regulatory compliance checks — specifically pesticide residue limits and certification validity — for the target export market.

**Inputs:**
`crop_type`, `pesticide_residue_level` (mg/kg), `certification_valid` (0 or 1), `certificate_expiry_days_remaining` (can be negative if expired), `destination_market` (EU / Domestic / Gulf).

**Output:**
```json
{"batch_id": "EX-1923", "compliance_status": "PASS", "check_type": "EU pesticide residue check (Reg. 396/2005)", "confidence_score": 93}
```

**Model used & why:**
`RandomForestClassifier` — the task is binary classification (PASS/FAIL) and different crops in different markets have different limits, creating a multi-way interaction that a linear model would struggle to capture cleanly. Random Forest handles these crop × market threshold interactions naturally.

**How the target/label was derived (synthetic data logic):**
Each batch was assigned a crop and destination market. A crop-specific MRL (Maximum Residue Limit) was looked up from approximate EU Regulation 396/2005 values (e.g. Potato: 0.05 mg/kg for EU, much stricter than Domestic 0.30 mg/kg). 80% of batches were sampled within 10–85% of the MRL (safely passing), 20% were sampled at 75–200% of the MRL (at-risk). A batch fails if its residue exceeds the MRL *or* its certificate is expired. 3% random label noise was added for borderline cases. Critically, the `mrl_limit` column was NOT fed to the model — the model must implicitly learn crop–market threshold interactions from the feature patterns.

**Key metrics achieved:**
- Precision: **95.4%**
- Recall: **98.6%**
- F1-Score: **96.9%**
- ROC-AUC: **96.7%**

**Top features driving the prediction:**
`pesticide_residue_level`, `certificate_expiry_days_remaining`, `certification_valid`, `destination_market_EU`, `crop_type_Potato`

**Known limitation:**
The model learned approximate MRL thresholds from synthetic data — it would need re-training on actual lab test records to apply real regulatory standards accurately. Also, the model treats each market's threshold as fixed; real MRLs are periodically updated by regulatory bodies.

---

## 6. Consumer Trust Agent

**What it predicts:**
Answers a consumer's simple question — "Is this batch authentic?" — with a Yes/No and a confidence percentage. It works by aggregating the signals from all 5 other agents for the same batch into a single trustworthiness verdict.

**Inputs:**
Outputs from the other 5 agents: `traceability_confidence` (0–100), `quality_score` (0–100), `spoilage_risk_pct` (0–100), `fraud_flagged` (true/false), `compliance_status` ("PASS"/"FAIL").

**Output:**
```json
{"batch_id": "AG-2835", "is_authentic": true, "answer": "Yes", "confidence_score": 88}
```

**Model used & why:**
`LogisticRegression` — deliberately chosen over RandomForest for three reasons:
1. Only 5 input features, all numeric/binary — linear separability is sufficient.
2. Coefficients give a direct, interpretable "how much does each agent's signal matter?" answer for the viva.
3. `predict_proba()` output is well-calibrated for logistic models.

**How the target/label was derived (synthetic data logic):**
For each synthetic batch, signals from all 5 agents were simulated independently. An authenticity score was computed as: `3.0 × (traceability/100) + 3.5 × (not fraud flagged) + 2.5 × (compliance passed) + 1.0 × (quality/100) + 1.0 × (1 - spoilage_risk/100)`. This was passed through a sigmoid to get a probability, and the binary `is_authentic` label was sampled from it. 4% random noise was added so the model can't just memorise a simple rule.

**Key metrics achieved:**
- Precision: **74.5%**
- Recall: **82.0%**
- F1-Score: **78.1%**
- ROC-AUC: **79.8%**
- **Top coefficients (log-odds contribution per unit):**
  - `compliance_status`: +1.027 (strongest positive driver)
  - `fraud_flagged`: -0.893 (strongest negative driver)
  - `traceability_confidence`: +0.448
  - `spoilage_risk_pct`: -0.189
  - `quality_score`: +0.150

**Known limitation:**
This agent's F1-Score (78.1%) is the lowest of all 6 — intentionally so. Because all 5 upstream signals are independently generated with noise, there is genuine ambiguity in the aggregated label (e.g. a batch can have high compliance but also be fraud-flagged). Logistic Regression's linear decision boundary is also a limitation here — a small RandomForest would likely improve performance, but at the cost of interpretability which is more valuable for this viva context.
