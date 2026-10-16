"""Command line: run experiments without the API.

    python -m phases_engine models
    python -m phases_engine schema ecosystem
    python -m phases_engine run ecosystem --seed 42 --set max_steps=500 --out runs/demo
"""

from __future__ import annotations

import argparse
import json
import sys

from . import get_model, list_models, run
from .io import frame_to_json, write_run


def _parse_sets(pairs: list[str]) -> dict:
    cfg = {}
    for pair in pairs:
        key, _, raw = pair.partition("=")
        if not _:
            raise SystemExit(f"--set expects key=value, got {pair!r}")
        try:
            cfg[key] = json.loads(raw)
        except json.JSONDecodeError:
            cfg[key] = raw
    return cfg


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="phases-engine", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("models", help="list available models")
    s = sub.add_parser("schema", help="print a model's parameter schema")
    s.add_argument("model")
    r = sub.add_parser("run", help="run one experiment")
    r.add_argument("model")
    r.add_argument("--seed", type=int, default=0)
    r.add_argument("--set", action="append", default=[], metavar="KEY=VALUE", help="override a parameter")
    r.add_argument("--config", help="JSON file with parameters")
    r.add_argument("--out", help="write run.json and metrics.csv here")
    r.add_argument("--frames", type=int, default=0, metavar="K", help="also save a frame every K steps")
    a = p.parse_args(argv)

    if a.cmd == "models":
        for m in list_models():
            print(f"{m.id}  v{m.version}  {m.name}")
        return 0
    if a.cmd == "schema":
        print(json.dumps(get_model(a.model).Config.model_json_schema(), indent=2))
        return 0

    cfg = json.load(open(a.config)) if a.config else {}
    cfg.update(_parse_sets(a.set))
    frames: list[dict] = []
    on_event = (lambda e: frames.append(frame_to_json(e["frame"])) if e["type"] == "frame" else None) if a.frames else None
    result = run(a.model, cfg, a.seed, on_event=on_event, frame_every=a.frames)
    if a.out:
        write_run(result, a.out, frames if a.frames else None)
    print(json.dumps({
        "status": result.status,
        "termination_reason": result.termination_reason,
        "steps": result.steps,
        "config_hash": result.config_hash[:12],
        "metrics_hash": result.metrics_hash[:12],
        "violations": len(result.violations),
        "wall_seconds": result.wall_seconds,
        "summary": result.summary,
    }, indent=2))
    return 1 if result.violations else 0


if __name__ == "__main__":
    sys.exit(main())
