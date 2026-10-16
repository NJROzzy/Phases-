"""Configuration from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_ORIGINS = "https://phases-pi.vercel.app,http://localhost:8080,http://localhost:4173,http://127.0.0.1:8080"


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("PHASES_DATA", "data")).resolve())
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(o.strip() for o in os.environ.get("PHASES_CORS", DEFAULT_ORIGINS).split(",") if o.strip())
    )
    max_concurrent_runs: int = field(default_factory=lambda: int(os.environ.get("PHASES_MAX_RUNS", "2")))
    max_steps_limit: int = field(default_factory=lambda: int(os.environ.get("PHASES_MAX_STEPS", "20000")))

    @property
    def db_url(self) -> str:
        return f"sqlite:///{self.data_dir / 'phases.db'}"

    @property
    def runs_dir(self) -> Path:
        return self.data_dir / "runs"
