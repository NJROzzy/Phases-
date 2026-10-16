// PHASES laboratory: experiment workspace, live dashboard, playback and history.
// Talks to the API in live mode; replays a recorded run in demo mode.
import { Api, ApiError } from "./api.js";
import { apiBase, setApiBase } from "./config.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const PHASES = ["conception", "initialization", "execution", "emergence", "observation", "termination"];
const FINAL = new Set(["completed", "cancelled", "failed"]);
const STATUS = { active: "running" };

// Parameter groups for the ecosystem form. Unknown parameters (from future
// models) fall into "Other", so the form still works for any schema.
const GROUPS = [
  ["World", ["width", "height", "max_steps"]],
  ["Population", ["initial_population", "max_population", "initial_energy", "max_age"]],
  ["Resources", ["resource_capacity", "resource_regrowth", "resource_reseed", "initial_resource_fill", "intake"]],
  ["Energy budget", ["metabolism", "move_cost", "sense_cost", "reproduction_threshold", "offspring_share"]],
  ["Behaviour", ["movement", "greedy_probability"]],
  ["Evolution", ["initial_speed", "initial_sense", "mutation_sd"]],
];

const state = {
  mode: "connecting", // live | demo
  api: null,
  model: null, // model description incl. config_schema
  demo: null,
  exp: null,
  run: null,
  series: {},
  frames: [],
  ws: null,
  replay: null,
  playTimer: 0,
  marker: null,
  parent: null,
};

const el = {
  status: $("#lab-status"),
  form: $("#exp-form"),
  groups: $("#param-groups"),
  formError: $("#form-error"),
  runBtn: $("#run-btn"),
  pauseBtn: $("#pause-btn"),
  cancelBtn: $("#cancel-btn"),
  replayBtn: $("#replay-btn"),
  playBtn: $("#play-btn"),
  scrub: $("#scrub"),
  nextBtn: $("#next-btn"),
  world: $("#world"),
  hudStep: $("#hud-step"),
  hudStatus: $("#hud-status"),
  summary: $("#summary"),
  history: $("#history-list"),
};

// ------------------------------------------------------------------ helpers
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const human = (key) => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const short = (hash) => (hash ? hash.slice(0, 12) : "—");
const num = (v, d = 2) => (v == null || Number.isNaN(v) ? "—" : Number.isInteger(v) ? v.toLocaleString() : v.toFixed(d));
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");

function setStatus(mode, text) {
  el.status.dataset.mode = mode;
  $(".text", el.status).innerHTML = text;
  document.body.dataset.labMode = mode;
}

// ------------------------------------------------------------------ series
function resetSeries() {
  state.series = {};
  state.marker = null;
  dirtyCharts();
}

function addRows(rows) {
  for (const row of rows) for (const k in row) (state.series[k] ||= []).push(row[k]);
  dirtyCharts();
}

const indexOfStep = (step) => {
  const s = state.series.step || [];
  return s[step] === step ? step : s.indexOf(step);
};

// ------------------------------------------------------------------ charts
const CHARTS = [
  { id: "chart-pop", series: [["population", "Population", "#ffffff", []], ["births", "Births", "#9a9a9a", [4, 4]], ["deaths", "Deaths", "#5f5f5f", [2, 3]]] },
  { id: "chart-res", series: [["resource_fraction", "Resources", "#ffffff", []]], range: [0, 1] },
  { id: "chart-traits", series: [["speed_mean", "Speed", "#ffffff", []], ["sense_mean", "Sense", "#9a9a9a", [4, 4]]] },
  { id: "chart-space", series: [["clark_evans", "Clark–Evans R", "#ffffff", []]], ref: 1 },
];

const axis = () => ({
  stroke: "#8f8f8f",
  grid: { stroke: "#1c1c1c", width: 1 },
  ticks: { stroke: "#2a2a2a", width: 1 },
  font: "11px 'JetBrains Mono', monospace",
});

