"""Reproducibility helpers: canonical hashes and environment capture."""

from __future__ import annotations

import hashlib
import json
import math
import platform
import subprocess
import sys
from importlib import metadata
from pathlib import Path
from typing import Any

import numpy as np


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def config_hash(model_id: str, model_version: str, config: dict) -> str:
    """Identifies a configuration exactly, independent of key order."""
    payload = canonical_json({"model": model_id, "version": model_version, "config": config})
    return hashlib.sha256(payload.encode()).hexdigest()


def _fmt(v: float) -> str:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "nan"
    return format(float(v), ".10g")


def metrics_hash(metrics: dict[str, np.ndarray]) -> str:
    """Fingerprint of a run's outputs. Equal hashes mean an identical replay.

    Values are formatted to 10 significant digits so the hash is stable across
    platforms that differ only in the last floating-point bits.
    """
    h = hashlib.sha256()
    for name in sorted(metrics):
        h.update(name.encode())
        h.update(",".join(_fmt(v) for v in metrics[name]).encode())
    return h.hexdigest()


def _version(pkg: str) -> str | None:
    try:
        return metadata.version(pkg)
    except metadata.PackageNotFoundError:
        return None


def _git_commit() -> str | None:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=Path(__file__).parent, capture_output=True, text=True, timeout=2
        )
        return out.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def environment() -> dict[str, Any]:
    from .. import __version__

    return {
        "engine_version": __version__,
        "python": sys.version.split()[0],
        "numpy": np.__version__,
        "scipy": _version("scipy"),
        "pydantic": _version("pydantic"),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "git_commit": _git_commit(),
    }
