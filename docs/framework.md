# The PHASES scientific framework

This document defines what PHASES means by a simulation, an experiment and a
cycle, and separates **established methods** (which PHASES uses) from
**PHASES's own hypotheses** (which it proposes and aims to test). Anything in
the second group must always be presented as a hypothesis.

## 1. Simulation

A simulation model is a tuple **M = (S, Θ, F, O, τ)**:

| Symbol | Meaning | In code |
|---|---|---|
| S | the state space | the object returned by `Model.init` |
| Θ | parameters θ | `Model.Config` (validated, with bounds) |
| F | step rule, s(t+1) = F(s(t), θ, ξ(t)) | `Model.step(state, cfg, rng)` |
| ξ(t) | randomness, drawn only from a seeded PCG64 generator | the `rng` argument |
| O | observation, y(t) = O(s(t)) | `Model.observe` (must not draw from `rng`) |
| τ | stopping rule | `Model.terminated`, plus `max_steps` |

Because ξ comes from a single seeded generator owned by the runner, and
observation never draws from it, a run is a deterministic function of
(model version, θ, seed, engine version, numpy version).

## 2. Experiment and run

An **experiment** E = (hypothesis H, model M, parameters θ, seeds, parent).
A **run** is one execution of E with one seed. Each configuration is
identified by `config_hash` = SHA-256 of the canonical JSON of
(model id, model version, θ), and each run's output by `metrics_hash`, a
SHA-256 of every metric series (formatted to 10 significant digits). Two runs
with equal metrics hashes are identical replays.

## 3. The six phases as a state machine

```
conception → initialization → execution → emergence → observation → termination
                                  ⇅ paused
         any phase ──cancel / failure──▶ termination (status cancelled / failed)
```

Phases advance one at a time and never go back (`core/lifecycle.py`).
Every transition is timestamped (UTC) in the run's `phase_log`.

| Phase | What happens | Output |
|---|---|---|
| Conception | H and θ are stated and validated; the configuration is hashed | `config`, `config_hash` |
| Initialization | the generator is seeded and the initial state built | y(0) |
| Execution | F is applied until τ; invariants are checked every step | metric series, `violations` |
| Emergence | candidate-pattern detectors run against null models (from release 0.2; none run yet, so nothing is claimed) | `findings` |
| Observation | summary statistics; the hypothesis verdict (from release 0.2) | `summary` |
| Termination | the record is closed and can be exported or used to seed the next cycle | `run.json`, `metrics.csv` |

## 4. Cycles

Cycle k+1 is an experiment whose `parent` is cycle k. It records the change
Δθ, the reason for it, and whether it came from a person or from an AI
suggestion. The cycles of a research question form a lineage tree. Per cycle,
the measurable outcome is the hypothesis verdict (supported / not supported /
inconclusive) with effect size and confidence interval over replicate seeds.

## 5. Emergence: an operational definition

PHASES never reports "emergence" as a fact. A **candidate pattern** is
recorded only when all of the following hold, with the evidence stored:

1. **Macro-level structure.** A population-level statistic departs from what
   the initial conditions alone produce. Examples: spatial clustering
   (Clark–Evans R < 1), periodic population oscillation (a dominant
   autocorrelation peak), directional trait change.
2. **Beats a null model.** Over ≥ 10 seeds it differs from a control in which
   the relevant mechanism is disabled (e.g. random movement instead of
   sensing; shuffled time series for periodicity), using a two-sided test with
   multiple-comparison correction and a reported effect size.
3. **Persistence.** It holds for at least W consecutive steps after burn-in.
4. **Robustness.** It appears in ≥ 80% of seeds.

This is PHASES's *working definition*, chosen to be measurable. It is not a
claim about what emergence fundamentally is.

## 6. Established methods vs. PHASES hypotheses

**Established (PHASES uses these):**

- Agent-based modelling of consumer–resource systems (e.g. Sugarscape,
  Epstein & Axtell 1996; Grimm et al., ODD protocol, 2006/2020).
- Logistic resource regrowth; boom–bust consumer–resource oscillations
  (Lotka–Volterra family).
- Mutation–selection dynamics on heritable traits.
- Clark–Evans nearest-neighbour index (Clark & Evans 1954).
- Seeded pseudo-random generators and provenance capture for reproducible
  computational science (e.g. Sandve et al. 2013, "Ten simple rules").
- Null-model testing and multiple-comparison correction.

**PHASES hypotheses (to be tested, never stated as fact):**

- H1. Structuring research as recursive six-phase cycles, with explicit
  hypotheses and recorded Δθ, reaches a supported or refuted verdict in fewer
  cycles than unstructured parameter exploration.
- H2. The operational emergence criteria in §5 separate mechanism-driven
  patterns from artefacts more reliably than visual inspection.
- H3. AI-suggested follow-up experiments, when kept separate from verified
  findings and approved by a person, increase the information gained per cycle.

## 7. First model: the autonomous-agent ecosystem

See the module docstring in `engine/phases_engine/models/ecosystem.py` for
the full rules and update order. Its measured outputs per step are:
population, births, deaths (starvation / age), resource total and fraction,
mean energy, speed and sense (mean, sd), share of greedy moves, fraction of
founders alive, cumulative mean lifespan, Clark–Evans R, and whether births
were capped. Energy conservation is checked every step.

**Known simplifications** (documented so they are not mistaken for findings):
one agent eats per cell per step; asexual reproduction; children appear in the
parent's cell; Clark–Evans uses deterministic within-cell jitter because
agents live on a grid. The `carrying_capacity_estimate` is simply the mean
population over the second half of a run and is only meaningful if the run
has settled.
