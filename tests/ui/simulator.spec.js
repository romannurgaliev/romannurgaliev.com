// The live risk simulator on the Brighty case page, in a real browser.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { PAGE, openSimulator, thumb, press, moveOf, chip, metric } = require('./helpers.js');

// Instant presets for every test unless one asks otherwise
test.use({ reducedMotion: 'reduce' });

// The states the case shows and the ones a visitor reaches first. Each is
// reached the way a visitor would: keys on a slider, or a button.
const STATES = {
  'market': async () => {},
  'btc-down-8': async page => press(page, 'btc', Array(8).fill('ArrowLeft')),
  'sol-up-15-stop-warning': async page => press(page, 'sol', ['PageUp', ...Array(5).fill('ArrowRight')]),
  'preset-market-crash': async page => page.locator('[data-scenario="crash"]').click(),
  'preset-oct-10-2025': async page => page.locator('[data-scenario="oct10"]').click(),
  'liquidated': async page => { await press(page, 'btc', ['PageDown', 'PageDown']); await press(page, 'eth', ['PageDown', 'PageDown']); },
};

test.describe('states', () => {
  for (const [name, reach] of Object.entries(STATES)) {
    test(`${name} looks as recorded`, { tag: '@visual' }, async ({ page }) => {
      const { errors, sim } = await openSimulator(page);
      await reach(page);
      await page.mouse.move(0, 0); // no hover styles
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      await expect(sim).toHaveScreenshot(`${name}.png`);
      expect(errors).toEqual([]);
    });
  }

  test('BTC −8% shows the numbers in the case copy', async ({ page }) => {
    await openSimulator(page);
    await STATES['btc-down-8'](page);
    expect(await moveOf(page, 'btc')).toBe(-8);
    await expect(chip(page, 'eth', 'liq')).toContainText('$2,305.78');
    await expect(chip(page, 'zec', 'liq')).toContainText('$146.35');
    await expect(chip(page, 'sol', 'liq')).toContainText('$164.87');
    await expect(page.locator('.sim-cmr-head')).toContainText('40.0%');
    await expect(page.locator('.sim-tag--warn')).toHaveText('Simulated');
  });

  test('SOL +15% warns that BTC’s stop won’t trigger', async ({ page }) => {
    await openSimulator(page);
    await STATES['sol-up-15-stop-warning'](page);
    await expect(chip(page, 'btc', 'warn')).toContainText('SL won’t trigger');
    await expect(chip(page, 'btc', 'warn')).toContainText('$81,109');
  });

  test('liquidated: the note, red tracks, no reserve, nothing to withdraw', async ({ page }) => {
    await openSimulator(page);
    await STATES['liquidated'](page);
    await expect(page.locator('.sim-liq-note')).toContainText('liquidated');
    await expect(page.locator('.sim-base.is-liquidated')).not.toHaveCount(0);
    await expect(metric(page, 'Equity Reserve')).toHaveText('—');
    await expect(metric(page, 'Withdrawable')).toContainText('$0.00');
    await expect(page.locator('.sim-fixes')).not.toContainText('Move SL');
  });

  test('crash replay: BTC’s stop closes it, the shorts keep the account alive', async ({ page }) => {
    await openSimulator(page);
    await STATES['preset-oct-10-2025'](page);
    await expect(page.locator('.sim-closed .sim-tag')).toHaveText('Closed by SL');
    await expect(page.locator('.sim-liq-note')).toHaveCount(0);
    await expect(page.locator('[data-scenario="oct10"]')).toHaveAttribute('title', /BTC −17\.1%/);
  });
});

test.describe('Reduce risk fixes', () => {
  const FIXES = [
    ['add-margin', 'Add $480 margin', 'Added $480 margin'],
    ['cut-btc', 'Cut BTC by 35%', 'Cut 35% of BTC'],
    ['move-stop', 'Move SL to $82,000', 'SL moved to $82,000'],
  ];
  for (const [name, offer, applied] of FIXES) {
    test(`${name}: apply, check, undo`, { tag: '@visual' }, async ({ page }) => {
      await openSimulator(page);
      await STATES['sol-up-15-stop-warning'](page);
      const before = await page.locator('[data-risk-sim]').innerHTML();
      await page.locator('.sim-fix', { hasText: offer }).click();
      const on = page.locator('.sim-fix', { hasText: applied });
      await expect(on).toHaveAttribute('aria-pressed', 'true');
      await expect(on).toContainText('Undo');
      await page.mouse.move(0, 0);
      await expect(page.locator('[data-risk-sim]')).toHaveScreenshot(`fix-${name}.png`);
      await on.click();
      // Undo gives back exactly the state before
      expect(await page.locator('[data-risk-sim]').innerHTML()).toBe(before);
    });
  }

  test('adding the offered margin takes risk to Low', async ({ page }) => {
    await openSimulator(page);
    await STATES['sol-up-15-stop-warning'](page);
    await page.locator('.sim-fix', { hasText: 'Add $480 margin' }).click();
    await expect(page.locator('.sim-cmr')).toHaveClass(/is-green/);
  });

  test('moving the stop clears the warning', async ({ page }) => {
    await openSimulator(page);
    await STATES['sol-up-15-stop-warning'](page);
    await page.locator('.sim-fix', { hasText: 'Move SL' }).click();
    await expect(chip(page, 'btc', 'warn')).toHaveCount(0);
    await expect(chip(page, 'btc', 'sl')).toBeVisible();
  });

  test('when risk is Low, nothing is offered', async ({ page }) => {
    await openSimulator(page);
    await page.locator('[data-scenario="boom"]').click();
    await expect(page.locator('.sim-fixes-empty')).toHaveText('Risk is low. Nothing to fix at these prices.');
  });
});

