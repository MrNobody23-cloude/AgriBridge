# AgriBridge ML Engine

Six ML agents for agricultural supply chain intelligence: traceability verification, produce quality scoring, spoilage risk prediction, fraud detection, regulatory compliance checking, and consumer trust assessment.

---

## Quick Start

### 1. Install Dependencies
```bash
pip install scikit-learn pandas numpy matplotlib seaborn fastapi uvicorn
```

### 2. Train All 6 Agents
```bash
cd ai-service/ml-engine
python train.py
```
This will:
- Generate synthetic datasets for each agent (saved to `data/`)
- Train and evaluate each model
- Save trained model pickles to `models/`
- Save metrics and plots to `results/<agent_name>/`

### 3. Re-run Evaluation (without re-training)
```bash
python evaluate.py
```
Loads the saved pickles, regenerates metrics, plots, and saves a combined `results/evaluation_summary.json`.

### 4. Start the API Server
```bash
python api.py
```
The API will start at `http://localhost:8001`. Interactive docs at `http://localhost:8001/docs`.

---

## API Endpoints

| Method | Endpoint | Description |
|:---|:---|:---|
| GET | `/` | Service status |
| GET | `/health` | Health check |
| POST | `/predict/traceability` | Verify custody chain integrity |
| POST | `/predict/quality` | Predict produce quality score |
| POST | `/predict/spoilage` | Predict spoilage risk % |
| POST | `/predict/fraud` | Detect fraudulent transactions |
| POST | `/predict/compliance` | Check regulatory compliance |
| POST | `/predict/trust` | Assess consumer-facing authenticity |

### Example Requests

**Quality:**
```bash
curl -X POST http://localhost:8001/predict/quality \
  -H "Content-Type: application/json" \
  -d '{"batch_id":"AG-001","crop_type":"Mango","temperature":18.5,"humidity":85.0,"storage_duration":3.0,"transportation_duration":2.0,"moisture":82.0}'
```

**Fraud:**
```bash
curl -X POST http://localhost:8001/predict/fraud \
  -H "Content-Type: application/json" \
  -d '{"batch_id":"EX-1923","quantity_kg":5000,"transport_hours":1.0,"distance_km":600,"transaction_value":12000,"certificate_age_days":400,"ownership_transfers":3}'
```

**Consumer Trust:**
```bash
curl -X POST http://localhost:8001/predict/trust \
  -H "Content-Type: application/json" \
  -d '{"batch_id":"AG-2835","traceability_confidence":96,"quality_score":82,"spoilage_risk_pct":15,"fraud_flagged":false,"compliance_status":"PASS"}'
```

---

## Folder Structure

```
ml-engine/
├── specs/                    # Spec documents (01-overview.md, 02-agent-instructions.md)
├── agents/
│   ├── traceability.py       # Agent 1: Custody chain integrity (IsolationForest)
│   ├── quality.py            # Agent 2: Quality scoring (RandomForestRegressor)
│   ├── spoilage.py           # Agent 3: Spoilage risk (RandomForestClassifier)
│   ├── fraud.py              # Agent 4: Fraud detection (RandomForestClassifier)
│   ├── compliance.py         # Agent 5: Regulatory compliance (RandomForestClassifier)
│   ├── trust.py              # Agent 6: Consumer trust (LogisticRegression)
│   └── WALKTHROUGH.md        # Plain-English viva prep guide
├── data/                     # Generated synthetic datasets (.csv)
├── models/                   # Trained model pickles (.pkl)
├── results/                  # Per-agent metrics (.json) and plots (.png)
├── utils.py                  # Shared helpers: save/load pickle, directories, metrics
├── train.py                  # Master training orchestrator
├── evaluate.py               # Master evaluation script
└── api.py                    # FastAPI service (6 POST endpoints)
```

---

## Model Summary

| Agent | Model | Task | Key Metric |
|:---|:---|:---|:---|
| Traceability | IsolationForest + Rule Engine | Anomaly Detection | F1: 96.7% |
| Quality | RandomForestRegressor | Regression | R²: 0.956 |
| Spoilage | RandomForestClassifier | Classification | ROC-AUC: 92.5% |
| Fraud | RandomForestClassifier | Classification | ROC-AUC: 99.8% |
| Compliance | RandomForestClassifier | Classification | F1: 96.9% |
| Consumer Trust | LogisticRegression | Meta-Classification | ROC-AUC: 79.8% |

All models use `sklearn.Pipeline` with preprocessing included, so each `.pkl` file is fully self-contained and `predict()` requires no external preprocessing.

---

## Notes for Viva
- All data is **synthetic** — no real datasets were used or needed.
- All models use `random_state=42` for full reproducibility.
- See `agents/WALKTHROUGH.md` for plain-English explanation of each agent's design choices, feature engineering, and known limitations.
- See `results/<agent_name>/eda_notes.md` for label leakage checks per agent.
