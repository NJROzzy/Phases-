// The storyline: rotating roles, word-by-word headings, counters, the chapter
// rail, and "What do you want to know about NJR?" answered from the story.

const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- Rotating roles ----------
const roles = ["AI/ML engineer", "Software engineer", "Robotics engineer", "Published researcher", "Instructor"];
const roleEl = document.getElementById("role");
if (roleEl && !calm) {
  let r = 0;
  setInterval(() => {
    r = (r + 1) % roles.length;
    roleEl.classList.add("out");
    setTimeout(() => {
      roleEl.textContent = roles[r];
      roleEl.classList.remove("out");
    }, 350);
  }, 2600);
}

// ---------- Headings reveal word by word ----------
document.querySelectorAll(".words").forEach((h) => {
  const words = h.textContent.trim().split(/\s+/);
  h.setAttribute("aria-label", h.textContent.trim());
  h.innerHTML = words
    .map((w, i) => `<span class="word" aria-hidden="true" style="--i:${i}"><span>${w}</span></span>`)
    .join(" ");
});

// ---------- Count-up numbers ----------
function countUp(el) {
  const to = Number(el.dataset.to);
  const decimals = Number(el.dataset.decimals || 0);
  const suffix = el.dataset.suffix || "";
  const show = (v) => (el.textContent = v.toFixed(decimals) + suffix);
  if (calm) return show(to);
  const start = performance.now();
  const dur = 1400;
  (function tick(now) {
    const t = Math.min(1, (now - start) / dur);
    show(to * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(tick);
  })(start);
}

const storyObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      if (entry.target.classList.contains("words")) entry.target.classList.add("in");
      if (entry.target.classList.contains("count")) countUp(entry.target);
      storyObserver.unobserve(entry.target);
    });
  },
  { threshold: 0.3 }
);
document.querySelectorAll(".words, .count").forEach((el) => storyObserver.observe(el));

// ---------- Chapter rail ----------
const railLinks = [...document.querySelectorAll(".rail a")];
const chapters = railLinks.map((a) => document.querySelector(a.getAttribute("href")));
const railObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const i = chapters.indexOf(entry.target);
      railLinks.forEach((a, k) => a.classList.toggle("on", k === i));
    });
  },
  { rootMargin: "-45% 0px -50% 0px" }
);
chapters.forEach((c) => c && railObserver.observe(c));

