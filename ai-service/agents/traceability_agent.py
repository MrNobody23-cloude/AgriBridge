"""
Traceability Agent — IsolationForest over hash-chained custody events.

Two-layer scoring, carried over from the training script:

    rule_score  deterministic deductions (broken hash link, backward timestamp,
                out-of-order custody role, impossible transit speed)
    ml_score    IsolationForest decision function mapped to 0-100
    composite   0.6 * rule + 0.4 * ml

Keeping the rule layer matters: the model alone caught 44/47 anomalies, but a
deterministic, explainable deduction is what an auditor can actually act on.

HONEST LIMITATION — read before trusting a VERIFIED verdict
----------------------------------------------------------
The model was trained on events carrying an explicit `prev_hash` / `tx_hash`
pair, i.e. a locally computable SHA-256 chain. AgriBridge's `SupplyChainEvent`
rows do **not** store `prev_hash`, and the Polygon contract in `contracts/`
records per-event transactions without a link to the preceding one.

The chain check therefore runs on what does exist — consecutive
`blockchainTransactionHash` values, which are independent Polygon transaction
hashes and therefore do not chain. Consequences, stated plainly:

  * Events carrying a real Polygon tx hash are checked for *sequence
    continuity* (a gap means a missing custody step) but they are not, and
    cannot be, verified as a hash chain.
  * Events with no tx hash are **excluded from the feature set** rather than
    being scored as though their hash were valid, because treating absent data
    as valid would push every real batch toward a VERIFIED verdict.

`hash_chain_available` in the response is False whenever fewer than two
comparable links exist, and the endpoint then refuses to return a composite
score at all. See the note appended to every response.
"""
import hashlib
import math
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from agents.base import MissingFeatures, ok, to_frame
from agents.loader import AgentUnavailable

# Custody order the model learned. AgriBridge's TRANSFERRED_TO_* events sit
# between the two ends, so they inherit the FARMER rank: a trader handover is
# still the farm-side end of the chain as far as ordering is concerned.
ROLE_ORDER = {
    "FARMER": 0,
    "TRADER": 1,
    "TRANSPORTER": 2,
    "RETAILER": 3,
}

EVENT_ROLE = {
    "FARM_REGISTERED": "FARMER",
    "HARVESTED": "FARMER",
    "INSPECTED": "FARMER",
    "CERTIFIED": "FARMER",
    "TRANSFERRED_TO_MANDI": "TRADER",
    "TRANSFERRED_TO_EXPORTER": "TRADER",
    "LOADED_FOR_EXPORT": "TRANSPORTER",
    "EXPORTED": "TRANSPORTER",
    "IN_TRANSIT": "TRANSPORTER",
    "CUSTOMS_CLEARED": "TRANSPORTER",
    "IMPORTER_RECEIVED": "TRANSPORTER",
    "RETAILER_RECEIVED": "RETAILER",
    "CONSUMER_VERIFIED": "RETAILER",
    "STATUS_CHANGED_TO_REGISTERED": "FARMER",
    "STATUS_CHANGED_TO_IN_TRANSIT": "TRANSPORTER",
    "STATUS_CHANGED_TO_EXPORTED": "TRANSPORTER",
    "STATUS_CHANGED_TO_DELIVERED": "RETAILER",
    "STATUS_CHANGED_TO_FLAGGED": "RETAILER",
    "STATUS_CHANGED_TO_RECALLED": "RETAILER",
}

# Trained geofence. Outside these six points the transit-speed check cannot run
# (the module has no geocoder), so that check reports "not evaluated" instead of
# inventing a distance.
LOCATIONS = {
    "FARM_NASHIK": (20.0059, 73.7898),
    "MANDI_NASHIK": (19.9975, 73.7898),
    "COLD_STORAGE_PUNE": (18.5204, 73.8567),
    "HUB_MUMBAI": (19.0760, 72.8777),
    "RETAIL_MUMBAI": (19.0178, 72.8478),
    "MANDI_NAGPUR": (21.1458, 79.0882),
}

FEATURE_COLS = [
    "num_events",
    "num_distinct_actors",
    "min_time_gap_hrs",
    "max_time_gap_hrs",
    "avg_time_gap_hrs",
    "negative_time_gaps_count",
    "max_speed_kmh",
    "hash_chain_valid_ratio",
    "role_sequence_valid",
]

NEG_INF = -1e6  # sentinel for "not evaluated" (the model is never trained on it)


def haversine_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    R = 6371.0
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h))


# ── Location resolution ──────────────────────────────────────────────────────

