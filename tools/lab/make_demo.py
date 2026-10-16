"""Record the demo run the Lab replays when no API is reachable.

    .venv/bin/python tools/lab/make_demo.py

Writes lab/demo/ecosystem.json: a real engine run (experiment, run record,
every metric, and sampled frames). Re-run it after changing the model.
"""

import json
import math
from pathlib import Path

import numpy as np

from phases_engine import get_model, run
from phases_engine.io import frame_to_json

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "lab" / "demo" / "ecosystem.json"

TITLE = "Do boom–bust cycles appear?"
HYPOTHESIS = (
    "With logistic resource regrowth, the forager population overshoots what the "
    "resource can sustain and then crashes, producing repeated boom–bust oscillations "
    "rather than settling at a steady size."
)
CONFIG = {"width": 48, "height": 48, "initial_population": 120, "max_steps": 600}
SEED = 2026
FRAME_EVERY = 5


def scrub(v):
    if isinstance(v, float):
        return v if math.isfinite(v) else None
    if isinstance(v, dict):
        return {k: scrub(x) for k, x in v.items()}
    if isinstance(v, list):
        return [scrub(x) for x in v]
    return v


def main():
    frames = []

    def on_event(e):
        if e["type"] == "frame":
            f = e["frame"]
            f.agents = f.agents[:, :3]  # x, y, energy keep the demo small
            f.agent_fields = f.agent_fields[:3]
            fr = frame_to_json(f)
            fr["agents"] = [round(a, 1) for a in fr["agents"]]
            frames.append(fr)

    result = run("ecosystem", CONFIG, SEED, on_event=on_event, frame_every=FRAME_EVERY)
    model = get_model("ecosystem")
    record = result.record()
    demo = {
        "experiment": {
            "id": "demo",
            "title": TITLE,
            "hypothesis": HYPOTHESIS,
            "model_id": model.id,
            "model_version": model.version,
            "config": result.config,
            "config_hash": result.config_hash,
            "seed": SEED,
            "parent_id": None,
            "cycle_index": 0,
            "change_from_parent": None,
            "change_note": "",
            "change_origin": "human",
            "engine_version": record["environment"]["engine_version"],
            "created_at": record["started_at"],
        },
        "run": {
            "id": "demo",
            "experiment_id": "demo",
            "seed": SEED,
            "status": record["status"],
            "phase": "termination",
            "steps": record["steps"],
            "termination_reason": record["termination_reason"],
            "metrics_hash": record["metrics_hash"],
            "summary": record["summary"],
            "environment": record["environment"],
            "violations": record["violations"],
            "frame_every": FRAME_EVERY,
            "phase_log": record["phase_log"],
        },
        "model": model.describe(),
        "series": {k: [None if (isinstance(x, float) and math.isnan(x)) else x for x in v] for k, v in result.metrics.items()},
        "frames": frames,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(scrub(demo), separators=(",", ":")))
    pop = np.array(result.metrics["population"])
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1e6:.2f} MB): {result.steps} steps, "
          f"{len(frames)} frames, population {pop.min():.0f}-{pop.max():.0f}, violations {len(result.violations)}")


if __name__ == "__main__":
    main()
