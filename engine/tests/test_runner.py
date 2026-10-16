"""Reproducibility and run-control guarantees."""

import numpy as np
import pytest
from pydantic import ValidationError

from phases_engine import Phase, run

SHORT = {"max_steps": 150, "width": 32, "height": 32, "initial_population": 60}


def test_same_seed_reproduces_exactly():
    a = run("ecosystem", SHORT, seed=11)
    b = run("ecosystem", SHORT, seed=11)
    assert a.metrics_hash == b.metrics_hash
    for name in a.metrics:
        np.testing.assert_array_equal(a.metrics[name], b.metrics[name])


def test_different_seeds_differ():
    assert run("ecosystem", SHORT, seed=1).metrics_hash != run("ecosystem", SHORT, seed=2).metrics_hash


def test_watching_a_run_does_not_change_it():
    """Frames and events are pure observation: they must not touch the rng."""
    events = []
    watched = run("ecosystem", SHORT, seed=5, on_event=events.append, frame_every=1)
    plain = run("ecosystem", SHORT, seed=5)
    assert watched.metrics_hash == plain.metrics_hash
    assert sum(e["type"] == "frame" for e in events) == watched.steps + 1


def test_config_hash_ignores_key_order_but_not_values():
    a = run("ecosystem", {"max_steps": 5, "width": 16, "height": 16}, 0)
    b = run("ecosystem", {"height": 16, "width": 16, "max_steps": 5}, 0)
    c = run("ecosystem", {"height": 16, "width": 17, "max_steps": 5}, 0)
    assert a.config_hash == b.config_hash != c.config_hash


def test_phase_events_follow_the_lifecycle():
    phases = []
    run("ecosystem", SHORT, 0, on_event=lambda e: e["type"] == "phase" and phases.append(e["phase"]))
    assert phases == [p.value for p in Phase]


def test_record_contains_reproducibility_fields():
    r = run("ecosystem", SHORT, seed=3)
    rec = r.record()
    for key in ("config", "config_hash", "seed", "metrics_hash", "environment", "phase_log", "started_at", "finished_at", "model_version"):
        assert rec[key] is not None
    assert rec["environment"]["numpy"]
    assert "metrics" not in rec and "population" in rec["metric_names"]


class Control:
    def __init__(self, cancel_at=None):
        self.cancel_at, self.steps = cancel_at, 0

    def cancelled(self):
        self.steps += 1
        return self.cancel_at is not None and self.steps > self.cancel_at

    def paused(self):
        return False


def test_cancel_stops_the_run_and_records_why():
    r = run("ecosystem", {**SHORT, "max_steps": 1000}, 0, control=Control(cancel_at=20))
    assert r.status == "cancelled"
    assert r.termination_reason == "cancelled"
    assert r.steps == 20
    assert r.phase_log[-1]["reason"] == "cancelled by user"


class PauseOnce:
    def __init__(self):
        self.calls = 0

    def cancelled(self):
        return False

    def paused(self):
        self.calls += 1
        return 10 <= self.calls < 13


def test_pause_and_resume_do_not_change_results():
    paused = run("ecosystem", SHORT, 9, control=PauseOnce())
    assert paused.metrics_hash == run("ecosystem", SHORT, 9).metrics_hash
    statuses = [e["status"] for e in paused.phase_log]
    assert "paused" in statuses and statuses[-1] == "completed"


def test_invalid_config_is_rejected_before_running():
    with pytest.raises(ValidationError):
        run("ecosystem", {"metabolism": -1})
    with pytest.raises(ValidationError):
        run("ecosystem", {"not_a_parameter": 1})


def test_unknown_model():
    with pytest.raises(KeyError):
        run("no-such-model")
