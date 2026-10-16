"""The six-phase experiment lifecycle as an explicit state machine.

Phases only move forward, one at a time:

    conception → initialization → execution → emergence → observation → termination

`status` is orthogonal to the phase: a run can be paused (only during
execution), or end early as cancelled or failed, which jumps straight to
termination. Every change is timestamped so the record shows exactly how the
experiment moved through its life.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum


class Phase(str, Enum):
    CONCEPTION = "conception"
    INITIALIZATION = "initialization"
    EXECUTION = "execution"
    EMERGENCE = "emergence"
    OBSERVATION = "observation"
    TERMINATION = "termination"


PHASE_ORDER = list(Phase)


class Status(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


FINAL = {Status.COMPLETED, Status.CANCELLED, Status.FAILED}


class InvalidTransition(Exception):
    """Raised when a lifecycle change would break the phase rules."""


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass
class Lifecycle:
    phase: Phase = Phase.CONCEPTION
    status: Status = Status.ACTIVE
    reason: str | None = None
    log: list[dict] = field(default_factory=lambda: [{"phase": Phase.CONCEPTION.value, "status": Status.ACTIVE.value, "at": utcnow()}])

    @property
    def finished(self) -> bool:
        return self.status in FINAL

    def _record(self) -> None:
        entry = {"phase": self.phase.value, "status": self.status.value, "at": utcnow()}
        if self.reason:
            entry["reason"] = self.reason
        self.log.append(entry)

    def advance(self, to: Phase) -> None:
        if self.finished:
            raise InvalidTransition(f"run already {self.status.value}")
        if self.status is Status.PAUSED:
            raise InvalidTransition("resume before advancing")
        current = PHASE_ORDER.index(self.phase)
        if PHASE_ORDER.index(to) != current + 1:
            raise InvalidTransition(f"cannot go from {self.phase.value} to {to.value}")
        self.phase = to
        if to is Phase.TERMINATION:
            self.status = Status.COMPLETED
        self._record()

    def pause(self) -> None:
        if self.phase is not Phase.EXECUTION or self.status is not Status.ACTIVE:
            raise InvalidTransition("can only pause an active execution")
        self.status = Status.PAUSED
        self._record()

    def resume(self) -> None:
        if self.status is not Status.PAUSED:
            raise InvalidTransition("run is not paused")
        self.status = Status.ACTIVE
        self._record()

    def end(self, status: Status, reason: str) -> None:
        """End early (cancelled or failed): jump straight to termination."""
        if status not in (Status.CANCELLED, Status.FAILED):
            raise InvalidTransition("use advance() to complete normally")
        if self.finished:
            raise InvalidTransition(f"run already {self.status.value}")
        self.phase = Phase.TERMINATION
        self.status = status
        self.reason = reason
        self._record()
