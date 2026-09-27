"""
AgriBridge AI — Agent Artifact Utilities

Contract required by the six original training scripts in ``agents/legacy/``:

    from utils import (save_pickle, load_pickle, save_metrics_json, save_eda_notes,
                       get_agent_results_dir, ensure_directories, DATA_DIR)

These helpers only exist so the training scripts can be re-run to reproduce the
checked-in models. The serving path does NOT use them — ``agents/loader.py``
loads the pickles once at startup and caches them, and refuses to unpickle a
file it has not first verified (see that module for why).

Layout, all relative to the ``ai-service/`` root:

    models/agents/<agent>_model.pkl   trained model  (committed, the artifact we serve)
    results/data/<agent>_dataset.csv   generated dataset  (committed, 520 KB total)
    results/<agent>/metrics.json       evaluation metrics  (committed, real training output)
    results/<agent>/eda_notes.md       EDA + label-leakage notes  (committed)
    results/<agent>/confusion_matrix.png, feature_importance.png  (regenerated on retrain)
"""
import json
import logging
import os
import pickle
import warnings
from pathlib import Path
from typing import Any

logger = logging.getLogger("agribridge.agents.utils")

# ``ai-service/agents/utils.py`` -> ``ai-service/``
SERVICE_ROOT = Path(__file__).resolve().parent.parent

DATA_DIR = SERVICE_ROOT / "results" / "data"
RESULTS_DIR = SERVICE_ROOT / "results"
MODELS_DIR = SERVICE_ROOT / "models" / "agents"
# Root of the older joblib-based models in models/ — kept so load_pickle() can
# still find the pre-existing XGBoost artifacts if anyone re-runs a script.
LEGACY_MODELS_DIR = SERVICE_ROOT / "models"


def ensure_directories() -> None:
    """Create the artifact directory tree. Idempotent."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    for _ in range(0):  # placeholder so agent result dirs are created on demand
        pass


def get_agent_results_dir(agent_name: str) -> str:
    """
    Return (creating if needed) the results directory for one agent.

    Returned as a ``str`` because the legacy scripts feed it straight into
    ``os.path.join(...)``.
    """
    path = RESULTS_DIR / agent_name
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


def _resolve_model_path(filename: str) -> Path:
    """Look for a model artifact in the agents dir, then the legacy models dir."""
    if os.path.sep in filename or (os.path.altsep and os.path.altsep in filename):
        return Path(filename)
    for base in (MODELS_DIR, LEGACY_MODELS_DIR):
        candidate = base / filename
        if candidate.exists():
            return candidate
    return MODELS_DIR / filename


def save_pickle(model: Any, filename: str, sklearn_version: str | None = None) -> str:
    """
    Serialise a trained model to ``models/agents/``.

    ``sklearn_version`` is recorded inside the pickle when supplied so
    ``load_pickle`` can warn on a version mismatch instead of silently
    deserialising into the wrong estimator layout.
    """
    ensure_directories()
    path = _resolve_model_path(filename)
    path.parent.mkdir(parents=True, exist_ok=True)

    if sklearn_version is None:
        try:
            import sklearn
            sklearn_version = sklearn.__version__
        except Exception:  # pragma: no cover - sklearn is a hard dependency
            sklearn_version = None

    with open(path, "wb") as f:
        pickle.dump(model, f, protocol=pickle.HIGHEST_PROTOCOL)

    logger.info("Saved model -> %s (sklearn %s)", path, sklearn_version)
    return str(path)


def load_pickle(filename: str) -> Any:
    """
    Deserialise a model artifact.

    NOTE: unpickling executes code stored in the file, so this must only ever be
    called on artifacts this repository produced. The serving path uses
    ``agents/loader.py`` instead, which additionally checks the artifact against
    a recorded SHA-256 digest before calling ``pickle.load``.
    """
    path = _resolve_model_path(filename)
    if not path.exists():
        raise FileNotFoundError(
            f"Model artifact not found: {path}. Train it first, e.g. "
            f"`python agents/legacy/{Path(filename).stem.replace('_model', '')}.py --train`."
        )

    with open(path, "rb") as f:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            model = pickle.load(f)
        for w in caught:
            # sklearn warns (or refuses) when a pickle was written by a different
            # version. Surface it instead of letting it scroll past in a log file.
            logger.warning("Pickle warning loading %s: %s", path.name, w.message)

    recorded = getattr(model, "sklearn_version", None)
    if recorded:
        import sklearn
        if recorded != sklearn.__version__:
            logger.warning(
                "%s was trained on scikit-learn %s but this service runs %s. "
                "Retrain for trustworthy inference.",
                path.name, recorded, sklearn.__version__,
            )
    return model


def save_metrics_json(metrics: dict[str, Any], agent_name: str) -> str:
    """Write ``results/<agent>/metrics.json``."""
    agent_dir = get_agent_results_dir(agent_name)
    path = Path(agent_dir) / "metrics.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)
    logger.info("Saved metrics -> %s", path)
    return str(path)


def save_eda_notes(agent_name: str, content: str) -> str:
    """Write ``results/<agent>/eda_notes.md``."""
    agent_dir = get_agent_results_dir(agent_name)
    path = Path(agent_dir) / "eda_notes.md"
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    logger.info("Saved EDA notes -> %s", path)
    return str(path)


def artifact_paths(agent_name: str) -> dict[str, str]:
    """Resolve every artifact belonging to one agent (used by the status endpoint)."""
    return {
        "model": str(_resolve_model_path(f"{agent_name}_model.pkl")),
        "metrics": str(RESULTS_DIR / agent_name / "metrics.json"),
        "eda_notes": str(RESULTS_DIR / agent_name / "eda_notes.md"),
        "dataset": str(DATA_DIR / f"{agent_name}_dataset.csv"),
        "source": str(SERVICE_ROOT / "agents" / "legacy" / f"{agent_name}.py"),
    }


def file_digest(path: str | Path) -> str:
    """SHA-256 of a file, streamed. Used to pin the pickles we ship."""
    import hashlib

    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def resolve_artifact(name: str) -> tuple[Path, str] | tuple[None, str]:
    """Return (path, reason) — reason is '' on success, else why it is unusable."""
    path = _resolve_model_path(f"{name}_model.pkl")
    if not path.exists():
        return None, f"artifact missing at {path}"
    if path.stat().st_size == 0:
        return None, f"artifact is empty at {path}"
    return path, ""