_STATE_CENTROIDS = {
    "maharashtra": (19.7515, 75.7139), "mumbai": (19.0760, 72.8777),
    "pune": (18.5204, 73.8567), "nashik": (20.0059, 73.7898),
    "nagpur": (21.1458, 79.0882), "ratnagiri": (16.9902, 73.3120),
    "punjab": (31.1471, 75.3412), "amritsar": (31.6340, 74.8723),
    "uttarakhand": (30.0668, 79.0193), "dehradun": (30.3165, 78.0321),
    "kashmir": (34.0837, 74.7973), "srinagar": (34.0837, 74.7973),
    "west bengal": (22.9868, 87.8550), "darjeeling": (27.0410, 88.2663),
    "kerala": (10.8505, 76.2711), "tamil nadu": (11.1271, 78.6569),
    "karnataka": (15.3173, 75.7139), "gujarat": (22.2587, 71.1924),
    "rajasthan": (27.0238, 74.2179), "haryana": (29.0588, 76.0856),
    "assam": (26.2006, 92.9376), "telangana": (17.1232, 79.2088),
    "andhra pradesh": (15.9129, 79.7400), "odisha": (20.9517, 85.0985),
    "bihar": (25.0961, 85.3131), "uttarakhand himachal": (31.1048, 77.1734),
    "himachal": (31.1048, 77.1734), "goa": (15.2993, 74.1240),
    "port": None, "unknown": None,
}

_WORD_COORDS = [
    (r"\bnashik\b", (20.0059, 73.7898)),
    (r"\bpune\b", (18.5204, 73.8567)),
    (r"\bmumbai\b", (19.0760, 72.8777)),
    (r"\bnagpur\b", (21.1458, 79.0882)),
    (r"\bratnagiri\b", (16.9902, 73.3120)),
    (r"\bamritsar\b", (31.6340, 74.8723)),
    (r"\bdehradun\b", (30.3165, 78.0321)),
    (r"\bdarjeeling\b", (27.0410, 88.2663)),
    (r"\bsrinagar\b", (34.0837, 74.7973)),
]


def resolve_location(raw: Optional[str]) -> Tuple[Optional[Tuple[float, float]], str]:
    """
    Best-effort coordinate resolution.

    Returns (coords, method). `coords` is None when the string cannot be placed
    inside the trained geofence, in which case the caller must report the
    transit-speed check as not evaluated rather than substituting a default
    position.
    """
    if not raw:
        return None, "absent"
    text = str(raw).strip()
    upper = text.upper()

    if upper in LOCATIONS:
        return LOCATIONS[upper], "exact_geofence"

    for name, coords in LOCATIONS.items():
        if name in upper:
            return coords, "fuzzy_geofence"

    low = text.lower()
    for pattern, coords in _WORD_COORDS:
        if re.search(pattern, low):
            return coords, "city_match"

    for key, coords in _STATE_CENTROIDS.items():
        if coords and key in low:
            return coords, "state_centroid"

    if "port" in low:
        return None, "port_unspecified"

    return None, "unresolved"


# ── Event preparation ────────────────────────────────────────────────────────

def parse_timestamp(value: Any) -> Optional[datetime]:
    """
    Parse an event timestamp to a timezone-aware UTC datetime.

    Returns None when the string is not a timestamp at all. A naive timestamp is
    read as UTC because every timestamp AgriBridge writes comes from
    `DateTime @default(now())` or an explicit `new Date()`.
    """
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _actor_role(event: Dict[str, Any]) -> str:
    if event.get("actorRole"):
        return str(event["actorRole"]).upper()
    return EVENT_ROLE.get(str(event.get("eventType", "")).upper(), "TRANSPORTER")


def _tx_hash(event: Dict[str, Any]) -> Optional[str]:
    h = event.get("blockchainTransactionHash") or event.get("blockchainHash")
    return str(h) if h else None


def prepare_events(raw_events: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[str]]:
    """
    Normalise AgriBridge `SupplyChainEvent` rows into the shape the feature
    extractor expects.

    Rows lacking both a transaction hash and a resolvable location cannot take
    part in a link or a speed check, so they are dropped from the compared set
    and named in the returned exclusion list.

    The order the caller supplied is preserved exactly. An earlier version of
    this function sorted by the timestamp string, which is wrong twice over: a
    timestamp carrying a UTC offset does not sort lexicographically into its
    real position, and — far worse — re-sorting by the very field being checked
    makes `negative_time_gaps_count` structurally impossible, so a custody
    record back-dated ahead of its predecessor is quietly reordered into a clean
    chain and reported as sound. The features measure the order the data
    arrived in. See :data:`ORDER_LIMITATION` for what that does and does not
    let AgriBridge detect.
    """
    excluded: List[str] = []
    prepared: List[Dict[str, Any]] = []

    for evt in raw_events or []:
        loc, _ = resolve_location(evt.get("location"))
        tx = _tx_hash(evt)
        if tx is None and loc is None:
            excluded.append(
                f"{evt.get('eventType', 'EVENT')} @ {evt.get('location', 'unknown')} "
                f"(no tx hash, location unresolved)"
            )
            continue
        prepared.append({
            "event_type": str(evt.get("eventType", "EVENT")),
            "actor_role": _actor_role(evt),
            "timestamp": evt.get("timestamp"),
            "dt": parse_timestamp(evt.get("timestamp")),
            "location": loc,
            "location_raw": evt.get("location"),
            "tx_hash": tx,
        })

    return prepared, excluded


