"""Runs one experiment through all six phases.

    run("ecosystem", {"max_steps": 500}, seed=42) -> RunResult

The runner owns the random generator (PCG64, seeded) and passes it to the
model; models never create their own randomness. Observation happens after
every step but never touches that generator, so how often you watch a run
cannot change its outcome.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

import numpy as np

from .lifecycle import Lifecycle, Phase, Status, utcnow
from .model import Model, ModelConfig
from .record import config_hash, environment, metrics_hash
from .registry import get_model

Event = dict[str, Any]


class RunControl(Protocol):
    """Lets a caller (e.g. the API) pause or cancel a run between steps."""

    def cancelled(self) -> bool: ...

    def paused(self) -> bool: ...


@dataclass
class RunResult:
    model_id: str
    model_version: str
    config: dict
    config_hash: str
    seed: int
    status: str
    termination_reason: str | None
    steps: int
    metrics: dict[str, list[float]]
    summary: dict[str, Any]
    findings: list[dict]
    violations: list[str]
    metrics_hash: str
    phase_log: list[dict]
    environment: dict[str, Any]
    started_at: str
    finished_at: str
    wall_seconds: float
    extra: dict[str, Any] = field(default_factory=dict)

    def record(self) -> dict[str, Any]:
        """Everything except the bulky metric series (those go to CSV)."""
        d = {k: v for k, v in self.__dict__.items() if k != "metrics"}
        d["metric_names"] = list(self.metrics)
        return d


def _clean(v: float) -> float:
    v = float(v)
    return v if math.isfinite(v) else float("nan")


def run(
    model: str | Model,
    config: dict | ModelConfig | None = None,
    seed: int = 0,
    *,
    on_event: Callable[[Event], None] | None = None,
    control: RunControl | None = None,
    frame_every: int = 0,
    check_invariants: bool = True,
    max_violations: int = 20,
) -> RunResult:
    model = get_model(model) if isinstance(model, str) else model
    emit = on_event or (lambda e: None)
    life = Lifecycle()
    started_at = utcnow()
    t0 = time.perf_counter()

    def phase(p: Phase) -> None:
        life.advance(p)
        emit({"type": "phase", "phase": p.value, "status": life.status.value})

    # ---- Conception: validate the parameters θ and fix the identity of the experiment
    cfg = config if isinstance(config, model.Config) else model.Config.model_validate(config or {})
    cfg_dict = cfg.model_dump(mode="json")
    chash = config_hash(model.id, model.version, cfg_dict)
    emit({"type": "phase", "phase": Phase.CONCEPTION.value, "status": life.status.value, "config_hash": chash})

    metrics: dict[str, list[float]] = {}
    violations: list[str] = []
    reason: str | None = None

    def observe(state: Any, step: int) -> None:
        values = {k: _clean(v) for k, v in model.observe(state, cfg).items()}
        metrics.setdefault("step", []).append(step)
        for k, v in values.items():
            metrics.setdefault(k, []).append(v)
        emit({"type": "metrics", "step": step, "values": values})
        if frame_every and step % frame_every == 0:
            emit({"type": "frame", "frame": model.frame(state, cfg)})

    try:
        # ---- Initialization
        phase(Phase.INITIALIZATION)
        rng = np.random.Generator(np.random.PCG64(seed))
        state = model.init(cfg, rng)
        observe(state, 0)

        # ---- Execution
        phase(Phase.EXECUTION)
        step = 0
        while True:
            if control is not None:
                if control.cancelled():
                    life.end(Status.CANCELLED, "cancelled by user")
                    reason = "cancelled"
                    break
                if control.paused():
                    if life.status is Status.ACTIVE:
                        life.pause()
                        emit({"type": "phase", "phase": life.phase.value, "status": life.status.value})
                    time.sleep(0.05)
                    continue
                if life.status is Status.PAUSED:
                    life.resume()
                    emit({"type": "phase", "phase": life.phase.value, "status": life.status.value})

            reason = model.terminated(state, cfg)
            if reason is None and step >= cfg.max_steps:
                reason = "max_steps"
            if reason:
                break

            state = model.step(state, cfg, rng)
            step += 1
            observe(state, step)

            if check_invariants and len(violations) < max_violations:
                for v in model.check(state, cfg):
                    violations.append(f"step {step}: {v}")

        series = {k: np.asarray(v, dtype=float) for k, v in metrics.items()}
        summary: dict[str, Any] = {}
        findings: list[dict] = []

        if not life.finished:
            # ---- Emergence: detectors are added in a later release; none are
            # registered yet, so no pattern is ever claimed without evidence.
            phase(Phase.EMERGENCE)
            # ---- Observation
            phase(Phase.OBSERVATION)
            summary = model.summarize(series, cfg)
            # ---- Termination
            phase(Phase.TERMINATION)
    except Exception as exc:  # the run fails; the record says why
        if not life.finished:
            life.end(Status.FAILED, f"{type(exc).__name__}: {exc}")
        emit({"type": "phase", "phase": life.phase.value, "status": life.status.value, "reason": life.reason})
        raise

    if life.status is Status.CANCELLED:
        emit({"type": "phase", "phase": life.phase.value, "status": life.status.value, "reason": life.reason})

    result = RunResult(
        model_id=model.id,
        model_version=model.version,
        config=cfg_dict,
        config_hash=chash,
        seed=seed,
        status=life.status.value,
        termination_reason=reason,
        steps=int(metrics["step"][-1]) if metrics.get("step") else 0,
        metrics=metrics,
        summary=summary,
        findings=findings,
        violations=violations,
        metrics_hash=metrics_hash(series),
        phase_log=life.log,
        environment=environment(),
        started_at=started_at,
        finished_at=utcnow(),
        wall_seconds=round(time.perf_counter() - t0, 4),
    )
    emit({"type": "done", "record": result.record()})
    return result
