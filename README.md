# Phases

**Live site: [phases-pi.vercel.app](https://phases-pi.vercel.app)**

PHASES treats simulations as recurring life cycles — conception, initialization,
execution, emergence, observation, termination — where the end of one
experiment seeds the next. It is a website about that idea and a laboratory
for running it: a reproducible Python simulation engine, an API that streams
runs live, and an interactive Lab.

## Pages

- **[Phases](https://phases-pi.vercel.app)** — the six life stages of a simulation.
- **[Worlds](https://phases-pi.vercel.app/worlds.html)** — simulation of robotics, the environment and the universe, how a physics engine works, and a live 2D physics playground.
- **[Lab](https://phases-pi.vercel.app/lab.html)** — design an experiment, run an ecosystem of foraging agents through the six phases, watch it live, scrub back through it, export it, and carry it into the next cycle. Without a connected API it replays a recorded run.

## Repository

| Path | What |
|---|---|
| `index.html`, `worlds.html`, `lab.html`, `*.js`, `styles.css`, `lab/` | the static site (no build step) |
| `engine/` | `phases_engine`: lifecycle state machine, model plugin interface, seeded runner, ecosystem model |
| `api/` | `phases_api`: FastAPI, worker processes, WebSocket streaming, SQLite, run bundles |
| `tests/e2e/` | Playwright browser tests (desktop and mobile) |
| `docs/` | [framework](docs/framework.md) · [reproducibility](docs/reproducibility.md) · [API](docs/api.md) · [deployment](docs/deploy.md) |
| `tools/` | ECHO voice generation, Lab demo recording |

## Run the laboratory locally

```sh
python3.12 -m venv .venv
.venv/bin/pip install -e "engine[dev]" -e "api[dev]"
.venv/bin/python -m phases_api            # API on http://127.0.0.1:8000 (docs at /docs)
npm run serve                             # site on http://localhost:8080
```

Open http://localhost:8080/lab.html; it connects to the local API automatically.
You can also run experiments from the command line:

```sh
.venv/bin/python -m phases_engine run ecosystem --seed 42 --set max_steps=500 --out runs/demo
```

## Tests

```sh
.venv/bin/pytest engine/tests            # engine
(cd api && ../.venv/bin/pytest tests)    # API, including WebSocket streaming
npm ci && npx playwright test            # site; set PHASES_E2E_API=http://127.0.0.1:8000 for live Lab tests
```

GitHub Actions runs all of these, plus a Docker build of the API, on every push.

## ECHO voice assistant

Every page has ECHO, a voice interface in the bottom-right corner.

- **Talk** — press the mic or `V`, then say a command (Chrome, Edge and Safari). You can also type commands in the console.
- **Narrate** — press the speaker or `N` for a spoken tour of the page; `Esc` stops it.
- **Try saying** — "help", "phase three", "emergence", "worlds", "lab", "gravity moon", "run experiment", "pause", "next cycle", "read this page".
- **Voice** — [Coqui TTS](https://github.com/idiap/coqui-ai-TTS) (LJSpeech VITS, Apache 2.0), pre-rendered into `audio/echo/`. Lines that can't be pre-rendered, like the time, use the browser's best voice. Switch voices in the console or say "change voice".

To regenerate the clips after changing page text or ECHO's lines (needs Python 3.10–3.12, ffmpeg and Google Chrome):

```sh
python3.12 -m venv .venv-voice && .venv-voice/bin/pip install -r tools/voice/requirements.txt
.venv-voice/bin/python tools/voice/generate.py
```

## Deploy

The site is hosted on Vercel as the `phases` project: `vercel deploy --prod`.
See [docs/deploy.md](docs/deploy.md) for the API.
