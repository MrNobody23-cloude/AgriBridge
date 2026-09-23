# AgriBridge ML Engine — Per-Agent Instructions

Follow the standards in `01-overview.md` for ALL agents below. This file only defines what's specific to each one: inputs, outputs, target derivation, and model choice.

---

## 1. Traceability Agent (`agents/traceability.py`)

**Predicts:** Whether a batch's ownership/custody chain (Farmer → Trader → Transporter → Retailer) is valid or broken/tampered, with a confidence score.

**Synthetic data:** Generate event chains per batch (3–6 events each), ~85% valid, ~15% intentionally broken (skipped role in sequence, backward timestamp, mismatched hash link, impossible transport speed for distance/time). Keep the broken-chain violations *subtle* (e.g. timestamp off by hours not days) so the anomaly model has to actually learn, not just catch obvious errors.

**Inputs:**
- `batch_id`, sequence of events (`event_type`, `actor_role`, `timestamp`, `location`, `prev_hash`, `tx_hash`)

**Feature engineering for the model:**
- time gaps between consecutive events
- number of distinct actors
- geographic distance vs. time elapsed (speed plausibility)
- rule-based flags (sequence valid?, hash chain intact?, timestamps ordered?) as additional input features

**Model:** Rule-based structural checks (deterministic) + IsolationForest anomaly layer on the engineered features, combined into a weighted final score (e.g. `0.6 * rule_score + 0.4 * ml_anomaly_score`).

**Output contract:**
```json
{
  "batch_id": "AG-2847",
  "status": "VERIFIED",
  "confidence_score": 98,
  "issues": []
}
```

---

## 2. Quality Intelligence Agent (`agents/quality.py`)

**Predicts:** Overall quality score of a produce batch.

**Inputs:**
- `crop_type`, `temperature`, `humidity`, `storage_duration`, `transportation_duration`, `moisture` (nullable)

**Target derivation (synthetic):** Base quality degrades from an initial harvest quality based on time/temperature/humidity stress, grounded in real spoilage behavior (quality drops faster above each crop's optimal temperature threshold — look up realistic per-crop thresholds, e.g. mango vs potato have very different optimal storage temps). Add random noise.

**Model:** RandomForestRegressor (or XGBoost) predicting `quality_score` (0–100).

**Output contract:**
```json
{
  "batch_id": "...",
  "quality_score": 86,
  "quality": "Good",
  "confidence_score": 87
}
```
Derive `quality` label from `quality_score` using thresholds based on the actual score distribution in your generated data (e.g. 80–100 Good, 50–79 Moderate, <50 Poor) — explain the chosen thresholds in code comments.

---

## 3. Spoilage Prediction Agent (`agents/spoilage.py`)

**Predicts:** Probability (%) that a batch will spoil before reaching its destination — an urgency/risk signal, distinct from Quality's shelf-life score.

**Inputs:**
- `crop_type`, `current_days_since_harvest`, `remaining_transport_time`, `current_temperature`, `temperature_variance`, `humidity`, `num_temperature_breaches`

**Target derivation (synthetic):** Binary spoilage outcome via a risk-score formula (temperature above threshold, long remaining transit, prior breaches all increase risk) passed through a sigmoid to get a probability, then sampled to get the binary label — same style as your existing spoilage generator, keep it.

**Model:** RandomForestClassifier (or XGBoost Classifier), using `predict_proba()` as the risk percentage. Use class weighting / stratified split since spoiled cases are the minority class.

**Output contract:**
```json
{
  "batch_id": "EX-1917",
  "spoilage_risk_pct": 94,
  "alert_level": "CRITICAL",
  "confidence_score": 91
}
```
Alert level thresholds: `>=80 CRITICAL`, `>=50 WARNING`, else `OK`.

---

## 4. Fraud Detection Agent (`agents/fraud.py`)

**Predicts:** Whether a batch/transaction shows signs of fraud (duplicate certificates, quantity/value anomalies, unrealistic logistics).

**Inputs:**
- `quantity_kg`, `transport_hours`, `distance_km`, `transaction_value`, `certificate_age_days`, `ownership_transfers`

**Synthetic data:** Generate a majority "normal" class and a minority "fraud" class with distinctly different but *not wildly separated* distributions (avoid trivially separable synthetic fraud — keep some overlap so the model has to work for it, same principle as Traceability's subtle violations).

**Model:** IsolationForest (unsupervised anomaly detection) on scaled features, OR RandomForestClassifier if you keep labeled normal/fraud classes (recommended, since you control ground truth — makes evaluation with real precision/recall possible, which is stronger for your report than unsupervised-only).

**Output contract:**
```json
{
  "batch_id": "EX-1923",
  "flagged": true,
  "fraud_type": "ANOMALOUS_PATTERN",
  "confidence_score": 97
}
```

---

## 5. Compliance Agent (`agents/compliance.py`)

**Predicts:** Whether a batch passes relevant compliance/regulatory checks (e.g. pesticide residue limits, certification validity) — pass/fail with confidence.

**Inputs:**
- `crop_type`, `pesticide_residue_level`, `certification_valid` (bool), `certificate_expiry_days_remaining`, `region`/`destination_market` (different markets can have different thresholds, e.g. EU vs domestic)

**Synthetic data:** Generate residue levels around realistic legal limits per crop type (most batches comfortably pass, a minority breach limits or have expired/invalid certs). Ground the residue limit values in realistic pesticide MRL (Maximum Residue Limit) ranges — look up plausible units (mg/kg) even if approximate.

**Model:** RandomForestClassifier predicting `PASS` / `FAIL`, using `predict_proba()` for confidence.

**Output contract:**
```json
{
  "batch_id": "EX-1923",
  "compliance_status": "PASS",
  "check_type": "EU pesticide residue check",
  "confidence_score": 99
}
```

---

## 6. Consumer Trust Agent (`agents/trust.py`)

**Predicts:** Answers a consumer's authenticity/trust query about a batch ("Is AG-2835 authentic?") with a Yes/No + confidence, based on the aggregated signals from the other 5 agents (this agent is a lightweight meta-classifier/aggregator, not an independent deep model).

**Inputs:**
- outputs from the other agents for the same batch: `traceability_confidence`, `quality_score`, `spoilage_risk_pct`, `fraud_flagged` (bool), `compliance_status`

**Synthetic data:** Generate combinations of the above signals with a derived `is_authentic` label (e.g. authentic if traceability confidence is high, not fraud-flagged, and compliance passed; inauthentic otherwise, with some noise so it's not a trivial rule).

**Model:** A simple RandomForestClassifier or Logistic Regression (keep this one lightweight and interpretable — it's explicitly an aggregator, and Logistic Regression lets you show clean odds-ratio style explanations in your report of how much each upstream agent's signal matters).

**Output contract:**
```json
{
  "batch_id": "AG-2835",
  "is_authentic": true,
  "answer": "Yes",
  "confidence_score": 94
}
```
