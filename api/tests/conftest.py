import time

import pytest
from fastapi.testclient import TestClient

from phases_api.app import create_app
from phases_api.settings import Settings

SMALL = {"width": 24, "height": 24, "initial_population": 40, "max_steps": 60}


@pytest.fixture(scope="session")
def client(tmp_path_factory):
    settings = Settings(data_dir=tmp_path_factory.mktemp("data"), cors_origins=("http://localhost:4173",), max_concurrent_runs=2, max_steps_limit=5000)
    with TestClient(create_app(settings)) as c:
        c.settings = settings
        yield c


@pytest.fixture
def experiment(client):
    r = client.post("/api/v1/experiments", json={"title": "Small world", "hypothesis": "Agents persist", "config": SMALL, "seed": 7})
    assert r.status_code == 201, r.text
    return r.json()


def wait_for(client, run_id, statuses=("completed", "cancelled", "failed"), timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = client.get(f"/api/v1/runs/{run_id}").json()
        if run["status"] in statuses:
            return run
        time.sleep(0.05)
    raise AssertionError(f"run {run_id} still {run['status']} after {timeout}s")
