# AgriBridge ML Engine — Setup & Usage

## Overview

The `ai-service/` directory contains a Python **FastAPI** microservice that hosts three trained ML models:

| Model | Algorithm | Endpoint |
|---|---|---|
| Quality Prediction | Random Forest Regressor | `POST /api/ml/quality` |
| Spoilage Prediction | Random Forest Classifier | `POST /api/ml/spoilage` |
| Fraud / Anomaly Detection | Isolation Forest | `POST /api/ml/fraud` |
| All-in-one | All 3 models | `POST /api/ml/predict` |

---

## Prerequisites

- Python 3.9+
- `pip`

---

## 1 · Install Python dependencies

```bash
cd ai-service
pip install -r requirements.txt
```

---

## 2 · Train the ML models

Run the training script **once** to generate the `.pkl` model files inside `ai-service/models/`:

```bash
cd ai-service
python -m ml_engine.train
```

Expected output files:

```
ai-service/
├── models/
│   ├── quality_prediction_model.pkl
│   ├── spoilage_prediction_model.pkl
│   ├── fraud_detection_model.pkl
│   └── fraud_scaler.pkl
└── plots/
    ├── quality_prediction.png
    └── spoilage_confusion_matrix.png
```

> **Note:** The training script uses synthetic data for demonstration.  
> Replace the data-generation sections in `ml_engine/train.py` with your real dataset when available.

---

## 3 · Start the FastAPI service

```bash
cd ai-service
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The service will be available at **http://localhost:8000**.

Interactive API docs: **http://localhost:8000/docs**

---

## 4 · Configure the Next.js app

Add to your `.env` (or `.env.local`):

```env
AI_SERVICE_URL=http://localhost:8000
```

The Next.js API route at `/api/ml/predict` will proxy requests to this URL.

---

## API Reference

### `POST /api/ml/predict`  —  Unified batch analysis

```json
{
  "crop_type": "Mango",
  "temperature_c": 14,
  "humidity_percent": 88,
  "storage_days": 8,
  "transport_hours": 30,
  "moisture_percent": 82,
  "initial_quality": 92,
  "quantity_kg": 500,
  "distance_km": 350,
  "transaction_value": 28000,
  "certificate_age_days": 10,
  "ownership_transfers": 2
}
```

**Response:**

```json
{
  "batch_summary": { "crop_type": "Mango", "storage_days": 8, "temperature_c": 14 },
  "quality":  { "quality_score": 72.4, "quality_label": "Good", "model": "random_forest_regressor" },
  "spoilage": { "spoilage_probability": 38.2, "spoilage_status": "Low Risk", "spoilage_risk_level": "MEDIUM", "model": "random_forest_classifier" },
  "fraud":    { "fraud_status": "Normal", "fraud_anomaly_score": 0.1234, "flagged": false, "model": "isolation_forest" }
}
```

### `POST /api/ml/quality`
Accepts `QualityRequest` — returns quality score + label only.

### `POST /api/ml/spoilage`
Accepts `SpoilageMLRequest` — returns spoilage probability + risk level only.

### `POST /api/ml/fraud`
Accepts `FraudRequest` — returns fraud status + anomaly score only.

---

## Graceful Fallback

If the `.pkl` model files are missing (i.e., training hasn't been run yet), **every endpoint falls back to a rule-based estimate** so the rest of the application remains functional. The response will include `"model": "rule_based_fallback"` to indicate this.

---

## Directory Structure

```
ai-service/
├── main.py                     # FastAPI application
├── requirements.txt            # Python dependencies
├── ml_engine/
│   ├── __init__.py
│   └── train.py               # Training script (run once)
├── models/                    # Generated .pkl files (git-ignored)
└── plots/                     # Generated diagnostic plots (git-ignored)
```
