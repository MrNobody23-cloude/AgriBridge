# Quality Intelligence Agent — EDA & Label Leakage Check

## Dataset Overview
- **Total Samples:** 1500 produce batches
- **Mean Quality Score:** 40.80 / 100
- **Quality Score Range:** 10.00 to 93.66

## Physical Feature Ranges
- `temperature`: 4.0°C to 35.0°C (cold storage vs ambient heat)
- `humidity`: 40.0% to 98.0% (dry air vs optimal cold room humidity)
- `storage_duration`: 1.0 to 14.0 days
- `transportation_duration`: 0.5 to 7.0 days
- `moisture`: 65.0% to 92.0% (5% missing values imputed via median)

## Label Leakage Verification
- Target `quality_score` is derived from physiological stress models with non-linear degradation and Gaussian noise.
- Features represent standard environmental telemetry available prior to quality grading.
- No single feature leaks the exact score directly.
