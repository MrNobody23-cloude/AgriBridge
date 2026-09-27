"""
AgriBridge AI — Shared agent plumbing

Gives every agent the same three-way outcome so a caller never has to guess
whether a number it received came from the model:

    status="OK"               a real model prediction
    status="NOT_APPLICABLE"   the model would not be meaningful for this input
    status="UNAVAILABLE"      the artifact is not loaded / failed its checksum

The middleware and the UI both key off `status`, never off the presence of a
number.
"""
import logging
from typing import Any

import pandas as pd

logger = logging.getLogger("agribridge.agents.base")

OK = "OK"
NOT_APPLICABLE = "NOT_APPLICABLE"
UNAVAILABLE = "UNAVAILABLE"


class MissingFeatures(Exception):
    """Required inputs are absent from the database — the model is not run."""

    def __init__(self, features: list[str], reason: str = ""):
        self.features = features
        self.reason = reason
        super().__init__(reason or f"missing required feature(s): {', '.join(features)}")


class NotApplicable(Exception):
    """The model is out of domain for this batch."""


def to_frame(row: dict[str, Any]) -> pd.DataFrame:
    return pd.DataFrame([row])


def require(
    inputs: dict[str, Any],
    features: list[str],
    reason: str = "",
) -> None:
    """Raise :class:`MissingFeatures` if any of ``features`` is None in ``inputs``."""
    absent = [f for f in features if inputs.get(f) is None]
    if absent:
        detail = reason or f"AgriBridge stores no {'/'.join(absent)} for this batch"
        raise MissingFeatures(absent, detail)


def ok(agent: str, prediction: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {"agent": agent, "status": OK, "prediction": prediction, **extra}


def not_applicable(agent: str, reason: str, **extra: Any) -> dict[str, Any]:
    return {"agent": agent, "status": NOT_APPLICABLE, "reason": reason, "prediction": None, **extra}


def unavailable(agent: str, reason: str, **extra: Any) -> dict[str, Any]:
    return {"agent": agent, "status": UNAVAILABLE, "reason": reason, "prediction": None, **extra}
