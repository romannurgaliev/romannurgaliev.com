// Writes tests/vectors.json: input → expected output examples for the risk
// model, in plain JSON, so another implementation (any language) can check
// itself against risk-model.js. See docs/risk-model.md for the formulas.
//
//   node scripts/vectors.js
//
// The expected values come from risk-model.js itself. tests/vectors.test.js
// fails if the model and this file ever disagree, so regenerate on purpose
// only, after a model change you mean.

const fs = require('fs');
const path = require('path');
const M = require('../risk-model.js');
const H = require('../tests/hl-helpers.js');
const fc = require('fast-check');

const OUT = path.resolve(__dirname, '..', 'tests', 'vectors.json');

// JSON has no Infinity: written as the string "inf"
const num = v => (v === Infinity ? 'inf' : v === -Infinity ? '-inf' : v);

// Only what an implementation needs: no display fields (name, dp)
const inputPosition = p => {
  const q = { id: p.id, side: p.side, size: p.size, entry: p.entry, mark: p.mark, lev: p.lev, maxLev: p.maxLev };
  if (p.sl) q.sl = p.sl;
  if (p.tp) q.tp = p.tp;
  return q;
};

const expected = (acc, ratios, adj) => {
  const s = M.simulate(acc, ratios, adj);
  return {
    liquidated: s.liquidated,
    accountValue: s.av,
    maintenanceMargin: s.mm,
    totalPnl: s.totalPnl,
    equityReserve: s.reserve,
    crossMarginRatio: num(s.cmr),
    effectiveLeverage: s.lev,
    marketMoveToLiq: num(s.move),
    withdrawable: s.withdrawable,
    distanceToLiq: num(s.distance),
    riskLevel: s.level,
    riskiest: s.riskiest,
    positions: Object.fromEntries(Object.entries(s.rows).map(([id, r]) => [id, {
      price: r.price, pnl: r.pnl, liqPrice: r.liq, priceBuffer: r.buffer,
    }])),
    closed: Object.fromEntries(Object.entries(s.closed).map(([id, c]) => [id, {
      by: c.kind === 'Closed by SL' ? 'stop' : c.kind === 'Closed by TP' ? 'takeProfit' : 'fix',
      price: c.price, pnl: c.pnl,
    }])),
    fixes: M.findFixes(acc, ratios, adj, s).map(f => {
      const g = { type: { deposit: 'addMargin', cut: 'cutPosition', sl: 'moveStop' }[f.id], value: f.value };
      if (f.target) g.position = f.target;
      if (f.on) g.applied = true;
      if ('liqAfter' in f) g.liqPriceAfter = f.liqAfter;
      return g;
    }),
  };
};

const cases = [];
const add = (id, description, acc, moves = {}, adj = M.noAdjustments(), extra = {}) => {
  const ratios = { ...M.marketRatios(acc), ...moves };
  cases.push({
    id, description,
    input: { collateral: acc.collateral, positions: acc.positions.map(inputPosition), ratios, adjustments: adj },
    expected: expected(acc, ratios, adj),
    ...extra,
  });
};

const pos = (id, extra) => M.withMmr({ id, side: 1, size: 1, entry: 100, mark: 100, lev: 10, maxLev: 20, ...extra });
const one = (p, collateral) => ({ collateral, positions: [M.withMmr({ id: 'x', side: 1, size: 1, entry: 100, mark: 100, lev: 10, maxLev: 20, ...p })] });
const DEMO = M.DEMO;
const adj = (o = {}) => ({ deposit: 0, cut: {}, sl: {}, ...o });

