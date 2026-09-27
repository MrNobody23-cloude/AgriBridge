"""
Pytest configuration for AgriBridge AI service tests.

Sets up an isolated test environment that:
- Stubs out Gemini API calls (no real API key needed in CI)
- Stubs out Pinata IPFS calls
- Points MODEL_DIR and the RAG paths at a temp dir, so CI never writes to the
  repo tree and never picks up a developer's local artifacts
- Initialises app.state (model_registry + rag_pipeline) via lifespan

It does **not** train anything. The lifespan loads what is on disk and records
what is missing; the trained agent pack is SHA-256 verified from
`models/agents/`, which stays in the repo regardless of MODEL_DIR so the agent
tests in test_agents_v2.py exercise the real artifacts.
"""
import os

import pytest_asyncio

# ── Environment stubs (must be set BEFORE importing the app) ──────────────────
os.environ.setdefault("GEMINI_API_KEY", "")           # empty → RAG fallback, no real calls
os.environ.setdefault("GEMINI_MODEL", "gemini-1.5-flash")
os.environ.setdefault("PINATA_JWT", "test-stub-jwt")
os.environ.setdefault("PINATA_API_KEY", "test-stub-api-key")
os.environ.setdefault("PINATA_API_SECRET", "test-stub-api-secret")
os.environ.setdefault("PINATA_GATEWAY_URL", "https://gateway.pinata.cloud")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000")
# Point models / vectorstore at a temp dir so CI never writes to the repo tree
import pathlib
import tempfile

_TMP = tempfile.mkdtemp(prefix="agribridge_test_")
os.environ.setdefault("MODEL_DIR", str(pathlib.Path(_TMP) / "models"))
os.environ.setdefault("RAG_VECTOR_STORE_DIR", str(pathlib.Path(_TMP) / "vectorstore"))
os.environ.setdefault("RAG_DOCUMENTS_DIR", str(pathlib.Path(_TMP) / "rag_documents"))


def pytest_configure(config):
    """Register custom markers to avoid PytestUnknownMarkWarning."""
    config.addinivalue_line("markers", "asyncio: mark test as async")


# ── Shared ASGI client that runs the FastAPI lifespan ─────────────────────────
@pytest_asyncio.fixture(scope="session")
async def client():
    """
    Session-scoped AsyncClient that starts the FastAPI lifespan once.

    Every test in the suite shares one warm app: the models and the RAG
    pipeline are loaded once, not per request.
    """
    from asgi_lifespan import LifespanManager
    from httpx import ASGITransport, AsyncClient
    from main import app

    async with LifespanManager(app) as manager, AsyncClient(
        transport=ASGITransport(manager.app),
        base_url="http://test",
    ) as ac:
        yield ac
