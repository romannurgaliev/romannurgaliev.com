// Event order (stops, take-profits, liquidation) checked against a second,
// independent simulator: it walks the price path in 20,000 small steps
// instead of solving for event times. Where two events land in the same
// step the order is ambiguous, and that case is skipped.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { fc, M, accountAndRatios } = require('./arbitraries.js');

const STEPS = 20000;

function walk(acc, rt) {
  let collateral = acc.collateral;
  let open = acc.positions.slice();
  const closed = {};
  const price = (p, t) => p.mark * (1 + t * (rt[p.id] - 1));
  const free = t => open.reduce((s, p) => s + p.side * p.size * (price(p, t) - p.entry) - p.size * price(p, t) * p.mmr, collateral);
  if (free(0) <= 0) return { liquidated: true, closed };
  for (let k = 1; k <= STEPS; k++) {
    const t0 = (k - 1) / STEPS, t1 = k / STEPS;
    // Stops and take-profits whose level the price passed in this step
    const hits = [];
    for (const p of open) {
      for (const [kind, level] of [['SL', p.sl], ['TP', p.tp]]) {
        if (!level) continue;
        const a = price(p, t0), b = price(p, t1);
        if (a !== b && (level - a) * (level - b) <= 0 && level !== a) hits.push({ p, kind, level });
      }
    }
    const liqHere = free(t1) <= 0;
    if (hits.length > 1 || (hits.length && liqHere)) return { ambiguous: true };
    if (liqHere) return { liquidated: true, closed };
    for (const h of hits) {
      collateral += h.p.side * h.p.size * (h.level - h.p.entry);
      closed[h.p.id] = 'Closed by ' + h.kind;
      open = open.filter(q => q !== h.p);
      if (free(t1) <= 0) return { ambiguous: true }; // liquidated right at the stop
    }
  }
  return { liquidated: false, closed };
}

describe('event order matches a step-by-step walk of the price path', () => {
  test('which positions close, by what, and whether the account is liquidated', () => {
    let compared = 0;
    fc.assert(fc.property(accountAndRatios({ stops: true }), ([acc, rt]) => {
      const ref = walk(acc, rt);
      fc.pre(!ref.ambiguous);
      compared++;
      const s = M.simulate(acc, rt, M.noAdjustments());
      const kinds = Object.fromEntries(Object.entries(s.closed).map(([id, c]) => [id, c.kind]));
      assert.equal(s.liquidated, ref.liquidated, 'liquidated');
      assert.deepEqual(kinds, ref.closed);
    }), { numRuns: 400 });
    assert.ok(compared > 300, `only ${compared} cases compared`);
  });
});

describe('event order, by hand', () => {
  const pos = (id, extra) => M.withMmr({ id, side: 1, size: 1, entry: 100, mark: 100, lev: 10, maxLev: 20, ...extra });

  test('of two stops, the one the price reaches first fires first, in either table order', () => {
    // a's stop at −5%, b's at −10%; b moves twice as fast, so b's comes first
    for (const order of [['a', 'b'], ['b', 'a']]) {
      const ps = { a: pos('a', { sl: 95 }), b: pos('b', { sl: 90 }) };
      const acc = { collateral: 1000, positions: order.map(id => ps[id]) };
      const s = M.simulate(acc, { a: 0.97, b: 0.8 }, M.noAdjustments());
      assert.deepEqual(Object.keys(s.closed), ['b'], order.join());
      assert.equal(s.closed.b.price, 90);
    }
  });

  test('after one stop fires, the next event is timed from that point on', () => {
    // a stops at t = 0.25; the account is then liquidated at t = 0.7 by b,
    // before b's own stop at t = 0.9 (−36% of a −40% move)
    const acc = { collateral: 33, positions: [pos('a', { sl: 95 }), pos('b', { sl: 64 })] };
    const rt = { a: 0.8, b: 0.6 };
    const s = M.simulate(acc, rt, M.noAdjustments());
    assert.equal(s.closed.a.kind, 'Closed by SL');
    assert.equal(s.liquidated, true);
    assert.equal(s.closed.b, undefined);
  });

  test('stops hit at the same moment all fire (bug found by the walk above)', () => {
    // Two longs with stops 10% away, one uniform −30% crash: both stop out at $90
    const acc = { collateral: 500, positions: [pos('a', { sl: 90 }), pos('b', { sl: 90 })] };
    const s = M.simulate(acc, { a: 0.7, b: 0.7 }, M.noAdjustments());
    assert.deepEqual(Object.keys(s.closed).sort(), ['a', 'b']);
    assert.equal(s.closed.b.price, 90);
    assert.equal(s.totalPnl, -20);
  });

  test('an account liquidated at market stays liquidated even if the move would recover it', () => {
    // Closing a position at its stop moves its loss from unrealized to realized
    // and frees its margin, so a stop never tips the account over by itself;
    // liquidation at the very start is the only "at once" case
    const acc = { collateral: 2, positions: [pos('a')] }; // MM $2.50 > $2 equity
    assert.equal(M.simulate(acc, { a: 1 }, M.noAdjustments()).liquidated, true);
    assert.equal(M.simulate(acc, { a: 1.2 }, M.noAdjustments()).liquidated, true);
  });

  test('a stop the move does not reach stays open', () => {
    const acc = { collateral: 1000, positions: [pos('a', { sl: 80, tp: 130 })] };
    assert.deepEqual(M.simulate(acc, { a: 0.85 }, M.noAdjustments()).closed, {});
    assert.deepEqual(M.simulate(acc, { a: 1.25 }, M.noAdjustments()).closed, {});
  });

  test('a stop exactly at the simulated price fires', () => {
    const acc = { collateral: 1000, positions: [pos('a', { sl: 80 })] };
    assert.equal(M.simulate(acc, { a: 0.8 }, M.noAdjustments()).closed.a.kind, 'Closed by SL');
  });
});