function drawOverlay(u, def) {
  const { ctx, bbox } = u;
  ctx.save();
  ctx.lineWidth = 1;
  if (def.ref != null) {
    const y = u.valToPos(def.ref, "y", true);
    if (y >= bbox.top && y <= bbox.top + bbox.height) {
      ctx.strokeStyle = "#444";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(bbox.left, y);
      ctx.lineTo(bbox.left + bbox.width, y);
      ctx.stroke();
    }
  }
  if (state.marker != null) {
    const x = u.valToPos(state.marker, "x", true);
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x, bbox.top);
    ctx.lineTo(x, bbox.top + bbox.height);
    ctx.stroke();
  }
  ctx.restore();
}

function setupCharts() {
  if (!window.uPlot) return;
  for (const def of CHARTS) {
    const host = document.getElementById(def.id);
    const opts = {
      width: host.clientWidth || 400,
      height: 200,
      padding: [10, 10, 0, 0],
      legend: { show: true, live: true },
      cursor: { drag: { x: false, y: false }, points: { size: 5 } },
      scales: { x: { time: false }, y: def.range ? { range: def.range } : {} },
      axes: [axis(), { ...axis(), size: 46 }],
      series: [
        { label: "step" },
        ...def.series.map(([, label, stroke, dash]) => ({
          label, stroke, dash, width: 1.5, points: { show: false },
          value: (u, v) => (v == null ? "—" : num(v)),
        })),
      ],
      hooks: { draw: [(u) => drawOverlay(u, def)] },
    };
    def.u = new uPlot(opts, [[], ...def.series.map(() => [])], host);
    new ResizeObserver(() => def.u.setSize({ width: host.clientWidth, height: 200 })).observe(host);
  }
}

let chartsDirty = false;
function dirtyCharts() {
  if (chartsDirty) return;
  chartsDirty = true;
  requestAnimationFrame(() => {
    chartsDirty = false;
    for (const def of CHARTS) {
      if (!def.u) continue;
      def.u.setData([state.series.step || [], ...def.series.map(([k]) => state.series[k] || [])]);
    }
  });
}

const redrawCharts = () => CHARTS.forEach((d) => d.u && d.u.redraw(false));

// ------------------------------------------------------------------ world
const wctx = el.world.getContext("2d");
const off = document.createElement("canvas");
const octx = off.getContext("2d");
let image = null;

function drawFrame(fr) {
  if (!fr || !fr.grid) return;
  const { w: W, h: H, data } = fr.grid;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const px = Math.round((el.world.clientWidth || 480) * dpr);
  if (el.world.width !== px) {
    el.world.width = px;
    el.world.height = Math.round((px * H) / W);
  }
  if (off.width !== W || off.height !== H || !image) {
    off.width = W;
    off.height = H;
    image = octx.createImageData(W, H);
  }
  const bytes = atob(data);
  const d = image.data;
  for (let i = 0; i < W * H; i++) {
    const c = (12 + bytes.charCodeAt(i) * 0.3) | 0;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = c;
    d[i * 4 + 3] = 255;
  }
  octx.putImageData(image, 0, 0);
  wctx.imageSmoothingEnabled = false;
  wctx.drawImage(off, 0, 0, el.world.width, el.world.height);

  const n = fr.fields.length;
  const ie = fr.fields.indexOf("energy");
  const cw = el.world.width / W;
  const ch = el.world.height / H;
  wctx.fillStyle = "rgba(255,255,255,0.9)";
  for (let i = 0; i < fr.agents.length; i += n) {
    const e = ie >= 0 ? Math.max(fr.agents[i + ie], 0) : 4;
    const r = Math.min(cw * 0.55, Math.max(1.1 * dpr, (0.7 + Math.sqrt(e) * 0.45) * dpr));
    wctx.beginPath();
    wctx.arc((fr.agents[i] + 0.5) * cw, (fr.agents[i + 1] + 0.5) * ch, r, 0, Math.PI * 2);
    wctx.fill();
  }
  el.hudStep.textContent = `step ${fr.step}`;
  $("#world-empty").hidden = true;
}

