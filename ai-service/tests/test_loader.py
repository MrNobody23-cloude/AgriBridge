"""
Tests for the digest gate and the scikit-learn version record.

These never deserialise an artifact. `pickle.load` executes code embedded in
the file, so what is under test is the part that decides whether deserialising
is allowed at all, and whether the environment the artifacts were fitted under
is knowable.

The version question has a specific history worth pinning: scikit-learn does
not stamp itself onto an estimator. An earlier `_sklearn_version` walked
`Pipeline.steps` looking for a `sklearn_version` attribute, and returned None
for all six artifacts — not because the estimator was nested somewhere
unexpected, but because the attribute does not exist. So the training version
has to be recorded out of band, and the test that matters is the one asserting
we no longer pretend to read it off the model.
"""
import agents.loader as loader_mod
from agents.loader import (
    AgentModelLoader,
    record_training_environment,
    running_sklearn,
    trained_on_sklearn,
)


# ── The version is not on the artifact ────────────────────────────────────────

class TestVersionIsNotOnTheArtifact:
    def test_an_unstamped_artifact_reports_no_version(self):
        """
        A plain object carries no version, and the loader says so rather than
        inferring one.
        """
        assert loader_mod._sklearn_version(object()) is None

    def test_no_model_is_no_version(self):
        assert loader_mod._sklearn_version(None) is None

    def test_a_stamped_artifact_reports_its_version(self):
        """What `record_training_environment` writes is what is read back."""
        class Fitted:
            pass

        stamped = record_training_environment(Fitted())
        assert loader_mod._sklearn_version(stamped) == running_sklearn()

    def test_the_stamp_survives_the_gap_between_fit_and_serve(self):
        """
        The whole point of stamping at training time: the version is readable
        later, from a different process, with no access to the training env.
        """
        class Fitted:
            pass

        stamped = record_training_environment(Fitted())
        # Round-trip through a plain attribute read, as a real unpickled
        # artifact would be — no reference to the training interpreter.
        assert stamped.sklearn_version is not None

    def test_a_slotted_estimator_that_refuses_attributes_does_not_crash(self):
        """
        Some estimators cannot take new attributes. Failing to stamp must not
        take the training run down with it — the digest file still records the
        version separately.
        """
        class Slotted:
            __slots__ = ()

        stamped = record_training_environment(Slotted())
        assert isinstance(stamped, Slotted)
        assert loader_mod._sklearn_version(stamped) is None


# ── Reading the recorded version ──────────────────────────────────────────────

class TestRecordedVersions:
    def test_unknown_agent_has_no_recorded_version(self, tmp_path, monkeypatch):
        monkeypatch.setattr(loader_mod, "DIGEST_FILE", tmp_path / "DIGESTS.json")
        assert trained_on_sklearn("nonexistent") is None

    def test_a_digest_file_without_versions_yields_none(self, tmp_path, monkeypatch):
        """
        The six artifacts on disk predate the `sklearn_version` field. Reading
        their digests must not crash and must not invent a version.
        """
        import json

        path = tmp_path / "DIGESTS.json"
        path.write_text(
            json.dumps({"models": {"quality": {"sha256": "abc", "bytes": 12}}}),
            encoding="utf-8",
        )
        monkeypatch.setattr(loader_mod, "DIGEST_FILE", path)

        assert trained_on_sklearn("quality") is None
        assert AgentModelLoader()._load_digests() == {"quality": "abc"}
        assert AgentModelLoader()._load_recorded_versions() == {}

    def test_a_recorded_version_is_read_back(self, tmp_path, monkeypatch):
        import json

        path = tmp_path / "DIGESTS.json"
        path.write_text(
            json.dumps({
                "models": {
                    "quality": {"sha256": "abc", "bytes": 12, "sklearn_version": "1.7.1"},
                    "fraud": {"sha256": "def", "bytes": 8},
                }
            }),
            encoding="utf-8",
        )
        monkeypatch.setattr(loader_mod, "DIGEST_FILE", path)

        assert trained_on_sklearn("quality") == "1.7.1"
        assert trained_on_sklearn("fraud") is None
        assert AgentModelLoader()._load_recorded_versions() == {"quality": "1.7.1"}

    def test_a_corrupt_digest_file_is_survivable(self, tmp_path, monkeypatch):
        """
        A truncated or hand-edited digests file must not stop the service from
        starting. It means the artifacts are refused, which is reported — not a
        crash at import.
        """
        path = tmp_path / "DIGESTS.json"
        path.write_text("{ this is not json", encoding="utf-8")
        monkeypatch.setattr(loader_mod, "DIGEST_FILE", path)

        ld = AgentModelLoader()
        assert ld._load_digests() == {}
        assert ld._load_recorded_versions() == {}
        assert trained_on_sklearn("quality") is None


