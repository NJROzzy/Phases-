"""Model registry. New simulation types plug in by registering a Model class."""

from __future__ import annotations

from .model import Model

_MODELS: dict[str, type[Model]] = {}


def register(cls: type[Model]) -> type[Model]:
    """Class decorator that makes a model available by its `id`."""
    if cls.id in _MODELS and _MODELS[cls.id] is not cls:
        raise ValueError(f"model id {cls.id!r} is already registered")
    _MODELS[cls.id] = cls
    return cls


def get_model(model_id: str) -> Model:
    try:
        return _MODELS[model_id]()
    except KeyError:
        raise KeyError(f"unknown model {model_id!r}; available: {sorted(_MODELS)}") from None


def list_models() -> list[type[Model]]:
    return [_MODELS[k] for k in sorted(_MODELS)]