// ------------------------------------------------------------------ tiles, phases, meta
function showRow(i) {
  for (const b of $$("#tiles b")) {
    const v = state.series[b.dataset.k]?.[i];
    const f = b.dataset.fmt;
    b.textContent = v == null ? "—" : f === "pct" ? `${Math.round(v * 100)}%` : f ? Number(v).toFixed(+f) : Number(v).toLocaleString();
  }
}
const showLast = () => showRow((state.series.step || []).length - 1);

function setPhase(phase, status) {
  status = STATUS[status] || status;
  const idx = PHASES.indexOf(phase);
  const final = FINAL.has(status);
  $$("#phase-track li").forEach((li, i) => {
    li.classList.toggle("done", i < idx || (final && i === idx));
    li.classList.toggle("current", i === idx && !final);
  });
  $("#phase-track").dataset.status = status;
  el.hudStatus.textContent = status;
}

function setControls({ running = false, paused = false, finished = false } = {}) {
  const demo = state.mode === "demo";
  el.pauseBtn.disabled = !running;
  el.pauseBtn.textContent = paused ? "Resume" : "Pause";
  el.pauseBtn.dataset.echo = paused ? "resume" : "pause";
  el.cancelBtn.disabled = !running;
  el.cancelBtn.textContent = demo ? "Skip to end" : "Cancel";
  el.playBtn.disabled = el.scrub.disabled = !(finished && state.frames.length > 1);
  el.nextBtn.disabled = !finished || demo;
  el.nextBtn.title = demo ? "Connect an API to run the next cycle" : "";
}

function renderMeta() {
  const { exp, run } = state;
  $("#meta-title").textContent = exp ? `${exp.title}${exp.cycle_index ? ` · cycle ${exp.cycle_index + 1}` : ""}` : "—";
  $("#meta-hyp").textContent = exp?.hypothesis || "";
  const rows = [];
  if (exp) {
    rows.push(["Model", `${exp.model_id} v${exp.model_version}`], ["Seed", run?.seed ?? exp.seed], ["Config hash", short(exp.config_hash)]);
    if (exp.change_from_parent && Object.keys(exp.change_from_parent).length) {
      rows.push(["Changed", Object.entries(exp.change_from_parent).map(([k, v]) => `${k} ${v.from} → ${v.to}`).join(", ")]);
    }
  }
  if (run && FINAL.has(run.status)) {
    rows.push(["Metrics hash", short(run.metrics_hash)], ["Ended", `${run.status}${run.termination_reason ? ` (${run.termination_reason.replace("_", " ")})` : ""} at step ${run.steps}`]);
    if (run.violations) rows.push(["Invariant checks", run.violations.length ? `${run.violations.length} violation(s)` : "passed at every step"]);
  }
  $("#meta-list").innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");

  const live = state.mode === "live" && run && run.id !== "demo";
  for (const [id, url] of [["#csv-link", live && state.api.csvUrl(run.id)], ["#bundle-link", live && state.api.bundleUrl(run.id)]]) {
    const a = $(id);
    a.hidden = !(url && FINAL.has(run.status));
    if (url) a.href = url;
  }
}

function renderSummary(run) {
  const s = run?.summary;
  el.summary.hidden = !s;
  if (!s) return;
  const span = (o) => (o && o.start != null ? `${num(o.start)} → ${num(o.end)}` : "—");
  const rows = [
    ["Outcome", s.extinct ? `extinction at step ${s.extinction_step}` : `${s.final_population} agents at the end`],
    ["Peak population", `${s.peak_population} at step ${s.peak_step}`],
    ["Carrying capacity (estimate)", s.carrying_capacity_estimate == null ? "—" : `${num(s.carrying_capacity_estimate, 0)} · mean of second half`],
    ["Population variability (CV)", s.population_cv_second_half == null ? "—" : num(s.population_cv_second_half)],
    ["Births · deaths", `${s.total_births.toLocaleString()} · ${s.total_deaths.toLocaleString()}`],
    ["Deaths from starvation", `${Math.round(s.starvation_share_of_deaths * 100)}%`],
    ["Mean lifespan", s.mean_lifespan == null ? "—" : `${num(s.mean_lifespan, 1)} steps`],
    ["Speed trait", span(s.speed)],
    ["Sense trait", span(s.sense)],
    ["Clustering R", span(s.clark_evans)],
  ];
  if (s.steps_capped) rows.push(["Births refused at cap", `${s.steps_capped} steps`]);
  $("#summary-list").innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
}

