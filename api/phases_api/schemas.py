"""Typed request and response bodies."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ModelInfo(BaseModel):
    id: str
    version: str
    name: str
    description: str
    config_schema: dict[str, Any]


class ExperimentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    hypothesis: str = Field("", max_length=4000, description="What this experiment is meant to test.")
    model: str = Field("ecosystem", description="Model id, see GET /models.")
    config: dict[str, Any] = Field(default_factory=dict, description="Parameters; omitted ones take model defaults.")
    seed: int = Field(0, ge=0, le=2**63 - 1)
    parent_id: str | None = Field(None, description="Previous cycle this experiment follows from.")
    change_note: str = Field("", max_length=4000, description="Why the parameters changed from the parent.")
    change_origin: Literal["human", "ai"] = "human"


class RunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    seed: int | None = Field(None, ge=0, le=2**63 - 1, description="Defaults to the experiment's seed.")
    steps_per_second: float | None = Field(60, gt=0, le=10_000, description="Pace for live viewing; null = full speed.")
    frame_every: int = Field(5, ge=1, le=1000, description="Stream and store a world frame every k steps.")


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    experiment_id: str
    seed: int
    status: str
    phase: str
    steps: int
    termination_reason: str | None
    metrics_hash: str | None
    summary: dict[str, Any] | None
    environment: dict[str, Any] | None
    violations: list[str] | None
    error: str | None
    frame_every: int
    created_at: str
    started_at: str | None
    finished_at: str | None


class ExperimentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    hypothesis: str
    model_id: str
    model_version: str
    config: dict[str, Any]
    config_hash: str
    seed: int
    parent_id: str | None
    cycle_index: int
    change_from_parent: dict[str, Any] | None
    change_note: str
    change_origin: str
    engine_version: str
    created_at: str


class ExperimentDetail(ExperimentOut):
    runs: list[RunOut]
    children: list[str]


class ControlAction(BaseModel):
    ok: bool
    status: str
