# AgriBridge AI

AgriBridge is a supply-chain traceability and compliance application for agricultural products. It records batches and handovers, supports certificate and cold-chain monitoring, and exposes optional AI, IPFS, and Polygon integrations.

This repository is a working prototype, not yet the broader farm-management platform described in the product roadmap. In particular, it does not currently provide crop disease image classification, yield prediction, farm/soil management, weather feeds, market prices, or irrigation recommendations. The existing ML training code and datasets are synthetic and are suitable for development demonstrations only; they are not validated agronomic models.

## Architecture

```text
frontend/                 Next.js 16 + React 19 UI and authenticated API routes
  src/app/                 Role dashboards, public verification, and API handlers
  src/lib/db/              Mongoose models, connection, and repositories
backend/                   Seed/migration scripts and Polygon Hardhat project
  contracts/               Solidity traceability contract
  ai-service/               FastAPI RAG and trained supply-chain agents
```

The current API boundary is Next.js Route Handlers backed by MongoDB. The Python service handles RAG and model inference. The contract is optional: the app remains usable without a deployed contract, but must report blockchain status as unconfigured. This repository intentionally does not run a second Express API alongside the Next.js handlers.

## Current capabilities

- Cookie-based login, registration, logout, and permission checks for the existing supply-chain roles.
- Batch registration and lookup, shipment workflows, QR verification, certificate records, and audit events.
- IoT temperature log ingestion and an explicitly simulated readings endpoint.
- Trust scoring and fraud/compliance workflows backed by MongoDB records.
- Optional Polygon Amoy anchoring and Pinata document pinning.
- Batch-scoped RAG retrieval over live, validated AgriBridge records: batch details, role-attributed supply-chain events, certificates, shipment/compliance records, and the configured blockchain verification result. The Next.js API assembles those records from MongoDB and the chain verifier; the AI service retrieves only from the requested batch feed, returns source labels, and abstains when no record matches. Gemini synthesis is optional; lexical retrieval remains available when embeddings cannot load.
- Manual/unproven document ingestion and the old generated sample regulations are not part of the active knowledge corpus. There is not yet an authoritative, versioned regulatory source feed; compliance checks therefore remain pending for human review and must not be treated as customs or legal clearance.
- A signed-digest-verified trained agent pack. Model availability is reported at runtime; it is not safe to assume every artifact loads under every scikit-learn version.

## Prerequisites

- Node.js 20 or newer
- Python 3.11 recommended (the model artifacts were trained with scikit-learn 1.7.1)
- MongoDB, local or Atlas, for persistent application features

## Local setup

Install the two JavaScript applications:

```powershell
npm ci --prefix frontend
npm ci --prefix backend
```

Create the root `.env` from `.env.example` and set at least `MONGODB_URI` and a unique `AUTH_SECRET`. The AI service has a separate optional template at `backend/ai-service/.env.example`; its variables can also be supplied through the root environment. Never commit either `.env` file.

Install Python dependencies from the repository root:

```powershell
python -m pip install -r backend/ai-service/requirements.txt
```

Seed development accounts only after MongoDB is reachable:

```powershell
npm run seed --prefix backend
```

Start the UI and AI service in separate terminals:

```powershell
npm run dev --prefix frontend
```

```powershell
npm run dev:ai --prefix backend
```

The UI is at `http://localhost:3000`; FastAPI's development schema is at `http://127.0.0.1:8000/docs`. The AI service binds to loopback by default. Set `AI_SERVICE_HOST=0.0.0.0` explicitly when running it inside a container. For Gemini-backed batch chat, set the same random `AI_SERVICE_API_KEY` in the root `.env` and `backend/ai-service/.env`; the Python batch-feed route rejects unsigned requests. If no key/model is configured, Next.js falls back to extractive answers from the same live records.

## Checks

```powershell
npm run lint --prefix frontend
npm run build --prefix frontend
npm test --prefix backend
npm run test:contracts --prefix backend
```

Run the AI service tests from its directory after installing development dependencies:

```powershell
python -m pip install -r requirements-dev.txt
python -m pytest
```

`npm run test:contracts` executes the Hardhat suite on its local in-memory chain. Deploying to Polygon Amoy is a separate, explicit action and requires a funded test wallet and a contract address.

CI is defined in `.github/workflows/ci.yml`. It runs frontend lint/type checks and build, backend tests, Python lint, and a Python service import check. AI-service pytest and Hardhat tests can also be run locally using the commands above.

## Environment variables

The root `.env.example` is the canonical template for the web application. The Python service template contains only its service-specific options. Common optional integrations:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection for the web application |
| `AUTH_SECRET` | JWT signing secret; use a long random value |
| `AI_SERVICE_URL` | Private URL of FastAPI, default `http://localhost:8000` |
| `AI_SERVICE_API_KEY` | Shared server-to-server key for the batch-feed RAG route; use the same value in both environment files |
| `GEMINI_API_KEY` | Optional Gemini-backed answer synthesis |
| `PINATA_JWT` | Optional IPFS pinning |
| `POLYGON_RPC_URL`, `PRIVATE_KEY`, `CONTRACT_ADDRESS` | Optional Polygon integration; use Amoy credentials for development |
| `SMTP_*` | Reserved configuration; email notifications are not currently wired into alert flows |

Do not place secrets in `NEXT_PUBLIC_*` variables. `.env.example` values are examples, not production credentials.

## ML and data provenance

The `backend/ai-service/ml/trainer.py` pipeline generates synthetic supply-chain examples. The six files under `models/agents/` are SHA-256 checked before deserialization, and the loader performs a prediction liveness probe. These controls protect artifact integrity and catch incompatibilities; they do **not** establish real-world accuracy. Replace the synthetic training data with governed, representative data and have domain experts validate performance before using these models for operational decisions.

The legacy `/api/ml/*` endpoints refuse requests when their expected model artifacts are absent. A missing model must remain an explicit unavailable state, not a fabricated score.

## Deployment notes

- Deploy the Next.js app with its runtime environment variables and MongoDB access configured.
- Deploy FastAPI on a private service network where possible; set `AI_SERVICE_URL` to that internal address and bind the container to `0.0.0.0`.
- Keep MongoDB, Gemini, Pinata, SMTP, and wallet secrets in the deployment provider's secret manager.
- Configure Polygon only after deploying and verifying the contract on the intended network.
- No production deployment target, weather/market provider, validated agronomic model, or disease-image model is configured in this repository. Do not present those capabilities as live.

## Known gaps

- No farm/crop lifecycle collections or CRUD workflows for soil, disease diagnoses, or irrigation records.
- No validated yield, crop recommendation, or disease-image model and no governed field dataset.
- No weather or market data provider integration.
- No password reset or email verification flow; configured SMTP values do not by themselves send alerts.
- The app has no distributed rate limiter; per-process limits would not protect a multi-instance deployment.
- The test environment used for this audit blocks the system Python executable with Windows Application Control, so the Python pytest suite could not be executed here. The live AI service health check and a RAG retrieval request did succeed.

These are actual implementation gaps, not features hidden behind demo data. The existing traceability workflows can be operated independently of optional blockchain and LLM integrations, but the project should not be described as a production-validated agronomy system until the gaps above are addressed and the end-to-end workflows are tested with real providers and representative data.
