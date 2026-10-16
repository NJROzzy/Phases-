import csv
import gzip
import json

import numpy as np

from phases_engine.analysis.spatial import clark_evans
from phases_engine.cli import main


def test_clark_evans_random_points_are_near_one():
    rng = np.random.default_rng(0)
    values = [clark_evans(rng.uniform(0, 100, 400), rng.uniform(0, 100, 400), 100, 100) for _ in range(20)]
    assert 0.95 < np.mean(values) < 1.05


def test_clark_evans_detects_clusters_and_regular_spacing():
    rng = np.random.default_rng(1)
    centres = rng.uniform(0, 100, (10, 2))
    pts = np.repeat(centres, 40, axis=0) + rng.normal(0, 1, (400, 2))
    assert clark_evans(pts[:, 0], pts[:, 1], 100, 100) < 0.5
    gx, gy = np.meshgrid(np.arange(0, 100, 5), np.arange(0, 100, 5))
    assert clark_evans(gx.ravel() + 0.0, gy.ravel() + 0.0, 100, 100) > 1.9


def test_clark_evans_needs_two_points():
    assert np.isnan(clark_evans(np.array([1.0]), np.array([1.0]), 10, 10))


def test_cli_writes_a_reproducible_run(tmp_path, capsys):
    out = tmp_path / "run"
    assert main(["run", "ecosystem", "--seed", "3", "--set", "max_steps=40", "--set", "width=16", "--set", "height=16", "--out", str(out), "--frames", "10"]) == 0
    record = json.loads((out / "run.json").read_text())
    assert record["seed"] == 3 and record["config"]["max_steps"] == 40
    rows = list(csv.DictReader(open(out / "metrics.csv")))
    assert len(rows) == record["steps"] + 1
    assert rows[0]["step"] == "0"
    frames = [json.loads(line) for line in gzip.open(out / "frames.jsonl.gz", "rt")]
    assert [f["step"] for f in frames] == [0, 10, 20, 30, 40][: len(frames)]
    assert frames[0]["grid"]["w"] == 16

    # Re-running from the saved config gives the same fingerprint
    (tmp_path / "cfg.json").write_text(json.dumps(record["config"]))
    main(["run", "ecosystem", "--seed", "3", "--config", str(tmp_path / "cfg.json")])
    assert json.loads(capsys.readouterr().out.split("\n}\n")[-2] + "\n}")["metrics_hash"] == record["metrics_hash"][:12]
