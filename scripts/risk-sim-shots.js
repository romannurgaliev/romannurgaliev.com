// Re-shoots the risk simulator screens in the Brighty carousel from the live
// prototype, so the stills never lag behind it:
//   node scripts/risk-sim-shots.js
// Needs Playwright (npm ci && npx playwright install chromium). Serves the
// site itself. Each state is reached the way a visitor would, with the same
// keys as tests/ui/simulator.spec.js, and keeps the slider focused so the
// price tooltip shows. WebP is encoded by Chromium, so no cwebp is needed.
// Set CHROMIUM=/path/to/chrome to use a browser Playwright didn't download.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'work/images/brighty');
const PORT = 4177;
const WIDTHS = [1744, 872];  // the srcset in work/brighty.html
const QUALITY = 0.82;

const press = async (page, id, keys) => {
  await page.locator(`[data-thumb="${id}"]`).focus();
  for (const k of keys) await page.keyboard.press(k);
};

const SHOTS = {
  'risk-simulator-btc-drop': page => press(page, 'btc', Array(8).fill('ArrowLeft')),
  'risk-simulator-sl-warning': page => press(page, 'sol', ['PageUp', ...Array(5).fill('ArrowRight')]),
};

// Resizes a PNG to each width and encodes it as WebP inside the page
async function toWebp(page, png, widths) {
  return page.evaluate(async ({ src, widths, q }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    return widths.map(w => {
      const h = Math.round(img.height * w / img.width);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      return { w, h, data: c.toDataURL('image/webp', q).split(',')[1] };
    });
  }, { src: 'data:image/png;base64,' + png.toString('base64'), widths, q: QUALITY });
}

(async () => {
  const server = spawn('node', [path.join(ROOT, 'scripts/serve.js'), PORT], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 500));
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  try {
    for (const [name, reach] of Object.entries(SHOTS)) {
      // 1280 wide so the live simulator is shown (it replaces the carousel from 960px); 2x for retina
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
      await page.goto(`http://localhost:${PORT}/work/brighty.html`);
      await page.waitForSelector('.sim-figure.is-ready');
      await page.evaluate(() => document.fonts.ready);
      await page.addStyleTag({ path: path.join(ROOT, 'tests/ui/screenshot.css') });
      const sim = page.locator('[data-risk-sim]');
      await sim.scrollIntoViewIfNeeded();
      await reach(page);
      await page.mouse.move(0, 0);
      const png = await sim.screenshot({ animations: 'disabled' });
      for (const { w, h, data } of await toWebp(page, png, WIDTHS)) {
        const file = path.join(OUT, `${name}-${w}.webp`);
        fs.writeFileSync(file, Buffer.from(data, 'base64'));
        console.log(`${path.relative(ROOT, file)}  ${w}×${h}`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
})();
