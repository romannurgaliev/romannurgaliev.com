// Browser tests for the risk simulator on the Brighty case page.
// Run: npm run test:ui   (re-record screenshots: npm run test:ui -- --update-snapshots=all)
const { defineConfig } = require('@playwright/test');

const PORT = 4176;

module.exports = defineConfig({
  testDir: 'tests/ui',
  // Screenshots differ slightly between macOS and Linux font rendering, so
  // each platform keeps its own set. On one machine they are pixel-identical
  // run to run, so the limits are tight: a text colour change (#007aff to
  // #2e8fff on an 11px chip) must fail
  snapshotPathTemplate: '{testDir}/screenshots/{arg}-{platform}{ext}',
  fullyParallel: true,
  reporter: [['list'], ['html', { outputFolder: 'reports/ui', open: 'never' }]],
  outputDir: 'reports/ui-results',
  expect: {
    toHaveScreenshot: { maxDiffPixels: 10, threshold: 0.02, animations: 'disabled', caret: 'hide', stylePath: 'tests/ui/screenshot.css' },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: 'chromium',
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  },
  // The site is static files, served by a tiny Node server (no Python in CI)
  webServer: {
    command: `node scripts/serve.js ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
