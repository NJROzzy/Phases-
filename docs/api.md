# PHASES Laboratory API (v1)

Interactive, always-current reference: run the API and open `/docs` (Swagger
UI) or `/openapi.json`. This page explains the concepts and the live stream.

Base path: `/api/v1`. All bodies are JSON. Validation errors return `422` with
the offending field; unknown ids return `404`; acting on a finished run
returns `409`.

## Running it

```sh
python3.12 -m venv .venv
.venv/bin/pip install -e "engine[dev]" -e "api[dev]"
.venv/bin/python -m phases_api            # http://127.0.0.1:8000, docs at /docs
```

| Variable | Default | Meaning |
|---|---|---|
| `PHASES_DATA` | `./data` | SQLite database and run files |
| `PHASES_CORS` | the Vercel site + localhost ports | comma-separated allowed origins |
| `PHASES_MAX_RUNS` | `2` | simulations running at once (more are queued) |
| `PHASES_MAX_STEPS` | `20000` | upper limit on `max_steps` for this server |
| `HOST`, `PORT` | `127.0.0.1`, `8000` | bind address |

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness and versions |
| GET | `/models` | available models with their parameter JSON schema |
| POST | `/experiments` | create an experiment (conception) |
| GET | `/experiments?parent_id=&limit=&offset=` | list, newest first |
| GET | `/experiments/{id}` | details, its runs and child cycles |
| POST | `/experiments/{id}/runs` | start a run (202); always an explicit request |
| GET | `/runs/{id}` | status, phase, summary, environment, invariant checks |
| POST | `/runs/{id}/pause` · `/resume` · `/cancel` | control a live run |
| GET | `/runs/{id}/metrics?format=json\|csv` | every metric for every step |
| GET | `/runs/{id}/frames?from=&to=&limit=` | stored world frames for playback |
| GET | `/runs/{id}/bundle` | zip: experiment, run record, metrics, frames, README |
| WS | `/ws/runs/{id}` | live stream (below) |

### Create an experiment

```json
POST /api/v1/experiments
{
  "title": "Does sensing pay off?",
  "hypothesis": "Greedy foragers sustain a larger population than random walkers.",
  "model": "ecosystem",
  "config": {"movement": "greedy", "max_steps": 2000},
  "seed": 42,
  "parent_id": null,
  "change_note": "",
  "change_origin": "human"
}
```

Omitted parameters take the model's defaults; the stored `config` is always
complete, and `config_hash` identifies it. With `parent_id`, the new
experiment becomes the next cycle: `cycle_index` increments and
`change_from_parent` lists every parameter that changed (`{"from", "to"}`).

### Start a run

```json
POST /api/v1/experiments/{id}/runs
{"seed": null, "steps_per_second": 60, "frame_every": 5}
```

`seed` defaults to the experiment's. `steps_per_second` paces the run for live
viewing (`null` = as fast as possible). Pacing never changes results.

Run `status`: `queued → running ⇄ paused → completed | cancelled | failed`.
Run `phase`: the six-phase lifecycle (`conception … termination`).

## Live stream: `WS /ws/runs/{id}`

Every message is a JSON object with a `type`:

| type | fields | when |
|---|---|---|
| `hello` | `run` (as GET /runs/{id}), `rows` (all metrics so far), `frame` (latest) | first message; for a finished run it is the only one |
| `phase` | `phase`, `status`, optional `reason` | lifecycle change |
| `metrics` | `rows`: `[{step, population, …}, …]` | batched, about every 100 ms |
| `frame` | `frame`: `{step, fields, agents (flat list), grid: {w, h, data (base64 uint8)}}` | every `frame_every` steps |
| `done` | `record`: full run record | end; the socket then closes |
| `error` | `error` | the run failed; the socket then closes |

Decoding a frame: agents is a flat list of `len(fields)` values per agent
(`x, y, energy, speed, sense` for the ecosystem). The grid is `w×h` bytes,
row-major, resource level scaled to 0–255.

## Architecture notes

- Simulations run in a `ProcessPoolExecutor` (spawned processes), so CPU-heavy
  runs never block the API. A pump thread per run moves events from the
  worker to the database and to WebSocket subscribers.
- If the server stops mid-run, those runs are marked `failed` ("server
  restarted during run") on the next start; they are never silently resumed.
- Only the final record sets a final status, so a `completed` run always has
  its summary, hashes and invariant checks.
- Not yet included (planned): authentication and rate limiting, needed before
  any public deployment; replicates, comparison, findings and reports (release
  0.2); AI notes (release 0.3).
