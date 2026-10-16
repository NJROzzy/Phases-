"""PHASES simulation engine.

Simulation logic only: no web or storage code lives here, so the engine can be
used from the API, the command line, notebooks or tests alike.
"""

__version__ = "0.1.0"

from .core.lifecycle import InvalidTransition, Lifecycle, Phase, Status
from .core.model import Frame, Model, ModelConfig
from .core.registry import get_model, list_models, register
from .core.runner import RunControl, RunResult, run

# Built-in models register themselves on import
from .models import ecosystem as _ecosystem  # noqa: F401

__all__ = [
    "__version__",
    "Frame",
    "InvalidTransition",
    "Lifecycle",
    "Model",
    "ModelConfig",
    "Phase",
    "RunControl",
    "RunResult",
    "Status",
    "get_model",
    "list_models",
    "register",
    "run",
]
