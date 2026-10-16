// ECHO — the voice interface, boot sequence and HUD shared by every page.
(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const onWorlds = !!document.getElementById("sandbox");
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    sget(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    sset(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
  };

  // ============================================================
  // UI sounds (Web Audio)
  // ============================================================
  let audio = null;
  let soundOn = store.get("phases-sound") !== "off";

  function unlockAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audio) audio = new AC();
    if (audio.state === "suspended") audio.resume();
  }

  function blip(freq = 880, dur = 0.07, type = "sine", vol = 0.035) {
    if (!soundOn || !audio || audio.state !== "running") return;
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.5, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  document.addEventListener("pointerdown", unlockAudio, { once: true });
  document.addEventListener("click", (e) => {
    if (e.target.closest("a, button")) blip(1200, 0.05, "square", 0.02);
  });
  document.addEventListener("pointerover", (e) => {
    const el = e.target.closest(".phase-head, .chip, .nav a, .button, .domain");
    if (el && !el.contains(e.relatedTarget)) blip(2400, 0.03, "sine", 0.012);
  });

  // ============================================================
  // Speech synthesis
  // ============================================================
  const synth = window.speechSynthesis;
  let voice = null;
  let speakToken = 0;
  let currentUtterance = null; // held so Chrome doesn't garbage-collect it before onend
  let safetyTimer = 0;

  let voices = []; // English voices, most natural first

  // Rank voices so neural / premium ones win over robotic system defaults
  const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|kathy|hysterical|deranged|pipe|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley/i;
  const FAVOURITES = /ava|zoe|allison|samantha|evan|nathan|jenny|aria|guy|libby|sonia|ryan|natasha|serena|daniel|moira|karen/i;
  function scoreVoice(v) {
    let s = 0;
    if (/natural|neural/i.test(v.name)) s += 120;
    if (/online/i.test(v.name)) s += 40;
    if (/premium/i.test(v.name)) s += 100;
    if (/enhanced/i.test(v.name)) s += 80;
    if (/^google/i.test(v.name)) s += 60;
    if (FAVOURITES.test(v.name)) s += 25;
    if (/^en-(US|GB)/i.test(v.lang)) s += 10;
    if (!v.localService) s += 5;
    if (NOVELTY.test(v.name)) s -= 500;
    return s;
  }

  function loadVoices() {
    if (!synth) return;
    voices = synth
      .getVoices()
      .filter((v) => /^en/i.test(v.lang) && !NOVELTY.test(v.name))
      .sort((a, b) => scoreVoice(b) - scoreVoice(a));
    const saved = store.get("phases-voice");
    voice = voices.find((v) => v.name === saved) || voices[0] || null;
    renderVoiceSelect && renderVoiceSelect();
  }
  let renderVoiceSelect = null;
  if (synth) {
    loadVoices();
    synth.addEventListener?.("voiceschanged", loadVoices);
  }

  function setVoice(v, announce = true) {
    if (!v) return;
    voice = v;
    store.set("phases-voice", v.name);
    renderVoiceSelect && renderVoiceSelect();
    if (announce) speak(`Hi, this is how I sound now. Do you like it?`);
  }

  // Split into sentences so each gets a natural pause (and Chrome doesn't cut off long speech)
  const sentences = (t) => t.match(/[^.!?]+[.!?]+["”’]?|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) || [t];

  function speak(text, onDone) {
    log("echo", text);
    const token = ++speakToken;
    if (!synth) { onDone && setTimeout(onDone, 1200); return; }
    synth.cancel();
    const finish = () => {
      if (token !== speakToken) return; // cancelled by a newer utterance
      speakToken++;
      clearTimeout(safetyTimer);
      setState(listening ? "listening" : "idle");
      onDone && onDone();
    };
    // Natural voices sound best at their default pitch and a relaxed pace
    const natural = voice && scoreVoice(voice) >= 60;
    const parts = sentences(text);
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part);
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      u.rate = natural ? 1 : 0.95;
      u.pitch = 1;
      u.onstart = () => setState("speaking");
      if (i === parts.length - 1) {
        u.onend = finish;
        currentUtterance = u;
      }
      u.onerror = (e) => { if (e.error !== "interrupted" && e.error !== "canceled") finish(); };
      synth.speak(u);
    });
    // Some browsers never fire onend; fall back to an estimate of the speaking time
    clearTimeout(safetyTimer);
    safetyTimer = setTimeout(finish, 2500 + text.split(/\s+/).length * 450 + parts.length * 300);
    setState("speaking");
  }

  function stopSpeaking() {
    speakToken++;
    synth && synth.cancel();
    narrating = false;
    $$(".speaking").forEach((el) => el.classList.remove("speaking"));
    setState(listening ? "listening" : "idle");
  }

  // ============================================================
  // Narration (guided tour of the current page)
  // ============================================================
  const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  let narrating = false;

  function buildScript() {
    if (onWorlds) {
      return [
        { el: $(".hero"), say: text($(".lede")) },
        ...$$(".domain").map((d) => ({ el: d, say: `${text($("h3", d))}, measured in ${text($(".scale", d)).toLowerCase().replace(" · ", " and ")}. ${text($(":scope > p:not(.domain-num):not(.scale)", d))}` })),
        { el: $("#engine"), say: `Inside the physics engine. ${text($("#engine .section-intro"))}` },
        ...$$(".loop-step").map((s, i) => ({ el: s, say: `Step ${i + 1}: ${text($("h4", s))}. ${text($("p", s))}` })),
        { el: $("#playground"), say: `${text($("#playground .section-intro"))} Go on, try saying gravity moon.` },
      ];
    }
    return [
      { el: $(".hero"), say: text($(".lede")) },
      ...$$(".phase").map((p, i) => ({
        el: p,
        open: p,
        say: `Phase ${i + 1}: ${text($(".phase-title", p))}. ${text($(".phase-body p", p))}`,
      })),
      { el: $("#cycle"), say: text($("#cycle .section-intro")) },
      { el: $("#about"), say: `${text($("#about p"))} If you're curious, say worlds, and I'll take you to the simulated worlds.` },
    ];
  }

  function openPhase(p) {
    $$(".phase").forEach((x) => {
      const open = x === p;
      x.classList.toggle("open", open);
      $(".phase-head", x).setAttribute("aria-expanded", String(open));
    });
  }

  function focusEl(el) {
    $$(".speaking").forEach((x) => x.classList.remove("speaking"));
    if (!el) return;
    el.classList.add("speaking", "in");
    el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  }

  function narrate() {
    const script = buildScript().filter((s) => s.el && s.say);
    narrating = true;
    let i = 0;
    const next = () => {
      if (!narrating) return;
      if (i >= script.length) {
        narrating = false;
        focusEl(null);
        speak("And that's the tour. If you want to explore more, just ask me for help.");
        return;
      }
      const s = script[i++];
      if (s.open) openPhase(s.open);
      focusEl(s.el);
      speak(s.say, next);
    };
    next();
  }

  // ============================================================
  // Commands (voice or typed)
  // ============================================================
  const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6 };

  function go(url, line) {
    speak(line);
    setTimeout(() => (location.href = url), 1100);
  }

  function scrollToId(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }

  function findPhase(t) {
    const phases = $$(".phase");
    const byName = phases.find((p) => t.includes(text($(".phase-title", p)).toLowerCase()));
    if (byName) return byName;
    const m = t.match(/phase\s+(\d|one|two|three|four|five|six|first|second|third|fourth|fifth|sixth)\b/);
    if (!m) return null;
    const n = NUMBERS[m[1]] || parseInt(m[1], 10);
    return phases[n - 1] || null;
  }

  const HELP = onWorlds
    ? "Sure. You can ask me to read this page, or jump to robotics, the environment, or the universe. I can show you the physics engine, or the playground. There, try gravity moon, zero, or orbit, or say reset. Say home to go back, or stop whenever you like."
    : "Sure. You can ask me to read this page, or say a phase, like phase three, or emergence. I can show you the cycle, take you to the worlds, or the physics engine. And say stop whenever you like.";

  function handleCommand(raw) {
    const t = raw.toLowerCase().replace(/[.,!?]/g, "").trim();
    if (!t) return;
    log("you", raw);
    blip(660, 0.08, "triangle", 0.03);

    if (/\b(stop|quiet|silence|shut up|pause|cancel)\b/.test(t)) { stopSpeaking(); log("echo", "Okay, I'll be quiet."); return; }
    if (/\b(help|commands|what can (you|i) (do|say))\b/.test(t)) return speak(HELP);
    if (/\b(change|next|switch|another|different) (your )?voice\b/.test(t)) {
      if (voices.length < 2) return speak("This browser only gives me one voice, I'm afraid.");
      const i = voices.indexOf(voice);
      return setVoice(voices[(i + 1) % voices.length]);
    }
    if (/\b(read|narrate|tour|guide|explain this)\b/.test(t)) return narrate();
    if (/\b(hello|hi|hey|who are you)\b/.test(t)) return speak("Hey there! I'm Echo. I can show you around, or read things out for you. Just ask.");
    if (/\btime\b/.test(t)) return speak(`It's ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}, at least in your world.`);
    if (/\b(top|beginning|start)\b/.test(t) || (!onWorlds && /\bhome\b/.test(t))) { scrollTo({ top: 0, behavior: "smooth" }); return speak("Okay, back to the top."); }
    if (/\bscroll down|down\b/.test(t)) { scrollBy({ top: innerHeight * 0.8, behavior: "smooth" }); return; }
    if (/\bscroll up|up\b/.test(t)) { scrollBy({ top: -innerHeight * 0.8, behavior: "smooth" }); return; }

    if (onWorlds) {
      const g = t.match(/\b(earth|moon|zero|orbit)\b/);
      if (g && (/\bgravity|mode|switch|set\b/.test(t) || g[1] !== "earth")) {
        $(`[data-gravity="${g[1]}"]`).click();
        scrollToId("playground");
        return speak(g[1] === "orbit" ? "Orbit mode. Watch them all swing around the star." : { earth: "Back to Earth gravity. Everything falls normally again.", moon: "Moon gravity. Things float down nice and slowly now.", zero: "Zero gravity. Nothing's holding them down anymore." }[g[1]]);
      }
      if (/\breset|restart\b/.test(t)) { $("#sandbox-reset").click(); scrollToId("playground"); return speak("Done. Fresh start."); }
      if (/\b(drop|add|spawn)\b/.test(t)) {
        const c = $("#sandbox");
        const r = c.getBoundingClientRect();
        c.dispatchEvent(new PointerEvent("pointerdown", { clientX: r.left + r.width * (0.2 + Math.random() * 0.6), clientY: r.top + 60 }));
        scrollToId("playground");
        return speak("Here come a few more.");
      }
      const domains = $$(".domain");
      const d = /robot/.test(t) ? 0 : /environment|climate|weather|planet/.test(t) ? 1 : /universe|galax|cosmo|space/.test(t) ? 2 : -1;
      if (d >= 0) { focusEl(domains[d]); return speak(`${text($("h3", domains[d]))}. ${text($(":scope > p:not(.domain-num):not(.scale)", domains[d]))}`); }
      if (/\b(engine|physics)\b/.test(t)) { scrollToId("engine"); return speak(text($("#engine .section-intro"))); }
      if (/\b(playground|sandbox|demo)\b/.test(t)) { scrollToId("playground"); return speak("Here's the playground. Tap inside to drop things in, or tell me which gravity you'd like."); }
      if (/\b(home|phases|back|life stages)\b/.test(t)) return go("index.html", "Sure, heading back to the phases.");
    } else {
      const p = findPhase(t);
      if (p) { openPhase(p); focusEl(p); return speak(`${text($(".phase-title", p))}. ${text($(".phase-body p", p))}`); }
      if (/\b(stages|phases|timeline)\b/.test(t)) { scrollToId("stages"); return speak("Here they are. The six phases of a simulation's life."); }
      if (/\bcycle\b/.test(t)) { scrollToId("cycle"); return speak(text($("#cycle .section-intro"))); }
      if (/\babout\b/.test(t)) { scrollToId("about"); return speak(text($("#about p"))); }
      if (/\b(engine|physics)\b/.test(t)) return go("worlds.html#engine", "Sure, let's look inside the physics engine.");
      if (/\b(playground|sandbox|demo|gravity)\b/.test(t)) return go("worlds.html#playground", "Let's go play with some physics.");
      if (/\b(world|worlds|robot|robotics|environment|universe|climate|galaxy)\b/.test(t)) return go("worlds.html", "Sure, let's go to the worlds.");
    }

    speak("Sorry, I didn't quite catch that. Say help, and I'll tell you what I can do.");
  }

  // ============================================================
  // Speech recognition
  // ============================================================
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let listening = false;

  if (SR) {
    rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const r = e.results[e.results.length - 1];
      const said = r[0].transcript;
      input.value = said;
      if (r.isFinal) {
        input.value = "";
        handleCommand(said);
      }
    };
    rec.onend = () => {
      listening = false;
      dock.classList.remove("is-listening");
      micBtn.setAttribute("aria-pressed", "false");
      if (state === "listening") setState("idle");
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") log("sys", "Microphone access was blocked. You can still type commands.");
      else if (e.error === "no-speech") log("sys", "I didn't hear anything.");
      else if (e.error !== "aborted") log("sys", `Voice error: ${e.error}`);
    };
  }

  function toggleListening() {
    unlockAudio();
    if (!rec) {
      openPanel(true);
      log("sys", "Voice input isn't supported in this browser. Type a command below — try Chrome, Edge or Safari for voice.");
      input.focus();
      return;
    }
    if (listening) { rec.stop(); return; }
    stopSpeaking();
    try {
      rec.start();
      listening = true;
      dock.classList.add("is-listening");
      micBtn.setAttribute("aria-pressed", "true");
      setState("listening");
      openPanel(true);
      blip(520, 0.12, "sine", 0.04);
    } catch {}
  }

  // ============================================================
  // Dock UI
  // ============================================================
  const dock = document.createElement("div");
  dock.className = "dock";
  dock.setAttribute("role", "region");
  dock.setAttribute("aria-label", "ECHO voice assistant");
  dock.innerHTML = `
    <div class="dock-panel" id="dock-panel" hidden>
      <div class="dock-log" aria-live="polite"></div>
      <label class="dock-voice">
        <span>voice</span>
        <select aria-label="ECHO voice"></select>
      </label>
      <form class="dock-form">
        <span class="dock-prompt">&gt;</span>
        <input type="text" placeholder="type a command — try “help”" aria-label="Command" autocomplete="off" spellcheck="false">
      </form>
    </div>
    <div class="dock-bar">
      <button class="dock-orb" aria-label="Open ECHO console" aria-expanded="false" aria-controls="dock-panel">
        <canvas width="96" height="28"></canvas>
      </button>
      <div class="dock-status"><b>ECHO</b> <span class="dock-state">online</span></div>
      <button class="dock-btn dock-mic" aria-label="Talk to ECHO (V)" aria-pressed="false" title="Talk (V)">
        <svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
      </button>
      <button class="dock-btn dock-read" aria-label="Narrate this page (N)" title="Narrate (N)">
        <svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path class="wave" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>
      </button>
      <button class="dock-btn dock-sound" aria-label="Toggle interface sounds" aria-pressed="${soundOn}" title="Sounds">
        <svg viewBox="0 0 24 24"><path d="M3 12h3l3-7 4 14 3-7h5"/></svg>
      </button>
    </div>`;
  document.body.appendChild(dock);

  const panel = $(".dock-panel", dock);
  const logEl = $(".dock-log", dock);
  const input = $("input", dock);
  const orb = $(".dock-orb", dock);
  const micBtn = $(".dock-mic", dock);
  const readBtn = $(".dock-read", dock);
  const soundBtn = $(".dock-sound", dock);
  const stateEl = $(".dock-state", dock);

  const voiceSelect = $(".dock-voice select", dock);
  renderVoiceSelect = () => {
    const label = $(".dock-voice", dock);
    label.hidden = !voices.length;
    voiceSelect.replaceChildren(
      ...voices.map((v) => {
        const o = document.createElement("option");
        o.value = v.name;
        const tag = scoreVoice(v) >= 80 ? " ★ natural" : "";
        o.textContent = `${v.name.replace(/^Microsoft |^Google /, "").replace(/ Online \(Natural\)| - English.*$/, "")} (${v.lang})${tag}`;
        o.selected = voice && v.name === voice.name;
        return o;
      })
    );
  };
  renderVoiceSelect();
  voiceSelect.addEventListener("change", () => {
    unlockAudio();
    setVoice(voices.find((v) => v.name === voiceSelect.value));
  });

  function openPanel(open = panel.hidden) {
    panel.hidden = !open;
    orb.setAttribute("aria-expanded", String(open));
  }

  function log(who, msg) {
    const line = document.createElement("p");
    line.className = `log-${who}`;
    line.innerHTML = `<span>${who === "you" ? "you" : who === "sys" ? "sys" : "echo"}</span>`;
    line.append(document.createTextNode(msg));
    logEl.appendChild(line);
    while (logEl.children.length > 30) logEl.firstChild.remove();
    logEl.scrollTop = logEl.scrollHeight;
  }

  let state = "idle";
  function setState(s) {
    state = s;
    dock.dataset.state = s;
    stateEl.textContent = s === "idle" ? "online" : s;
    readBtn.setAttribute("aria-pressed", String(s === "speaking"));
  }
  setState("idle");

  orb.addEventListener("click", () => openPanel());
  micBtn.addEventListener("click", toggleListening);
  readBtn.addEventListener("click", () => {
    unlockAudio();
    if (state === "speaking" || narrating) stopSpeaking();
    else narrate();
  });
  soundBtn.addEventListener("click", () => {
    soundOn = !soundOn;
    store.set("phases-sound", soundOn ? "on" : "off");
    soundBtn.setAttribute("aria-pressed", String(soundOn));
    unlockAudio();
    blip(990, 0.08);
  });
  $(".dock-form", dock).addEventListener("submit", (e) => {
    e.preventDefault();
    unlockAudio();
    const v = input.value;
    input.value = "";
    handleCommand(v);
  });

  addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "v" || e.key === "V") toggleListening();
    else if (e.key === "n" || e.key === "N") readBtn.click();
    else if (e.key === "Escape") stopSpeaking();
  });

  log("sys", rec ? "Press the mic or V to speak. Type “help” for commands." : "Type “help” for commands.");

  // Waveform in the orb
  const wave = $("canvas", orb);
  const wctx = wave.getContext("2d");
  let phase = 0;
  const bars = Array.from({ length: 16 }, () => 0.1);
  function drawWave() {
    phase += 0.08;
    const target = state === "speaking" ? 0.9 : state === "listening" ? 0.6 : 0.12;
    wctx.clearRect(0, 0, 96, 28);
    bars.forEach((b, i) => {
      const goal = state === "idle"
        ? 0.12 + Math.sin(phase + i * 0.5) * 0.08
        : target * (0.3 + Math.random() * 0.7);
      bars[i] += (goal - b) * 0.25;
      const bh = Math.max(2, bars[i] * 24);
      wctx.fillStyle = state === "idle" ? "rgba(255,255,255,0.45)" : "#fff";
      wctx.fillRect(i * 6 + 1, 14 - bh / 2, 3, bh);
    });
    requestAnimationFrame(drawWave);
  }
  if (reduceMotion) { wctx.fillStyle = "rgba(255,255,255,0.45)"; bars.forEach((_, i) => wctx.fillRect(i * 6 + 1, 11, 3, 6)); }
  else requestAnimationFrame(drawWave);

  // ============================================================
  // HUD frame (corner brackets + live readout)
  // ============================================================
  const hud = document.createElement("div");
  hud.className = "hud";
  hud.setAttribute("aria-hidden", "true");
  hud.innerHTML = `<i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i>
    <span class="hud-readout"></span><span class="hud-clock"></span>`;
  document.body.appendChild(hud);
  const readout = $(".hud-readout", hud);
  const clock = $(".hud-clock", hud);
  let mx = 0, my = 0;
  addEventListener("pointermove", (e) => { mx = Math.round(e.clientX); my = Math.round(e.clientY); }, { passive: true });
  function tickHud() {
    const max = document.documentElement.scrollHeight - innerHeight;
    const pct = max > 0 ? Math.round((scrollY / max) * 100) : 0;
    readout.textContent = `X ${String(mx).padStart(4, "0")} · Y ${String(my).padStart(4, "0")} · DEPTH ${String(pct).padStart(3, "0")}%`;
    clock.textContent = `T+ ${new Date().toISOString().slice(11, 19)} UTC`;
  }
  tickHud();
  setInterval(tickHud, 250);

  // ============================================================
  // Decoding headings
  // ============================================================
  const GLYPHS = "01<>/\\#*+=_-[]{}";
  function decode(el) {
    if (el.dataset.decoded) return;
    el.dataset.decoded = "1";
    const final = el.textContent;
    el.setAttribute("aria-label", final);
    const start = performance.now();
    const dur = 700;
    const run = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const done = Math.floor(p * final.length);
      let out = final.slice(0, done);
      for (let i = done; i < final.length; i++) {
        out += final[i] === " " ? " " : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      el.textContent = out;
      if (p < 1) requestAnimationFrame(run);
      else el.textContent = final;
    };
    requestAnimationFrame(run);
  }
  if (!reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { decode(en.target); io.unobserve(en.target); }
      });
    }, { threshold: 0.6 });
    $$("main h2, main h3").forEach((h) => io.observe(h));
  }

  // ============================================================
  // Boot sequence (once per session)
  // ============================================================
  function greet() {
    speak(onWorlds
      ? "Welcome to Worlds! I'm Echo. Press V any time you want to talk to me."
      : "Hi, welcome to Phases! I'm Echo, and I'll be your guide through the life of a simulation. Press V whenever you want to talk to me, or press N, and I'll walk you through it.");
  }

  if (!store.sget("phases-booted")) {
    const boot = document.createElement("div");
    boot.className = "boot";
    boot.setAttribute("role", "dialog");
    boot.setAttribute("aria-label", "Phases boot sequence");
    boot.innerHTML = `<div class="boot-inner">
        <p class="boot-title">PHASES<span>//</span>OS <em>v2.6</em></p>
        <pre class="boot-log"></pre>
        <div class="boot-actions" hidden>
          <button class="boot-enter voice">Enter with voice</button>
          <button class="boot-enter silent">Enter silently</button>
        </div>
      </div>`;
    document.body.appendChild(boot);
    document.documentElement.classList.add("booting");

    const lines = [
      "> calibrating particle field ......... ok",
      "> seeding world state ................ ok",
      "> integrator: semi-implicit euler .... ok",
      `> voice synthesis .................... ${synth ? "online" : "unavailable"}`,
      `> voice recognition .................. ${rec ? "online" : "text only"}`,
      "> ECHO ready.",
    ];
    const pre = $(".boot-log", boot);
    const actions = $(".boot-actions", boot);
    let i = 0;
    const typeLine = () => {
      if (i < lines.length) {
        pre.textContent += lines[i++] + "\n";
        setTimeout(typeLine, reduceMotion ? 0 : 160 + Math.random() * 120);
      } else {
        actions.hidden = false;
        $(".boot-enter.voice", boot).focus();
      }
    };
    setTimeout(typeLine, reduceMotion ? 0 : 400);

    const enter = (withVoice) => {
      store.sset("phases-booted", "1");
      unlockAudio();
      blip(440, 0.25, "sine", 0.05);
      setTimeout(() => blip(880, 0.3, "sine", 0.04), 120);
      boot.classList.add("out");
      document.documentElement.classList.remove("booting");
      setTimeout(() => boot.remove(), 900);
      if (withVoice) setTimeout(greet, 500);
    };
    $(".boot-enter.voice", boot).addEventListener("click", () => enter(true));
    $(".boot-enter.silent", boot).addEventListener("click", () => enter(false));
    boot.addEventListener("keydown", (e) => { if (e.key === "Escape") enter(false); });
  }
})();
