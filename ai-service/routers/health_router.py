"""Health check endpoints."""
import time
from fastapi import APIRouter, Request

router = APIRouter()


@router.get("")
@router.get("/")
async def health(request: Request):
    registry = getattr(request.app.state, "model_registry", None)
    rag = getattr(request.app.state, "rag_pipeline", None)

    models_ok = registry is not None and registry.is_loaded()
    rag_ok = rag is not None and rag._initialized

    # A legacy model with no artifact on disk is "not configured", not "unhealthy" —
    # the service is fine, the model simply was never supplied. `/api/ml/models`
    # is where the per-model detail lives.
    missing = sorted(getattr(registry, "missing", {}) or {})

    services = {
        "ml_models": (
            "healthy" if models_ok and not missing
            else "degraded" if models_ok
            else "initializing"
        ),
        "ml_models_not_configured": missing,
        "trained_agents": _agents_status(request),
        "rag_pipeline": "healthy" if rag_ok else "initializing",
        "gemini_llm": "healthy" if (rag and rag.llm is not None) else "unavailable",
        "embedder": "healthy" if (rag and rag.embedder is not None) else "unavailable",
    }

    scalar = [v for v in services.values() if isinstance(v, str)]
    agents = services["trained_agents"]
    overall = (
        "healthy"
        if all(v in ("healthy", "unavailable") for v in scalar) and agents["available"] == agents["total"]
        else "degraded"
    )

    return {
        "status": overall,
        "services": services,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "version": "2.1.0",
    }


def _agents_status(request: Request):
    """How many of the six trained agents actually loaded."""
    loader = getattr(request.app.state, "agent_loader", None)
    if loader is None:
        return {"available": 0, "total": 6, "state": "initializing"}
    return {
        "available": len(loader.available_agents()),
        "total": 6,
        "agents": loader.available_agents(),
        "state": "ready" if len(loader.available_agents()) == 6 else "degraded",
    }
