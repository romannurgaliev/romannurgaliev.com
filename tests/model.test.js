// Edge cases and the demo account's known numbers (the case page copy and
// Figma frames quote these, so they must not drift).
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../risk-model.js');

const none = M.noAdjustments();
const DEMO = M.DEMO;
const market = () => M.marketRatios(DEMO);
const run = (ratios = {}, adj = none, acc = DEMO) => M.simulate(acc, { ...M.marketRatios(acc), ...ratios }, adj);
const near = (actual, expected, dp) => assert.equal(+actual.toFixed(dp), expected, `${actual} ≠ ${expected}`);
const one = (p, collateral) => ({ collateral, positions: [M.withMmr({ id: 'x', ticker: 'X', dp: 2, lev: 10, maxLev: 20, ...p })] });

describe('demo account, as quoted on the case page', () => {
  // Values as the page rendered them before risk-model.js was split out
  // (recorded Oct 23, 2026), so the refactor and any later change are pinned
  const PAGE = {
    market:   { level: 'medium', cmr: 18.5, pnl: -1206.75, reserve: 1054.01, mm: 239.24, lev: 10.11, move: -11.96, withdrawable: 0, closed: [] },
    crash:    { level: 'low', cmr: 22.4, pnl: -2103.32, reserve: 307.73, mm: 88.94, lev: 7.24, move: 848.47, withdrawable: 0, closed: ['btc'] },
    boom:     { level: 'low', cmr: 9.7, pnl: 139.35, reserve: 2383.29, mm: 256.06, lev: 5.46, move: -23.51, withdrawable: 988.54, closed: [] },
    recovery: { level: 'low', cmr: 12.0, pnl: -301.82, reserve: 1935.01, mm: 263.16, lev: 6.54, move: -19.97, withdrawable: 530.36, closed: [] },
    oct10:    { level: 'low', cmr: 17.8, pnl: -2023.20, reserve: 391.78, mm: 85.02, lev: 5.83, move: -820.03, withdrawable: 53.39, closed: ['btc'] },
    apr25:    { level: 'low', cmr: 23.7, pnl: -2114.28, reserve: 294.20, mm: 91.52, lev: 7.77, move: 590.81, withdrawable: 0, closed: ['btc'] },
  };
  for (const [id, want] of Object.entries(PAGE)) {
    test(`${id === 'market' ? 'at market' : 'preset ' + id}: the numbers the page shows`, () => {
      const preset = M.SCENARIOS.concat(M.SHOCKS).find(p => p.id === id);
      const s = run(preset ? preset.ratios : {});
      assert.equal(s.liquidated, false);
      assert.equal(s.level, want.level);
      near(s.cmr, want.cmr, 1);
      near(s.totalPnl, want.pnl, 2);
      near(s.reserve, want.reserve, 2);
      near(s.mm, want.mm, 2);
      near(s.lev, want.lev, 2);
      near(s.move * 100, want.move, 2);
      near(s.withdrawable, want.withdrawable, 2);
      assert.deepEqual(Object.keys(s.closed), want.closed);
      // In every replayed drop BTC's stop fires before anything else
      want.closed.forEach(c => assert.equal(s.closed[c].kind, 'Closed by SL'));
    });
  }

  test('at market: liquidation price per position', () => {
    const s = run();
    near(s.rows.btc.liq, 79066.456, 3);
    near(s.rows.eth.liq, 858.954, 3);
    assert.equal(s.rows.zec.liq, null);
    near(s.rows.sol.liq, 234.03, 3);
    near(s.rows.hype.liq, 56.811, 3);
    assert.equal(s.riskiest, 'btc');
  });

  test('BTC −8% (frame: ETH $2,305.78 with a 23.4% buffer, ZEC $146.35, SOL $164.87, CMR 40%)', () => {
    const s = run({ btc: 0.92 });
    near(s.rows.eth.liq, 2305.78, 2);
    near(s.rows.eth.buffer, 23.4, 1);
    near(s.rows.zec.liq, 146.35, 2);
    near(s.rows.sol.liq, 164.87, 2);
    near(s.cmr, 40, 0);
  });

  test('SOL +15% (frame: BTC liq. $81,109 comes before its $81,000 stop)', () => {
    const s = run({ sol: 1.15 });
    near(s.rows.btc.liq, 81109, 0);
    assert.ok(s.rows.btc.liq > DEMO.positions[0].sl);
    const fixes = M.findFixes(DEMO, { ...market(), sol: 1.15 }, none, s);
    assert.deepEqual(fixes.map(f => [f.id, f.value]), [['deposit', 480], ['cut', 0.35], ['sl', 82000]]);
    near(fixes[1].liqAfter, 75850.17, 2);
  });

  test('crash ratios are daily low / daily open from the candles listed', () => {
    const oct = M.SHOCKS.find(s => s.id === 'oct10');
    assert.equal(oct.ratios.btc, 100837 / 121615);
    assert.deepEqual(Object.keys(oct.ratios).sort(), DEMO.positions.map(p => p.id).sort());
    M.SHOCKS.forEach(sh => Object.values(sh.ratios).forEach(r => assert.ok(r > 0.5 && r < 1, `${sh.id}: ${r}`)));
  });
});

