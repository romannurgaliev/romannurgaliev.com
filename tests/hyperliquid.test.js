// risk-model.js checked against real Hyperliquid accounts (see
// tests/fixtures/hyperliquid/README.md). Run: npm test
//
// Tests marked TODO are known gaps: the model doesn't do what Hyperliquid
// does yet. They run and print what is off, but don't fail the suite. Each
// one has a passing "explained" test next to it that reproduces
// Hyperliquid's number, so the cause is proven, not guessed. When a gap is
// fixed in the model, drop its `todo` and it becomes a normal test.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./hl-helpers.js');

const PRICE_TOLERANCE = 0.01; // %, for liquidation prices
const USD_TOLERANCE = 0.02;   // $, for margins and withdrawable

const classic = H.accounts.filter(a => a.mode === 'disabled');
const unified = H.accounts.filter(a => a.mode === 'unifiedAccount');
const portfolio = H.accounts.filter(a => a.mode === 'portfolioMargin');

// Collects every miss and reports the worst ones, instead of stopping at the first
const expectAll = (cases, check, label) => {
  const misses = cases.map(c => ({ c, miss: check(c) })).filter(x => x.miss);
  if (misses.length) {
    const lines = misses.slice(0, 10).map(x => '  ' + x.miss).join('\n');
    assert.fail(`${misses.length} of ${cases.length} ${label} off:\n${lines}`);
  }
};

const liqCheck = (acc, p, ours) => {
  const hl = p.liquidationPx === null ? null : +p.liquidationPx;
  if ((ours === null) !== (hl === null)) return `${acc.id} ${p.coin}: ours ${ours}, Hyperliquid ${hl}`;
  if (hl === null) return null;
  const d = H.relDiff(ours, hl);
  return d > PRICE_TOLERANCE ? `${acc.id} ${p.coin}: ours ${ours.toFixed(6)}, Hyperliquid ${hl}, ${d.toFixed(4)}% apart` : null;
};

const positionsOf = accs => accs.flatMap(acc => acc.positions.map(p => ({ acc, p })));

// What Hyperliquid lets you withdraw from a classic account with no opening
// orders: account value minus, per position, the larger of its initial
// margin and 10% of its notional (the "transfer margin requirement")
const hlWithdrawable = acc => Math.max(0, +acc.crossMarginSummary.accountValue -
  acc.positions.reduce((s, p) => s + Math.max(+p.marginUsed, 0.1 * +p.positionValue), 0));
const hasOpeningOrders = acc => acc.openOrders.some(o => !o.reduceOnly && !o.isTrigger);

// ---------------------------------------------------------------------------

describe('fixtures', () => {
  test('cover classic and unified accounts', () => {
    assert.ok(classic.length >= 10, `only ${classic.length} classic accounts`);
    assert.ok(unified.length >= 3, `only ${unified.length} unified accounts`);
  });

  test('contain no wallet addresses', () => {
    const dir = path.join(__dirname, 'fixtures', 'hyperliquid');
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
      assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), /0x[0-9a-fA-F]{40}/, f);
    }
  });
});

describe('demo account matches Hyperliquid today', () => {
  test('max leverage per coin is what Hyperliquid lists', () => {
    for (const p of H.M.DEMO.positions) {
      assert.equal(p.maxLev, H.coins[p.ticker].maxLeverage, p.ticker);
    }
  });

  test('every demo position stays in the first margin tier, even at +50%', () => {
    // The simulator's sliders reach market price × 1.5
    for (const p of H.M.DEMO.positions) {
      const next = H.tiersOf(p.ticker)[1];
      if (next) assert.ok(p.size * p.mark * 1.5 < next.lower, `${p.ticker} reaches the $${next.lower} tier`);
    }
  });
});

describe('maintenance margin', () => {
  test('matches Hyperliquid to the cent on every account, in every mode', () => {
    expectAll(H.accounts, acc => {
      const ours = H.modelState(acc).mm, hl = +acc.crossMaintenanceMarginUsed;
      return Math.abs(ours - hl) > USD_TOLERANCE ? `${acc.id}: ours ${ours.toFixed(2)}, Hyperliquid ${hl}` : null;
    }, 'accounts');
  });
});

