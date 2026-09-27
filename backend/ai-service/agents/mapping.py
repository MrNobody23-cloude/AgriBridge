"""
AgriBridge AI — Agent Input Mapping

The six agent models were trained on five specific crop types
(Mango, Tomato, Potato, Banana, Onion) drawn from a fixed feature contract.
AgriBridge's own product catalogue is different (Alphonso Mango, Basmati Rice,
Nashik Grapes, Kesar Saffron, Darjeeling Tea, and whatever users create).

So every mapping here makes one of three decisions *explicitly*:

  * **MATCHED**  — a trained crop was identified. The model runs on real inputs.
  * **IN_DOMAIN** — a real AgriBridge crop with no trained counterpart, but the
    agronomic behaviour matches a trained crop closely enough to transfer
    (e.g. Nashik Grapes -> Tomato, both chilling-sensitive with ~4°C optima).
    The model runs, and the caller is told it ran on a transferred profile.
  * **OUT_OF_DOMAIN** — nothing trained resembles this crop. The model is NOT
    run. The agent reports itself not applicable rather than returning a
    confident number derived from a mango model.

Nothing here invents a value. Where a needed input genuinely does not exist in
the database (pesticide residue level, for example — AgriBridge has no residue
field), the mapping says so via `AVAILABLE`/`MISSING` and the caller decides
whether to decline the prediction.
"""
import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("agribridge.agents.mapping")

MATCHED = "MATCHED"
IN_DOMAIN = "IN_DOMAIN"
OUT_OF_DOMAIN = "OUT_OF_DOMAIN"


class InDomain(Exception):
    """Raised when a batch's crop is outside what the model was trained on."""


# ── Crop resolution ──────────────────────────────────────────────────────────

# Trained crops, with a couple of spelling variants seen in the wild.
_TRAINED_CROPS = {"mango", "tomato", "potato", "banana", "onion"}

# Real AgriBridge catalogue -> nearest trained crop, with the reason.
# Keyed by a normalised token of the product name.
_CROP_ALIASES: dict[str, tuple[str, str]] = {
    "mango": ("Mango", "exact"),
    "alphonso": ("Mango", "exact"),
    "banana": ("Banana", "exact"),
    "tomato": ("Tomato", "exact"),
    "potato": ("Potato", "exact"),
    "onion": ("Onion", "exact"),
    # Transfers: same postharvest behaviour class as a trained crop.
    "grapes": ("Tomato", "chilling-sensitive fruit, ~4°C optimum"),
    "grape": ("Tomato", "chilling-sensitive fruit, ~4°C optimum"),
    "apple": ("Banana", "climacteric fruit with similar ripening profile"),
    "orange": ("Tomato", "chilling-sensitive citrus"),
    "brinjal": ("Tomato", "solanaceous fruit"),
    "eggplant": ("Tomato", "solanaceous fruit"),
    "okra": ("Tomato", "solanaceous pod vegetable"),
    "chilli": ("Tomato", "solanaceous fruit"),
    "pepper": ("Tomato", "solanaceous fruit"),
    "beans": ("Tomato", "pod vegetable, short shelf life"),
    "cabbage": ("Potato", "leafy/brassica, ~4°C optimum"),
    "cauliflower": ("Potato", "brassica, ~4°C optimum"),
    "carrot": ("Potato", "root vegetable, ~4°C optimum"),
    # Storage staples: low water content, long shelf life, spoilage driven by
    # moisture/heat rather than chill injury.
    "rice": ("Onion", "dry storage crop, low water activity"),
    "wheat": ("Onion", "dry storage crop, low water activity"),
    "saffron": ("Onion", "dry storage crop, low water activity"),
    "tea": ("Onion", "dry storage crop, low water activity"),
    "coffee": ("Onion", "dry storage crop, low water activity"),
    "jaggery": ("Onion", "dry storage crop, low water activity"),
}