describe('edge cases', () => {
  test('all positions closed: nothing at risk, risk Low', () => {
    const cut = Object.fromEntries(DEMO.positions.map(p => [p.id, 1]));
    const s = run({}, { ...none, cut });
    assert.deepEqual(s.rows, {});
    assert.equal(s.move, null);
    assert.equal(s.distance, Infinity);
    assert.equal(s.level, 'low');
    assert.equal(s.cmr, 0);
    assert.equal(Object.values(s.closed).every(c => c.kind === 'Closed' && c.manual), true);
  });

  test('a long that can fall to zero has no liquidation price', () => {
    const s = run({}, none, one({ side: 1, size: 1, entry: 100, mark: 100 }, 1000));
    assert.equal(s.rows.x.liq, null);
    assert.equal(s.rows.x.buffer, null);
  });

  test('a short always has a liquidation price, however much margin', () => {
    const s = run({}, none, one({ side: -1, size: 1, entry: 100, mark: 100 }, 1e9));
    assert.ok(s.rows.x.liq > 100);
  });

  test('liquidated already at market', () => {
    const s = run({}, none, one({ side: 1, size: 10, entry: 100, mark: 90 }, 100));
    assert.equal(s.liquidated, true);
    assert.equal(s.cmr >= 100, true);
  });

  test('account value at or below zero: no leverage, ratio shown as infinite', () => {
    const s = run({}, none, one({ side: 1, size: 10, entry: 100, mark: 50 }, 400));
    assert.ok(s.av <= 0);
    assert.equal(s.cmr, Infinity);
    assert.equal(s.lev, null);
  });

  test('a perfectly hedged account cannot be liquidated by a uniform move', () => {
    // Long and short of the same notional: net exposure equals MM, the uniform move has no denominator
    const acc = { collateral: 1000, positions: [
      M.withMmr({ id: 'a', side: 1, size: 1, entry: 100, mark: 100, lev: 10, maxLev: 10 }),
      M.withMmr({ id: 'b', side: -1, size: 100 / 95 * 1.1 / (1 + 0.05) * 0 + 1, entry: 100, mark: 100, lev: 10, maxLev: 10 }),
    ] };
    // netLong − MM = 100 − 100 − (5 + 5) ≠ 0 here, so build the exact case:
    // side·n summed = MM → long n_a, short n_b with n_a − n_b = 0.05 (n_a + n_b)
    acc.positions[1].size = 0.95 / 1.05;
    const s = run({}, none, acc);
    assert.equal(s.move, Infinity);
  });

  test('a stop exactly at the liquidation price still counts as beaten', () => {
    const base = one({ side: 1, size: 1, entry: 100, mark: 100 }, 20);
    const liq = run({}, none, base).rows.x.liq;
    const s = run({}, none, { ...base, positions: [{ ...base.positions[0], sl: liq }] });
    const fixes = M.findFixes(base, M.marketRatios(base), none, s);
    assert.ok(fixes.some(f => f.id === 'sl'), 'no "Move SL" offered for a stop sitting on the liquidation price');
  });

  test('a coin left at market price never triggers its stops', () => {
    const p = { side: 1, size: 1, entry: 100, mark: 100, sl: 100, tp: 100 };
    const s = run({}, none, one(p, 50));
    assert.deepEqual(s.closed, {});
  });

  test('take-profit closes at its price and books the gain', () => {
    const acc = one({ side: 1, size: 2, entry: 100, mark: 100, tp: 120 }, 50);
    const s = run({ x: 1.3 }, none, acc);
    assert.deepEqual(s.closed.x, { kind: 'Closed by TP', price: 120, pnl: 40 });
    assert.equal(s.av, 90);
  });

  test('a stop that fires first can save the account from a later liquidation', () => {
    const acc = { collateral: 30, positions: [
      M.withMmr({ id: 'a', side: 1, size: 1, entry: 100, mark: 100, lev: 10, maxLev: 20, sl: 95 }),
      M.withMmr({ id: 'b', side: 1, size: 1, entry: 100, mark: 100, lev: 10, maxLev: 20 }),
    ] };
    const noStop = { ...acc, positions: [{ ...acc.positions[0], sl: undefined }, acc.positions[1]] };
    assert.equal(run({ a: 0.8, b: 0.88 }, none, noStop).liquidated, true);
    const s = run({ a: 0.8, b: 0.88 }, none, acc);
    assert.equal(s.liquidated, false);
    assert.equal(s.closed.a.kind, 'Closed by SL');
  });

  test('no fixes are offered when risk is already Low', () => {
    const s = run({ btc: 1.15 });
    assert.equal(s.level, 'low');
    assert.deepEqual(M.findFixes(DEMO, { ...market(), btc: 1.15 }, none, s), []);
  });

  test('no margin fix when even $100,000 would not help', () => {
    const acc = one({ side: 1, size: 1e6, entry: 100, mark: 100 }, 1e6);
    const s = run({ x: 0.5 }, none, acc);
    const fixes = M.findFixes(acc, { x: 0.5 }, none, s);
    assert.equal(fixes.some(f => f.id === 'deposit'), false);
  });

  test('a cut too small to help becomes a full close', () => {
    const acc = one({ side: 1, size: 1, entry: 100, mark: 100 }, 12);
    const s = run({ x: 0.97 }, none, acc);
    const cut = M.findFixes(acc, { x: 0.97 }, none, s).find(f => f.id === 'cut');
    assert.ok(cut);
    assert.equal(cut.liqAfter === null || cut.value < 1, true);
  });
});

