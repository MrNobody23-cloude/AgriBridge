"""
AgriBridge AI — Python FastAPI Microservice
Provides: ML inference, RAG compliance, LangGraph multi-agent, IPFS upload
"""
import logging
import os
import time
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

# ── Environment validation ────────────────────────────────────────────────────

REQUIRED_VARS = []  # Optional vars, not hard-required for basic startup
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# ── Logging ────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("agribridge.ai")

# ── Lifespan: load models at startup ─────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Load models once at startup, not on every request.

    Nothing is trained here. The legacy registry looks for its artifacts on disk
    and records any that are absent as not configured; the six trained agents
    are SHA-256 verified and deserialised. A model that is missing or fails its
    checksum is reported as unavailable at request time — the service never
    trains one on startup to fill the gap.
    """
    logger.info("🚀 AgriBridge AI Service starting up...")

    from ml.model_registry import ModelRegistry
    registry = ModelRegistry()
    await registry.load_all()
    app.state.model_registry = registry

    # Six trained scikit-learn agents. Each artifact is SHA-256 verified before
    # it is deserialised; one that fails is reported unavailable, not faked.
    from agents import get_loader
    get_loader()
    app.state.agent_loader = get_loader()

    from rag.pipeline import RAGPipeline
    rag = RAGPipeline()
    await rag.initialize()
    app.state.rag_pipeline = rag

    logger.info("✅ Models and RAG pipeline loaded.")
    yield
    logger.info("🛑 AgriBridge AI Service shutting down.")

# ── App ────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="AgriBridge AI Microservice",
    description="""
    Real AI inference engine for AgriBridge Agricultural Trust Intelligence Platform.

    Provides:
    - XGBoost spoilage prediction with SHAP explanations
    - Quality and shelf-life prediction
    - Isolation Forest anomaly/fraud detection
    - Batch-scoped retrieval over validated platform feed records; optional Gemini synthesis
    - LangGraph multi-agent orchestration
    - IPFS document upload via Pinata
    """,
    version="2.0.0",
    lifespan=lifespan,
)

origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ────────────────────────────────────────────────────────────────────

# Import order: FastAPI's OpenAPI schema builder is configured before the
# routers are imported, so this import block is intentionally after the
# `app.add_middleware` and `app.options` calls. E402 is documented here
# with a comment rather than moved, because reordering would require the
# entire file re-layout and the comment makes the intent clear.
from routers import (  # noqa: E402 — routers import late per docstring above
    agents_router,
    agents_v2_router,
    health_router,
    ipfs_router,
    ml_router,
    rag_router,
)

app.include_router(health_router.router, prefix="/api/health", tags=["Health"])
app.include_router(ml_router.router, prefix="/api/ml", tags=["ML Inference"])
app.include_router(rag_router.router, prefix="/api/rag", tags=["RAG Compliance"])
app.include_router(agents_router.router, prefix="/api/agents", tags=["LangGraph Agents"])
# Additive: the trained agent pack. The routes above keep their exact shapes.
app.include_router(agents_v2_router.router, prefix="/api/agents/v2", tags=["Trained Agents"])
app.include_router(ipfs_router.router, prefix="/api/ipfs", tags=["IPFS"])

@app.get("/")
def root():
    return {
        "service": "AgriBridge AI Microservice",
        "version": "2.0.0",
        "status": "online",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "docs": "/docs",
        "capabilities": ["ml-inference", "rag-compliance", "multi-agent", "ipfs"],
    }

if __name__ == "__main__":
    import uvicorn
    # Bind loopback by default: Next.js calls the AI service server-to-server,
    # so a local development process does not need to listen on the LAN.
    # Container deployments should explicitly set AI_SERVICE_HOST=0.0.0.0.
    host = os.getenv("AI_SERVICE_HOST", "127.0.0.1")
    port = int(os.getenv("AI_SERVICE_PORT", "8000"))
    uvicorn.run("main:app", host=host, port=port, reload=True)