// ---------- The demo account ----------
add('demo-market', 'Demo account at market prices', DEMO);
add('demo-btc-down-8', 'BTC −8%: ETH liq. moves to $2,305.78 (case page, slide 1)', DEMO, { btc: 0.92 });
add('demo-sol-up-15', 'SOL +15%: BTC liq. $81,109 comes before its $81,000 stop (slide 2)', DEMO, { sol: 1.15 });
add('demo-sol-up-15-add-margin', 'SOL +15% with the offered $480 added', DEMO, { sol: 1.15 }, adj({ deposit: 480 }));
add('demo-sol-up-15-cut-btc', 'SOL +15% with BTC cut by 35%', DEMO, { sol: 1.15 }, adj({ cut: { btc: 0.35 } }));
add('demo-sol-up-15-move-stop', 'SOL +15% with BTC’s stop moved to $82,000', DEMO, { sol: 1.15 }, adj({ sl: { btc: 82000 } }));
add('demo-sol-up-15-all-fixes', 'SOL +15% with all three fixes applied', DEMO, { sol: 1.15 }, adj({ deposit: 480, cut: { btc: 0.35 }, sl: { btc: 82000 } }));
add('demo-liquidated', 'BTC and ETH −20%: the account is liquidated', DEMO, { btc: 0.8, eth: 0.8 });
add('demo-all-closed', 'Every position closed by a fix', DEMO, {}, adj({ cut: Object.fromEntries(DEMO.positions.map(p => [p.id, 1])) }));
for (const p of M.SCENARIOS.concat(M.SHOCKS)) {
  add(`demo-preset-${p.id}`, `Preset "${p.id}"` + (p.range ? `: ${p.range}, daily open to low on Hyperliquid` : ''), DEMO, p.ratios);
}

// ---------- Edge cases ----------
add('edge-long-no-liq', 'A long that can fall to zero has no liquidation price', one({}, 1000));
add('edge-short-always-liq', 'A short always has a liquidation price', one({ side: -1 }, 1e9));
add('edge-liquidated-at-market', 'Equity below maintenance margin before any move', one({ size: 10, mark: 90 }, 100));
add('edge-liquidated-stays', 'Liquidated at the start stays liquidated even if the move would recover it', one({}, 2), { x: 1.2 });
add('edge-negative-equity', 'Account value below zero', one({ size: 10, mark: 50 }, 400));
add('edge-hedged', 'Net exposure equals maintenance margin: no uniform move liquidates', {
  collateral: 1000, positions: [M.withMmr({ id: 'a', side: 1, size: 1, entry: 100, mark: 100, lev: 10, maxLev: 10 }), M.withMmr({ id: 'b', side: -1, size: 0.95 / 1.05, entry: 100, mark: 100, lev: 10, maxLev: 10 })],
});
add('edge-move-before-buffers', 'Two equal longs: the uniform move comes before either position’s buffer', { collateral: 40, positions: [pos('a'), pos('b')] });

// ---------- Risk level thresholds ----------
// One long at $100, maxLev 10: distance = (collateral − $5) / $95, so each
// collateral puts the distance just either side of 7.5% and 15%
for (const d of [7.45, 7.55, 14.95, 15.05]) {
  add(`risk-level-${String(d).replace('.', '_')}`, `Distance to liquidation ${d}%`, one({ maxLev: 10 }, 5 + 0.95 * d));
}

// ---------- Event order ----------
add('events-take-profit', 'Take-profit closes at its price and books the gain', one({ size: 2, tp: 120 }, 50), { x: 1.3 });
add('events-stop-not-reached', 'A stop the move does not reach stays open', one({ sl: 80, tp: 130 }, 1000), { x: 0.85 });
add('events-stop-at-target', 'A stop exactly at the simulated price fires', one({ sl: 80 }, 1000), { x: 0.8 });
add('events-earliest-first', 'Of two stops, the one reached first fires first', { collateral: 1000, positions: [pos('a', { sl: 95 }), pos('b', { sl: 90 })] }, { a: 0.97, b: 0.8 });
add('events-simultaneous', 'Two stops hit at the same moment both fire', { collateral: 500, positions: [pos('a', { lev: 5, sl: 90 }), pos('b', { lev: 5, sl: 90 })] }, { a: 0.7, b: 0.7 });
add('events-stop-saves', 'A stop that fires first saves the account from a later liquidation', { collateral: 30, positions: [pos('a', { sl: 95 }), pos('b')] }, { a: 0.8, b: 0.88 });
add('events-liq-after-stop', 'After a stop, liquidation comes before the second stop', { collateral: 33, positions: [pos('a', { sl: 95 }), pos('b', { sl: 64 })] }, { a: 0.8, b: 0.6 });

