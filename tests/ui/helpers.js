// Shared steps for the simulator browser tests
const { expect } = require('@playwright/test');

const PAGE = '/work/brighty.html';

// Opens the case page and waits until the simulator is drawn and fonts are in
async function openSimulator(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(PAGE);
  await expect(page.locator('.sim-figure.is-ready')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.locator('[data-risk-sim]').scrollIntoViewIfNeeded();
  return { errors, sim: page.locator('[data-risk-sim]') };
}

const thumb = (page, id) => page.locator(`[data-thumb="${id}"]`);

async function press(page, id, keys) {
  await thumb(page, id).focus();
  for (const k of keys) await page.keyboard.press(k);
}

// Simulated move of one coin, in %, read from the slider
const moveOf = async (page, id) => +(await thumb(page, id).getAttribute('aria-valuenow'));

const chip = (page, id, kind) => page.locator(`[data-track="${id}"] + .sim-labels [data-kind="${kind}"]`);
const metric = (page, label) => page.locator('.sim-metric', { hasText: label }).locator('p').last();

module.exports = { PAGE, openSimulator, thumb, press, moveOf, chip, metric };
