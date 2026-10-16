# Reproducibility

Every PHASES run can be repeated exactly. This is how.

## What makes a run deterministic

- **One random source.** The runner creates `numpy.random.Generator(PCG64(seed))`
  and passes it to the model. Models never create their own randomness.
- **Observation is free.** `observe` and `frame` must not draw from the
  generator (enforced by `tests/test_contract.py`), so watching a run more or
  less often cannot change it.
- **Fixed update order.** Where agents compete (e.g. eating), they are served
  in a seeded random order, never in memory or dictionary order.
- **No wall-clock time in the simulation.** Timestamps are only recorded.

## What is recorded with every run (`run.json`)

| Field | Purpose |
|---|---|
| `model_id`, `model_version` | which model, which revision of its rules |
| `config`, `config_hash` | every parameter, plus a fingerprint independent of key order |
| `seed` | the generator seed |
| `metrics_hash` | fingerprint of all outputs; equal hashes mean an identical replay |
| `environment` | engine, Python, numpy, scipy, pydantic versions, platform, git commit |
| `phase_log` | UTC timestamp of every phase and status change |
| `started_at`, `finished_at`, `wall_seconds` | when and how long |
| `termination_reason`, `status` | why the run ended |
| `violations` | any invariant broken during the run (should be empty) |
| `summary` | observation-phase statistics |

The step-by-step series are in `metrics.csv` (one row per step) and optional
frames in `frames.jsonl.gz`.

## Repeating a run

```sh
python -m phases_engine run ecosystem --seed 42 --config run.json-config.json
```

Compare the printed `metrics_hash` with the original. A difference means the
model version, a dependency version or the platform changed; `environment`
tells you which.

## Limits

Results are bit-for-bit identical on the same platform and library versions.
Across platforms, tiny floating-point differences are possible; the metrics
hash rounds to 10 significant digits to absorb most of them, but long chaotic
runs can still diverge. Record the `environment` alongside any published
result.
