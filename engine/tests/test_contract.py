"""Every registered model must honour the plugin contract."""

import json
import math

import numpy as np
import pytest

from phases_engine import list_models, run


@pytest.mark.parametrize("model_cls", list_models(), ids=lambda m: m.id)
def test_model_contract(model_cls):
    model = model_cls()
    info = model.describe()
    assert info["id"] and info["version"] and info["name"]
    json.dumps(info["config_schema"])  # the UI builds its form from this

    cfg = model.Config()
    rng = np.random.Generator(np.random.PCG64(0))
    state = model.init(cfg, rng)
    for _ in range(20):
        if model.terminated(state, cfg):
            break
        state = model.step(state, cfg, rng)
        assert model.check(state, cfg) == []
        values = model.observe(state, cfg)
        assert values and all(isinstance(v, (int, float)) for v in values.values())
        fr = model.frame(state, cfg)
        assert fr.agents.ndim == 2 and fr.agents.shape[1] == len(fr.agent_fields)


@pytest.mark.parametrize("model_cls", list_models(), ids=lambda m: m.id)
def test_observe_does_not_consume_randomness(model_cls):
    model = model_cls()
    cfg = model.Config()
    rng = np.random.Generator(np.random.PCG64(0))
    state = model.step(model.init(cfg, rng), cfg, rng)
    before = rng.bit_generator.state
    model.observe(state, cfg)
    model.frame(state, cfg)
    assert rng.bit_generator.state == before


def test_summary_is_json_serialisable():
    r = run("ecosystem", {"max_steps": 100}, 0)
    text = json.dumps(r.record())
    assert not any(isinstance(v, float) and math.isnan(v) for v in json.loads(text)["summary"].values())
