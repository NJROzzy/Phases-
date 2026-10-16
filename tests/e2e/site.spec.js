// Guards the existing public pages so platform work can't silently break them.
const { test, expect } = require("@playwright/test");
const { open, expectNoHorizontalScroll, echo } = require("./helpers");

test.describe("home page", () => {
  test("loads without errors and shows all six phases", async ({ page }) => {
    const errors = await open(page, "/index.html");
    await expect(page).toHaveTitle("Phases");
    await expect(page.locator(".phase")).toHaveCount(6);
    await expect(page.locator(".phase-title")).toHaveText([
      "Conception", "Initialization", "Execution", "Emergence", "Observation", "Termination",
    ]);
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

  test("the cycle ring steps through phases", async ({ page }) => {
    await open(page, "/index.html");
    const label = page.locator("#ring-label");
    const first = await label.textContent();
    await expect(label).not.toHaveText(first, { timeout: 5000 });
  });

  test("boot screen only appears once per session", async ({ page }) => {
    await open(page, "/index.html");
    await page.goto("/worlds.html");
    await expect(page.locator(".boot")).toHaveCount(0);
  });
});

test.describe("worlds page", () => {
  test("loads without errors with three domains", async ({ page }) => {
    const errors = await open(page, "/worlds.html");
    await expect(page.locator(".domain h3")).toHaveText(["Robotics", "Environment", "Universe"], { useInnerText: true });
    await expect(page.locator(".loop-step")).toHaveCount(5);
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("physics playground runs and switches gravity", async ({ page }) => {
    await open(page, "/worlds.html");
    await page.locator("#playground").scrollIntoViewIfNeeded();
    const steps = page.locator("#hud-steps");
    await expect.poll(async () => Number((await steps.textContent()).replace(/,/g, ""))).toBeGreaterThan(30);
    await page.locator('[data-gravity="moon"]').click();
    await expect(page.locator("#hud-gravity")).toHaveText("Moon");
    await expect(page.locator('[data-gravity="moon"]')).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("ECHO assistant", () => {
  test("answers typed commands and navigates", async ({ page }) => {
    await open(page, "/index.html");
    await echo(page, "phase four");
    await expect(page.locator(".phase.open .phase-title")).toHaveText("Emergence");
    await echo(page, "help");
    await expect(page.locator(".dock-log .log-echo").last()).toContainText("read this page");
    await echo(page, "worlds");
    await page.waitForURL(/worlds\.html/);
  });

  test("offers the Coqui voice first", async ({ page }) => {
    await open(page, "/index.html");
    await page.locator(".dock-orb").click();
    await expect(page.locator(".dock-voice option").first()).toHaveText(/Coqui/);
  });

  test("every Coqui clip in the manifest exists", async ({ request }) => {
    const manifest = await (await request.get("/audio/echo/manifest.json")).json();
    const files = [...new Set(Object.values(manifest))];
    expect(files.length).toBeGreaterThan(50);
    for (const f of files) expect((await request.head(`/audio/echo/${f}`)).ok()).toBe(true);
  });
});
