"""Spatial statistics."""

from __future__ import annotations

import numpy as np
from scipy.spatial import cKDTree


def clark_evans(x: np.ndarray, y: np.ndarray, width: float, height: float) -> float:
    """Clark–Evans aggregation index R on a torus (no edge effects).

    R = mean nearest-neighbour distance / expected distance under complete
    spatial randomness, 0.5 / sqrt(density) (Clark & Evans, 1954).
    R ≈ 1: random; R < 1: clustered; R > 1: evenly spread.
    Returns NaN for fewer than two points.
    """
    n = len(x)
    if n < 2:
        return float("nan")
    pts = np.column_stack([np.mod(x, width), np.mod(y, height)])
    tree = cKDTree(pts, boxsize=[width, height])
    dist, _ = tree.query(pts, k=2)
    observed = dist[:, 1].mean()
    expected = 0.5 / np.sqrt(n / (width * height))
    return float(observed / expected)