// ------------------------------------------------------------------ playback
function stopPlayback() {
  clearInterval(state.playTimer);
  state.playTimer = 0;
  el.playBtn.textContent = "▶";
}

function showFrameIndex(i) {
  const fr = state.frames[i];
  if (!fr) return;
  drawFrame(fr);
  state.marker = fr.step;
  showRow(indexOfStep(fr.step));
  redrawCharts();
}

function enablePlayback() {
  el.scrub.max = Math.max(0, state.frames.length - 1);
  el.scrub.value = el.scrub.max;
  setControls({ finished: true });
}

el.scrub.addEventListener("input", () => {
  stopPlayback();
  showFrameIndex(+el.scrub.value);
});

el.playBtn.addEventListener("click", () => {
  if (state.playTimer) return stopPlayback();
  if (+el.scrub.value >= +el.scrub.max) el.scrub.value = 0;
  el.playBtn.textContent = "❚❚";
  state.playTimer = setInterval(() => {
    const i = +el.scrub.value + 1;
    if (i > +el.scrub.max) return stopPlayback();
    el.scrub.value = i;
    showFrameIndex(i);
  }, 80);
});

// ------------------------------------------------------------------ form
function buildForm(model, values = {}) {
  const props = model.config_schema.properties;
  const used = new Set();
  const groups = GROUPS.map(([name, keys]) => [name, keys.filter((k) => props[k])]);
  groups.forEach(([, keys]) => keys.forEach((k) => used.add(k)));
  const other = Object.keys(props).filter((k) => !used.has(k));
  if (other.length) groups.push(["Other", other]);

  el.groups.innerHTML = groups
    .filter(([, keys]) => keys.length)
    .map(([name, keys]) => `<fieldset><legend>${esc(name)}</legend><div class="field-grid">${keys.map((k) => fieldHtml(k, props[k])).join("")}</div></fieldset>`)
    .join("");
  fillConfig({ ...defaults(model), ...values });
}

function fieldHtml(key, p) {
  const label = esc(p.title || human(key));
  const help = p.description ? `<small>${esc(p.description)}</small>` : "";
  if (p.enum) {
    return `<label class="field"><span class="label">${label}</span><select name="cfg.${key}" data-type="string">${p.enum.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}</select>${help}<em class="err"></em></label>`;
  }
  const min = p.minimum ?? p.exclusiveMinimum;
  const max = p.maximum ?? p.exclusiveMaximum;
  const step = p.type === "integer" ? 1 : "any";
  return `<label class="field"><span class="label">${label}</span><input name="cfg.${key}" type="number" data-type="${p.type}" step="${step}"${min != null ? ` min="${min}"` : ""}${max != null ? ` max="${max}"` : ""}>${help}<em class="err"></em></label>`;
}

const defaults = (model) => Object.fromEntries(Object.entries(model.config_schema.properties).map(([k, p]) => [k, p.default]));

function fillConfig(values) {
  for (const [k, v] of Object.entries(values)) {
    const input = el.form.elements[`cfg.${k}`];
    if (input) input.value = v;
  }
}

