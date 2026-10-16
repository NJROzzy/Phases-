"""Autonomous-agent ecosystem: foragers on a regrowing resource field.

World
    A W×H grid that wraps at the edges (a torus). Each cell holds a resource
    r ∈ [0, K] that regrows logistically, r ← r + g·r·(1 − r/K). A cell grazed
    to zero cannot regrow logistically, so empty cells are reseeded to 0.1·K
    with a small probability per step.

Agents
    Position (cell), energy, age, and two heritable traits:
    speed ∈ [0.25, 4] (cells per step) and sense ∈ [0, 6] (sensing radius).

One step, in this fixed order
    1. Move. Random walk, greedy (towards the richest cell within the
       sensing radius, Chebyshev distance), or mixed (greedy with
       probability p). Fractional speed is rounded stochastically.
    2. Pay costs: metabolism + move_cost·speed² + sense_cost·sense.
    3. Eat. Agents are served in a seeded random order and at most one agent
       eats per cell per step; it takes min(r, intake).
    4. Age, then die if energy ≤ 0 (starvation) or age ≥ max_age.
    5. Reproduce asexually if energy ≥ threshold: the child receives a
       fraction of the parent's energy and mutated traits (Gaussian, sd =
       mutation_sd × trait range; mutation_sd = 0 switches evolution off).
       Births beyond max_population are refused (recorded as `capped`).
    6. Resources regrow.

Energy is conserved by construction, and `check` verifies it every step:
    E(t+1) = E(t) + eaten − spent − energy of agents that died.

This is a standard consumer–resource agent-based model (cf. Sugarscape,
Epstein & Axtell 1996), not a model of any particular species.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

import numpy as np
from pydantic import Field, model_validator

from ..analysis.spatial import clark_evans
from ..core.model import Frame, Model, ModelConfig
from ..core.registry import register

SPEED_RANGE = (0.25, 4.0)
SENSE_RANGE = (0.0, 6.0)
MAX_RADIUS = int(SENSE_RANGE[1])

# Every offset within the largest sensing radius, with its Chebyshev distance
_OY, _OX = np.mgrid[-MAX_RADIUS : MAX_RADIUS + 1, -MAX_RADIUS : MAX_RADIUS + 1]
OFF_X = _OX.ravel()
OFF_Y = _OY.ravel()
OFF_R = np.maximum(np.abs(OFF_X), np.abs(OFF_Y))


class EcosystemConfig(ModelConfig):
    width: int = Field(64, ge=8, le=256, description="Grid width in cells.")
    height: int = Field(64, ge=8, le=256, description="Grid height in cells.")
    initial_population: int = Field(150, ge=1, le=2000, description="Agents at the start.")
    max_population: int = Field(3000, ge=10, le=10_000, description="Births beyond this are refused.")
    resource_capacity: float = Field(1.0, gt=0, le=10, description="Maximum resource per cell (K).")
    resource_regrowth: float = Field(0.1, ge=0, le=1, description="Logistic regrowth rate (g).")
    resource_reseed: float = Field(0.02, ge=0, le=0.1, description="Chance per step that an empty cell sprouts again.")
    initial_resource_fill: float = Field(0.5, ge=0, le=1, description="Mean starting resource as a fraction of K.")
    initial_energy: float = Field(5.0, gt=0, le=100, description="Energy each starting agent has.")
    intake: float = Field(0.5, gt=0, le=10, description="Most an agent can eat per step.")
    metabolism: float = Field(0.1, ge=0, le=5, description="Energy spent per step just to live.")
    move_cost: float = Field(0.02, ge=0, le=1, description="Cost per step × speed².")
    sense_cost: float = Field(0.01, ge=0, le=1, description="Cost per step × sensing radius.")
    reproduction_threshold: float = Field(10.0, gt=0, le=200, description="Energy needed to reproduce.")
    offspring_share: float = Field(0.5, gt=0, lt=1, description="Fraction of the parent's energy given to the child.")
    max_age: int = Field(300, ge=1, le=100_000, description="Agents die of old age at this many steps.")
    movement: Literal["random", "greedy", "mixed"] = Field("mixed", description="Movement behaviour.")
    greedy_probability: float = Field(0.8, ge=0, le=1, description="For mixed movement: chance of moving greedily.")
    initial_speed: float = Field(1.0, ge=SPEED_RANGE[0], le=SPEED_RANGE[1], description="Starting speed trait.")
    initial_sense: float = Field(2.0, ge=SENSE_RANGE[0], le=SENSE_RANGE[1], description="Starting sensing radius.")
    mutation_sd: float = Field(0.05, ge=0, le=1, description="Mutation size as a fraction of each trait's range; 0 = no evolution.")

    @model_validator(mode="after")
    def _population_fits(self) -> "EcosystemConfig":
        if self.initial_population > self.max_population:
            raise ValueError("initial_population cannot exceed max_population")
        return self


@dataclass
class EcosystemState:
    step: int
    resource: np.ndarray
    x: np.ndarray
    y: np.ndarray
    energy: np.ndarray
    age: np.ndarray
    speed: np.ndarray
    sense: np.ndarray
    ids: np.ndarray
    next_id: int
    founders: int
    # tallies for the latest step
    births: int = 0
    deaths_starvation: int = 0
    deaths_age: int = 0
    eaten: float = 0.0
    spent: float = 0.0
    dead_energy: float = 0.0
    greedy_moves: int = 0
    movers: int = 0
    capped: bool = False
    energy_before: float = 0.0
    # whole-run tallies
    total_births: int = 0
    total_deaths: int = 0
    lifespan_sum: float = 0.0
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def n(self) -> int:
        return len(self.x)

    def keep(self, mask: np.ndarray) -> None:
        for name in ("x", "y", "energy", "age", "speed", "sense", "ids"):
            setattr(self, name, getattr(self, name)[mask])


def _mutate(values: np.ndarray, lo: float, hi: float, sd: float, rng: np.random.Generator) -> np.ndarray:
    if sd == 0:
        return values.copy()
    return np.clip(values + rng.normal(0.0, sd * (hi - lo), len(values)), lo, hi)


@register
class Ecosystem(Model[EcosystemConfig, EcosystemState]):
    id = "ecosystem"
    version = "1.0.0"
    name = "Autonomous-agent ecosystem"
    description = "Foragers with heritable speed and sensing compete for a regrowing resource on a toroidal grid."
    Config = EcosystemConfig

    # ---------------------------------------------------------------- init
    def init(self, cfg: EcosystemConfig, rng: np.random.Generator) -> EcosystemState:
        k = cfg.resource_capacity
        resource = np.clip(rng.uniform(0, 2 * cfg.initial_resource_fill, (cfg.height, cfg.width)), 0, 1) * k
        n = cfg.initial_population
        state = EcosystemState(
            step=0,
            resource=resource,
            x=rng.integers(0, cfg.width, n),
            y=rng.integers(0, cfg.height, n),
            energy=np.full(n, cfg.initial_energy, dtype=float),
            age=np.zeros(n, dtype=np.int64),
            speed=np.full(n, cfg.initial_speed, dtype=float),
            sense=np.full(n, cfg.initial_sense, dtype=float),
            ids=np.arange(n, dtype=np.int64),
            next_id=n,
            founders=n,
        )
        state.energy_before = float(state.energy.sum())
        return state

    # ---------------------------------------------------------------- step
    def step(self, s: EcosystemState, cfg: EcosystemConfig, rng: np.random.Generator) -> EcosystemState:
        s.step += 1
        s.births = s.deaths_starvation = s.deaths_age = s.greedy_moves = 0
        s.movers = s.n
        s.eaten = s.spent = s.dead_energy = 0.0
        s.capped = False
        s.energy_before = float(s.energy.sum())
        W, H, K = cfg.width, cfg.height, cfg.resource_capacity
        n = s.n

        if n:
            # 1. Move
            whole = np.floor(s.speed)
            reach = (whole + (rng.random(n) < (s.speed - whole))).astype(np.int64)
            if cfg.movement == "random":
                greedy = np.zeros(n, dtype=bool)
            elif cfg.movement == "greedy":
                greedy = np.ones(n, dtype=bool)
            else:
                greedy = rng.random(n) < cfg.greedy_probability
            dx = rng.integers(-1, 2, n) * reach
            dy = rng.integers(-1, 2, n) * reach

            g = np.flatnonzero(greedy)
            if len(g):
                radius = np.rint(s.sense[g]).astype(np.int64)
                # Only scan offsets within the largest radius anyone has
                window = OFF_R <= radius.max()
                ox, oy, orad = OFF_X[window], OFF_Y[window], OFF_R[window]
                gx = (s.x[g, None] + ox[None, :]) % W
                gy = (s.y[g, None] + oy[None, :]) % H
                seen = s.resource[gy, gx] + rng.random(gx.shape) * 1e-9  # random tie-break
                seen[orad[None, :] > radius[:, None]] = -np.inf
                best = np.argmax(seen, axis=1)
                dx[g] = np.clip(ox[best], -reach[g], reach[g])
                dy[g] = np.clip(oy[best], -reach[g], reach[g])
                s.greedy_moves = len(g)
            s.x = (s.x + dx) % W
            s.y = (s.y + dy) % H

            # 2. Pay costs
            cost = cfg.metabolism + cfg.move_cost * s.speed**2 + cfg.sense_cost * s.sense
            s.energy -= cost
            s.spent = float(cost.sum())

            # 3. Eat — one agent per cell, served in a seeded random order
            order = rng.permutation(n)
            cells = s.y * W + s.x
            _, first = np.unique(cells[order], return_index=True)
            winners = order[first]
            flat = s.resource.reshape(-1)
            gain = np.minimum(flat[cells[winners]], cfg.intake)
            flat[cells[winners]] -= gain
            s.energy[winners] += gain
            s.eaten = float(gain.sum())

            # 4. Age and die
            s.age += 1
            starved = s.energy <= 0
            old = (s.age >= cfg.max_age) & ~starved
            dead = starved | old
            if dead.any():
                s.deaths_starvation = int(starved.sum())
                s.deaths_age = int(old.sum())
                s.dead_energy = float(s.energy[dead].sum())
                s.lifespan_sum += float(s.age[dead].sum())
                s.total_deaths += int(dead.sum())
                s.keep(~dead)

            # 5. Reproduce
            parents = np.flatnonzero(s.energy >= cfg.reproduction_threshold)
            room = cfg.max_population - s.n
            if len(parents) > room:
                s.capped = True
                parents = np.sort(rng.permutation(parents)[: max(room, 0)])
            if len(parents):
                child_energy = s.energy[parents] * cfg.offspring_share
                s.energy[parents] -= child_energy
                m = len(parents)
                s.x = np.concatenate([s.x, s.x[parents]])
                s.y = np.concatenate([s.y, s.y[parents]])
                s.energy = np.concatenate([s.energy, child_energy])
                s.age = np.concatenate([s.age, np.zeros(m, dtype=np.int64)])
                s.speed = np.concatenate([s.speed, _mutate(s.speed[parents], *SPEED_RANGE, cfg.mutation_sd, rng)])
                s.sense = np.concatenate([s.sense, _mutate(s.sense[parents], *SENSE_RANGE, cfg.mutation_sd, rng)])
                s.ids = np.concatenate([s.ids, np.arange(s.next_id, s.next_id + m, dtype=np.int64)])
                s.next_id += m
                s.births = m
                s.total_births += m

        # 6. Resources regrow; empty cells occasionally reseed
        r = s.resource
        r += cfg.resource_regrowth * r * (1 - r / K)
        if cfg.resource_reseed > 0:
            sprout = (r < 1e-9) & (rng.random(r.shape) < cfg.resource_reseed)
            r[sprout] = 0.1 * K
        np.clip(r, 0, K, out=r)
        return s

    # ---------------------------------------------------------------- observe
    def observe(self, s: EcosystemState, cfg: EcosystemConfig) -> dict[str, float]:
        n = s.n
        nan = float("nan")
        # Deterministic jitter within each cell (from agent ids, not the rng) so
        # agents sharing a cell don't make the nearest-neighbour distance zero.
        jx = (s.ids * 0.6180339887) % 1.0
        jy = (s.ids * 0.7548776662) % 1.0
        return {
            "population": n,
            "births": s.births,
            "deaths": s.deaths_starvation + s.deaths_age,
            "deaths_starvation": s.deaths_starvation,
            "deaths_age": s.deaths_age,
            "resource_total": float(s.resource.sum()),
            "resource_fraction": float(s.resource.mean() / cfg.resource_capacity),
            "energy_mean": float(s.energy.mean()) if n else nan,
            "speed_mean": float(s.speed.mean()) if n else nan,
            "speed_sd": float(s.speed.std()) if n else nan,
            "sense_mean": float(s.sense.mean()) if n else nan,
            "sense_sd": float(s.sense.std()) if n else nan,
            # share of this step's movers that moved greedily (NaN before anyone has moved)
            "greedy_share": s.greedy_moves / s.movers if s.movers else nan,
            "founders_alive": float(np.count_nonzero(s.ids < s.founders) / s.founders),
            "mean_lifespan": s.lifespan_sum / s.total_deaths if s.total_deaths else nan,
            "clark_evans": clark_evans(s.x + jx, s.y + jy, cfg.width, cfg.height),
            "capped": float(s.capped),
        }

    # ---------------------------------------------------------------- frame
    def frame(self, s: EcosystemState, cfg: EcosystemConfig) -> Frame:
        agents = np.column_stack([s.x, s.y, s.energy, s.speed, s.sense]).astype(np.float32)
        return Frame(
            step=s.step,
            agents=agents,
            agent_fields=("x", "y", "energy", "speed", "sense"),
            grid=(s.resource / cfg.resource_capacity).astype(np.float32),
        )

    # ---------------------------------------------------------------- stop
    def terminated(self, s: EcosystemState, cfg: EcosystemConfig) -> str | None:
        return "extinction" if s.n == 0 else None

    # ---------------------------------------------------------------- checks
    def check(self, s: EcosystemState, cfg: EcosystemConfig) -> list[str]:
        problems = []
        after = float(s.energy.sum())
        expected = s.energy_before + s.eaten - s.spent - s.dead_energy
        if abs(after - expected) > 1e-6 * (1 + abs(expected)):
            problems.append(f"energy not conserved: expected {expected:.9g}, found {after:.9g}")
        if s.n and ((s.x < 0).any() or (s.x >= cfg.width).any() or (s.y < 0).any() or (s.y >= cfg.height).any()):
            problems.append("agent outside the grid")
        if (s.resource < 0).any() or (s.resource > cfg.resource_capacity + 1e-12).any():
            problems.append("resource outside [0, K]")
        if s.n and (s.energy <= 0).any():
            problems.append("living agent with no energy")
        if s.n > cfg.max_population:
            problems.append("population above max_population")
        return problems

    # ---------------------------------------------------------------- summary
    def summarize(self, m: dict[str, np.ndarray], cfg: EcosystemConfig) -> dict[str, Any]:
        pop = m["population"]
        steps = m["step"]
        extinct = bool(pop[-1] == 0)
        half = pop[len(pop) // 2 :]

        def first_last(name: str) -> dict[str, float | None]:
            v = m[name][~np.isnan(m[name])]
            return {"start": float(v[0]), "end": float(v[-1])} if len(v) else {"start": None, "end": None}

        return {
            "extinct": extinct,
            "extinction_step": int(steps[-1]) if extinct else None,
            "final_population": int(pop[-1]),
            "peak_population": int(pop.max()),
            "peak_step": int(steps[int(pop.argmax())]),
            # Mean population over the second half of the run. Only an
            # estimate of carrying capacity, valid if the run has settled.
            "carrying_capacity_estimate": None if extinct else float(half.mean()),
            "population_cv_second_half": None if extinct or half.mean() == 0 else float(half.std() / half.mean()),
            "total_births": int(m["births"].sum()),
            "total_deaths": int(m["deaths"].sum()),
            "starvation_share_of_deaths": float(m["deaths_starvation"].sum() / max(1, m["deaths"].sum())),
            "mean_lifespan": None if np.isnan(m["mean_lifespan"][-1]) else float(m["mean_lifespan"][-1]),
            "speed": first_last("speed_mean"),
            "sense": first_last("sense_mean"),
            "clark_evans": first_last("clark_evans"),
            "steps_capped": int(m["capped"].sum()),
        }
