/**
 * /api/ml/predict  —  Next.js Route Handler
 * ------------------------------------------
 * Proxies unified ML batch prediction requests to the Python FastAPI
 * microservice. Accepts POST with a BatchPredictRequest JSON body and
 * returns a BatchPredictResult (quality + spoilage + fraud) as JSON.
 *
 * Example client call:
 *   const res = await fetch('/api/ml/predict', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ crop_type: 'Mango', ... }),
 *   });
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  predictBatch,
  type BatchPredictRequest,
} from '@/lib/services/mlService';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as BatchPredictRequest;

    // Basic field validation
    const required: Array<keyof BatchPredictRequest> = [
      'crop_type',
      'temperature_c',
      'humidity_percent',
      'storage_days',
      'transport_hours',
      'moisture_percent',
      'initial_quality',
      'quantity_kg',
      'distance_km',
      'transaction_value',
      'certificate_age_days',
      'ownership_transfers',
    ];

    for (const field of required) {
      if (body[field] === undefined || body[field] === null) {
        return NextResponse.json(
          { success: false, error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    const result = await predictBatch(body);

    return NextResponse.json({ success: true, data: result });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Unknown error occurred';

    console.error('[/api/ml/predict]', message);

    // If the ML service is down, return a 503 so the client can show
    // a meaningful "service unavailable" message.
    const status = message.includes('fetch failed') ||
      message.includes('ECONNREFUSED')
      ? 503
      : 500;

    return NextResponse.json(
      {
        success: false,
        error:
          status === 503
            ? 'ML service is offline. Start the Python FastAPI service and try again.'
            : message,
      },
      { status }
    );
  }
}