# ── The mismatch warning ──────────────────────────────────────────────────────

class TestMismatchWarning:
    """`_check_sklearn_versions` is the check that would have caught the quality
    agent's `SimpleImputer._fill_dtype` failure at load time rather than at the
    first request. A 1.7.1-fitted artifact reconstructed under 1.8.0 still
    deserialises and still looks healthy, so nothing else would notice."""

    def _loader_with(self, trained_on, running, monkeypatch):
        monkeypatch.setattr(loader_mod, "running_sklearn", lambda: running)
        ld = AgentModelLoader()
        ld.recorded_versions = {n: trained_on for n in loader_mod.AGENT_NAMES}
        for name in loader_mod.AGENT_NAMES:
            ld.status_map[name] = {
                "agent": name, "loaded": True, "reason": "", "algorithm": "x",
                "artifact": "x", "sklearn_version": trained_on,
            }
        return ld

    def test_a_mismatch_is_warned_about(self, caplog, monkeypatch):
        ld = self._loader_with("1.7.1", "1.8.0", monkeypatch)
        with caplog.at_level("WARNING", logger="agribridge.agents.loader"):
            ld._check_sklearn_versions()

        warned = [r.getMessage() for r in caplog.records if "1.7.1" in r.getMessage()]
        assert len(warned) == len(loader_mod.AGENT_NAMES)
        # The warning has to name the version to install, not just complain.
        assert any("scikit-learn==1.7.1" in m for m in warned)

    def test_matching_versions_are_silent(self, caplog, monkeypatch):
        ld = self._loader_with("1.7.1", "1.7.1", monkeypatch)
        with caplog.at_level("WARNING", logger="agribridge.agents.loader"):
            ld._check_sklearn_versions()
        assert not [r for r in caplog.records if "class layout" in r.getMessage()]

    def test_an_unrecorded_version_is_warned_about_differently(self, caplog, monkeypatch):
        """
        Unknown is not the same as fine — and not the same as a mismatch either.
        The warning asks for the digests to be regenerated, because without the
        record there is nothing to compare against.
        """
        ld = self._loader_with(None, "1.8.0", monkeypatch)
        with caplog.at_level("WARNING", logger="agribridge.agents.loader"):
            ld._check_sklearn_versions()

        messages = [r.getMessage() for r in caplog.records]
        assert any("unrecorded scikit-learn" in m for m in messages)
        assert not any("class layout" in m for m in messages)

    def test_an_agent_that_did_not_load_is_not_warned_about(self, caplog, monkeypatch):
        """
        A version mismatch on an artifact that was never deserialised is not
        news — the agent is already reported unavailable with its own reason.
        """
        monkeypatch.setattr(loader_mod, "running_sklearn", lambda: "1.8.0")
        ld = AgentModelLoader()
        ld.recorded_versions = {"quality": "1.7.1"}
        ld.status_map["quality"] = {
            "agent": "quality", "loaded": False,
            "reason": "artifact missing", "algorithm": "x",
            "artifact": "x", "sklearn_version": "1.7.1",
        }
        with caplog.at_level("WARNING", logger="agribridge.agents.loader"):
            ld._check_sklearn_versions()
        assert not caplog.records

    def test_no_sklearn_installed_is_not_a_mismatch(self, monkeypatch):
        """A service with no scikit-learn at all has nothing to compare."""
        monkeypatch.setattr(loader_mod, "running_sklearn", lambda: None)
        ld = AgentModelLoader()
        for name in loader_mod.AGENT_NAMES:
            ld.status_map[name] = {
                "agent": name, "loaded": True, "reason": "", "algorithm": "x",
                "artifact": "x", "sklearn_version": "1.7.1",
            }
        ld._check_sklearn_versions()  # must not raise


