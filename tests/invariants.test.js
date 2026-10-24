// Rules risk-model.js must keep for any account and any price move.
// fast-check generates hundreds of random cases per rule and, on a failure,
// shrinks it to the smallest account that still breaks the rule.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { fc, M, account, accountAndRatios } = require('./arbitraries.js');

const none = M.noAdjustments();
const atMarket = acc => M.simulate(acc, M.marketRatios(acc), none);
const close = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));
const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
const prop = (arb, fn) => fc.assert(fc.property(arb, fn));

// Deep-freezes inputs so any mutation by the model throws
const freeze = o => { Object.values(o).forEach(v => v && typeof v === 'object' && freeze(v)); return Object.freeze(o); };
const deepCopy = o => JSON.parse(JSON.stringify(o));

describe('formulas', () => {
  test('at market: account value = collateral + Σ P&L, MM = Σ notional × mmr', () => {
    prop(account(), acc => {
      const s = atMarket(acc);
      assert.ok(close(s.av, acc.collateral + sum(acc.positions, p => p.side * p.size * (p.mark - p.entry))));
      assert.ok(close(s.mm, sum(acc.positions, p => p.size * p.mark / (2 * p.maxLev))));
    });
  });

  test('at market: liquidated exactly when account value ≤ maintenance margin', () => {
    prop(account(), acc => {
      const s = atMarket(acc);
      assert.equal(s.liquidated, s.av - s.mm <= 0);
    });
  });

  test('account value = starting collateral + deposit + total P&L, after any move and fixes', () => {
    prop(accountAndRatios({ stops: true }).chain(([acc, rt]) => fc.tuple(
      fc.constant(acc), fc.constant(rt),
      fc.double({ min: 0, max: 5000, noNaN: true }),
      fc.double({ min: 0, max: 1, noNaN: true }),
    )), ([acc, rt, deposit, cut]) => {
      const a = { deposit, cut: { [acc.positions[0].id]: cut }, sl: {} };
      const s = M.simulate(acc, rt, a);
      assert.ok(close(s.av, acc.collateral + deposit + s.totalPnl, 1e-7));
    });
  });

  test('cross margin ratio = MM / account value, and 100% or more means liquidated at market', () => {
    prop(account(), acc => {
      const s = atMarket(acc);
      if (s.av > 0) assert.ok(close(s.cmr, s.mm / s.av * 100));
      if (s.cmr >= 100 + 1e-9) assert.ok(s.liquidated);
    });
  });
});

describe('liquidation price', () => {
  test('sits on the losing side: below the price for a long, above for a short', () => {
    prop(accountAndRatios(), ([acc, rt]) => {
      const s = M.simulate(acc, rt, none);
      for (const p of acc.positions) {
        const r = s.rows[p.id];
        if (!r || r.liq === null) continue;
        assert.ok(p.side > 0 ? r.liq < r.price : r.liq > r.price, `${p.id} ${p.side > 0 ? 'long' : 'short'}: liq ${r.liq}, price ${r.price}`);
        assert.ok(r.buffer > 0);
      }
    });
  });

  test('is where the account actually gets liquidated: just before it survives, just past it does not', () => {
    prop(account(), acc => {
      const s = atMarket(acc);
      fc.pre(!s.liquidated);
      for (const p of acc.positions) {
        const liq = s.rows[p.id].liq;
        // A liq. price within a millionth of zero is rounding left over from
        // an exact zero (fully collateralized long), nothing to cross there
        if (liq === null || liq < p.mark * 1e-6) continue;
        const at = k => M.simulate(acc, { ...M.marketRatios(acc), [p.id]: liq * k / p.mark }, none).liquidated;
        const toward = p.side > 0 ? 1 - 1e-7 : 1 + 1e-7; // past liq, in the losing direction
        assert.equal(at(1 / toward), false, `${p.id} liquidated before its liq. price`);
        assert.equal(at(toward), true, `${p.id} not liquidated past its liq. price`);
      }
    });
  });

  test('"Market move to liq." takes the account exactly to the edge', () => {
    prop(account(), acc => {
      const s = atMarket(acc);
      fc.pre(!s.liquidated && isFinite(s.move) && Math.abs(s.move) < 0.9);
      const rt = Object.fromEntries(acc.positions.map(p => [p.id, 1 + s.move]));
      const after = M.simulate(acc, rt, none);
      const mm = sum(acc.positions, p => p.size * p.mark * (1 + s.move) * p.mmr);
      assert.ok(close(after.av, mm, 1e-6), `account value ${after.av} vs MM ${mm}`);
    });
  });

  test('does not change when every size and the collateral are scaled together', () => {
    prop(fc.tuple(accountAndRatios(), fc.double({ min: 0.01, max: 100, noNaN: true })), ([[acc, rt], k]) => {
      const scaled = { collateral: acc.collateral * k, positions: acc.positions.map(p => ({ ...p, size: p.size * k })) };
      const a = M.simulate(acc, rt, none), b = M.simulate(scaled, rt, none);
      assert.equal(a.liquidated, b.liquidated);
      assert.equal(a.level, b.level);
      for (const p of acc.positions) {
        const x = a.rows[p.id].liq, y = b.rows[p.id].liq;
        assert.ok(x === y || close(x, y, 1e-6), `${p.id}: ${x} vs ${y}`);
      }
    });
  });
});