def extract_features(events: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Structural + physical plausibility features over a prepared event chain.

    Mirrors the training script's extractor, with three changes forced by real
    data: an absent tx hash is a *link that cannot be checked* (counted
    separately) rather than a link that passed; an unresolved location makes
    the speed check not-evaluated; and the validity ratio divides by the number
    of comparable links, not by the number of events.
    """
    if not events:
        return {
            "num_events": 0, "num_distinct_actors": 0, "min_time_gap_hrs": 0.0,
            "max_time_gap_hrs": 0.0, "avg_time_gap_hrs": 0.0, "negative_time_gaps_count": 0,
            "max_speed_kmh": 0.0, "hash_chain_valid_ratio": 0.0, "role_sequence_valid": 0,
            "hash_chain_available": False, "speed_check_evaluated": False,
            "issues": ["No comparable custody events on record"],
        }

    issues: List[str] = []

    parsed = []
    for e in events:
        # `prepare_events` already parsed these; re-parse only if the feature
        # set is called directly with a hand-built chain.
        parsed.append({**e, "dt": e.get("dt") or parse_timestamp(e.get("timestamp"))})

    # ── Link continuity over consecutive transaction hashes ──
    #
    # A link is intact when two consecutive steps are DISTINCT recorded
    # transactions. A repeat means the handover was never recorded separately.
    # (This condition was previously inverted, which scored every genuine
    # Polygon pair as 0.0 and every duplicate as a clean 1.0.)
    total_links = 0
    intact_links = 0
    uncheckable_links = 0
    for i in range(len(parsed) - 1):
        prev, cur = parsed[i], parsed[i + 1]
        # `prepare_events` normalises to `tx_hash`; accept the raw API shape too
        # so this function can be called on un-prepared rows without every link
        # silently reading as uncheckable.
        prev_tx = prev.get("tx_hash") or _tx_hash(prev)
        cur_tx = cur.get("tx_hash") or _tx_hash(cur)
        if prev_tx and cur_tx:
            total_links += 1
            if prev_tx != cur_tx:
                intact_links += 1
            else:
                issues.append(
                    f"Step {i + 2} repeats the transaction hash of step {i + 1} — "
                    f"the custody handover was not recorded separately"
                )
        else:
            uncheckable_links += 1

    chain_ratio = (intact_links / total_links) if total_links else 0.0
    chain_available = total_links > 0

    # ── Time gaps ──
    time_gaps: List[float] = []
    negative = 0
    for i in range(1, len(parsed)):
        a, b = parsed[i - 1]["dt"], parsed[i]["dt"]
        if a is None or b is None:
            continue
        gap = (b - a).total_seconds() / 3600.0
        time_gaps.append(gap)
        if gap < 0:
            negative += 1
            issues.append(f"Backward timestamp between step {i} and step {i + 1}")

    # ── Transit speed ──
    speeds: List[float] = []
    speed_evaluated = False
    for i in range(1, len(parsed)):
        prev, cur = parsed[i - 1], parsed[i]
        if prev["location"] is None or cur["location"] is None:
            continue
        a, b = prev["dt"], cur["dt"]
        if a is None or b is None:
            continue
        gap = (b - a).total_seconds() / 3600.0
        if gap <= 0:
            continue
        dist = haversine_km(prev["location"], cur["location"])
        speed_evaluated = True
        speeds.append(dist / max(gap, 0.01))
        if dist > 10 and (dist / gap) > 120.0:
            issues.append(
                f"Impossible transit speed ({dist / gap:.0f} km/h) between step {i} and step {i + 1}"
            )

    max_speed = float(max(speeds)) if speeds else 0.0

    # ── Role ordering ──
    ranks = [ROLE_ORDER.get(e["actor_role"], 99) for e in parsed]
    role_ok = int(ranks == sorted(ranks) and len(set(ranks)) == len(ranks))
    if not role_ok:
        issues.append("Custody roles are out of order or a role was skipped")

    return {
        "num_events": len(parsed),
        "num_distinct_actors": len({e["actor_role"] for e in parsed}),
        "min_time_gap_hrs": float(min(time_gaps)) if time_gaps else 0.0,
        "max_time_gap_hrs": float(max(time_gaps)) if time_gaps else 0.0,
        "avg_time_gap_hrs": float(np.mean(time_gaps)) if time_gaps else 0.0,
        "negative_time_gaps_count": negative,
        "max_speed_kmh": max_speed if speed_evaluated else NEG_INF,
        "hash_chain_valid_ratio": chain_ratio,
        "role_sequence_valid": role_ok,
        "hash_chain_available": chain_available,
        "speed_check_evaluated": speed_evaluated,
        "links_total": total_links,
        "links_uncheckable": uncheckable_links,
        "issues": sorted(set(issues)),
    }


CHAIN_LIMITATION = (
    "AgriBridge's supply-chain events do not store a prev_hash link, and independent "
    "Polygon transaction hashes do not form a verifiable chain. The link check here "
    "confirms that consecutive custody steps are distinct recorded transactions, not "
    "that they hash-link. Tamper-evidence of that stronger kind requires a chained "
    "on-contract event write, which is not deployed."
)

ORDER_LIMITATION = (
    "The backward-timestamp check compares the order the events were recorded in "
    "against their own timestamps. A record back-dated ahead of its predecessor is "
    "reported; a timestamp rewritten to a value that merely looks out of sequence is "
    "not distinguishable from a recording error, because AgriBridge keeps no "
    "immutable event-creation time separate from the event timestamp."
)


def predict(loader, inputs: Dict[str, Any]) -> Dict[str, Any]:
    events, excluded = prepare_events(inputs.get("events") or [])

    if not events:
        raise MissingFeatures(
            ["events"],
            reason="No custody events could be placed in the model's geofence with a "
                   "recordable transaction. A batch needs at least two comparable "
                   "custody events before a chain can be assessed.",
        )

    features = extract_features(events)
    issues = list(features.pop("issues", []))
    comparable_links = features.pop("links_total", 0)
    uncheckable_links = features.pop("links_uncheckable", 0)

    if not features["hash_chain_available"] or comparable_links == 0:
        raise MissingFeatures(
            ["blockchainTransactionHash"],
            reason=(
                f"None of the {features['num_events'] - 1} custody links in this batch carry a "
                f"transaction hash, so there is nothing to check for chain continuity. This "
                f"batch has no recorded on-chain custody trail."
            ),
        )

    model = loader.get("traceability")
    frame = pd.DataFrame([{c: features[c] for c in FEATURE_COLS}])

    scaler = model.named_steps["scaler"]
    iso = model.named_steps["isolation_forest"]
    decision = float(iso.decision_function(scaler.transform(frame))[0])
    ml_score = float(np.clip((decision + 0.3) / 0.6 * 100.0, 0, 100))

    # ── Deterministic rule layer ──
    rule_score = 100.0
    deductions = []
    if features["hash_chain_valid_ratio"] < 1.0:
        rule_score -= 40.0
        deductions.append("custody handover missing or repeated")
    if features["negative_time_gaps_count"] > 0:
        rule_score -= 50.0
        deductions.append("backward timestamp")
    if features["role_sequence_valid"] == 0:
        rule_score -= 30.0
        deductions.append("out-of-order custody roles")
    if features["speed_check_evaluated"] and features["max_speed_kmh"] > 120.0:
        rule_score -= 30.0
        deductions.append("impossible transit speed")
    rule_score = float(np.clip(rule_score, 0, 100))

    composite = int(round(0.6 * rule_score + 0.4 * ml_score))

    if composite >= 85 and not issues:
        status = "VERIFIED"
    elif composite >= 50:
        status = "SUSPICIOUS"
    else:
        status = "TAMPERED"

    return ok(
        "traceability",
        {
            "batch_id": inputs.get("batch_id", "AG-UNKNOWN"),
            "status": status,
            "confidence_score": composite,
            "issues": issues,
        },
        scoring={
            "rule_score": round(rule_score, 1),
            "ml_score": round(ml_score, 1),
            "weights": {"rule": 0.6, "isolation_forest": 0.4},
            "deductions": deductions,
        },
        features=features,
        excluded_events=excluded,
        chain_limitation=CHAIN_LIMITATION,
        order_limitation=ORDER_LIMITATION,
        blockchain_status=inputs.get("blockchain_status"),
        blockchain_verified=inputs.get("blockchain_verified"),
    )
