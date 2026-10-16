"""The plugin interface every simulation model implements.

A model is stateless: all simulation state lives in the object returned by
`init`, and every source of randomness is the `rng` passed in by the runner.
That is what makes runs reproducible from a seed.

Formally a model defines the step rule s(t+1) = F(s(t), θ, ξ(t)), an
observation function y(t) = O(s(t)) and a stopping condition τ(s(t)).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, ClassVar, Generic, TypeVar

import numpy as np
from pydantic import BaseModel, ConfigDict, Field


class ModelConfig(BaseModel):
    """Base class for model parameters (θ). Unknown fields are rejected."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    max_steps: int = Field(1000, ge=1, le=100_000, description="Simulation stops after this many steps.")


@dataclass
class Frame:
    """A compact snapshot of the world for visualisation and playback."""

    step: int
    agents: np.ndarray  # shape (n, len(agent_fields))
    agent_fields: tuple[str, ...]
    grid: np.ndarray | None = None  # 2-D field scaled to 0..1, or None


C = TypeVar("C", bound=ModelConfig)
S = TypeVar("S")


class Model(ABC, Generic[C, S]):
    id: ClassVar[str]
    version: ClassVar[str]
    name: ClassVar[str]
    description: ClassVar[str]
    Config: ClassVar[type[ModelConfig]]

    @abstractmethod
    def init(self, cfg: C, rng: np.random.Generator) -> S:
        """Initialization phase: build the starting state."""

    @abstractmethod
    def step(self, state: S, cfg: C, rng: np.random.Generator) -> S:
        """Advance the state by one step. May mutate and return `state`."""

    @abstractmethod
    def observe(self, state: S, cfg: C) -> dict[str, float]:
        """Measurable outputs. Must not consume randomness from the run's rng."""

    @abstractmethod
    def frame(self, state: S, cfg: C) -> Frame:
        """Snapshot for visualisation."""

    @abstractmethod
    def terminated(self, state: S, cfg: C) -> str | None:
        """Return a reason to stop (e.g. "extinction"), or None to continue."""

    def check(self, state: S, cfg: C) -> list[str]:
        """Invariant violations after a step (empty when the state is valid)."""
        return []

    def summarize(self, metrics: dict[str, np.ndarray], cfg: C) -> dict[str, Any]:
        """Observation phase: summary statistics over the whole run."""
        return {}

    @classmethod
    def describe(cls) -> dict[str, Any]:
        return {
            "id": cls.id,
            "version": cls.version,
            "name": cls.name,
            "description": cls.description,
            "config_schema": cls.Config.model_json_schema(),
        }
