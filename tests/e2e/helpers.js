const { expect } = require("@playwright/test");

/** Open a page, collect uncaught errors, and dismiss the ECHO boot screen. */
async function open(page, path) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(path);
  const silent = page.locator(".boot-enter.silent");
  await silent.waitFor({ state: "visible" });
  await silent.click();
  await expect(page.locator(".boot")).toHaveCount(0);
  return errors;
}

async function expectNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
}

/** Type a command into the ECHO console. */
async function echo(page, command) {
  if (await page.locator("#dock-panel").isHidden()) await page.locator(".dock-orb").click();
  await page.locator(".dock-form input").fill(command);
  await page.locator(".dock-form input").press("Enter");
}

module.exports = { open, expectNoHorizontalScroll, echo };
