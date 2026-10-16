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