describe('helpers', () => {
  test('bisect finds the smallest passing value, or null when none passes', () => {
    near(M.bisect(0, 100, v => v >= 37.5), 37.5, 6);
    assert.equal(M.bisect(0, 1, () => false), null);
    assert.equal(M.bisect(0, 1, () => true), 0 + M.bisect(0, 1, () => true)); // stays inside the range
    assert.ok(M.bisect(0, 1, () => true) <= 1e-9);
  });

  test('niceAbove rounds to three significant digits, away from the market', () => {
    assert.equal(M.niceAbove(81109, 1), 81200);
    assert.equal(M.niceAbove(81109, -1), 81100);
    assert.equal(M.niceAbove(1.2345, 1), 1.24);
    assert.equal(M.niceAbove(0.012345, -1), 0.0123);
  });

  test('risk levels: High below 7.5%, Medium below 15%, Low from 15%', () => {
    assert.equal(M.riskLevel(0), 'high');
    assert.equal(M.riskLevel(7.4999), 'high');
    assert.equal(M.riskLevel(7.5), 'medium');
    assert.equal(M.riskLevel(14.9999), 'medium');
    assert.equal(M.riskLevel(15), 'low');
    assert.equal(M.riskLevel(Infinity), 'low');
  });

  test('hasAdjustments notices each kind of fix', () => {
    assert.equal(M.hasAdjustments(none), false);
    assert.equal(M.hasAdjustments({ ...none, deposit: 1 }), true);
    assert.equal(M.hasAdjustments({ ...none, cut: { btc: 0.5 } }), true);
    assert.equal(M.hasAdjustments({ ...none, sl: { btc: 80000 } }), true);
  });

  test('priceAt and accountAt move linearly from market to the simulated price', () => {
    const p = DEMO.positions[0];
    assert.equal(M.priceAt(p, 0, { btc: 0.5 }), p.mark);
    assert.equal(M.priceAt(p, 1, { btc: 0.5 }), p.mark * 0.5);
    assert.equal(M.priceAt(p, 0.5, { btc: 0.5 }), p.mark * 0.75);
    const a = M.accountAt([p], 1000, 1, { btc: 1 });
    near(a.av, 1000 + 0.1 * (89740 - 101000), 6);
    near(a.mm, 0.1 * 89740 / 80, 6);
  });

  test('withMmr sets mmr = 1 / (2 × max leverage) without changing the input', () => {
    const p = { maxLev: 25 };
    assert.equal(M.withMmr(p).mmr, 0.02);
    assert.equal(p.mmr, undefined);
  });
});