// ---------- Fixes ----------
add('fix-margin-round', 'Exact margin needed is a hair under $1,000: offered as $1,000', {
  collateral: 1500.00000005, positions: [M.withMmr({ id: 'x', side: -1, size: 50000, entry: 1, mark: 1, lev: 10, maxLev: 10 })],
}, { x: 0.5 });
add('fix-cut-round', 'Exact cut is 30%: offered as 30%', one({ maxLev: 10 }, 13.475));
add('fix-cut-full-close', 'Only closing all of c1 brings risk to Low', { collateral: 774.196, positions: [
  M.withMmr({ id: 'c0', side: 1, size: 190446, entry: 0.01, mark: 0.01, lev: 50, maxLev: 50 }),
  M.withMmr({ id: 'c1', side: 1, size: 4002.41, entry: 1, mark: 1, lev: 17, maxLev: 40 }),
] }, { c0: 0.71953, c1: 1.00763 });
add('fix-riskiest-second', 'Cut targets the riskiest position even when it is not first', { collateral: 120, positions: [pos('a', { size: 0.1, maxLev: 10 }), pos('b', { size: 10, maxLev: 10 })] });
add('fix-stop-long', 'Long stop behind the liq. price: moved 1% in front, 3 significant digits', one({ maxLev: 10, sl: 83 }, 20));
add('fix-stop-short', 'Short stop behind the liq. price', one({ side: -1, maxLev: 10, sl: 118 }, 20));
add('fix-stop-no-room', 'Liq. price within 1% of the price: no stop fix', one({ maxLev: 10, sl: 99 }, 5.475));
add('fix-stop-first-beaten', 'Two beaten stops: one fix, for the first', { collateral: 40, positions: [pos('a', { maxLev: 10, sl: 50 }), pos('b', { maxLev: 10, sl: 50 })] });
add('fix-none-when-low', 'Risk already Low: nothing offered', DEMO, { btc: 1.15 });

// ---------- Real Hyperliquid accounts (classic mode, no tier crossing) ----------
// The model's own output is the expected value; `exchange` holds what
// Hyperliquid reported, for reference (they agree within 0.0000006%)
const real = H.accounts
  .filter(a => a.mode === 'disabled' && a.positions.length >= 2 && a.positions.length <= 6 && !a.positions.some(H.crossesTier))
  .slice(0, 3);
for (const a of real) {
  const acc = H.toModelAccount(a);
  add(`hyperliquid-${a.id}`, `Real classic Hyperliquid account (${a.band}, ${a.positions.length} positions), snapshot ${new Date(a.time).toISOString()}`, acc, {}, M.noAdjustments(), {
    exchange: {
      maintenanceMargin: +a.crossMaintenanceMarginUsed,
      accountValue: +a.crossMarginSummary.accountValue,
      liqPrice: Object.fromEntries(a.positions.map(p => [p.coin, p.liquidationPx === null ? null : +p.liquidationPx])),
    },
  });
}

// ---------- Random accounts, fixed seed ----------
const { accountAndRatios } = require('../tests/arbitraries.js');
fc.sample(accountAndRatios({ stops: true }), { numRuns: 20, seed: 42 }).forEach(([acc, ratios], i) => {
  add(`random-${String(i + 1).padStart(2, '0')}`, 'Random account and move (fast-check, seed 42)', acc, ratios);
});

const doc = {
  about: 'Input → expected output examples for the Entry.fi liquidation risk model (romannurgaliev.com/risk-model.js). Formulas and terms: docs/risk-model.md.',
  generated: new Date().toISOString().slice(0, 10),
  conventions: {
    side: '1 = long, -1 = short',
    mmr: 'not an input: maintenance margin rate = 1 / (2 × maxLev)',
    ratios: 'simulated price / mark price, per position id; prices move along a straight line from mark to mark × ratio',
    adjustments: 'fixes applied at mark prices before the move: deposit (USD), cut (share 0–1 of a position, 1 = close), sl (new stop price)',
    infinity: 'written as the string "inf"',
    null: 'no value: no liquidation price, equity reserve and leverage when liquidated, and so on',
    riskLevel: 'high below 7.5% distance to liquidation, medium below 15%, low from 15%',
    tolerance: 'compare numbers with relative tolerance 1e-9 (absolute 1e-9 near zero); fix values exactly',
  },
  cases,
};

fs.writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n');
console.log(`${cases.length} cases → ${path.relative(process.cwd(), OUT)}`);
