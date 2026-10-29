const { expect } = require("@playwright/test");

/** Open a page and collect uncaught errors. */
async function open(page, path) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(path);
  return errors;
}

async function expectNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
}

module.exports = { open, expectNoHorizontalScroll };
