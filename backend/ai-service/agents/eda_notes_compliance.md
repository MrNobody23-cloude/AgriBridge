# Compliance Agent — EDA & Label Leakage Check

## Dataset Overview
- **Total Samples:** 1500 produce batches
- **Class Balance:** 453 FAIL (30.2%), 1047 PASS (69.8%)

## MRL Thresholds Used (mg/kg, approximate from EU Reg. 396/2005)
| Crop   | EU   | Domestic | Gulf |
|--------|------|----------|------|
| Mango  | 0.10 | 0.50     | 0.20 |
| Tomato | 0.20 | 1.00     | 0.50 |
| Potato | 0.05 | 0.30     | 0.10 |
| Banana | 0.10 | 0.40     | 0.20 |
| Onion  | 0.30 | 1.50     | 0.70 |

## Physical Feature Ranges
- `pesticide_residue_level`: 0.001 mg/kg to 2× MRL limit (with sensor noise)
- `certificate_expiry_days_remaining`: -180 to 365 days
- `certification_valid`: Binary (0/1)

## Label Leakage Verification
- `mrl_limit` column NOT fed to model (would trivially leak label).
- Model must learn crop-specific + market-specific thresholds implicitly from residue levels.
- 3% random label noise added to simulate borderline regulatory judgment calls.