describe('liquidation price, classic accounts', () => {
  const flat = positionsOf(classic).filter(x => !H.crossesTier(x.p));
  const tiered = positionsOf(classic).filter(x => H.crossesTier(x.p));

  test(`matches Hyperliquid within ${PRICE_TOLERANCE}% (${flat.length} positions)`, () => {
    assert.ok(flat.length > 50);
    const states = new Map(classic.map(a => [a, H.modelState(a)]));
    expectAll(flat, ({ acc, p }) => liqCheck(acc, p, states.get(acc).rows[p.coin].liq), 'positions');
  });

  test(`GAP margin tiers: positions that pass into a higher tier before liquidation (${tiered.length})`, {
    todo: 'model uses one maintenance rate per coin; Hyperliquid raises it above $3M–150M notional',
  }, () => {
    expectAll(tiered, ({ acc, p }) => liqCheck(acc, p, H.modelState(acc).rows[p.coin].liq), 'positions');
  });

  test('explained: margin tiers as Hyperliquid documents them reproduce every classic position', () => {
    expectAll(positionsOf(classic), ({ acc, p }) => liqCheck(acc, p, H.tieredLiqPrice(acc, p)), 'positions');
  });
});

describe('withdrawable, classic accounts', () => {
  const noOrders = classic.filter(a => !hasOpeningOrders(a));

  test(`GAP transfer margin: withdrawable on accounts without opening orders (${noOrders.length})`, {
    todo: 'model keeps initial margin only; Hyperliquid keeps max(initial margin, 10% of notional) per position',
  }, () => {
    expectAll(noOrders, acc => {
      const ours = H.modelState(acc).withdrawable, hl = +acc.withdrawable;
      return Math.abs(ours - hl) > USD_TOLERANCE ? `${acc.id}: ours ${ours.toFixed(2)}, Hyperliquid ${hl}` : null;
    }, 'accounts');
  });

  test('explained: per-position max(initial margin, 10% of notional) reproduces Hyperliquid', () => {
    assert.ok(noOrders.length >= 3, `only ${noOrders.length} accounts without opening orders`);
    expectAll(noOrders, acc => {
      const ours = hlWithdrawable(acc), hl = +acc.withdrawable;
      return Math.abs(ours - hl) > USD_TOLERANCE ? `${acc.id}: rule ${ours.toFixed(2)}, Hyperliquid ${hl}` : null;
    }, 'accounts');
  });

  test('explained: opening orders only ever lower it further', () => {
    expectAll(classic.filter(hasOpeningOrders), acc =>
      +acc.withdrawable > hlWithdrawable(acc) + USD_TOLERANCE ? `${acc.id}: Hyperliquid ${acc.withdrawable} above rule ${hlWithdrawable(acc).toFixed(2)}` : null,
    'accounts');
  });
});

describe('liquidation price, unified accounts', () => {
  test(`GAP unified account: spot USDC backs perps (${unified.length} accounts)`, {
    todo: 'model takes equity from the perp account only',
  }, () => {
    expectAll(positionsOf(unified), ({ acc, p }) => liqCheck(acc, p, H.modelState(acc).rows[p.coin].liq), 'positions');
  });

  test('explained: spot USDC as equity reproduces most unified accounts', () => {
    const results = unified.map(acc => ({
      acc,
      misses: acc.positions.map(p => liqCheck(acc, p, H.tieredLiqPrice(acc, p, H.spotUsdc(acc)))).filter(Boolean),
    }));
    const explained = results.filter(r => r.misses.length === 0);
    // Not all: some big accounts hold USDC for spot orders or other assets.
    // Those stay unexplained until the fixtures record what the hold is for.
    assert.ok(explained.length >= unified.length * 2 / 3,
      `only ${explained.length} of ${unified.length} explained:\n` + results.filter(r => r.misses.length).map(r => '  ' + r.misses[0]).join('\n'));
  });
});

describe('liquidation price, portfolio margin accounts', () => {
  test(`GAP portfolio margin: other spot assets count, with haircuts (${portfolio.length} accounts)`, {
    todo: 'not modelled; rare on Hyperliquid',
  }, () => {
    expectAll(positionsOf(portfolio), ({ acc, p }) => liqCheck(acc, p, H.modelState(acc).rows[p.coin].liq), 'positions');
  });
});
