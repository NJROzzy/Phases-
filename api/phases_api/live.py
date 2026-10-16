"""Run orchestration: worker processes, event pumping and live subscribers.

    API request ──start()──▶ ProcessPoolExecutor ──worker.execute──▶ simulation
                                   │ events (manager queue)
          pump thread ◀────────────┘
             ├─▶ database (status, phase, steps, results)
             └─▶ event loop ─▶ Hub ─▶ each WebSocket subscriber

Simulations run in separate processes, so CPU-heavy runs never block the API.
"""

from __future__ import annotations

import asyncio
import multiprocessing as mp
import queue
import threading
from concurrent.futures import Future, ProcessPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy.orm import sessionmaker

from .db import Run, utcnow
from .worker import execute

STATUS = {"active": "running", "paused": "paused", "completed": "completed", "cancelled": "cancelled", "failed": "failed"}
FINAL = {"completed", "cancelled", "failed"}


@dataclass
class LiveRun:
    rows: list[dict] = field(default_factory=list)
    frame: dict | None = None
    status: str = "queued"
    phase: str = "conception"
    subscribers: set[asyncio.Queue] = field(default_factory=set)


class Hub:
    """In-memory state of active runs and their WebSocket subscribers. Loop thread only."""

    def __init__(self) -> None:
        self.runs: dict[str, LiveRun] = {}

    def open(self, run_id: str) -> None:
        self.runs.setdefault(run_id, LiveRun())

    def subscribe(self, run_id: str) -> tuple[asyncio.Queue, LiveRun | None]:
        q: asyncio.Queue = asyncio.Queue()
        live = self.runs.get(run_id)
        if live is not None:
            live.subscribers.add(q)
        return q, live

    def unsubscribe(self, run_id: str, q: asyncio.Queue) -> None:
        live = self.runs.get(run_id)
        if live is not None:
            live.subscribers.discard(q)

    def publish(self, run_id: str, event: dict) -> None:
        live = self.runs.get(run_id)
        if live is None:
            return
        kind = event["type"]
        if kind == "metrics":
            live.rows.extend(event["rows"])
        elif kind == "frame":
            live.frame = event["frame"]
        elif kind == "phase":
            live.phase = event["phase"]
            live.status = STATUS.get(event["status"], event["status"])
        for q in list(live.subscribers):
            q.put_nowait(event)
        if kind in ("done", "error"):
            self.runs.pop(run_id, None)


class RunManager:
    def __init__(self, sessions: sessionmaker, runs_dir: Path, max_workers: int, loop: asyncio.AbstractEventLoop):
        self.sessions = sessions
        self.runs_dir = runs_dir
        self.loop = loop
        self.hub = Hub()
        ctx = mp.get_context("spawn")
        self.manager = ctx.Manager()
        self.controls = self.manager.dict()
        self.executor = ProcessPoolExecutor(max_workers=max_workers, mp_context=ctx)
        self.futures: dict[str, Future] = {}

    # ------------------------------------------------------------ lifecycle
    def recover(self) -> None:
        """Runs left unfinished by a previous server process can't resume."""
        with self.sessions.begin() as s:
            for r in s.query(Run).filter(Run.status.notin_(FINAL)):
                r.status, r.phase, r.error, r.finished_at = "failed", "termination", "server restarted during run", utcnow()

    def shutdown(self) -> None:
        for run_id in list(self.futures):
            self.controls[run_id] = "cancel"
        self.executor.shutdown(wait=True, cancel_futures=True)
        self.manager.shutdown()

    # ------------------------------------------------------------ runs
    def start(self, run: Run, model_id: str, config: dict, steps_per_second: float | None) -> None:
        run_dir = self.runs_dir / run.id
        job = {
            "run_id": run.id,
            "model": model_id,
            "config": config,
            "seed": run.seed,
            "frame_every": run.frame_every,
            "steps_per_second": steps_per_second,
            "run_dir": str(run_dir),
        }
        events = self.manager.Queue()
        self.controls[run.id] = "run"
        self.hub.open(run.id)
        future = self.executor.submit(execute, job, events, self.controls)
        self.futures[run.id] = future
        threading.Thread(target=self._pump, args=(run.id, events, future), daemon=True, name=f"pump-{run.id}").start()

    def is_live(self, run_id: str) -> bool:
        return run_id in self.futures

    def control(self, run_id: str, action: str) -> str:
        """Pause, resume or cancel. Returns the resulting status."""
        future = self.futures.get(run_id)
        if future is None:
            raise LookupError("run is not active")
        if action == "cancel" and future.cancel():  # still queued: never started
            self._finish(run_id, {"status": "cancelled", "phase": "termination", "termination_reason": "cancelled", "finished_at": utcnow()})
            self.loop.call_soon_threadsafe(self.hub.publish, run_id, {"type": "done", "record": {"status": "cancelled"}})
            return "cancelled"
        self.controls[run_id] = {"pause": "pause", "resume": "run", "cancel": "cancel"}[action]
        return {"pause": "paused", "resume": "running", "cancel": "cancelling"}[action]

    # ------------------------------------------------------------ pump (thread)
    def _pump(self, run_id: str, events, future: Future) -> None:
        ended = False
        while not ended:
            try:
                event = events.get(timeout=0.5)
            except queue.Empty:
                if future.done():
                    break
                continue
            except (EOFError, OSError):
                break
            ended = self._handle(run_id, event)
            self.loop.call_soon_threadsafe(self.hub.publish, run_id, event)

        if not ended and not future.cancelled():
            exc = future.exception()
            message = f"{type(exc).__name__}: {exc}" if exc else "worker exited without a result"
            self._finish(run_id, {"status": "failed", "phase": "termination", "error": message, "finished_at": utcnow()})
            self.loop.call_soon_threadsafe(self.hub.publish, run_id, {"type": "error", "error": message})
        self.futures.pop(run_id, None)
        try:
            self.controls.pop(run_id, None)
        except (EOFError, OSError, BrokenPipeError):
            pass

    def _handle(self, run_id: str, event: dict) -> bool:
        kind = event["type"]
        if kind == "phase":
            fields: dict[str, Any] = {"phase": event["phase"]}
            status = STATUS.get(event["status"], event["status"])
            if status not in FINAL:  # final status is only set with the full record, in "done"
                fields["status"] = status
            if event["phase"] == "initialization":
                fields["started_at"] = utcnow()
            self._update(run_id, fields)
        elif kind == "metrics" and event["rows"]:
            self._update(run_id, {"steps": int(event["rows"][-1]["step"])})
        elif kind == "done":
            rec = event["record"]
            self._finish(run_id, {
                "status": rec["status"],
                "phase": "termination",
                "steps": rec["steps"],
                "termination_reason": rec["termination_reason"],
                "metrics_hash": rec["metrics_hash"],
                "summary": rec["summary"],
                "environment": rec["environment"],
                "violations": rec["violations"],
                "finished_at": rec["finished_at"],
            })
            return True
        elif kind == "error":
            self._finish(run_id, {"status": "failed", "phase": "termination", "error": event["error"], "finished_at": utcnow()})
            return True
        return False

    def _update(self, run_id: str, fields: dict) -> None:
        with self.sessions.begin() as s:
            run = s.get(Run, run_id)
            if run is not None and run.status not in FINAL:
                for k, v in fields.items():
                    setattr(run, k, v)

    def _finish(self, run_id: str, fields: dict) -> None:
        with self.sessions.begin() as s:
            run = s.get(Run, run_id)
            if run is not None:
                for k, v in fields.items():
                    setattr(run, k, v)
