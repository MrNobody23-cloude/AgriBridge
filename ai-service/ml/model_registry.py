"""
ML Model Registry — loads and caches all trained models at startup.
Models are loaded once, not on every request.

This registry serves the *legacy* `/api/ml/*` endpoints. It only ever loads
artifacts that exist on disk.

It deliberately does NOT train a model when one is missing. It used to: a
missing `spoilage_xgboost_v1.joblib` would trigger a fit on randomly generated
rows and the endpoint would then serve confident spoilage percentages that no
agronomist had ever validated. The numbers looked real and were not, which is
worse than an error. A missing artifact is now a missing artifact — the model
is absent from the registry, `/api/ml/models` does not list it, and the calling
route gets a KeyError it turns into a 503 with an honest reason.

Note this is separate from the six-agent pack in `agents/`, which is served at
`/api/agents/v2` and additionally SHA-256 verifies every artifact before
deserialising it.
"""
import os
import json
import logging
import joblib
import numpy as np
from pathlib import Path
from typing import Dict, Any, Optional

logger = logging.getLogger("agribridge.ml.registry")

MODEL_DIR = Path(os.getenv("MODEL_DIR", "./models"))


class ModelRegistry:
    """Central registry for all AgriBridge ML models."""

    def __init__(self):
        self.models: Dict[str, Any] = {}
        self.metadata: Dict[str, Dict] = {}
        self.missing: Dict[str, str] = {}
        self._loaded = False

    async def load_all(self):
        """
        Load every model present in MODEL_DIR.

        A model that is absent is recorded in `self.missing` with the path that
        was looked for, so `/api/ml/models` and the 503 body can name it.
        """
        MODEL_DIR.mkdir(parents=True, exist_ok=True)

        model_files = {
            "spoilage": "spoilage_xgboost_v1.joblib",
            "quality": "quality_xgboost_v1.joblib",
            "shelf_life": "shelf_life_xgboost_v1.joblib",
            "fraud": "fraud_isolation_forest_v1.joblib",
        }

        for name, filename in model_files.items():
            path = MODEL_DIR / filename
            if not path.exists():
                self.missing[name] = (
                    f"no artifact at {path} — this model is not configured. "
                    f"The service does not train one on startup."
                )
                logger.warning("⚠️  %s: %s", name, self.missing[name])
                continue
            try:
                self.models[name] = joblib.load(path)
            except Exception as exc:
                self.missing[name] = f"failed to load {path}: {type(exc).__name__}: {exc}"
                logger.exception("❌ Could not load %s", name)
                continue

            meta_path = MODEL_DIR / f"{name}_metadata.json"
            if meta_path.exists():
                with open(meta_path) as f:
                    self.metadata[name] = json.load(f)
            logger.info("✅ Loaded model: %s from %s", name, path)

        if self.missing:
            logger.warning(
                "%d of %d legacy models are not configured: %s",
                len(self.missing), len(model_files), ", ".join(self.missing),
            )
        self._loaded = True

    def get(self, name: str):
        """Get a loaded model by name."""
        if name not in self.models:
            reason = self.missing.get(name, "not loaded")
            raise KeyError(
                f"Model '{name}' is not configured: {reason} "
                f"Loaded: {sorted(self.models) or 'none'}"
            )
        return self.models[name]

    def get_metadata(self, name: str) -> Dict:
        return self.metadata.get(name, {})

    def is_loaded(self) -> bool:
        return self._loaded

    def status(self) -> Dict[str, Any]:
        return {
            "loaded": sorted(self.models),
            "notConfigured": {k: v for k, v in self.missing.items()},
        }