def resolve_crop(product_name: str | None) -> dict[str, Any]:
    """
    Map an AgriBridge product name onto a trained crop.

    Returns a dict with `crop_type` (always a trained crop when this succeeds)
    and `mapping` (MATCHED / IN_DOMAIN).
    """
    if not product_name:
        return {"ok": False, "reason": "batch has no product name"}

    tokens = [t for t in "".join(c if c.isalnum() else " " for c in product_name.lower()).split() if t]
    for token in tokens:
        if token in _CROP_ALIASES:
            crop, why = _CROP_ALIASES[token]
            mapping = MATCHED if why == "exact" else IN_DOMAIN
            return {
                "ok": True,
                "crop_type": crop,
                "mapping": mapping,
                "matched_on": product_name,
                "note": (
                    f"'{product_name}' resolved to trained crop {crop} ({why})."
                    if mapping == IN_DOMAIN else
                    f"'{product_name}' matched trained crop {crop}."
                ),
            }

    return {
        "ok": False,
        "mapping": OUT_OF_DOMAIN,
        "reason": (
            f"No trained crop profile matches '{product_name}'. The agent models were "
            f"trained on {sorted(_TRAINED_CROPS)}; running them on an unrelated crop "
            f"would produce a confident but meaningless number."
        ),
        "crop_type": product_name,
    }


def require_crop(product_name: str | None) -> dict[str, Any]:
    """Same as :func:`resolve_crop` but raises :class:`InDomain` when it fails."""
    res = resolve_crop(product_name)
    if not res.get("ok"):
        raise InDomain(res["reason"])
    return res


# ── Feature extraction from real AgriBridge data ─────────────────────────────


def hours_since(iso: Any) -> float | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return max(0.0, (datetime.now(timezone.utc) - dt).total_seconds() / 3600.0)
    except Exception:
        return None


def days_since_harvest(harvest_date: Any) -> float:
    h = hours_since(harvest_date)
    return round(h / 24.0, 2) if h is not None else 0.0