# ── The status map ────────────────────────────────────────────────────────────

class TestStatusMap:
    def test_the_artifact_version_wins_over_the_digest_file(self, monkeypatch):
        """
        A stamp written by `record_training_environment` is per-artifact truth;
        the digest file is a fallback for artifacts that predate stamping.
        """
        ld = AgentModelLoader()
        ld.recorded_versions = {"quality": "1.7.1"}
        ld.models["quality"] = type("Fitted", (), {"sklearn_version": "1.6.2"})()

        ld._mark("quality", True, "")
        assert ld.status_map["quality"]["sklearn_version"] == "1.6.2"

    def test_the_digest_file_is_used_when_the_artifact_is_unstamped(self, monkeypatch):
        ld = AgentModelLoader()
        ld.recorded_versions = {"quality": "1.7.1"}
        ld.models["quality"] = object()

        ld._mark("quality", True, "")
        assert ld.status_map["quality"]["sklearn_version"] == "1.7.1"

    def test_nothing_recorded_stays_none(self, monkeypatch):
        """An unknown version stays null. It never becomes a plausible string."""
        ld = AgentModelLoader()
        ld.recorded_versions = {}
        ld.models["quality"] = object()

        ld._mark("quality", True, "")
        assert ld.status_map["quality"]["sklearn_version"] is None


# ── write_digests never lies about provenance ─────────────────────────────────

class TestWriteDigestsProvenance:
    def _write(self, tmp_path, monkeypatch, running, override, trained_on=None):
        import json

        monkeypatch.setattr(loader_mod, "MODEL_DIR", tmp_path)
        monkeypatch.setattr(loader_mod, "DIGEST_FILE", tmp_path / "DIGESTS.json")
        monkeypatch.setattr(loader_mod, "running_sklearn", lambda: running)

        for name in loader_mod.AGENT_NAMES:
            (tmp_path / f"{name}_model.pkl").write_bytes(b"not-really-a-pickle")

        ld = AgentModelLoader()
        ld._recorded_training_version = override
        ld.write_digests()

        with open(tmp_path / "DIGESTS.json", encoding="utf-8") as f:
            return json.load(f)

    def test_an_explicit_training_version_is_recorded_verbatim(
        self, tmp_path, monkeypatch
    ):
        """
        Artifacts trained elsewhere keep their real version. Recording the
        running one instead would claim they match this environment when they
        demonstrably do not.
        """
        out = self._write(tmp_path, monkeypatch, running="1.8.0", override="1.7.1")
        for entry in out["models"].values():
            assert entry["sklearn_version"] == "1.7.1"

    def test_without_an_override_the_running_version_is_recorded(
        self, tmp_path, monkeypatch
    ):
        """The honest default straight after a re-train in this interpreter."""
        out = self._write(tmp_path, monkeypatch, running="1.8.0", override=None)
        for entry in out["models"].values():
            assert entry["sklearn_version"] == "1.8.0"

    def test_writing_digests_does_not_deserialise(self, tmp_path, monkeypatch):
        """
        The digest step reads bytes and hashes them. It must not unpickle — that
        is the whole reason the hash gate and the load step are separate.
        """
        import pickle as _pickle

        calls = []
        real_load = _pickle.load

        def tripwire(file):
            calls.append(file)
            return real_load(file)

        monkeypatch.setattr(loader_mod.pickle, "load", tripwire)
        self._write(tmp_path, monkeypatch, running="1.8.0", override="1.7.1")
        assert calls == [], "write_digests must not deserialise anything"
