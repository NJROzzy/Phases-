const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- Expand / collapse phases ----------
const phases = [...document.querySelectorAll(".phase")];

function setOpen(phase, open) {
  phase.classList.toggle("open", open);
  phase.querySelector(".phase-head").setAttribute("aria-expanded", String(open));
}

phases.forEach((phase) => {
  phase.querySelector(".phase-head").addEventListener("click", () => {
    setOpen(phase, !phase.classList.contains("open"));
  });
});

if (phases[0]) setOpen(phases[0], true);

// ---------- Scroll reveal (staggered) ----------
phases.forEach((phase, i) => phase.style.setProperty("--d", `${i * 0.08}s`));

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("in");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
);
document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));

// ---------- Scroll progress + timeline fill ----------
const progress = document.querySelector(".progress");
const timeline = document.querySelector(".timeline");

function onScroll() {
  const max = document.documentElement.scrollHeight - innerHeight;
  progress.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;

  if (!timeline) return;
  const rect = timeline.getBoundingClientRect();
  const fill = (innerHeight * 0.6 - rect.top) / rect.height;
  timeline.style.setProperty("--fill", Math.min(1, Math.max(0, fill)).toFixed(3));
}
addEventListener("scroll", onScroll, { passive: true });
addEventListener("resize", onScroll);
onScroll();

// ---------- Cursor glow ----------
const glow = document.querySelector(".glow");
const mouse = { x: innerWidth / 2, y: innerHeight / 2, active: false };
const glowPos = { x: mouse.x, y: mouse.y };

addEventListener("pointermove", (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.active = true;
});
document.addEventListener("pointerleave", () => (mouse.active = false));

// ---------- Particle field background ----------
const canvas = document.getElementById("field");
const ctx = canvas.getContext("2d");
let particles = [];
let w = 0;
let h = 0;
const dpr = Math.min(window.devicePixelRatio || 1, 2);

function resize() {
  w = innerWidth;
  h = innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const count = Math.round(Math.min(110, (w * h) / 14000));
  particles = Array.from({ length: count }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.3,
    r: Math.random() * 1.4 + 0.4,
    depth: Math.random() * 0.8 + 0.2,
  }));
}
addEventListener("resize", resize);
resize();

const LINK = 130;

function drawField() {
  ctx.clearRect(0, 0, w, h);
  const parallax = scrollY * 0.15;

  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;

    // Gently push particles away from the cursor
    if (mouse.active) {
      const dx = p.x - mouse.x;
      const dy = (((p.y - parallax * p.depth) % h) + h) % h - mouse.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 120 * 120 && d2 > 0) {
        const f = (1 - Math.sqrt(d2) / 120) * 0.6;
        p.x += (dx / Math.sqrt(d2)) * f;
        p.y += (dy / Math.sqrt(d2)) * f;
      }
    }

    if (p.x < -10) p.x = w + 10;
    if (p.x > w + 10) p.x = -10;
    if (p.y < -10) p.y = h + 10;
    if (p.y > h + 10) p.y = -10;
  }

  // Connection lines
  for (let i = 0; i < particles.length; i++) {
    const a = particles[i];
    const ay = (((a.y - parallax * a.depth) % h) + h) % h;
    for (let j = i + 1; j < particles.length; j++) {
      const b = particles[j];
      const by = (((b.y - parallax * b.depth) % h) + h) % h;
      const dx = a.x - b.x;
      const dy = ay - by;
      const d = Math.hypot(dx, dy);
      if (d < LINK) {
        ctx.strokeStyle = `rgba(255,255,255,${(1 - d / LINK) * 0.14})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, ay);
        ctx.lineTo(b.x, by);
        ctx.stroke();
      }
    }
  }

  // Lines to cursor
  if (mouse.active) {
    for (const p of particles) {
      const py = (((p.y - parallax * p.depth) % h) + h) % h;
      const d = Math.hypot(p.x - mouse.x, py - mouse.y);
      if (d < 180) {
        ctx.strokeStyle = `rgba(255,255,255,${(1 - d / 180) * 0.25})`;
        ctx.beginPath();
        ctx.moveTo(p.x, py);
        ctx.lineTo(mouse.x, mouse.y);
        ctx.stroke();
      }
    }
  }

  // Dots
  for (const p of particles) {
    const py = (((p.y - parallax * p.depth) % h) + h) % h;
    ctx.fillStyle = `rgba(255,255,255,${0.25 + p.depth * 0.55})`;
    ctx.beginPath();
    ctx.arc(p.x, py, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------- Orbit (cycle section) ----------
const orbit = document.querySelector(".orbit");
const arm = document.querySelector(".orbit-arm");
const label = document.getElementById("ring-label");
const num = document.getElementById("ring-num");
const names = phases.map((p) => p.querySelector(".phase-title").textContent);
const PERIOD = 12000; // ms per full turn

const dots = !orbit ? [] : names.map((_, i) => {
  const dot = document.createElement("span");
  dot.className = "orbit-dot";
  const angle = (i / names.length) * Math.PI * 2 - Math.PI / 2;
  dot.style.left = `${50 + Math.cos(angle) * 50}%`;
  dot.style.top = `${50 + Math.sin(angle) * 50}%`;
  orbit.appendChild(dot);
  return dot;
});

let current = -1;
function showPhase(i) {
  if (!orbit || i === current) return;
  current = i;
  dots.forEach((d, k) => d.classList.toggle("on", k === i));
  label.classList.add("swap");
  setTimeout(() => {
    label.textContent = names[i];
    num.textContent = String(i + 1).padStart(2, "0");
    label.classList.remove("swap");
  }, 250);
}
showPhase(0);

// ---------- Main loop ----------
function frame(t) {
  glowPos.x += (mouse.x - glowPos.x) * 0.08;
  glowPos.y += (mouse.y - glowPos.y) * 0.08;
  glow.style.transform = `translate3d(${glowPos.x}px, ${glowPos.y}px, 0)`;

  drawField();

  if (orbit) {
    const turn = (t % PERIOD) / PERIOD;
    arm.style.transform = `rotate(${turn * 360}deg)`;
    // Highlight the phase the arm is passing through (centred on each dot)
    showPhase(Math.floor((turn * names.length + 0.5) % names.length));
  }

  requestAnimationFrame(frame);
}

if (reduceMotion) {
  drawField();
} else {
  requestAnimationFrame(frame);
}

document.getElementById("year").textContent = new Date().getFullYear();
