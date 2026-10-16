# Deployment

PHASES has two deployable parts that are deliberately independent:

| Part | What | Where |
|---|---|---|
| Site | `index.html`, `worlds.html`, `lab.html` and static assets | Vercel (static, no build step) |
| Laboratory API | `engine/` + `api/` (Python, FastAPI) | your computer today; any container host later |

The site never depends on the API being up: without one, the Lab runs in
**demo mode** and replays `lab/demo/ecosystem.json`.

## Site (Vercel)

```sh
vercel deploy --prod
```

`.vercelignore` keeps the Python packages, tests, tools and docs out of the
deployment. The Vercel project is `phases` (https://phases-pi.vercel.app).

## Laboratory API on your computer

```sh
python3.12 -m venv .venv
.venv/bin/pip install -e engine -e api
.venv/bin/python -m phases_api          # http://127.0.0.1:8000
```

Then open the Lab. On `localhost` it connects automatically; on the live site,
use the **Connect** form in the demo notice (or add `?api=http://127.0.0.1:8000`
to the URL). Chrome and Edge allow an `https` page to reach `http://127.0.0.1`;
Safari and Firefox may block it, in which case serve the site locally too
(`npm run serve`, then http://localhost:8080/lab.html).

## Laboratory API in a container (later)

```sh
docker build -f api/Dockerfile -t phases-api .
docker run -p 8000:8000 -v phases-data:/data \
  -e PHASES_CORS=https://phases-pi.vercel.app phases-api
```

Before exposing it publicly, add authentication and rate limiting (see
`docs/api.md`, "Not yet included"), put it behind HTTPS, and keep
`PHASES_MAX_RUNS` and `PHASES_MAX_STEPS` conservative. The WebSocket must
connect straight to the API's domain; Vercel rewrites don't proxy WebSockets.

## Regenerating assets

| Asset | Command | When |
|---|---|---|
| ECHO voice clips | `python tools/voice/generate.py` (Coqui venv) | page text or ECHO's lines change |
| Lab demo run | `.venv/bin/python tools/lab/make_demo.py` | the ecosystem model changes |
