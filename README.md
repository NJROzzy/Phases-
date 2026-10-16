# Phases

**Live site: [phases-pi.vercel.app](https://phases-pi.vercel.app)**

A small static site about the life stages of a simulation, and the worlds simulations are built for.

## Pages

- **[Phases](https://phases-pi.vercel.app)** — the six life stages of a simulation: Conception, Initialization, Execution, Emergence, Observation and Termination.
- **[Worlds](https://phases-pi.vercel.app/worlds.html)** — simulation of robotics, the environment and the universe, how a physics engine works, and a live 2D physics playground.

## ECHO voice assistant

Every page has ECHO, a voice interface in the bottom-right corner.

- **Talk** — press the mic or `V`, then say a command (Chrome, Edge and Safari). You can also type commands in the console.
- **Narrate** — press the speaker or `N` for a spoken tour of the page; `Esc` stops it.
- **Voice** — ECHO speaks with [Coqui TTS](https://github.com/idiap/coqui-ai-TTS) (the open-source LJSpeech VITS model, Apache 2.0), pre-rendered into `audio/echo/`. Lines that can't be pre-rendered, like the time, use the browser's best voice. Switch voices from the console's voice menu or say "change voice".

### Regenerating ECHO's voice

Run this after changing page text or ECHO's lines in `voice.js` (needs Python 3.10–3.12, ffmpeg and Google Chrome):

```sh
python3.12 -m venv .venv && .venv/bin/pip install -r tools/voice/requirements.txt
.venv/bin/python tools/voice/generate.py
```

Only new or changed sentences are rendered. Set `ECHO_MODEL` (and `ECHO_SPEAKER` for multi-speaker models) to try another Coqui voice.
- **Try saying** — "help", "phase three", "emergence", "worlds", "physics engine", "gravity moon", "orbit", "reset", "read this page".

## Run locally

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

Then visit http://localhost:8000.

## Deploy

The site is hosted on Vercel as the `phases` project:

```sh
vercel deploy --prod
```
