"""Writing runs to disk in a stable, documented layout.

    <dir>/run.json       record: config, seed, hashes, environment, phase log, summary
    <dir>/metrics.csv    one row per step, one column per metric
    <dir>/frames.jsonl.gz  optional sampled frames for playback
"""

from __future__ import annotations

import base64
import csv
import gzip
import json
import math
from pathlib import Path
from typing import Iterable

import numpy as np

from .core.model import Frame
from .core.runner import RunResult


def frame_to_json(frame: Frame) -> dict:
    """Compact JSON form: agents as a flat list, the grid as base64 uint8."""
    out: dict = {
        "step": frame.step,
        "fields": list(frame.agent_fields),
        "agents": np.round(frame.agents.astype(float), 3).ravel().tolist(),
    }
    if frame.grid is not None:
        g = np.clip(frame.grid * 255, 0, 255).astype(np.uint8)
        out["grid"] = {"w": int(g.shape[1]), "h": int(g.shape[0]), "data": base64.b64encode(g.tobytes()).decode()}
    return out


def write_metrics_csv(metrics: dict[str, list[float]], path: Path) -> None:
    names = list(metrics)
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(names)
        for row in zip(*(metrics[n] for n in names)):
            w.writerow(["" if isinstance(v, float) and math.isnan(v) else (int(v) if float(v).is_integer() else repr(float(v))) for v in row])


def write_run(result: RunResult, directory: str | Path, frames: Iterable[dict] | None = None) -> Path:
    d = Path(directory)
    d.mkdir(parents=True, exist_ok=True)
    (d / "run.json").write_text(json.dumps(result.record(), indent=2, default=_json_default) + "\n")
    write_metrics_csv(result.metrics, d / "metrics.csv")
    if frames is not None:
        with gzip.open(d / "frames.jsonl.gz", "wt") as f:
            for fr in frames:
                f.write(json.dumps(fr, separators=(",", ":")) + "\n")
    return d


def _json_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if math.isnan(o) else float(o)
    raise TypeError(f"not JSON serialisable: {type(o).__name__}")
