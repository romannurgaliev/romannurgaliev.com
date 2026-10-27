# Tests for risk-model.js

The simulator's math lives in `risk-model.js`, with no page code. These tests
check it three ways: against real Hyperliquid accounts, against rules that
must hold for any account, and against known numbers from the case page.

```bash
npm install          # once: fast-check, Stryker, Playwright, axe-core (dev only, the site doesn't use them)
npm test             # all tests, under 2 seconds
npm run coverage     # same, fails below 99% lines / 95% branches / 100% functions
npm run mutation     # Stryker, about 2 minutes, report in reports/mutation/index.html
npm run test:ui      # the simulator in a real browser (Playwright), about 5 seconds
npm run test:ui -- --update-snapshots=all   # after a deliberate visual change
```

## Files

| File | What it checks |
|---|---|
| `hyperliquid.test.js` | Model vs 29 real accounts (`fixtures/hyperliquid/`). Known gaps are `todo` tests, each next to a passing test that reproduces Hyperliquid's number |
| `invariants.test.js` | 16 rules for any account, 1,000 random cases each (fast-check): formulas, liq. price sits on the losing side and is exactly where liquidation happens, scaling sizes doesn't move it, adding margin never hurts, every offered fix does what its button says and is the smallest step that works, no side effects |
| `events.test.js` | Order of stops, take-profits and liquidation, against a second simulator that walks the price path in 20,000 steps |
| `model.test.js` | The demo account's numbers as the page showed them before the refactor, edge cases (all closed, zero-price long, hedged account, already liquidated), every fix in detail |
| `vectors.test.js` | The model against `vectors.json`: 64 language-neutral input → output cases for other implementations (`node scripts/vectors.js` rebuilds it). Formulas: `docs/risk-model.md` |
| `arbitraries.js`, `hl-helpers.js` | Random accounts; reading Hyperliquid fixtures |
| `ui/simulator.spec.js` | The page in Chromium at 1280px: screenshots of 6 states and 3 fixes, the case copy's numbers on screen, keyboard (every slider key, presets, fixes, Reset, focus ring, focus kept on redraw), drag, reduced motion vs the 0.3 s glide, carousel below 960px and when the script fails to load, axe-core WCAG 2.1 AA |

### Browser tests

Screenshots live in `tests/ui/screenshots/`, one set per platform
(`-darwin` now; CI on Linux will need its own `-linux` set). On one machine
they come out pixel-identical run to run (90 of 90 at zero tolerance), so the
limits are tight: at most 10 pixels may differ, each by at most 2%. That
catches a 1px shift and a text colour change as small as #007aff → #2e8fff
on the 11px TP chip.

When a change is on purpose, look at the report (`reports/ui/index.html`),
then re-record with `--update-snapshots=all`. Plain `--update-snapshots`
only rewrites screenshots that fail, and leaves near-misses as they were.

States: market, BTC −8% and SOL +15% (the two carousel slides), Market Crash,
Oct 10, 2025 replay, liquidated (BTC and ETH −20%); fixes from SOL +15%: add
margin, cut BTC, move the stop.

**Known accessibility issues** (contrast below 4.5:1). Colours are a design
call, so they're listed in `KNOWN` in the spec instead of changed. Each has a
test marked as expected to fail; fixing the colour turns it into "expected to
fail, but passed", then delete the entry. Everything else must pass.

| Element | Colours | Ratio | Status |
|---|---|---|---|
| Carousel counter "01 / 03", every case page | #737373 on #f3f3f3 | 4.27:1 | open (#6b6b6b would give 4.8:1, but it is the site-wide `--text-muted`) |
| Simulator footnote "Stop orders are assumed…" | #4f4f4f on #141414 | 2.24:1 | fixed Oct 24: `--w50` |
| Simulator TP chip text | #007aff on #121e2c | 4.18:1 | fixed Oct 24: new `--blue-text` #2e8fff, 5.2:1; the TP tick on the track keeps `--blue` |

Random tests use a fixed seed, so a failure always reproduces. To look further:
`FC_SEED=7 FC_RUNS=20000 npm test`.

## Results (Oct 24, 2026)

- 149 model tests: 145 pass, 4 known Hyperliquid gaps marked `todo` (see `fixtures/hyperliquid/README.md`). 34 browser tests pass.
- Coverage of risk-model.js: 99.7% lines, 98.6% branches, 100% functions. The
  one uncovered line is the browser loader.
- Mutation score: 93.8% (466 of 497 small code changes caught; the threshold is 85%).

### Bugs the tests found and fixed

1. **Stops hit at the same moment: only one fired.** Two longs with stops 10%
   away, run through one uniform −30% crash: the first stopped at $90, the
   second rode down to $70. Found by the step-by-step walk. The demo was not
   affected (only BTC has stops).
2. **"Add margin" asked $10 too much, "Cut" 5% too much**, when the exact
   answer was a round number. Found by fast-check.

Neither changes what the demo shows: the page renders identically to before
across 96 recorded states.

### The 31 mutants that survive, and why they don't matter

- **Ties on exact floating-point values** (`<` vs `<=` on liq. vs stop, distance
  vs 15%, account value vs margin, two events at the same instant): the outcomes
  differ only when two computed numbers are bit-for-bit equal.
- **Impossible inputs:** `side >= 0` vs `side > 0` (side is always ±1),
  `x × side` vs `x / side`, `av <= 0` when that already means liquidated.
- **Safety limits:** the 20-event loop cap, bisection's 40 vs 41 steps.
- **Checks that later code makes redundant:** skipping a coin at market price
  or a missing stop (the division gives ±Infinity or NaN and is filtered out
  anyway), and the lower bounds of the $10/5% step-down.

## CI (GitHub Actions)

`.github/workflows/test.yml` runs on every push and pull request:

| Job | What | Time |
|---|---|---|
| Model | `npm test`, then `npm run coverage` | ~1 min |
| Browser | `npm run test:ui` inside `mcr.microsoft.com/playwright:v1.64.1-noble` | ~2 min |
| Mutation | Stryker, only when started by hand with "mutation" ticked | ~4 min |

A red run doesn't block Netlify, which deploys on its own. It means something
in the simulator broke. When the browser job fails, the run keeps the
Playwright report (with screenshot diffs) as a downloadable artifact.

**Linux screenshots.** CI compares against `tests/ui/screenshots/*-linux.png`.
They're recorded by `.github/workflows/update-screenshots.yml` in the same
image, so fonts render identically. Until they exist, the browser job skips
the 9 screenshot tests (tagged `@visual`), runs the other 24, and shows a
warning. To record or refresh them: Actions tab → "Update Linux screenshots"
→ Run workflow. It records, checks three more runs match, and commits the
files. Then re-run "Tests" (the bot's commit doesn't start it).

After a deliberate visual change, update both sets: macOS locally
(`npm run test:ui -- --update-snapshots=all`), then Linux with that workflow.

The Playwright version is pinned in three places that must move together:
`package.json` (`@playwright/test`) and the image tag in both workflow files.