test.describe('keyboard', () => {
  test('sliders: arrows 1%, Shift 5%, Page 10%, Home and End the ends', async ({ page }) => {
    await openSimulator(page);
    const steps = [['ArrowRight', 1], ['ArrowUp', 2], ['ArrowLeft', 1], ['ArrowDown', 0], ['Shift+ArrowRight', 5],
      ['Shift+ArrowLeft', 0], ['PageUp', 10], ['PageDown', 0], ['End', 50], ['ArrowRight', 50], ['Home', -50], ['ArrowLeft', -50]];
    await thumb(page, 'eth').focus();
    for (const [key, want] of steps) {
      await page.keyboard.press(key);
      expect(await moveOf(page, 'eth'), key).toBe(want);
    }
  });

  test('sliders say what they do to a screen reader', async ({ page }) => {
    await openSimulator(page);
    const t = thumb(page, 'btc');
    await expect(t).toHaveAttribute('role', 'slider');
    await expect(t).toHaveAttribute('aria-label', 'BTC-USDC simulated price');
    await expect(t).toHaveAttribute('aria-valuemin', '-50');
    await expect(t).toHaveAttribute('aria-valuemax', '50');
    await press(page, 'btc', Array(8).fill('ArrowLeft'));
    await expect(t).toHaveAttribute('aria-valuetext', '$82,561, −8.0% from market');
  });

  test('focus stays on the slider while the simulator redraws', async ({ page }) => {
    await openSimulator(page);
    await press(page, 'sol', ['PageUp', 'PageUp', 'PageUp']);
    expect(await page.evaluate(() => document.activeElement.getAttribute('data-thumb'))).toBe('sol');
  });

  test('a focused slider shows a focus ring', async ({ page }) => {
    await openSimulator(page);
    await page.keyboard.press('Tab'); // focus-visible needs a keyboard focus
    await thumb(page, 'hype').focus();
    await page.keyboard.press('ArrowRight');
    // The ring is a 3px box-shadow; give the redraw a frame to apply it
    await expect.poll(() => thumb(page, 'hype').evaluate(el => getComputedStyle(el).boxShadow)).toContain('0px 0px 0px 3px');
  });

  test('presets, fixes and Reset work from the keyboard, and keep focus', async ({ page }) => {
    await openSimulator(page);
    const reset = page.locator('[data-reset]');
    await expect(reset).toBeDisabled();

    await page.locator('[data-scenario="boom"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-scenario="boom"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.activeElement.getAttribute('data-scenario'))).toBe('boom');
    await page.keyboard.press('Space');
    await expect(page.locator('[data-scenario="boom"]')).toHaveAttribute('aria-pressed', 'false');

    await press(page, 'sol', ['PageUp', ...Array(5).fill('ArrowRight')]);
    await page.locator('.sim-fix').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.sim-fix').first()).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.activeElement.hasAttribute('data-fix'))).toBe(true);

    await expect(reset).toBeEnabled();
    await reset.focus();
    await page.keyboard.press('Enter');
    for (const id of ['btc', 'eth', 'zec', 'sol', 'hype']) expect(await moveOf(page, id)).toBe(0);
    await expect(page.locator('.sim-fix[aria-pressed="true"]')).toHaveCount(0);
    await expect(reset).toBeDisabled();
  });
});

test.describe('pointer', () => {
  test('dragging a track moves that coin and shows the price on the thumb', async ({ page }) => {
    await openSimulator(page);
    const track = page.locator('[data-track="eth"]');
    const box = await track.boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2, { steps: 5 });
    await expect(thumb(page, 'eth')).toHaveClass(/is-dragging/);
    await page.mouse.up();
    expect(await moveOf(page, 'eth')).toBeCloseTo(-20, 0);
    await expect(thumb(page, 'eth')).not.toHaveClass(/is-dragging/);
  });
});