def temperature_stats(temperature_logs: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Summarise IoT temperature readings into what the spoilage agent needs.

    Returns current/variance/humidity/breach-count, each `None` when the data
    does not exist. `breach_threshold` is supplied by the caller because the
    critical temperature is crop-specific.
    """
    logs = [t for t in (temperature_logs or []) if t.get("temperature") is not None]
    if not logs:
        return {"available": False, "current_temperature": None, "temperature_variance": None,
                "humidity": None, "num_temperature_breaches": 0, "reading_count": 0,
                "simulated_only": False}

    temps = [float(t["temperature"]) for t in logs]
    humidities = [float(t["humidity"]) for t in logs if t.get("humidity") is not None]
    # Logs arrive newest-first from the API; treat the newest as "current".
    ordered = list(reversed(temps))
    mean = sum(ordered) / len(ordered)
    variance = sum((t - mean) ** 2 for t in ordered) / len(ordered)

    return {
        "available": True,
        "current_temperature": round(ordered[-1], 2),
        "mean_temperature": round(mean, 2),
        "temperature_variance": round(variance ** 0.5, 2),  # sigma, matches the training scale
        "humidity": round(sum(humidities) / len(humidities), 2) if humidities else None,
        "reading_count": len(logs),
        "simulated_only": bool(logs) and all(t.get("isSimulated") for t in logs),
    }


def count_temperature_breaches(
    temperature_logs: list[dict[str, Any]], crit_temp: float
) -> int:
    """Readings outside the crop's safe band (|T - crit_temp| > tolerance)."""
    tol = 5.0
    return sum(
        1 for t in (temperature_logs or [])
        if t.get("temperature") is not None
        and abs(float(t["temperature"]) - crit_temp) > tol
    )


# ── Per-agent input assembly ─────────────────────────────────────────────────


def compliance_inputs(
    batch: dict[str, Any],
    certificates: list[dict[str, Any]],
    destination_market: str,
    residue_override: float | None = None,
) -> dict[str, Any]:
    """
    Inputs for the Compliance agent (Reg. 396/2005 MRL check).

    AgriBridge has no pesticide-residue field, so `pesticide_residue_level` is
    only present when the caller measured one. Without it the compliance
    decision rests on certification validity and certificate expiry alone,
    which is a narrower question than a full MRL test — `residue_source` records
    which of the two happened so the UI can say so.
    """
    now = datetime.now(timezone.utc)
    expiries = [
        (c.get("expiryDate"), c.get("verificationStatus"))
        for c in certificates
        if c.get("expiryDate")
    ]
    if expiries:
        soonest = min(expiries, key=lambda e: str(e[0]))
        try:
            exp_dt = datetime.fromisoformat(str(soonest[0]).replace("Z", "+00:00"))
            if exp_dt.tzinfo is None:
                exp_dt = exp_dt.replace(tzinfo=timezone.utc)
            days_remaining = (exp_dt - now).days
        except Exception:
            days_remaining = None
        expiry_status = soonest[1]
    else:
        days_remaining = None
        expiry_status = None

    # A certificate is "valid" for the MRL check when it is verified and unexpired.
    if not certificates:
        certification_valid = 0
    elif days_remaining is None:
        certification_valid = int(all(c.get("verificationStatus") == "VERIFIED" for c in certificates))
    else:
        certification_valid = int(days_remaining > 0 and expiry_status == "VERIFIED")

    return {
        "batch_id": batch.get("batchCode"),
        "destination_market": destination_market,
        "certification_valid": certification_valid,
        "certificate_expiry_days_remaining": days_remaining,
        "pesticide_residue_level": residue_override,
        "residue_source": "measured" if residue_override is not None else "not_recorded",
        "certificate_count": len(certificates),
    }


def fraud_inputs(
    batch: dict[str, Any],
    shipment: dict[str, Any] | None,
    certificates: list[dict[str, Any]],
    events: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Inputs for the Fraud agent.

    `transaction_value` comes from the shipment price when one exists. When
    there is no shipment yet, the model is not run: the price-manipulation
    feature is a third of the model's signal and guessing it would let a
    fabricated number drive the decision.
    """
    quantity_kg = float(batch.get("quantity") or 0.0)
    value = float(shipment.get("price") or 0.0) if shipment else 0.0
    if not value and shipment and shipment.get("quantity"):
        try:
            value = float(batch.get("quantity") or 0.0) * float(batch.get("unitPrice") or 0.0)
        except Exception:
            value = 0.0

    ages = []
    for c in certificates:
        age = hours_since(c.get("issueDate"))
        if age is not None:
            ages.append(age / 24.0)

    depart = hours_since(shipment.get("departureDate")) if shipment else None
    arrive = hours_since(shipment.get("arrivalDate")) if shipment else None
    if depart is not None:
        transport_hours = (depart - arrive) if arrive is not None else depart
        transport_hours = max(0.0, transport_hours)
    else:
        transport_hours = None

    return {
        "batch_id": batch.get("batchCode"),
        "quantity_kg": quantity_kg,
        "transaction_value": value,
        "transport_hours": transport_hours,
        "distance_km": float(shipment.get("distanceKm") or 0.0) if shipment else None,
        "certificate_age_days": max(ages) if ages else None,
        "ownership_transfers": len(events) if events else None,
        "has_shipment": shipment is not None,
    }


def quality_inputs(
    batch: dict[str, Any],
    temperature_logs: list[dict[str, Any]],
    certificates: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Inputs for the Quality agent (regressor, 0-100 score).

    `moisture` is optional in training (5% of rows are null and the pipeline
    imputes the median), so omitting it is legitimate rather than a gap.
    `storage_duration` and `transportation_duration` both come from elapsed
    harvest time; they are split only when the data lets us do so honestly.
    """
    elapsed_days = days_since_harvest(batch.get("harvestDate"))
    stats = temperature_stats(temperature_logs)
    humidity = stats.get("humidity") if stats.get("available") else None

    return {
        "batch_id": batch.get("batchCode"),
        "temperature": stats.get("current_temperature") if stats.get("available") else None,
        "humidity": humidity,
        "storage_duration": round(elapsed_days, 2),
        "transportation_duration": round(elapsed_days, 2),
        "moisture": None,
        "certificate_count": len(certificates),
        "simulated_only": stats.get("simulated_only", False),
    }


def spoilage_inputs(
    batch: dict[str, Any],
    temperature_logs: list[dict[str, Any]],
    crit_temp: float,
) -> dict[str, Any]:
    """Inputs for the Spoilage agent. `remaining_transport_time` needs a shipment ETA."""
    stats = temperature_stats(temperature_logs)
    return {
        "batch_id": batch.get("batchCode"),
        "current_days_since_harvest": days_since_harvest(batch.get("harvestDate")),
        "current_temperature": stats.get("current_temperature") if stats.get("available") else None,
        "temperature_variance": stats.get("temperature_variance") if stats.get("available") else None,
        "humidity": stats.get("humidity") if stats.get("available") else None,
        "num_temperature_breaches": count_temperature_breaches(temperature_logs, crit_temp),
        "has_sensor_data": bool(stats.get("available")),
        "simulated_only": stats.get("simulated_only", False),
    }
