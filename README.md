# 🌾 AgriBridge AI

AgriBridge AI is an end-to-end, AI-driven agricultural supply chain traceability and compliance platform built with Next.js, FastAPI, MongoDB, and Polygon Blockchain.

---

## 📁 Project Architecture

The repository is structured into two main applications:

```text
agribridge-ai/
├── frontend/             # Next.js 16 Web Dashboard & UI
│   ├── src/              # React Pages, Components, UI Layer
│   ├── public/           # Static Assets
│   └── package.json      # Frontend Dependencies & Scripts
├── backend/              # Server-Side APIs, AI Service & Smart Contracts
│   ├── ai-service/       # Python FastAPI Service (RAG & Agent Pipelines)
│   ├── contracts/        # Solidity Smart Contracts (Hardhat)
│   ├── scripts/          # Database Seeding & Contract Deployment Scripts
│   ├── test/             # Backend & Auth Unit Test Suites
│   └── package.json      # Backend Node.js Dependencies & Hardhat Scripts
├── .env.example          # Environment Variable Configuration Template
└── README.md             # Project Documentation
```

---

## 🔑 Required Environment Variables & API Keys

To make the AgriBridge AI platform fully functional, copy `.env.example` to `.env` in the root directory (or inside `frontend/` and `backend/` depending on execution setup).

| Variable / Service | Description | Where to Get It / Instructions | Optional / Required |
| :--- | :--- | :--- | :--- |
| `MONGODB_URI` | MongoDB Connection String | Local: `mongodb://127.0.0.1:27017/agribridge_ai` <br> Cloud: Free cluster at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) | **Required** |
| `AUTH_SECRET` | Secret key for signing JWT auth tokens | Generate with terminal command: `openssl rand -base64 64` | **Required** |
| `GEMINI_API_KEY` | Google Gemini API key for AI RAG & agents | Get free key from [Google AI Studio](https://aistudio.google.com/app/apikey) | **Required for AI** |
| `PRIVATE_KEY` | Wallet private key for signing on-chain batches | MetaMask or any Web3 wallet (use Amoy testnet account only) | Optional (Blockchain) |
| `CONTRACT_ADDRESS` | Deployed `AgriBridgeTraceability` address | Generated after deploying contract via Hardhat | Optional (Blockchain) |
| `POLYGON_RPC_URL` | RPC node for Polygon Amoy Testnet | Default: `https://rpc-amoy.polygon.technology` or [Alchemy](https://www.alchemy.com/) | Optional (Blockchain) |
| `PINATA_API_KEY` / `SECRET` / `JWT` | IPFS pinning for document hashing & decentralization | Create free account at [Pinata Developer Portal](https://app.pinata.cloud/developers/api-keys) | Optional (IPFS) |
| `SMTP_USER` / `PASSWORD` | SMTP configuration for email alerts | Google App Password or SendGrid credentials | Optional (Email) |

---

## 🛠️ Step-by-Step Setup & How to Make the App Fully Working

### 1. Prerequisites
- **Node.js**: `v20.x` or higher
- **Python**: `v3.11`
- **MongoDB**: Active local `mongod` instance or MongoDB Atlas connection URL

### 2. Install Dependencies
```bash
# Install Frontend Dependencies
npm install --prefix frontend

# Install Backend Dependencies
npm install --prefix backend

# Install Python AI Service Dependencies
pip install -r backend/ai-service/requirements.txt
```

### 3. Environment Setup & Data Seeding
1. Copy `.env.example` to `.env` in your project workspace:
   ```bash
   cp .env.example .env
   ```
2. Set your `MONGODB_URI`, `AUTH_SECRET`, and `GEMINI_API_KEY`.
3. Seed the database with demo accounts (Farmers, Exporters, Regulators, Admins):
   ```bash
   npm run seed --prefix backend
   ```

---

## 🚀 Commands to Run the Project

Run each service in a separate terminal window:

### Terminal 1: Run Frontend UI (Next.js)
```bash
npm run dev --prefix frontend
```
> App will be accessible at: **`http://localhost:3000`**

### Terminal 2: Run Backend AI Service (FastAPI)
```bash
# Navigate to backend/ai-service directory
cd backend/ai-service
python main.py
```
> AI Service API docs available at: **`http://localhost:8000/docs`**

### Terminal 3 (Optional): Smart Contract Deployment & Testing
```bash
# Run smart contract tests
npm run --prefix backend hardhat test

# Deploy smart contracts to Polygon Amoy Testnet
npx --prefix backend hardhat run scripts/deploy.js --network amoy
```

---

## 🧪 Running Automated Tests

```bash
# Run Backend Node & Auth Tests (Vitest)
npm test --prefix backend

# Run Python AI Service Tests (Pytest)
python -m pytest -c backend/ai-service/pytest.ini backend/ai-service/tests
```
