# Phases of NJR

**Live site: [phases-pi.vercel.app](https://phases-pi.vercel.app)**

The story of Nitish John Rawat (NJR), told in seven phases: foundations, robots that learn,
research, building, teaching, current projects, and what's next. It opens with
**"What do you want to know about NJR?"**, which answers questions from the story itself
(`story.js`, no server needed) and links to the matching chapter.

The current projects:

| Phase | Project | Live site |
|---|---|---|
| 01 · Layers | [Layerschecklist](https://github.com/NJROzzy/Layerschecklist): my AI/ML/DL learning log | [layerschecklist.vercel.app](https://layerschecklist.vercel.app) |
| 02 · Agent | [AI-Agentic-Modal-Collaborative-](https://github.com/NJROzzy/AI-Agentic-Modal-Collaborative-): agentic AI, built with SA | [evolutionofaiagents-njr.vercel.app](https://evolutionofaiagents-njr.vercel.app) |
| 03 · Quantum | [QuantumApplications](https://github.com/NJROzzy/QuantumApplications): an interactive quantum field guide | [quantumapplicationsbynjr.vercel.app](https://quantumapplicationsbynjr.vercel.app) |

## Repository

`index.html`, `script.js`, `story.js` and `styles.css` make up the static site; there is no build step.
To add a phase, copy one of the `.phase` items in `index.html`. To teach the Ask box something new, add an entry to `ANSWERS` in `story.js`.

## Run locally

```sh
npm run serve        # http://localhost:8080
```

## Tests

```sh
npm ci && npx playwright test
```

GitHub Actions runs the browser tests (desktop and mobile) on every push.

## Deploy

The site is hosted on Vercel as the `phases` project: `vercel deploy --prod`.
