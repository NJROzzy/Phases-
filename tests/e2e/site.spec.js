// Guards the public page so changes can't silently break it.
const { test, expect } = require("@playwright/test");
const { open, expectNoHorizontalScroll } = require("./helpers");

test.describe("home page", () => {
  test("loads without errors and tells the story in chapters", async ({ page }) => {
    const errors = await open(page, "/index.html");
    await expect(page).toHaveTitle("Phases of NJR");
    await expect(page.locator("h1")).toContainText("Nitish John Rawat");
    await expect(page.locator(".chapter")).toHaveCount(7);
    await expect(page.locator(".phase-title")).toHaveText(["Layers", "Agent", "Quantum"]);
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("answers questions about NJR and links to the chapter", async ({ page }) => {
    await open(page, "/index.html");
    await expect(page.locator("#ask h2")).toHaveText("What do you want to know about NJR?");

    await page.locator(".chip", { hasText: "Does NJR teach?" }).click();
    await expect(page.locator("#answer-a")).toContainText("Boston College", { timeout: 8000 });
    await expect(page.locator("#answer-link")).toHaveAttribute("href", "#teaching");

    await page.locator("#ask-input").fill("which papers did you publish?");
    await page.locator("#ask-input").press("Enter");
    await expect(page.locator("#answer-a")).toContainText("Taylor & Francis", { timeout: 8000 });
    await expect(page.locator("#answer-link")).toHaveAttribute("href", "#research");

    await page.locator("#ask-input").fill("favourite pizza topping");
    await page.locator("#ask-input").press("Enter");
    await expect(page.locator("#answer-a")).toContainText("don't have that chapter", { timeout: 8000 });
    await expect(page.locator("#answer-link")).toBeHidden();
  });

  test("every suggested question has a matching answer", async ({ page }) => {
    await open(page, "/index.html");
    const chips = page.locator(".chip");
    const n = await chips.count();
    expect(n).toBeGreaterThan(5);
    for (let i = 0; i < n; i++) {
      await chips.nth(i).click();
      await expect(page.locator("#answer-link")).toBeVisible();
    }
  });

  test("counters count up to their values", async ({ page }) => {
    await open(page, "/index.html");
    const gpa = page.locator('#foundations .count[data-to="4.0"]');
    await gpa.scrollIntoViewIfNeeded();
    await expect(gpa).toHaveText("4.0", { timeout: 5000 });
    const done = page.locator('#teaching .count[data-suffix="%"]');
    await done.scrollIntoViewIfNeeded();
    await expect(done).toHaveText("100%", { timeout: 5000 });
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
});