describe('fixes', () => {
  test('adding margin never brings any liquidation price closer, nor lowers the distance', () => {
    prop(fc.tuple(account(), fc.double({ min: 1, max: 10000, noNaN: true })), ([acc, deposit]) => {
      const a = atMarket(acc), b = M.simulate(acc, M.marketRatios(acc), { ...none, deposit });
      assert.ok(b.distance >= a.distance - 1e-9);
      if (a.liquidated) return;
      for (const p of acc.positions) {
        const x = a.rows[p.id].liq, y = b.rows[p.id].liq;
        if (x === null) { assert.equal(y, null); continue; }
        if (y !== null) assert.ok(p.side > 0 ? y <= x + 1e-9 : y >= x - 1e-9, `${p.id}: ${x} → ${y}`);
      }
    });
  });

  test('cutting a position at market never lowers the equity reserve', () => {
    prop(fc.tuple(account(), fc.double({ min: 0, max: 0.99, noNaN: true })), ([acc, cut]) => {
      const a = atMarket(acc);
      fc.pre(!a.liquidated);
      const b = M.simulate(acc, M.marketRatios(acc), { ...none, cut: { [acc.positions[0].id]: cut } });
      assert.ok(b.reserve >= a.reserve - 1e-6 * Math.max(1, a.reserve));
    });
  });

  test('every offered fix does what its button says', () => {
    prop(accountAndRatios({ stops: true }), ([acc, rt]) => {
      const s = M.simulate(acc, rt, none);
      for (const f of M.findFixes(acc, rt, none, s)) {
        assert.ok(!f.on);
        const after = M.simulate(acc, rt, M.applyFix(none, f));
        if (f.id === 'deposit') {
          assert.ok(!after.liquidated && after.distance >= M.LOW, 'margin added, risk not Low');
          // Smallest round $10 that works: $10 less is not enough
          if (f.value >= 10) {
            const less = M.simulate(acc, rt, { ...none, deposit: f.value - 10 });
            assert.ok(less.liquidated || less.distance < M.LOW, `$${f.value} offered, $${f.value - 10} would do`);
          }
        }
        if (f.id === 'cut') {
          assert.ok(f.value > 0 && f.value <= 1);
          assert.ok(!after.liquidated && after.distance >= M.LOW, 'position cut, risk not Low');
          // Smallest 5% step that works: one step less is not enough
          if (f.value >= 0.1) {
            const less = M.simulate(acc, rt, { ...none, cut: { [f.target]: f.value - 0.05 } });
            assert.ok(less.liquidated || less.distance < M.LOW, `cut ${f.value} offered, ${f.value - 0.05} would do`);
          }
        }
        if (f.id === 'sl') {
          // The new stop sits between the liquidation price and the price
          const p = acc.positions.find(q => q.id === f.target), r = s.rows[p.id];
          assert.ok(p.side > 0 ? f.value > r.liq && f.value < r.price : f.value < r.liq && f.value > r.price);
        }
      }
    });
  });

  test('applying a fix and then its undo gives back the same adjustments', () => {
    prop(accountAndRatios({ stops: true }), ([acc, rt]) => {
      const s = M.simulate(acc, rt, none);
      for (const f of M.findFixes(acc, rt, none, s)) {
        const on = M.applyFix(none, f);
        const shown = M.findFixes(acc, rt, on, M.simulate(acc, rt, on)).find(g => g.id === f.id);
        assert.ok(shown && shown.on, `${f.id} not shown as applied`);
        assert.deepEqual(M.applyFix(on, shown), none);
      }
    });
  });
});

describe('stops and liquidation', () => {
  test('a stop in front of the liquidation price closes the position first', () => {
    // One position, so nothing else moves the liquidation price
    prop(account().filter(a => a.positions.length === 1), acc => {
      const s = atMarket(acc);
      fc.pre(!s.liquidated);
      const p = acc.positions[0], liq = s.rows[p.id].liq;
      // An account sitting on the edge (fast-check found $1 collateral vs $1
      // MM) has stop and liquidation at the same instant; the model treats
      // events closer than 1e-9 of the path as simultaneous, so skip those
      fc.pre(liq !== null && Math.abs(liq / p.mark - 1) < 0.45 && Math.abs(liq / p.mark - 1) > 1e-6);
      const sl = (p.mark + liq) / 2;
      const stopped = { collateral: acc.collateral, positions: [{ ...p, sl }] };
      const r = M.simulate(stopped, { [p.id]: (liq / p.mark) * (p.side > 0 ? 0.99 : 1.01) }, none);
      assert.equal(r.liquidated, false);
      assert.equal(r.closed[p.id].kind, 'Closed by SL');
      assert.ok(close(r.closed[p.id].price, sl));
    });
  });

  test('a liquidated account shows no reserve, leverage or move, and nothing to withdraw', () => {
    prop(accountAndRatios({ stops: true }), ([acc, rt]) => {
      const s = M.simulate(acc, rt, none);
      if (!s.liquidated) return;
      assert.equal(s.reserve, null);
      assert.equal(s.lev, null);
      assert.equal(s.move, null);
      assert.equal(s.withdrawable, 0);
      assert.equal(s.distance, 0);
      assert.equal(s.level, 'high');
      Object.values(s.rows).forEach(r => assert.equal(r.liq, null));
    });
  });
});

describe('the model has no side effects', () => {
  test('simulate, findFixes and applyFix leave their inputs untouched', () => {
    prop(accountAndRatios({ stops: true }), ([acc, rt]) => {
      const before = deepCopy({ acc, rt });
      const fa = freeze(deepCopy(acc)), fr = freeze(deepCopy(rt)), fn = freeze(M.noAdjustments());
      const s = M.simulate(fa, fr, fn);
      M.findFixes(fa, fr, fn, s).forEach(f => M.applyFix(fn, f));
      assert.deepEqual({ acc, rt }, before);
    });
  });

  test('the same inputs always give the same result', () => {
    prop(accountAndRatios({ stops: true }), ([acc, rt]) => {
      assert.deepEqual(M.simulate(acc, rt, none), M.simulate(acc, rt, none));
    });
  });
});
