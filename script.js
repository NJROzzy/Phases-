// Expand / collapse phases
document.querySelectorAll(".phase-head").forEach((head) => {
  head.addEventListener("click", () => {
    const phase = head.parentElement;
    const isOpen = phase.classList.toggle("open");
    head.setAttribute("aria-expanded", String(isOpen));
  });
});

// Open the first phase by default
const first = document.querySelector(".phase");
if (first) {
  first.classList.add("open");
  first.querySelector(".phase-head").setAttribute("aria-expanded", "true");
}

// Cycle through phase names in the ring
const names = [...document.querySelectorAll(".phase-title")].map((el) => el.textContent);
const label = document.getElementById("ring-label");
let i = 0;
if (label && names.length) {
  setInterval(() => {
    i = (i + 1) % names.length;
    label.style.opacity = 0;
    setTimeout(() => {
      label.textContent = names[i];
      label.style.opacity = 1;
    }, 400);
  }, 2000);
}

document.getElementById("year").textContent = new Date().getFullYear();