function readForm() {
  const f = el.form.elements;
  const config = {};
  for (const input of $$("[name^='cfg.']", el.form)) {
    const key = input.name.slice(4);
    const t = input.dataset.type;
    config[key] = t === "integer" ? parseInt(input.value, 10) : t === "number" ? parseFloat(input.value) : input.value;
  }
  const body = {
    title: f.title.value.trim(),
    hypothesis: f.hypothesis.value.trim(),
    model: state.model.id,
    seed: parseInt(f.seed.value, 10),
    config,
  };
  if (state.parent) {
    body.parent_id = state.parent.id;
    body.change_note = f.change_note.value.trim();
  }
  return body;
}

function clearErrors() {
  el.formError.hidden = true;
  $$(".field.invalid", el.form).forEach((x) => x.classList.remove("invalid"));
  $$(".err", el.form).forEach((x) => (x.textContent = ""));
}

function showErrors(err) {
  if (err instanceof ApiError && Array.isArray(err.detail)) {
    const loose = [];
    for (const d of err.detail) {
      const key = d.loc?.[d.loc.length - 1];
      const input = el.form.elements[`cfg.${key}`] || el.form.elements[key];
      const field = input?.closest(".field");
      if (field) {
        field.classList.add("invalid");
        const msg = $(".err", field);
        if (msg) msg.textContent = d.msg;
      } else loose.push(d.msg);
    }
    if (loose.length) showFormError(loose.join(" "));
    else showFormError("Some parameters are out of range — see the highlighted fields.");
    $(".field.invalid", el.form)?.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
  } else if (err instanceof ApiError) {
    showFormError(String(err.detail));
  } else {
    showFormError("Couldn't reach the laboratory API. Is it still running?");
  }
}

function showFormError(text) {
  el.formError.textContent = text;
  el.formError.hidden = false;
}

function setParent(exp) {
  state.parent = exp;
  $("#cycle-banner").hidden = !exp;
  if (!exp) return;
  $("#cycle-text").textContent = `Cycle ${exp.cycle_index + 2} · follows “${exp.title}”`;
  el.form.elements.title.value = `${exp.title.replace(/ · cycle \d+$/, "")} · cycle ${exp.cycle_index + 2}`;
  el.form.elements.hypothesis.value = exp.hypothesis;
  el.form.elements.seed.value = exp.seed;
  el.form.elements.change_note.value = "";
  fillConfig(exp.config);
}

el.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.mode !== "live") return;
  clearErrors();
  const body = readForm();
  if (!body.title) {
    el.form.elements.title.closest(".field").classList.add("invalid");
    return showFormError("Give the experiment a title.");
  }
  el.runBtn.disabled = true;
  el.runBtn.textContent = "Starting…";
  try {
    const exp = await state.api.createExperiment(body);
    const speed = el.form.elements.speed.value;
    const run = await state.api.startRun(exp.id, { steps_per_second: speed ? +speed : null, frame_every: 5 });
    setParent(null);
    attachRun(exp, run);
    $("#dashboard").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
    refreshHistory();
  } catch (err) {
    showErrors(err);
  } finally {
    el.runBtn.disabled = false;
    el.runBtn.textContent = "Run experiment";
  }
});

$("#seed-dice").addEventListener("click", () => (el.form.elements.seed.value = Math.floor(Math.random() * 2 ** 31)));
$("#defaults-btn").addEventListener("click", () => state.model && fillConfig(defaults(state.model)));
$("#cycle-clear").addEventListener("click", () => setParent(null));

el.nextBtn.addEventListener("click", () => {
  if (state.mode !== "live" || !state.exp) return;
  setParent(state.exp);
  $("#workspace").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  setTimeout(() => el.form.elements.change_note.focus({ preventScroll: true }), reduceMotion ? 0 : 600);
});

// ------------------------------------------------------------------ live runs
function stopAll() {
  stopPlayback();
  if (state.ws) {
    state.ws.onclose = null;
    state.ws.close();
    state.ws = null;
  }
  if (state.replay) {
    state.replay.stop = true;
    state.replay = null;
  }
}

