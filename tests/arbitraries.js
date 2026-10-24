// Random accounts and price moves for property tests (fast-check).
// The seed is fixed so a failure always reproduces; set FC_SEED to explore.
const fc = require('fast-check');
const M = require('../risk-model.js');

fc.configureGlobal({
  seed: process.env.FC_SEED ? +process.env.FC_SEED : 20261023,
  numRuns: process.env.FC_RUNS ? +process.env.FC_RUNS : 1000,
});

const MAX_LEVS = [3, 5, 10, 20, 25, 40, 50];

// Prices across seven orders of magnitude, like real coins
const price = fc.double({ min: Math.log(0.01), max: Math.log(100000), noNaN: true }).map(Math.exp);

const position = (id, opts = {}) => fc.record({
  side: fc.constantFrom(1, -1),
  notional: fc.double({ min: 10, max: 50000, noNaN: true }),
  mark: price,
  entryShift: fc.double({ min: -0.3, max: 0.3, noNaN: true }),
  maxLev: fc.constantFrom(...MAX_LEVS),
  levShare: fc.double({ min: 0.1, max: 1, noNaN: true }),
  sl: opts.stops ? fc.option(fc.double({ min: 0.02, max: 0.45, noNaN: true }), { nil: null }) : fc.constant(null),
  tp: opts.stops ? fc.option(fc.double({ min: 0.02, max: 0.45, noNaN: true }), { nil: null }) : fc.constant(null),
}).map(r => {
  const lev = Math.max(1, Math.round(r.maxLev * r.levShare));
  const p = {
    id, ticker: id.toUpperCase(), name: id.toUpperCase() + '-USDC', dp: 2,
    side: r.side, size: r.notional / r.mark, mark: r.mark, entry: r.mark * (1 + r.entryShift),
    lev, maxLev: r.maxLev,
  };
  // Stops below the price for a long, above for a short; take-profits opposite
  if (r.sl !== null) p.sl = r.mark * (1 - r.side * r.sl);
  if (r.tp !== null) p.tp = r.mark * (1 + r.side * r.tp);
  return M.withMmr(p);
});

// An account of 1–6 positions. Collateral is a multiple of the initial
// margin, net of open P&L, so some accounts start healthy and some near the edge.
const account = (opts = {}) => fc.integer({ min: 1, max: 6 })
  .chain(n => fc.tuple(
    fc.tuple(...Array.from({ length: n }, (_, i) => position('c' + i, opts))),
    fc.double({ min: 0.3, max: 4, noNaN: true }),
  ))
  .map(([positions, cushion]) => {
    const im = positions.reduce((s, p) => s + p.size * p.mark / p.lev, 0);
    const pnl = positions.reduce((s, p) => s + p.side * p.size * (p.mark - p.entry), 0);
    return { collateral: im * cushion - pnl, positions };
  });

// Simulated price / market price per position, within the sliders' ±50%
const ratiosFor = acc => fc.tuple(...acc.positions.map(() => fc.double({ min: 0.5, max: 1.5, noNaN: true })))
  .map(rs => Object.fromEntries(acc.positions.map((p, i) => [p.id, rs[i]])));

const accountAndRatios = (opts = {}) => account(opts).chain(acc => fc.tuple(fc.constant(acc), ratiosFor(acc)));

module.exports = { fc, M, account, accountAndRatios, ratiosFor };
