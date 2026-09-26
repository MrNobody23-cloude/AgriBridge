# ──────────────────────────────────────────────
# AgriBridge AI — Python FastAPI AI Service
# ──────────────────────────────────────────────

FROM python:3.11-slim AS base
WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ── Dependencies ──────────────────────────────
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── App ──────────────────────────────────────
COPY . .

# Create non-root user
RUN useradd --create-home --shell /bin/bash aiservice
RUN chown -R aiservice:aiservice /app
USER aiservice

# Ensure model/vectorstore dirs exist
RUN mkdir -p models vectorstore rag_documents

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
