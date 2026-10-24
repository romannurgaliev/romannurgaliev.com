// Shared code for tests that compare risk-model.js with Hyperliquid fixtures.
const path = require('path');
const M = require('../risk-model.js');

const DIR = path.join(__dirname, 'fixtures', 'hyperliquid');
const { accounts } = require(path.join(DIR, 'accounts.json'));
const meta = require(path.join(DIR, 'meta.json'));

const coins = Object.fromEntries(meta.universe.map(u => [u.name, u]));
const tables = Object.fromEntries(meta.marginTables);

// Relative difference in %, for comparing prices
const relDiff = (a, b) => Math.abs(a - b) / Math.abs(b) * 100;

const markOf = p => +p.positionValue / Math.abs(+p.szi);

// A fixture account as risk-model.js input. By default collateral comes from
// the perp account value; `equity` overrides it (used for unified accounts).
const toModelAccount = (acc, equity = +acc.crossMarginSummary.accountValue) => {
  const upnl = acc.positions.reduce((s, p) => s + +p.unrealizedPnl, 0);
  return {
    collateral: equity - upnl,
    positions: acc.positions.map(p => M.withMmr({
      id: p.coin,
      side: Math.sign(+p.szi),
      size: Math.abs(+p.szi),
      // entryPx is rounded for display; over many positions that adds up to
      // hundreds of dollars, so take the exact entry back from the P&L
      entry: markOf(p) - +p.unrealizedPnl / +p.szi,
      mark: markOf(p),
      lev: p.leverage.value,
      maxLev: p.maxLeverage,
    })),
  };
};

// The model's state for a fixture account at its snapshot prices
const modelState = (acc, equity) => {
  const a = toModelAccount(acc, equity);
  return M.simulate(a, M.marketRatios(a), M.noAdjustments());
};

// ---------- Margin tiers, as Hyperliquid documents them ----------
// maintenance margin = notional × rate of its tier − deduction, where the
// deduction keeps the margin continuous across tier bounds.
// A position opened before Hyperliquid lowered a coin's max leverage keeps
// its old rate, and its old tier table too. The API doesn't say which table
// that was; these were found by matching liquidation prices exactly
// (Oct 23, 2026 fixtures). Coins missing here fall back to one flat tier.
const LEGACY_TABLES = { WIF: 52, POPCAT: 52 };

// maxLev: the position's own max leverage
const tiersOf = (coin, maxLev = coins[coin].maxLeverage) => {
  const legacy = maxLev !== coins[coin].maxLeverage && LEGACY_TABLES[coin];
  const t = tables[legacy || coins[coin].marginTableId];
  const list = (t ? t.marginTiers : [{ lowerBound: '0', maxLeverage: maxLev }])
    .map((tier, i) => i === 0 ? { ...tier, maxLeverage: maxLev } : tier);
  let deduction = 0, prevRate = 0;
  return list.map(tier => {
    const lower = +tier.lowerBound;
    const rate = 1 / (2 * tier.maxLeverage);
    deduction += lower * (rate - prevRate);
    prevRate = rate;
    return { lower, rate, deduction };
  });
};

const tieredMm = (p, notional) => {
  const tier = tiersOf(p.coin, p.maxLeverage).filter(t => notional >= t.lower).pop();
  return notional * tier.rate - tier.deduction;
};

// True if the position would pass into a higher margin tier before
// reaching Hyperliquid's liquidation price
const crossesTier = p => {
  if (p.liquidationPx === null) return false;
  const tiers = tiersOf(p.coin, p.maxLeverage);
  const now = +p.positionValue, atLiq = Math.abs(+p.szi) * +p.liquidationPx;
  return tiers.some(t => t.lower > 0 && t.lower > Math.min(now, atLiq) && t.lower <= Math.max(now, atLiq));
};

// Liquidation price of one position with margin tiers, others held at mark.
// Solves account value = Σ maintenance margin by bisection.
const tieredLiqPrice = (acc, p, equity = +acc.crossMarginSummary.accountValue) => {
  const side = Math.sign(+p.szi), size = Math.abs(+p.szi), mark = markOf(p);
  const others = acc.positions.filter(q => q !== p)
    .reduce((s, q) => s + tieredMm(q, +q.positionValue), 0);
  const free = x => equity + side * size * (x - mark) - others - tieredMm(p, size * x);
  let lo, hi;
  if (side > 0) {
    if (free(0) > 0) return null; // never liquidated, even at zero
    lo = 0; hi = mark; // free(lo) ≤ 0 < free(hi)
  } else {
    lo = mark; hi = mark * 2;
    while (free(hi) > 0) hi *= 2;
  }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if ((free(mid) > 0) === (side > 0)) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
};

const spotUsdc = acc => +((acc.spotBalances.find(b => b[0] === 'USDC') || [, 0])[1]);

module.exports = { M, accounts, meta, coins, tables, relDiff, markOf, toModelAccount, modelState, tiersOf, tieredMm, crossesTier, tieredLiqPrice, spotUsdc };
