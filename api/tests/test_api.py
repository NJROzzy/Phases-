import csv
import gzip
import io
import json
import time
import zipfile

from phases_engine import run as engine_run

from conftest import SMALL, wait_for

API = "/api/v1"


# ---------------------------------------------------------------- meta
def test_health_and_models(client):
    assert client.get(f"{API}/health").json()["ok"] is True
    models = client.get(f"{API}/models").json()
    eco = next(m for m in models if m["id"] == "ecosystem")
    assert "initial_population" in eco["config_schema"]["properties"]


def test_cors_allows_only_configured_origins(client):
    ok = client.get(f"{API}/health", headers={"Origin": "http://localhost:4173"})
    assert ok.headers["access-control-allow-origin"] == "http://localhost:4173"
    bad = client.get(f"{API}/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in bad.headers


# ---------------------------------------------------------------- experiments
def test_create_fills_defaults_and_hashes(client, experiment):
    assert experiment["config"]["width"] == 24
    assert experiment["config"]["metabolism"] == 0.1  # default filled in
    assert len(experiment["config_hash"]) == 64
    assert experiment["cycle_index"] == 0 and experiment["parent_id"] is None


def test_invalid_config_is_rejected(client):
    r = client.post(f"{API}/experiments", json={"title": "Bad", "config": {"metabolism": -1}})
    assert r.status_code == 422
    assert r.json()["detail"][0]["loc"] == ["metabolism"]
    assert client.post(f"{API}/experiments", json={"title": "Bad", "config": {"nope": 1}}).status_code == 422
    assert client.post(f"{API}/experiments", json={"title": "Bad", "model": "nope"}).status_code == 422
    assert client.post(f"{API}/experiments", json={"title": ""}).status_code == 422
    assert client.post(f"{API}/experiments", json={"title": "Too long", "config": {"max_steps": 9999}}).status_code == 422


def test_child_cycle_records_parameter_changes(client, experiment):
    r = client.post(f"{API}/experiments", json={
        "title": "More food", "parent_id": experiment["id"], "change_note": "Test resource limitation",
        "config": {**SMALL, "resource_regrowth": 0.3},
    })
    child = r.json()
    assert child["cycle_index"] == 1
    assert child["change_from_parent"] == {"resource_regrowth": {"from": 0.1, "to": 0.3}}
    detail = client.get(f"{API}/experiments/{experiment['id']}").json()
    assert child["id"] in detail["children"]
    assert client.post(f"{API}/experiments", json={"title": "x", "parent_id": "missing"}).status_code == 404


def test_list_experiments_newest_first(client, experiment):
    listed = client.get(f"{API}/experiments").json()
    assert listed[0]["id"] == experiment["id"]


# ---------------------------------------------------------------- runs
def test_run_completes_and_matches_the_engine(client, experiment):
    r = client.post(f"{API}/experiments/{experiment['id']}/runs", json={"steps_per_second": None, "frame_every": 10})
    assert r.status_code == 202
    run = wait_for(client, r.json()["id"])
    assert run["status"] == "completed" and run["phase"] == "termination"
    assert run["violations"] == []
    assert run["environment"]["engine_version"]
    # The API's result is the same replay as running the engine directly
    direct = engine_run("ecosystem", experiment["config"], 7)
    assert run["metrics_hash"] == direct.metrics_hash

    series = client.get(f"{API}/runs/{run['id']}/metrics").json()["series"]
    assert len(series["population"]) == run["steps"] + 1
    text = client.get(f"{API}/runs/{run['id']}/metrics?format=csv").text
    assert list(csv.DictReader(io.StringIO(text)))[0]["step"] == "0"

    frames = client.get(f"{API}/runs/{run['id']}/frames?from=10&to=40").json()["frames"]
    assert [f["step"] for f in frames] == [10, 20, 30, 40]


def test_bundle_contains_a_reproducible_record(client, experiment):
    run_id = client.post(f"{API}/experiments/{experiment['id']}/runs", json={"steps_per_second": None}).json()["id"]
    wait_for(client, run_id)
    r = client.get(f"{API}/runs/{run_id}/bundle")
    assert r.headers["content-type"] == "application/zip"
    z = zipfile.ZipFile(io.BytesIO(r.content))
    assert {"experiment.json", "run.json", "metrics.csv", "frames.jsonl.gz", "README.md", "run_status.json"} <= set(z.namelist())
    record = json.loads(z.read("run.json"))
    assert record["seed"] == 7 and record["config_hash"] == experiment["config_hash"]
    assert json.loads(gzip.decompress(z.read("frames.jsonl.gz")).splitlines()[0])["step"] == 0


def test_seed_override(client, experiment):
    a = client.post(f"{API}/experiments/{experiment['id']}/runs", json={"seed": 99, "steps_per_second": None}).json()
    done = wait_for(client, a["id"])
    assert done["seed"] == 99
    assert done["metrics_hash"] == engine_run("ecosystem", experiment["config"], 99).metrics_hash


def test_pause_resume_and_cancel(client):
    exp = client.post(f"{API}/experiments", json={"title": "Long", "config": {**SMALL, "max_steps": 5000}}).json()
    run_id = client.post(f"{API}/experiments/{exp['id']}/runs", json={"steps_per_second": 200}).json()["id"]
    wait_for(client, run_id, statuses=("running",))

    assert client.post(f"{API}/runs/{run_id}/pause").json()["status"] == "paused"
    wait_for(client, run_id, statuses=("paused",))
    held = client.get(f"{API}/runs/{run_id}").json()["steps"]
    time.sleep(0.4)
    assert client.get(f"{API}/runs/{run_id}").json()["steps"] == held

    client.post(f"{API}/runs/{run_id}/resume")
    wait_for(client, run_id, statuses=("running",))
    client.post(f"{API}/runs/{run_id}/cancel")
    run = wait_for(client, run_id)
    assert run["status"] == "cancelled" and run["termination_reason"] == "cancelled"
    assert client.post(f"{API}/runs/{run_id}/pause").status_code == 409


def test_unknown_ids(client):
    assert client.get(f"{API}/runs/nope").status_code == 404
    assert client.get(f"{API}/experiments/nope").status_code == 404
    assert client.post(f"{API}/experiments/nope/runs").status_code == 404


def test_bad_run_options(client, experiment):
    assert client.post(f"{API}/experiments/{experiment['id']}/runs", json={"frame_every": 0}).status_code == 422
    assert client.post(f"{API}/experiments/{experiment['id']}/runs", json={"speed": 1}).status_code == 422


# ---------------------------------------------------------------- websocket
def test_websocket_streams_the_whole_lifecycle(client, experiment):
    run_id = client.post(f"{API}/experiments/{experiment['id']}/runs", json={"steps_per_second": 100, "frame_every": 10}).json()["id"]
    phases, steps, frames = [], [], 0
    with client.websocket_connect(f"/ws/runs/{run_id}") as ws:
        hello = ws.receive_json()
        assert hello["type"] == "hello" and hello["run"]["id"] == run_id
        steps += [r["step"] for r in hello["rows"]]
        frames += hello["frame"] is not None
        while True:
            e = ws.receive_json()
            if e["type"] == "phase":
                phases.append(e["phase"])
            elif e["type"] == "metrics":
                steps += [r["step"] for r in e["rows"]]
            elif e["type"] == "frame":
                frames += 1
                assert len(e["frame"]["agents"]) % len(e["frame"]["fields"]) == 0
            elif e["type"] == "done":
                record = e["record"]
                break
    assert record["status"] == "completed"
    assert phases[-3:] == ["emergence", "observation", "termination"]
    assert steps == list(range(steps[0], 61))  # no gaps or duplicates
    assert frames >= 3


def test_websocket_for_finished_and_missing_runs(client, experiment):
    run_id = client.post(f"{API}/experiments/{experiment['id']}/runs", json={"steps_per_second": None}).json()["id"]
    wait_for(client, run_id)
    with client.websocket_connect(f"/ws/runs/{run_id}") as ws:
        hello = ws.receive_json()
        assert hello["run"]["status"] == "completed"
    with client.websocket_connect("/ws/runs/nope") as ws:
        try:
            ws.receive_json()
            raise AssertionError("expected close")
        except Exception as e:
            assert getattr(e, "code", None) == 4404


def test_api_stays_responsive_during_runs(client):
    exp = client.post(f"{API}/experiments", json={"title": "Busy", "config": {**SMALL, "max_steps": 3000, "initial_population": 200, "width": 64, "height": 64}}).json()
    ids = [client.post(f"{API}/experiments/{exp['id']}/runs", json={"steps_per_second": None}).json()["id"] for _ in range(2)]
    wait_for(client, ids[0], statuses=("running",))
    t = time.perf_counter()
    for _ in range(20):
        assert client.get(f"{API}/health").status_code == 200
    assert (time.perf_counter() - t) / 20 < 0.05
    for i in ids:
        client.post(f"{API}/runs/{i}/cancel")
        wait_for(client, i)