function attachRun(exp, run) {
  stopAll();
  resetSeries();
  state.exp = exp;
  state.run = run;
  state.frames = [];
  renderMeta();
  renderSummary(null);
  setPhase(run.phase, run.status);
  setControls({ running: !FINAL.has(run.status) });
  state.ws = state.api.stream(run.id, {
    onEvent: onLiveEvent,
    onClose: () => {
      if (state.run && !FINAL.has(state.run.status)) setStatus("live", `${statusBase()} · stream closed, <button class="link-btn" id="reconnect">reconnect</button>`);
    },
  });
}

function onLiveEvent(e) {
  switch (e.type) {
    case "hello":
      if (e.rows.length) addRows(e.rows);
      showLast();
      if (e.frame) drawFrame(e.frame);
      setPhase(e.run.phase, e.run.status);
      if (FINAL.has(e.run.status)) loadFinished(state.exp, e.run);
      else setControls({ running: true, paused: e.run.status === "paused" });
      break;
    case "phase": {
      const status = STATUS[e.status] || e.status;
      setPhase(e.phase, status);
      if (!FINAL.has(status)) setControls({ running: true, paused: status === "paused" });
      break;
    }
    case "metrics":
      addRows(e.rows);
      showLast();
      break;
    case "frame":
      state.frames.push(e.frame);
      drawFrame(e.frame);
      break;
    case "done":
    case "error":
      state.api.run(state.run.id).then((run) => loadFinished(state.exp, run, { keepSeries: true }));
      break;
  }
}

async function loadFinished(exp, run, { keepSeries = false } = {}) {
  state.exp = exp;
  state.run = run;
  setPhase("termination", run.status);
  renderMeta();
  renderSummary(run);
  setControls({ finished: true });
  try {
    if (!keepSeries || !(state.series.step || []).length) {
      resetSeries();
      addRows(columnsToRows((await state.api.metrics(run.id)).series));
    }
    state.frames = (await state.api.frames(run.id)).frames;
    enablePlayback();
    showFrameIndex(state.frames.length - 1);
  } catch {
    /* a failed or cancelled-before-start run has no files */
  }
  refreshHistory();
}

function columnsToRows(series) {
  const keys = Object.keys(series);
  const n = series.step?.length || 0;
  return Array.from({ length: n }, (_, i) => Object.fromEntries(keys.map((k) => [k, series[k][i]])));
}

el.pauseBtn.addEventListener("click", async () => {
  if (state.mode === "demo") {
    if (!state.replay) return;
    state.replay.paused = !state.replay.paused;
    setPhase("execution", state.replay.paused ? "paused" : "running");
    return setControls({ running: true, paused: state.replay.paused });
  }
  const action = el.pauseBtn.dataset.echo;
  el.pauseBtn.disabled = true;
  try {
    await state.api.control(state.run.id, action);
  } catch {
    el.pauseBtn.disabled = false;
  }
});

el.cancelBtn.addEventListener("click", async () => {
  if (state.mode === "demo") {
    if (state.replay) state.replay.skip = true;
    return;
  }
  el.cancelBtn.disabled = true;
  try {
    await state.api.control(state.run.id, "cancel");
  } catch {
    el.cancelBtn.disabled = false;
  }
});

