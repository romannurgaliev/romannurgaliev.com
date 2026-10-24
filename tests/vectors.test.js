// risk-model.js against tests/vectors.json. This is also the reference for
// checking any other implementation: read each case's input, run your model,
// compare with `expected` using the rules in vectors.json "conventions".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../risk-model.js');
const vectors = require('./vectors.json');

const TOL = 1e-9;

// Numbers within TOL (relative, or absolute near zero); everything else exact
function compare(actual, expected, where, misses) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (Math.abs(actual - expected) > TOL * Math.max(1, Math.abs(expected))) misses.push(`${where}: ${actual} ≠ ${expected}`);
  } else if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return misses.push(`${where}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    keys.forEach(k => compare(actual[k], expected[k], `${where}.${k}`, misses));
  } else if (actual !== expected) {
    misses.push(`${where}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
  }
}

// Run the model the way any implementation would: from the JSON input only
function run(input) {
  const inf = v => (v === Infinity ? 'inf' : v === -Infinity ? '-inf' : v);
  const acc = { collateral: input.collateral, positions: input.positions.map(M.withMmr) };
  const s = M.simulate(acc, input.ratios, input.adjustments);
  return {
    liquidated: s.liquidated, accountValue: s.av, maintenanceMargin: s.mm, totalPnl: s.totalPnl,
    equityReserve: s.reserve, crossMarginRatio: inf(s.cmr), effectiveLeverage: s.lev,
    marketMoveToLiq: inf(s.move), withdrawable: s.withdrawable, distanceToLiq: inf(s.distance),
    riskLevel: s.level, riskiest: s.riskiest,
    positions: Object.fromEntries(Object.entries(s.rows).map(([id, r]) => [id, { price: r.price, pnl: r.pnl, liqPrice: r.liq, priceBuffer: r.buffer }])),
    closed: Object.fromEntries(Object.entries(s.closed).map(([id, c]) => [id, {
      by: c.kind === 'Closed by SL' ? 'stop' : c.kind === 'Closed by TP' ? 'takeProfit' : 'fix', price: c.price, pnl: c.pnl,
    }])),
    fixes: M.findFixes(acc, input.ratios, input.adjustments, s).map(f => {
      const g = { type: { deposit: 'addMargin', cut: 'cutPosition', sl: 'moveStop' }[f.id], value: f.value };
      if (f.target) g.position = f.target;
      if (f.on) g.applied = true;
      if ('liqAfter' in f) g.liqPriceAfter = f.liqAfter;
      return g;
    }),
  };
}

test(`vectors.json has the cases the docs promise (${vectors.cases.length})`, () => {
  const ids = vectors.cases.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate case ids');
  for (const prefix of ['demo-', 'edge-', 'events-', 'fix-', 'hyperliquid-', 'random-']) {
    assert.ok(ids.some(id => id.startsWith(prefix)), `no ${prefix} cases`);
  }
  // Every kind of outcome appears somewhere, so a partial implementation can't pass
  const all = vectors.cases.map(c => c.expected);
  assert.ok(all.some(e => e.liquidated) && all.some(e => !e.liquidated));
  for (const lvl of ['high', 'medium', 'low']) assert.ok(all.some(e => e.riskLevel === lvl), lvl);
  for (const by of ['stop', 'takeProfit', 'fix']) assert.ok(all.some(e => Object.values(e.closed).some(c => c.by === by)), by);
  for (const t of ['addMargin', 'cutPosition', 'moveStop']) assert.ok(all.some(e => e.fixes.some(f => f.type === t && !f.applied)), t);
  assert.ok(all.some(e => e.fixes.some(f => f.applied)));
  assert.ok(all.some(e => e.marketMoveToLiq === 'inf'));
  assert.ok(all.some(e => Object.values(e.positions).some(p => p.liqPrice === null)));
});

for (const c of vectors.cases) {
  test(`${c.id}: ${c.description}`, () => {
    const misses = [];
    compare(run(c.input), c.expected, 'expected', misses);
    assert.deepEqual(misses, []);
  });
}

test('real Hyperliquid cases agree with the exchange within 0.0001%', () => {
  for (const c of vectors.cases.filter(x => x.exchange)) {
    compare(c.expected.maintenanceMargin, c.exchange.maintenanceMargin, `${c.id} MM`, []);
    for (const [id, hl] of Object.entries(c.exchange.liqPrice)) {
      const ours = c.expected.positions[id].liqPrice;
      if (hl === null) { assert.equal(ours, null, `${c.id} ${id}`); continue; }
      assert.ok(Math.abs(ours - hl) / hl < 1e-6, `${c.id} ${id}: ${ours} vs exchange ${hl}`);
    }
  }
});
