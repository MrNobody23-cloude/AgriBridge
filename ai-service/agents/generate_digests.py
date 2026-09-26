"""
Record the SHA-256 of every agent artifact so the loader can verify it.

    python agents/generate_digests.py            # write/refresh DIGESTS.json
    python agents/generate_digests.py --check    # verify only, write nothing

This script reads bytes and hashes them. It does **not** deserialise anything —
`pickle.load` executes code embedded in the file, so the digest step stays
entirely separate from the load step. Run this once after adding or replacing
an artifact, and commit the resulting DIGESTS.json: a model file whose digest
is not recorded will be refused at startup, which is the intended behaviour for
an artifact whose provenance nobody has vouched for.
"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = Path(os.getenv("AGENT_MODEL_DIR", str(SERVICE_ROOT / "models" / "agents")))
DIGEST_FILE = MODEL_DIR / "DIGESTS.json"

AGENT_NAMES = ["traceability", "quality", "spoilage", "fraud", "compliance", "trust"]


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _digests() -> dict:
    """DIGESTS.json as a mapping, or empty if absent or unreadable."""
    if not DIGEST_FILE.exists():
        return {}
    try:
        with open(DIGEST_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        print(f"warning: could not read {DIGEST_FILE}: {exc}", file=sys.stderr)
        return {}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check", action="store_true",
        help="verify artifacts against the recorded digests instead of writing them",
    )
    parser.add_argument(
        "--trained-on", metavar="X.Y.Z", default=None,
        help=(
            "record these artifacts as having been fitted on scikit-learn X.Y.Z. "
            "Required whenever the artifacts were not trained in this interpreter: "
            "without it the running version is recorded, which silently claims the "
            "artifacts match the current environment even when they do not."
        ),
    )
    args = parser.parse_args()

    recorded = {
        k: v["sha256"] for k, v in _digests().get("models", {}).items()
        if "sha256" in v
    }

    if args.check:
        failures = 0
        for name in AGENT_NAMES:
            path = MODEL_DIR / f"{name}_model.pkl"
            if not path.exists():
                print(f"MISSING  {name}: no artifact at {path}")
                failures += 1
                continue
            expected = recorded.get(name)
            if expected is None:
                print(f"NO DIGEST  {name}: not recorded — the loader will refuse this artifact")
                failures += 1
                continue
            actual = sha256_of(path)
            if actual == expected:
                print(f"OK       {name}  {actual[:16]}…")
            else:
                print(f"MISMATCH {name}  recorded {expected[:16]}… got {actual[:16]}…")
                failures += 1

        print(f"\n{len(AGENT_NAMES) - failures}/{len(AGENT_NAMES)} artifacts verified")

        # A verified digest only proves the bytes are the ones that were
        # recorded. It says nothing about whether they can be reconstructed
        # under the scikit-learn now installed, which is a separate failure and
        # the one that actually bites — the artifact loads fine and then raises
        # on the first prediction.
        try:
            import sklearn
            running = sklearn.__version__
        except Exception:
            running = None
        versions = {
            k: v.get("sklearn_version")
            for k, v in _digests().get("models", {}).items()
        }
        unrecorded = sorted(k for k, v in versions.items() if not v)
        skewed = sorted(
            k for k, v in versions.items() if v and running and v != running
        )
        if running:
            print(f"running scikit-learn: {running}")
        if skewed:
            print(
                f"\nWARNING: {len(skewed)} artifact(s) were fitted on a different "
                f"scikit-learn than this interpreter runs: {', '.join(skewed)}.\n"
                f"A pickle stores the class layout of the version that fitted it — "
                f"install scikit-learn=={versions[skewed[0]]}, or re-train and re-run "
                f"this script."
            )
        if unrecorded:
            print(
                f"\nnote: {len(unrecorded)} artifact(s) have no recorded training "
                f"version ({', '.join(unrecorded)}); a version skew cannot be "
                f"detected for them."
            )
        return 1 if failures else 0

    try:
        import sklearn
        running = sklearn.__version__
    except Exception:
        running = None
    recorded_version = args.trained_on or running
    if not args.trained_on and running:
        print(
            f"note: no --trained-on given, recording the running scikit-learn {running}. "
            f"Pass --trained-on X.Y.Z if these artifacts were fitted elsewhere."
        )

    out = {
        "models": {},
        "note": (
            "sklearn_version is the scikit-learn these artifacts were fitted under. "
            "The loader warns when it differs from the running version, because a "
            "pickle stores the class layout of the version that fitted it."
        ),
    }
    for name in AGENT_NAMES:
        path = MODEL_DIR / f"{name}_model.pkl"
        if not path.exists():
            print(f"skipped {name}: no artifact at {path}")
            continue
        out["models"][name] = {"sha256": sha256_of(path), "bytes": path.stat().st_size}
        if recorded_version:
            out["models"][name]["sklearn_version"] = recorded_version
        print(f"recorded {name}  {out['models'][name]['sha256'][:16]}…")

    if not out["models"]:
        print(f"No artifacts found under {MODEL_DIR}", file=sys.stderr)
        return 1

    if running and recorded_version and running != recorded_version:
        print(
            f"\nWARNING: these artifacts are recorded as scikit-learn {recorded_version} "
            f"but this interpreter runs {running}. A pickle stores the class layout of "
            f"the version that fitted it — install {recorded_version}, or re-train and "
            f"re-run this script."
        )

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    tmp = DIGEST_FILE.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    os.replace(tmp, DIGEST_FILE)
    print(f"\nWrote {len(out['models'])} digest(s) -> {DIGEST_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