describe('fix details', () => {
  const long = (extra = {}) => M.withMmr({ id: 'x', ticker: 'X', dp: 2, side: 1, size: 1, entry: 100, mark: 100, lev: 10, maxLev: 10, ...extra });
  const fixesFor = (acc, rt, adj = none) => M.findFixes(acc, { ...M.marketRatios(acc), ...rt }, adj, run(rt, adj, acc));

  test('margin fix: an answer a hair under $1,000 is offered as $1,000, not $1,010', () => {
    // Found by fast-check: the search lands just above the exact answer
    const acc = { collateral: 1500.00000005, positions: [M.withMmr({ id: 'x', ticker: 'X', dp: 2, side: -1, size: 50000, entry: 1, mark: 1, lev: 10, maxLev: 10 })] };
    assert.deepEqual(fixesFor(acc, { x: 0.5 }), [{ id: 'deposit', value: 1000 }]);
  });

  test('cut fix: an exact 30% cut is offered as 30%, not 35%', () => {
    // Distance = 15% exactly when 70% of the position is left
    const acc = { collateral: 13.475, positions: [long()] };
    const cut = fixesFor(acc, {}).find(f => f.id === 'cut');
    assert.equal(cut.value, 0.3);
    assert.equal(cut.target, 'x');
  });

  test('cut fix targets the riskiest position, wherever it is in the list', () => {
    // In cross margin the biggest position has the thinnest buffer; put it second
    const acc = { collateral: 120, positions: [long({ id: 'a', size: 0.1 }), long({ id: 'b', size: 10 })] };
    const s = run({}, none, acc);
    assert.equal(s.riskiest, 'b');
    assert.equal(M.findFixes(acc, M.marketRatios(acc), none, s).find(f => f.id === 'cut').target, 'b');
  });

  test('a full close has no liquidation price to report', () => {
    // Found by searching random accounts: cutting less than all of c1 leaves risk above Low
    const acc = { collateral: 774.196, positions: [
      M.withMmr({ id: 'c0', ticker: 'C0', dp: 4, side: 1, size: 190446, entry: 0.01, mark: 0.01, lev: 50, maxLev: 50 }),
      M.withMmr({ id: 'c1', ticker: 'C1', dp: 2, side: 1, size: 4002.41, entry: 1, mark: 1, lev: 17, maxLev: 40 }),
    ] };
    const rt = { c0: 0.71953, c1: 1.00763 };
    const cut = M.findFixes(acc, rt, none, M.simulate(acc, rt, none)).find(f => f.id === 'cut');
    assert.deepEqual(cut, { id: 'cut', target: 'c1', value: 1, liqAfter: null });
  });

  test('"Move SL" is offered only for a stop the liquidation would beat', () => {
    const at = sl => ({ collateral: 20, positions: [long({ sl })] });
    const liq = run({}, none, at(undefined)).rows.x.liq; // $84.21
    // A long falls: a stop above the liq. price fires first, one below never does
    assert.equal(fixesFor(at(liq + 1), {}).some(f => f.id === 'sl'), false, 'stop already in front');
    const f = fixesFor(at(liq - 1), {}).find(g => g.id === 'sl');
    assert.ok(f, 'stop behind the liquidation price: no fix offered');
    assert.equal(f.target, 'x');
    assert.equal(f.value, M.niceAbove(liq * 1.01, 1)); // 1% in front, rounded away from the market
  });

  test('"Move SL" works for shorts too', () => {
    const acc = (sl) => ({ collateral: 20, positions: [M.withMmr({ id: 'x', ticker: 'X', dp: 2, side: -1, size: 1, entry: 100, mark: 100, lev: 10, maxLev: 10, sl })] });
    const liq = run({}, none, acc(undefined)).rows.x.liq;
    // A short rises: its stop must sit below the liq. price to fire first
    assert.equal(fixesFor(acc(liq - 1), {}).some(f => f.id === 'sl'), false);
    const f = fixesFor(acc(liq + 1), {}).find(g => g.id === 'sl');
    assert.equal(f.value, M.niceAbove(liq * 0.99, -1));
    assert.ok(f.value < liq && f.value > 100);
  });

  test('"Move SL" is not offered when the new stop would sit past the price', () => {
    // Liq. price $99.50, stop $99 behind it: 1% in front would be $100.50, past the price
    const acc = { collateral: 5.475, positions: [long({ sl: 99 })] };
    const s = run({}, none, acc);
    near(s.rows.x.liq, 99.5, 9);
    assert.equal(M.findFixes(acc, M.marketRatios(acc), none, s).some(f => f.id === 'sl'), false);
  });

  test('"Move SL" picks the first beaten stop, not one that is fine', () => {
    // Both liq. prices $68.42: a's stop at $99 fires first, b's at $50 never would
    const acc = { collateral: 40, positions: [long({ id: 'a', sl: 99 }), long({ id: 'b', sl: 50 })] };
    const s = run({}, none, acc);
    const f = M.findFixes(acc, M.marketRatios(acc), none, s).filter(g => g.id === 'sl');
    assert.equal(f.length, 1);
    assert.equal(f[0].target, 'b');
  });

  test('"Move SL" looks past positions without a stop', () => {
    const acc = { collateral: 40, positions: [long({ id: 'a' }), long({ id: 'b', sl: 50 })] };
    const f = M.findFixes(acc, M.marketRatios(acc), none, run({}, none, acc)).filter(g => g.id === 'sl');
    assert.deepEqual(f.map(g => g.target), ['b']);
  });

  test('"Move SL" skips a stop it cannot fix and offers the next one', () => {
    // a: big, liq. price $99.50, no room in front of it. b: small, plenty of room
    // a: long, liq. price $99.60, stop $99 behind it, no room in front.
    // b: tiny short, liq. price about $861, stop $900 behind it, plenty of room
    const short = M.withMmr({ id: 'b', ticker: 'B', dp: 2, side: -1, size: 0.01, entry: 100, mark: 100, lev: 10, maxLev: 20, sl: 900 });
    const acc = { collateral: 57.825, positions: [long({ id: 'a', size: 20, maxLev: 20, sl: 99 }), short] };
    const s = run({}, none, acc);
    near(s.rows.a.liq, 99.6, 6);
    assert.ok(s.rows.b.liq < 900);
    const f = M.findFixes(acc, M.marketRatios(acc), none, s).filter(g => g.id === 'sl');
    assert.deepEqual(f.map(g => g.target), ['b']);
  });

  test('"Move SL" offers one stop at a time, the first beaten one', () => {
    const acc = { collateral: 40, positions: [long({ id: 'a', sl: 50 }), long({ id: 'b', sl: 50 })] };
    const f = M.findFixes(acc, M.marketRatios(acc), none, run({}, none, acc)).filter(g => g.id === 'sl');
    assert.deepEqual(f.map(g => g.target), ['a']);
  });

  test('applying one fix leaves the others alone', () => {
    assert.deepEqual(M.applyFix(none, { id: 'deposit', value: 280 }), { deposit: 280, cut: {}, sl: {} });
    assert.deepEqual(M.applyFix(none, { id: 'cut', target: 'btc', value: 0.35 }), { deposit: 0, cut: { btc: 0.35 }, sl: {} });
    assert.deepEqual(M.applyFix(none, { id: 'sl', target: 'btc', value: 82000 }), { deposit: 0, cut: {}, sl: { btc: 82000 } });
    const all = { deposit: 280, cut: { btc: 0.35 }, sl: { btc: 82000 } };
    assert.deepEqual(M.applyFix(all, { id: 'cut', target: 'btc', on: true }), { deposit: 280, cut: {}, sl: { btc: 82000 } });
    assert.deepEqual(M.applyFix(all, { id: 'deposit', on: true }), { deposit: 0, cut: { btc: 0.35 }, sl: { btc: 82000 } });
  });

  test('applied fixes come back as "on", so their buttons undo them', () => {
    const rt = { ...market(), sol: 1.15 };
    const adj = { deposit: 480, cut: { btc: 0.35 }, sl: { btc: 82000 } };
    assert.deepEqual(M.findFixes(DEMO, rt, adj, M.simulate(DEMO, rt, adj)), [
      { id: 'deposit', on: true, value: 480 },
      { id: 'cut', target: 'btc', on: true, value: 0.35 },
      { id: 'sl', target: 'btc', on: true, value: 82000 },
    ]);
  });
});

