/**
 * mlService.ts
 * -----------
 * TypeScript client that communicates with the AgriBridge Python FastAPI
 * ML microservice running at AI_SERVICE_URL (default: http://localhost:8000).
 *
 * Usage example:
 *   import { predictBatch } from '@/lib/services/mlService';
 *   const result = await predictBatch({ crop_type: 'Mango', ... });
 */

const AI_SERVICE_URL =
  process.env.AI_SERVICE_URL ?? 'http://localhost:8000';

// ─────────────────────────────────────────────────────────────
// Request types
// ─────────────────────────────────────────────────────────────

export interface QualityRequest {
  crop_type: string;
  temperature_c: number;
  humidity_percent: number;
  storage_days: number;
  transport_hours: number;
  moisture_percent: number;
  initial_quality: number;
}

export interface SpoilageMLRequest {
  crop_type: string;
  temperature_c: number;
  humidity_percent: number;
  storage_days: number;
  transport_hours: number;
  moisture_percent: number;
}

export interface FraudRequest {
  quantity_kg: number;
  transport_hours: number;
  distance_km: number;
  transaction_value: number;
  certificate_age_days: number;
  ownership_transfers: number;
}

/** Combined request for /api/ml/predict (all 3 models in one call). */
export interface BatchPredictRequest
  extends QualityRequest,
    Omit<FraudRequest, 'transport_hours'> {
  // transport_hours is shared — already in QualityRequest
}

// ─────────────────────────────────────────────────────────────
// Response types
// ─────────────────────────────────────────────────────────────

export interface QualityResult {
  quality_score: number;
  quality_label: 'Excellent' | 'Good' | 'Moderate' | 'Poor';
  model: string;
}

export interface SpoilageResult {
  spoilage_probability: number; // 0–100
  spoilage_status: 'High Risk' | 'Low Risk';
  spoilage_risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  model: string;
}

export interface FraudResult {
  fraud_status: 'Normal' | 'Suspicious / Anomaly';
  fraud_anomaly_score: number;
  flagged: boolean;
  model: string;
}

export interface BatchPredictResult {
  batch_summary: {
    crop_type: string;
    storage_days: number;
    temperature_c: number;
  };
  quality: QualityResult;
  spoilage: SpoilageResult;
  fraud: FraudResult;
}

// ─────────────────────────────────────────────────────────────
// Internal helper
// ─────────────────────────────────────────────────────────────

async function post<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  const url = `${AI_SERVICE_URL}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // Next.js 15+ cache: no-store so predictions are always fresh
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `ML service error [${res.status}] at ${path}: ${text}`
    );
  }

  return res.json() as Promise<TRes>;
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Unified batch prediction — calls all 3 ML models in a single request.
 * This is the preferred method for batch analysis pages.
 */
export async function predictBatch(
  req: BatchPredictRequest
): Promise<BatchPredictResult> {
  return post<BatchPredictRequest, BatchPredictResult>(
    '/api/ml/predict',
    req
  );
}

/**
 * Quality-only prediction (Random Forest Regressor).
 */
export async function predictQuality(
  req: QualityRequest
): Promise<QualityResult> {
  return post<QualityRequest, QualityResult>('/api/ml/quality', req);
}

/**
 * Spoilage-only prediction (Random Forest Classifier).
 */
export async function predictSpoilage(
  req: SpoilageMLRequest
): Promise<SpoilageResult> {
  return post<SpoilageMLRequest, SpoilageResult>(
    '/api/ml/spoilage',
    req
  );
}

/**
 * Fraud / anomaly detection (Isolation Forest).
 */
export async function detectFraud(
  req: FraudRequest
): Promise<FraudResult> {
  return post<FraudRequest, FraudResult>('/api/ml/fraud', req);
}

/**
 * Check whether the ML microservice is reachable and models are loaded.
 */
export async function checkMLServiceHealth(): Promise<{
  online: boolean;
  models_loaded: {
    quality: boolean;
    spoilage: boolean;
    fraud: boolean;
  };
}> {
  try {
    const res = await fetch(`${AI_SERVICE_URL}/`, {
      cache: 'no-store',
    });
    if (!res.ok) return { online: false, models_loaded: { quality: false, spoilage: false, fraud: false } };
    const data = await res.json();
    return {
      online: true,
      models_loaded: data.models_loaded ?? { quality: false, spoilage: false, fraud: false },
    };
  } catch {
    return { online: false, models_loaded: { quality: false, spoilage: false, fraud: false } };
  }
}
