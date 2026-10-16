// A tiny 2D physics engine for the Worlds page playground.
(() => {
  const canvas = document.getElementById("sandbox");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const DT = 1 / 120;
  const RESTITUTION = 0.82;
  const MAX_BODIES = 140;

  const GRAVITY = {
    earth: { label: "Earth", g: 900 },
    moon: { label: "Moon", g: 150 },
    zero: { label: "Zero-G", g: 0 },
    orbit: { label: "Orbit", g: 0 },
  };

  let mode = "earth";
  let bodies = [];
  let steps = 0;
  let w = 0;
  let h = 0;

  const hudBodies = document.getElementById("hud-bodies");
  const hudSteps = document.getElementById("hud-steps");
  const hudGravity = document.getElementById("hud-gravity");

  function resize() {
    const rect = canvas.getBoundingClientRect();
    w = rect.width;
    h = rect.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function addBody(x, y, vx, vy) {
    if (bodies.length >= MAX_BODIES) bodies.shift();
    const r = 6 + Math.random() * 14;
    bodies.push({
      x, y,
      vx: vx ?? (Math.random() - 0.5) * 300,
      vy: vy ?? (Math.random() - 0.5) * 300,
      r,
      m: r * r,
      shade: 120 + Math.floor(Math.random() * 135),
      trail: [],
    });
  }

  function seed() {
    bodies = [];
    steps = 0;
    for (let i = 0; i < 18; i++) {
      addBody(40 + Math.random() * (w - 80), 40 + Math.random() * (h * 0.5));
    }
  }

  function setMode(next) {
    mode = next;
    document.querySelectorAll("[data-gravity]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.gravity === next))
    );
    hudGravity.textContent = GRAVITY[next].label;

    if (next === "orbit") {
      // Give every body a sideways push so it circles the centre
      const cx = w / 2;
      const cy = h / 2;
      for (const b of bodies) {
        const dx = b.x - cx;
        const dy = b.y - cy;
        const d = Math.max(30, Math.hypot(dx, dy));
        const speed = Math.sqrt(4e6 / d) * 0.9;
        b.vx = (-dy / d) * speed;
        b.vy = (dx / d) * speed;
      }
    }
  }

  // ----- one fixed step of the engine -----
  function step() {
    const g = GRAVITY[mode].g;
    const cx = w / 2;
    const cy = h / 2;

    // 1. forces + 2. integrate (semi-implicit Euler)
    for (const b of bodies) {
      if (mode === "orbit") {
        const dx = cx - b.x;
        const dy = cy - b.y;
        const d2 = Math.max(900, dx * dx + dy * dy);
        const a = 4e6 / d2;
        const d = Math.sqrt(d2);
        b.vx += (dx / d) * a * DT;
        b.vy += (dy / d) * a * DT;
      } else {
        b.vy += g * DT;
      }
      b.x += b.vx * DT;
      b.y += b.vy * DT;

      // Walls
      if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx) * RESTITUTION; }
      if (b.x + b.r > w) { b.x = w - b.r; b.vx = -Math.abs(b.vx) * RESTITUTION; }
      if (b.y - b.r < 0) { b.y = b.r; b.vy = Math.abs(b.vy) * RESTITUTION; }
      if (b.y + b.r > h) {
        b.y = h - b.r;
        b.vy = -Math.abs(b.vy) * RESTITUTION;
        b.vx *= 0.995; // floor friction
      }
    }

    // 3. detect collisions (broad phase: sort by x, sweep) + 4. resolve
    bodies.sort((a, b) => a.x - b.x);
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        if (b.x - b.r > a.x + a.r) break; // nothing further can touch a
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const overlap = a.r + b.r - dist;
        if (overlap <= 0 || dist === 0) continue;

        const nx = dx / dist;
        const ny = dy / dist;
        const total = a.m + b.m;

        // Positional correction: push apart in proportion to mass
        a.x -= nx * overlap * (b.m / total);
        a.y -= ny * overlap * (b.m / total);
        b.x += nx * overlap * (a.m / total);
        b.y += ny * overlap * (a.m / total);

        // Impulse along the contact normal
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel > 0) continue;
        const jImp = (-(1 + RESTITUTION) * rel) / (1 / a.m + 1 / b.m);
        a.vx -= (jImp / a.m) * nx;
        a.vy -= (jImp / a.m) * ny;
        b.vx += (jImp / b.m) * nx;
        b.vy += (jImp / b.m) * ny;
      }
    }

    // 5. advance time
    steps++;
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);

    if (mode === "orbit") {
      ctx.fillStyle = "#fff";
      ctx.shadowColor = "rgba(255,255,255,0.8)";
      ctx.shadowBlur = 30;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    for (const b of bodies) {
      b.trail.push(b.x, b.y);
      if (b.trail.length > 24) b.trail.splice(0, 2);
      ctx.strokeStyle = `rgba(${b.shade},${b.shade},${b.shade},0.25)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < b.trail.length; i += 2) {
        if (i === 0) ctx.moveTo(b.trail[i], b.trail[i + 1]);
        else ctx.lineTo(b.trail[i], b.trail[i + 1]);
      }
      ctx.stroke();

      const grad = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.1, b.x, b.y, b.r);
      grad.addColorStop(0, `rgb(${Math.min(255, b.shade + 60)},${Math.min(255, b.shade + 60)},${Math.min(255, b.shade + 60)})`);
      grad.addColorStop(1, `rgb(${b.shade * 0.35},${b.shade * 0.35},${b.shade * 0.35})`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }

    hudBodies.textContent = bodies.length;
    hudSteps.textContent = steps.toLocaleString();
  }

  // Fixed-timestep loop with an accumulator
  let last = performance.now();
  let acc = 0;
  let visible = true;

  function loop(now) {
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    if (visible) {
      while (acc >= DT) {
        step();
        acc -= DT;
      }
      draw();
    } else {
      acc = 0;
    }
    requestAnimationFrame(loop);
  }

  new IntersectionObserver(([entry]) => (visible = entry.isIntersecting)).observe(canvas);

  canvas.addEventListener("pointerdown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    for (let i = 0; i < 4; i++) addBody(x + (Math.random() - 0.5) * 20, y + (Math.random() - 0.5) * 20);
    if (mode === "orbit") setMode("orbit");
  });

  document.querySelectorAll("[data-gravity]").forEach((btn) =>
    btn.addEventListener("click", () => setMode(btn.dataset.gravity))
  );
  document.getElementById("sandbox-reset").addEventListener("click", () => {
    seed();
    setMode(mode);
  });

  addEventListener("resize", () => {
    resize();
    for (const b of bodies) {
      b.x = Math.min(Math.max(b.r, b.x), w - b.r);
      b.y = Math.min(Math.max(b.r, b.y), h - b.r);
    }
  });

  resize();
  seed();
  requestAnimationFrame(loop);
})();
