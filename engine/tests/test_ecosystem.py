"""Behaviour of the ecosystem model."""

import numpy as np
import pytest
from pydantic import ValidationError

from phases_engine import get_model, run

BASE = {"width": 32, "height": 32, "initial_population": 80}


def test_invariants_hold_over_a_long_run():
    r = run("ecosystem", {**BASE, "max_steps": 600}, seed=21)
    assert r.violations == []


def test_energy_accounting_detects_tampering():
    model = get_model("ecosystem")
    cfg = model.Config(**BASE)
    rng = np.random.Generator(np.random.PCG64(0))
    state = model.step(model.init(cfg, rng), cfg, rng)
    assert model.check(state, cfg) == []
    state.energy[0] += 1.0
    assert any("energy not conserved" in p for p in model.check(state, cfg))


def test_starvation_without_resources():
    r = run("ecosystem", {**BASE, "initial_resource_fill": 0, "resource_reseed": 0, "max_steps": 500}, seed=1)
    assert r.termination_reason == "extinction"
    assert r.summary["starvation_share_of_deaths"] == 1.0
    assert r.summary["total_births"] == 0


def test_old_age_kills_a_cohort_that_cannot_reproduce():
    r = run("ecosystem", {**BASE, "max_age": 50, "reproduction_threshold": 200, "max_steps": 200}, seed=1)
    assert r.termination_reason == "extinction"
    assert r.steps == 50
    assert r.summary["mean_lifespan"] == 50


def test_traits_stay_fixed_without_mutation():
    r = run("ecosystem", {**BASE, "mutation_sd": 0, "max_steps": 300}, seed=4)
    speeds = [v for v in r.metrics["speed_sd"] if not np.isnan(v)]
    assert max(speeds) == 0
    assert r.summary["speed"]["end"] == pytest.approx(1.0)


def test_traits_vary_with_mutation():
    r = run("ecosystem", {**BASE, "mutation_sd": 0.1, "max_steps": 300}, seed=4)
    assert np.nanmax(r.metrics["speed_sd"]) > 0


def test_population_cap_is_respected():
    r = run("ecosystem", {**BASE, "max_population": 90, "resource_regrowth": 0.5, "max_steps": 300}, seed=2)
    assert max(r.metrics["population"]) <= 90
    assert r.summary["steps_capped"] > 0
    assert r.violations == []


def test_movement_behaviour_is_reported():
    assert np.nanmean(run("ecosystem", {**BASE, "movement": "random", "max_steps": 50}, 0).metrics["greedy_share"]) == 0
    assert np.nanmean(run("ecosystem", {**BASE, "movement": "greedy", "max_steps": 50}, 0).metrics["greedy_share"]) == 1


def test_greedy_foragers_outlast_random_walkers():
    """Sensing food should pay off: averaged over seeds, greedy agents end with
    more energy than random walkers in the same world."""
    def mean_energy(movement):
        vals = []
        for seed in range(6):
            r = run("ecosystem", {**BASE, "movement": movement, "max_steps": 150}, seed)
            vals.append(np.nanmean(r.metrics["energy_mean"][50:]))
        return np.mean(vals)

    assert mean_energy("greedy") > mean_energy("random")


def test_frame_shape():
    model = get_model("ecosystem")
    cfg = model.Config(**BASE)
    state = model.init(cfg, np.random.Generator(np.random.PCG64(0)))
    fr = model.frame(state, cfg)
    assert fr.agents.shape == (80, len(fr.agent_fields))
    assert fr.grid.shape == (32, 32)
    assert 0 <= fr.grid.min() and fr.grid.max() <= 1


@pytest.mark.parametrize("bad", [
    {"width": 4},
    {"offspring_share": 1.0},
    {"movement": "teleport"},
    {"initial_population": 100, "max_population": 50},
    {"initial_speed": 10},
])
def test_config_validation(bad):
    with pytest.raises(ValidationError):
        get_model("ecosystem").Config(**bad)
