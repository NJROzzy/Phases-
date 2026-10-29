// Guards the public page so changes can't silently break it.
const { test, expect } = require("@playwright/test");
const { open, expectNoHorizontalScroll } = require("./helpers");

test.describe("home page", () => {
  test("loads without errors and shows the three phases", async ({ page }) => {
    const errors = await open(page, "/index.html");
    await expect(page).toHaveTitle("Phases of NJR");
    await expect(page.locator(".phase")).toHaveCount(3);
    await expect(page.locator(".phase-title")).toHaveText(["Layers", "Agent", "Quantum"]);
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("phase cards expand and collapse", async ({ page }) => {
    await open(page, "/index.html");
    const third = page.locator(".phase").nth(2);
    await third.locator(".phase-head").click();
    await expect(third).toHaveClass(/open/);
    await expect(third.locator(".phase-head")).toHaveAttribute("aria-expanded", "true");
    await third.locator(".phase-head").click();
    await expect(third).not.toHaveClass(/open/);
  });

  test("each phase links to its live site and repository", async ({ page }) => {
    await open(page, "/index.html");
    const expected = [
      ["https://layerschecklist.vercel.app", "https://github.com/NJROzzy/Layerschecklist"],
      ["https://evolutionofaiagents-njr.vercel.app", "https://github.com/NJROzzy/AI-Agentic-Modal-Collaborative-"],
      ["https://quantumapplicationsbynjr.vercel.app", "https://github.com/NJROzzy/QuantumApplications"],
    ];
    for (const [i, hrefs] of expected.entries()) {
      const links = page.locator(".phase").nth(i).locator(".project-links a");
      await expect(links).toHaveCount(2);
      expect(await links.evaluateAll((as) => as.map((a) => a.getAttribute("href")))).toEqual(hrefs);
    }
  });

  test("the cycle ring steps through phases", async ({ page }) => {
    await open(page, "/index.html");
    const label = page.locator("#ring-label");
    const first = await label.textContent();
    await expect(label).not.toHaveText(first, { timeout: 6000 });
  });
});