// ------------------------------------------------------------------ history
async function refreshHistory() {
  if (state.mode === "demo") return renderDemoHistory();
  let exps;
  try {
    exps = await state.api.experiments();
  } catch {
    return;
  }
  if (!exps.length) {
    el.history.innerHTML = `<p class="muted">Nothing here yet. Your first experiment will appear here.</p>`;
    return;
  }
  const ids = new Set(exps.map((e) => e.id));
  const kids = {};
  const roots = [];
  for (const e of [...exps].reverse()) {
    if (e.parent_id && ids.has(e.parent_id)) (kids[e.parent_id] ||= []).push(e);
    else roots.push(e);
  }
  roots.reverse();
  const node = (e) => `
    <div class="h-node" data-id="${esc(e.id)}">
      <div class="h-head">
        <span class="h-cycle">C${e.cycle_index + 1}</span>
        <b>${esc(e.title)}</b>
        <span class="h-when">${esc(when(e.created_at))}</span>
        <button class="chip h-open" data-id="${esc(e.id)}" aria-expanded="false">Runs</button>
      </div>
      ${e.hypothesis ? `<p class="h-hyp">${esc(e.hypothesis)}</p>` : ""}
      ${e.change_from_parent && Object.keys(e.change_from_parent).length ? `<p class="h-change">Δ ${esc(Object.entries(e.change_from_parent).map(([k, v]) => `${k}: ${v.from} → ${v.to}`).join(" · "))}${e.change_note ? ` — ${esc(e.change_note)}` : ""}</p>` : ""}
      <div class="h-runs" hidden></div>
      ${(kids[e.id] || []).length ? `<div class="h-children">${kids[e.id].map(node).join("")}</div>` : ""}
    </div>`;
  el.history.innerHTML = roots.map(node).join("");
}

el.history.addEventListener("click", async (ev) => {
  const open = ev.target.closest(".h-open");
  if (open) {
    const box = $(".h-runs", open.closest(".h-node"));
    const expanded = open.getAttribute("aria-expanded") === "true";
    open.setAttribute("aria-expanded", String(!expanded));
    box.hidden = expanded;
    if (expanded || state.mode !== "live") return;
    const exp = await state.api.experiment(open.dataset.id);
    box.innerHTML = exp.runs.length
      ? exp.runs.map((r) => `
          <div class="h-run">
            <span class="h-status" data-status="${esc(r.status)}">${esc(r.status)}</span>
            <span>seed ${esc(r.seed)} · ${esc(r.steps)} steps${r.metrics_hash ? ` · ${esc(short(r.metrics_hash))}` : ""}</span>
            <span class="h-actions">
              <button class="chip h-view" data-exp="${esc(exp.id)}" data-run="${esc(r.id)}">View</button>
              ${FINAL.has(r.status) && r.metrics_hash ? `<a class="chip" href="${esc(state.api.csvUrl(r.id))}" download>CSV</a><a class="chip" href="${esc(state.api.bundleUrl(r.id))}" download>Bundle</a>` : ""}
            </span>
          </div>`).join("")
      : `<p class="muted">No runs yet.</p>`;
    return;
  }
  const view = ev.target.closest(".h-view");
  if (view && state.mode === "live") {
    const [exp, run] = await Promise.all([state.api.experiment(view.dataset.exp), state.api.run(view.dataset.run)]);
    $("#dashboard").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
    if (FINAL.has(run.status)) {
      stopAll();
      state.frames = [];
      resetSeries();
      loadFinished(exp, run);
    } else attachRun(exp, run);
  }
});

function renderDemoHistory() {
  const e = state.demo.experiment;
  el.history.innerHTML = `
    <div class="h-node">
      <div class="h-head"><span class="h-cycle">C1</span><b>${esc(e.title)}</b><span class="h-when">recorded demo</span></div>
      <p class="h-hyp">${esc(e.hypothesis)}</p>
      <p class="muted">Connect a laboratory API to keep your own experiments and cycles here.</p>
    </div>`;
}

