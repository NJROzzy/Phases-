"""Runs one simulation inside a worker process.

The worker never touches the database. It streams JSON-ready events through a
queue and writes the run's files; the API process does the rest. Pacing (for
watchable live runs) only delays events and never changes the simulation.
"""

from __future__ import annotations

import math
import time
from typing import Any

from phases_engine import run
from phases_engine.io import frame_to_json, write_run

FLUSH_SECONDS = 0.1


def scrub(obj: Any) -> Any:
    """Replace NaN/inf with None so every event is valid JSON."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: scrub(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [scrub(v) for v in obj]
    return obj


class _Control:
    def __init__(self, controls, run_id: str):
        self.controls, self.run_id = controls, run_id

    def cancelled(self) -> bool:
        return self.controls.get(self.run_id) == "cancel"

    def paused(self) -> bool:
        return self.controls.get(self.run_id) == "pause"


def execute(job: dict, events, controls) -> dict:
    run_id = job["run_id"]
    sps = job.get("steps_per_second")
    frames: list[dict] = []
    batch: list[dict] = []
    clock = {"last_flush": time.monotonic(), "t0": None}

    def flush() -> None:
        if batch:
            events.put({"type": "metrics", "rows": scrub(batch)})
            batch.clear()
        clock["last_flush"] = time.monotonic()

    def pace(step: int) -> None:
        now = time.monotonic()
        if clock["t0"] is None or now - (clock["t0"] + step / sps) > 0.25:
            clock["t0"] = now - step / sps  # (re)start the clock, e.g. after a pause
        wait = clock["t0"] + step / sps - now
        if wait > 0:
            time.sleep(wait)

    def on_event(e: dict) -> None:
        kind = e["type"]
        if kind == "metrics":
            batch.append({"step": e["step"], **e["values"]})
            if sps:
                pace(e["step"])
            if time.monotonic() - clock["last_flush"] >= FLUSH_SECONDS:
                flush()
        elif kind == "frame":
            frame = frame_to_json(e["frame"])
            frames.append(frame)
            flush()
            events.put({"type": "frame", "frame": frame})
        elif kind == "phase":
            flush()
            events.put(scrub(e))
        elif kind == "done":
            flush()

    try:
        result = run(
            job["model"], job["config"], job["seed"],
            on_event=on_event, control=_Control(controls, run_id), frame_every=job["frame_every"],
        )
        write_run(result, job["run_dir"], frames)
        record = scrub(result.record())
        events.put({"type": "done", "record": record})
        return record
    except Exception as exc:
        flush()
        events.put({"type": "error", "error": f"{type(exc).__name__}: {exc}"})
        raise