// ---------- Ask NJR ----------
const ANSWERS = [
  {
    q: "Who is NJR?",
    keys: ["who", "about", "introduce", "yourself", "summary", "background", "name"],
    a: "I'm Nitish John Rawat, an AI/ML, software and robotics engineer. I work across robotic simulation, reinforcement and imitation learning, and production software, in Python, C++, Java, SQL and Rust. I'm also a published researcher and an instructor.",
    to: "#foundations",
  },
  {
    q: "What is NJR working on now?",
    keys: ["now", "current", "currently", "working", "projects", "building", "layers", "quantum", "agent", "agentic", "today", "lately"],
    a: "Three projects, built in public: Layers, my AI/ML learning log; Agent, a collaborative workspace on agentic AI; and Quantum, an interactive field guide to quantum physics. I'm also the founding engineer at BrighterRoots, and I teach AI Algorithms II at Boston College.",
    to: "#phases",
  },
  {
    q: "Where did NJR study?",
    keys: ["study", "studied", "education", "school", "university", "degree", "masters", "master", "clark", "wpi", "worcester", "gpa", "college"],
    a: "I took Machine Learning for Robotics at Worcester Polytechnic Institute with a 4.0 GPA (May 2025), and earned a STEM Master's in Computer Science from Clark University (December 2025).",
    to: "#foundations",
  },
  {
    q: "What robotics work has NJR done?",
    keys: ["robot", "robots", "robotics", "mujoco", "reinforcement", "rl", "ddpg", "a3c", "imitation", "act", "peg", "simulation", "manipulation", "ros"],
    a: "I built MuJoCo environments and benchmarked DDPG and A3C agents for continuous control. I also implemented the Action Chunking Transformer for peg-in-hole insertion, which beat the RL baselines on sub-millimeter precision tasks.",
    to: "#robots",
  },
  {
    q: "What research has NJR published?",
    keys: ["research", "publish", "published", "publication", "publications", "paper", "papers", "ieee", "cassini", "cancer", "renal", "taylor", "francis"],
    a: "Two peer-reviewed papers accepted by Taylor & Francis: one on surgical decision making for renal cell carcinoma with ML models, and one on feature selection for renal cancer across geographic regions. At Clark's IEEE chapter I also led LLM evaluation research as Team Cassini.",
    to: "#research",
  },
  {
    q: "Does NJR teach?",
    keys: ["teach", "teaching", "instructor", "professor", "adjunct", "boston", "nvidia", "mit", "idtech", "course", "students", "class"],
    a: "Yes. I'm an Adjunct Instructor for AI Algorithms II at Boston College, and I taught the NVIDIA ML & AI Academy at iD Tech @ MIT, where I reviewed 41 student codebases and every student finished their project.",
    to: "#teaching",
  },
  {
    q: "What has NJR built?",
    keys: ["built", "build", "ship", "shipped", "startup", "brighterroots", "founding", "mobile", "app", "flutter", "voice", "gpt", "twilio", "whisper", "fastapi", "experience", "work", "job"],
    a: "As founding engineer at BrighterRoots I shipped a cross-platform EdTech app from zero, owning its architecture and CI/CD. I also built a real-time AI voice agent with GPT-4o, Whisper and Twilio, and took it to production.",
    to: "#building",
  },
  {
    q: "What are NJR's skills?",
    keys: ["skills", "skill", "languages", "language", "stack", "tools", "python", "c++", "java", "rust", "cloud", "aws", "pytorch", "tech"],
    a: "Languages: Python, C++, Java, SQL, Rust and Dart. ML: LLMs, agentic workflows, deep learning, RL and imitation learning. Cloud and tools: AWS, Azure, GCP, Docker, FastAPI, Firebase, PostgreSQL, CI/CD and PyTorch.",
    to: "#next",
  },
  {
    q: "Is NJR open to new roles?",
    keys: ["hire", "hiring", "role", "roles", "open", "looking", "available", "opportunity", "opportunities", "massachusetts", "next", "position"],
    a: "Yes. I'm looking for AI/ML, software and robotics engineering roles in Massachusetts, where research meets production.",
    to: "#next",
  },
  {
    q: "How can I reach NJR?",
    keys: ["contact", "reach", "email", "mail", "connect", "github", "talk", "message"],
    a: "Email me at nitishjohnrawat@gmail.com, or find my work on GitHub as NJROzzy.",
    to: "#next",
  },
];

const chipsEl = document.getElementById("chips");
const answerBox = document.getElementById("answer");
const answerQ = document.getElementById("answer-q");
const answerA = document.getElementById("answer-a");
const answerLink = document.getElementById("answer-link");
const askInput = document.getElementById("ask-input");
let typing = null;

function match(text) {
  const words = text.toLowerCase().replace(/[^a-z0-9+#\s]/g, " ").split(/\s+/).filter(Boolean);
  let best = null;
  let bestScore = 0;
  for (const entry of ANSWERS) {
    const score = words.filter((w) => entry.keys.includes(w)).length;
    if (score > bestScore) { best = entry; bestScore = score; }
  }
  return best;
}

function typeOut(text) {
  clearInterval(typing);
  if (calm) { answerA.textContent = text; return; }
  answerA.textContent = "";
  answerA.classList.add("typing");
  let i = 0;
  typing = setInterval(() => {
    i += 2;
    answerA.textContent = text.slice(0, i);
    if (i >= text.length) {
      clearInterval(typing);
      answerA.classList.remove("typing");
    }
  }, 16);
}

function answer(question) {
  const entry = match(question);
  answerBox.hidden = false;
  answerQ.textContent = question;
  if (!entry) {
    typeOut("I don't have that chapter written yet. Try one of the questions below, or email me at nitishjohnrawat@gmail.com.");
    answerLink.hidden = true;
    return;
  }
  typeOut(entry.a);
  answerLink.hidden = false;
  answerLink.href = entry.to;
}

chipsEl.innerHTML = ANSWERS.map((e, i) => `<button type="button" class="chip" data-i="${i}">${e.q}</button>`).join("");
chipsEl.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  askInput.value = "";
  answer(ANSWERS[chip.dataset.i].q);
});

document.getElementById("ask-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = askInput.value.trim();
  if (q) answer(q);
});
