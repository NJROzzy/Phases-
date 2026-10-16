// The laboratory page: demo replay always; live runs when PHASES_E2E_API points at an API.
const { test, expect } = require("@playwright/test");
const { open, expectNoHorizontalScroll, echo } = require("./helpers");

const API = process.env.PHASES_E2E_API;

test.describe("lab in demo mode", () => {
  test("replays the recorded run through all six phases", async ({ page }) => {
    const errors = await open(page, "/lab.html?api=");
    await expect(page.locator("#lab-status")).toHaveAttribute("data-mode", "demo");
    await expect(page.locator("#demo-notice")).toBeVisible();
    await expect(page.locator("#run-btn")).toBeDisabled();
    await expect(page.locator('[name="cfg.width"]')).toHaveValue("48");

    await page.locator("#phase-track").scrollIntoViewIfNeeded();
    await expect(page.locator("#phase-track li.current")).toHaveAttribute("data-phase", "execution", { timeout: 5000 });
    await page.locator("#cancel-btn").click(); // "Skip to end" in demo mode
    await expect(page.locator("#hud-status")).toHaveText("completed", { timeout: 10000 });
    await expect(page.locator("#phase-track li.done")).toHaveCount(6);
    await expect(page.locator("#summary")).toBeVisible();
    await expect(page.locator("#scrub")).toBeEnabled();
    await expect(page.locator("#meta-list")).toContainText("passed at every step");

    await page.locator("#scrub").fill("10");
    await expect(page.locator("#hud-step")).toHaveText("step 50");
    await expect(page.locator(".charts canvas")).toHaveCount(4);
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("ECHO knows the lab commands", async ({ page }) => {
    await open(page, "/lab.html?api=");
    await echo(page, "help");
    await expect(page.locator(".dock-log .log-echo").last()).toContainText("run experiment");
    await echo(page, "run experiment");
    await expect(page.locator(".dock-log .log-echo").last()).toContainText("demo mode");
  });

  test("is linked from the other pages", async ({ page }) => {
    await open(page, "/index.html");
    await page.locator('.nav a[href="lab.html"]').click();
    await expect(page).toHaveURL(/lab\.html/);
  });
});

test.describe("lab with a live API", () => {
  test.skip(!API, "set PHASES_E2E_API to run against a live API");

  test("runs an experiment and its next cycle", async ({ page }) => {
    const errors = await open(page, `/lab.html?api=${encodeURIComponent(API)}`);
    await expect(page.locator("#lab-status")).toHaveAttribute("data-mode", "live");

    await page.fill('[name="title"]', "E2E world");
    await page.fill('[name="hypothesis"]', "The population survives 120 steps.");
    await page.fill('[name="cfg.max_steps"]', "120");
    await page.selectOption('[name="speed"]', "");
    await page.locator("#run-btn").click();
    await expect(page.locator("#hud-status")).toHaveText("completed", { timeout: 30000 });
    await expect(page.locator("#csv-link")).toBeVisible();
    await expect(page.locator("#meta-list")).toContainText("Metrics hash");

    await page.locator("#next-btn").click();
    await expect(page.locator("#cycle-banner")).toBeVisible();
    await page.selectOption('[name="cfg.movement"]', "random");
    await page.fill('[name="change_note"]', "Turn sensing off");
    await page.locator("#run-btn").click();
    await expect(page.locator("#hud-status")).toHaveText("completed", { timeout: 30000 });
    await expect(page.locator(".h-children .h-change").first()).toContainText("movement: mixed → random");
    expect(errors).toEqual([]);
  });
});