describe('other outputs', () => {
  test('"Market move to liq." counts when it comes before every single position\'s buffer', () => {
    // Two equal longs: each buffer assumes the other holds still, a uniform move hits both
    const p = id => M.withMmr({ id, side: 1, size: 1, entry: 100, mark: 100, lev: 10, maxLev: 20 });
    const s = run({}, none, { collateral: 40, positions: [p('a'), p('b')] });
    assert.ok(Math.abs(s.move) * 100 < s.rows.a.buffer);
    assert.equal(s.distance, Math.abs(s.move) * 100);
  });

  test('sized: positions as they stand after fixes, for the stop and take-profit chips', () => {
    const s = run({ sol: 1.15 }, { deposit: 0, cut: { btc: 0.35, eth: 1 }, sl: { btc: 82000 } });
    near(s.sized.btc.size, 0.065, 12);
    assert.equal(s.sized.btc.sl, 82000);
    assert.equal(s.sized.eth, undefined);
    assert.equal(s.sized.zec.size, DEMO.positions[2].size);
  });

  test('demo data is what the Figma frames show', () => {
    assert.equal(DEMO.collateral, 2500);
    assert.deepEqual(DEMO.positions.map(p => [p.id, p.name, p.ticker, p.side, p.size, p.entry, p.mark, p.lev, p.maxLev, p.dp, p.sl || null, p.tp || null]), [
      ['btc', 'BTC-USDC', 'BTC', 1, 0.1, 101000, 89740, 10, 40, 0, 81000, 104000],
      ['eth', 'ETH-USDC', 'ETH', 1, 0.5, 3120, 3010, 5, 25, 2, null, null],
      ['zec', 'ZEC-USDC', 'ZEC', 1, 1.5, 402, 388.5, 5, 10, 2, null, null],
      ['sol', 'SOL-USDC', 'SOL', -1, 10, 128.4, 131.2, 10, 20, 2, null, null],
      ['hype', 'HYPE-USDC', 'HYPE', -1, 30, 24.1, 23.35, 10, 10, 3, null, null],
    ]);
    assert.deepEqual(M.SCENARIOS.map(s => [s.id, !!s.down]), [['crash', true], ['boom', false], ['recovery', false]]);
    assert.deepEqual(M.SHOCKS.map(s => [s.id, s.range, s.down]), [['oct10', 'Oct 10, 2025', true], ['apr25', 'Apr 2–7, 2025', true]]);
  });
});

describe('clean numbers', () => {
  test('a moved stop is an exact decimal, not floating-point leftovers', () => {
    // 84.2105… × 1.01 rounds up to 85.1; without care it came out 85.10000000000001
    assert.equal(M.niceAbove(85.05, 1), 85.1);
    for (const v of [0.0123456, 0.987654, 1.23456, 12.3456, 85.05, 99.99, 123.456, 81109.4]) {
      for (const side of [1, -1]) {
        const r = M.niceAbove(v, side);
        assert.equal(r, +r.toPrecision(3), `${v} → ${r}`);
      }
    }
  });
});