// ------------------------------------------------------------------ demo mode
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function playDemo() {
  stopAll();
  const demo = state.demo;
  const replay = (state.replay = { stop: false, paused: false, skip: false });
  resetSeries();
  state.exp = demo.experiment;
  state.run = { ...demo.run, status: "running", phase: "conception" };
  state.frames = [];
  renderMeta();
  renderSummary(null);
  setControls({ running: true });

  const rows = columnsToRows(demo.series);
  const fe = demo.run.frame_every;
  const pause = async (ms) => {
    await wait(ms);
    while (replay.paused && !replay.stop && !replay.skip) await wait(100);
  };

  for (const p of ["conception", "initialization"]) {
    setPhase(p, "running");
    await pause(reduceMotion ? 0 : 450);
    if (replay.stop) return;
  }
  setPhase("execution", "running");
  const perTick = 2; // steps per 50 ms ≈ 40 steps per second
  for (let i = 0; i < rows.length; i += perTick) {
    if (replay.stop) return;
    if (replay.skip || reduceMotion) {
      addRows(rows.slice(i));
      break;
    }
    const chunk = rows.slice(i, i + perTick);
    addRows(chunk);
    showLast();
    for (const r of chunk) {
      if (r.step % fe === 0) {
        const fr = demo.frames[r.step / fe];
        if (fr) {
          state.frames.push(fr);
          drawFrame(fr);
        }
      }
    }
    await pause(50);
  }
  if (replay.stop) return;
  setControls({});
  for (const p of ["emergence", "observation"]) {
    setPhase(p, "running");
    await wait(reduceMotion ? 0 : 400);
    if (replay.stop) return;
  }
  state.replay = null;
  state.run = demo.run;
  state.frames = demo.frames;
  setPhase("termination", demo.run.status);
  renderMeta();
  renderSummary(demo.run);
  enablePlayback();
  showFrameIndex(state.frames.length - 1);
}

el.replayBtn.addEventListener("click", () => state.demo && playDemo());

async function startDemo(failedBase) {
  state.mode = "demo";
  const note = failedBase ? ` Couldn't reach <code>${esc(failedBase)}</code>.` : "";
  setStatus("demo", `Demo mode · replaying a recorded run.${note}`);
  $("#demo-notice").hidden = false;
  el.replayBtn.hidden = false;
  $("#run-btn").disabled = true;
  $$("input, select, textarea, button", el.form).forEach((x) => (x.disabled = true));
  try {
    state.demo = await (await fetch("lab/demo/ecosystem.json")).json();
  } catch {
    setStatus("demo", "Demo mode · the recorded run couldn't be loaded.");
    return;
  }
  state.model = state.demo.model;
  buildForm(state.model, state.demo.experiment.config);
  $$("input, select, textarea, button", el.form).forEach((x) => (x.disabled = true));
  el.form.elements.title.value = state.demo.experiment.title;
  el.form.elements.hypothesis.value = state.demo.experiment.hypothesis;
  el.form.elements.seed.value = state.demo.experiment.seed;
  renderDemoHistory();
  // Show the first frame now; start the replay when the dashboard comes into view
  drawFrame(state.demo.frames[0]);
  state.exp = state.demo.experiment;
  renderMeta();
  const io = new IntersectionObserver((entries) => {
    if (entries.some((x) => x.isIntersecting)) {
      io.disconnect();
      playDemo();
    }
  }, { threshold: 0.25 });
  io.observe($("#phase-track"));
}

$("#connect-form").addEventListener("submit", (e) => {
  e.preventDefault();
  setApiBase($("#api-url").value.trim());
  location.reload();
});

// ------------------------------------------------------------------ start
let baseLabel = "";
const statusBase = () => baseLabel;

document.addEventListener("click", (e) => {
  if (e.target.id === "reconnect" && state.run) {
    state.api.run(state.run.id).then((run) => (FINAL.has(run.status) ? loadFinished(state.exp, run) : attachRun(state.exp, run)));
    setStatus("live", statusBase());
  }
  if (e.target.id === "disconnect") {
    setApiBase("");
    location.search = "?api=";
  }
});

async function init() {
  setupCharts();
  setPhase("conception", "idle");
  const base = apiBase();
  if (base) {
    try {
      const api = new Api(base);
      const health = await api.health();
      const models = await api.models();
      state.api = api;
      state.mode = "live";
      state.model = models.find((m) => m.id === "ecosystem") || models[0];
      baseLabel = `Connected to <code>${esc(base)}</code> · engine v${esc(health.engine_version)} · <button class="link-btn" id="disconnect">disconnect</button>`;
      setStatus("live", baseLabel);
      buildForm(state.model);
      setControls({});
      refreshHistory();
      return;
    } catch {
      /* fall through to demo mode */
    }
  }
  startDemo(base);
}

init();