test.describe('motion', () => {
  test('with reduced motion, a preset lands at once', async ({ page }) => {
    await openSimulator(page);
    const now = await page.evaluate(() => {
      // BTC's stop closes it in a crash, so watch ETH
      document.querySelector('[data-scenario="crash"]').click();
      return document.querySelector('[data-thumb="eth"]').getAttribute('aria-valuenow');
    });
    expect(+now).toBe(-30);
    const duration = await page.locator('.sim-cmr-fill').evaluate(el => getComputedStyle(el).transitionDuration);
    expect(parseFloat(duration)).toBeLessThan(0.001);
  });

  test.describe('without reduced motion', () => {
    test.use({ reducedMotion: 'no-preference' });

    test('a preset glides there in about 0.3 s', async ({ page }) => {
      await openSimulator(page);
      const seen = await page.evaluate(() => new Promise(resolve => {
        const t = () => +document.querySelector('[data-thumb="eth"]').getAttribute('aria-valuenow');
        document.querySelector('[data-scenario="crash"]').click();
        const values = [t()], start = performance.now();
        (function tick() {
          values.push(t());
          if (performance.now() - start < 500) requestAnimationFrame(tick); else resolve({ values, end: t() });
        })();
      }));
      expect(seen.values[0]).toBe(0); // nothing jumps on the click itself
      expect(seen.values.some(v => v < 0 && v > -30)).toBe(true); // passes through in between
      expect(seen.end).toBe(-30);
    });
  });
});

test.describe('page layout', () => {
  test('from 960px the live simulator replaces the carousel', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 900 });
    await openSimulator(page);
    await expect(page.locator('.case-carousel--large')).toBeHidden();
  });

  test('below 960px the static carousel stays and the simulator is hidden', async ({ page }) => {
    await page.setViewportSize({ width: 959, height: 900 });
    await page.goto(PAGE);
    await expect(page.locator('.case-carousel--large')).toBeVisible();
    await expect(page.locator('.sim-figure')).toBeHidden();
  });

  test('narrowing the window brings the carousel back', async ({ page }) => {
    await openSimulator(page);
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(page.locator('.case-carousel--large')).toBeVisible();
    await expect(page.locator('.sim-figure')).toBeHidden();
  });

  test('if the simulator script fails to load, the carousel stays', async ({ page }) => {
    await page.route('**/risk-model.js', r => r.abort());
    await page.goto(PAGE);
    await expect(page.locator('.case-carousel--large')).toBeVisible();
    await expect(page.locator('.sim-figure')).toBeHidden();
  });
});

test.describe('accessibility (axe-core, WCAG 2.1 AA)', () => {
  const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
  // Contrast below 4.5:1, found Oct 24, 2026. Colours are a design call, so
  // they are listed here instead of changed. Each has its own test below,
  // marked as expected to fail: once the colour is fixed, that test reports
  // "expected to fail, but passed", and the entry can be deleted.
  // Fixed Oct 24, 2026: simulator footnote (now --w50) and TP chip (now --blue-text).
  const KNOWN = [
    { selector: '.case-carousel-count', where: 'carousel', issue: 'counter on every case carousel, #737373 on #f3f3f3, 4.27:1' },
  ];
  const known = where => KNOWN.filter(k => k.where === where).map(k => k.selector);

  // One line per element, with colours and ratio for contrast problems
  const summary = r => r.violations.flatMap(v => v.nodes.map(n => {
    const d = n.any[0] && n.any[0].data;
    return `${v.id}: ${n.target.join(' ')}` + (d && d.contrastRatio ? ` ${d.fgColor} on ${d.bgColor} = ${d.contrastRatio}:1, needs ${d.expectedContrastRatio}` : '');
  }));
  const scan = (page, include, exclude = []) => {
    let b = new AxeBuilder({ page }).include(include).withTags(TAGS);
    exclude.forEach(sel => { b = b.exclude(sel); });
    return b.analyze();
  };
  const openCarousel = async page => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(PAGE);
    await page.locator('.case-carousel--large').scrollIntoViewIfNeeded();
  };

  for (const name of ['market', 'sol-up-15-stop-warning', 'liquidated']) {
    test(`simulator, ${name}: no violations apart from the known ones`, async ({ page }) => {
      await openSimulator(page);
      await STATES[name](page);
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      expect(summary(await scan(page, '.sim-figure', known('simulator')))).toEqual([]);
    });
  }

  test('carousel below 960px: no violations apart from the known ones', async ({ page }) => {
    await openCarousel(page);
    expect(summary(await scan(page, '.case-carousel--large', known('carousel')))).toEqual([]);
  });

  for (const k of KNOWN) {
    test(`known: ${k.selector} contrast (${k.issue})`, async ({ page }) => {
      test.fail(true, 'Known contrast issue, waiting for a colour decision');
      if (k.where === 'simulator') await openSimulator(page); else await openCarousel(page);
      const r = await scan(page, k.selector);
      expect(summary(r)).toEqual([]);
    });
  }
});
