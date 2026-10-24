# Hyperliquid fixtures

Real exchange data for checking `risk-model.js` against Hyperliquid itself.
Rebuild with `node scripts/hl-fixtures.js` (numbers will change: it is a
live snapshot). Fetched 2026-10-23.

- `meta.json`: every perp coin with max leverage, margin tier table and mark price.
- `accounts.json`: 29 public accounts (from the leaderboard, addresses
  removed) holding only cross positions, 567 positions in all. Each has
  Hyperliquid's own `liquidationPx`, maintenance margin, account mode and
  spot balances.

## How to read an account into the model

```
side   = sign(szi)          size  = |szi|
entry  = entryPx            mark  = positionValue / |szi|   (exact mark the exchange used)
lev    = leverage.value     maxLev = maxLeverage
collateral = crossMarginSummary.accountValue − Σ unrealizedPnl
```

## Tests

`npm test` runs `tests/hyperliquid.test.js`. Known gaps are `todo` tests:
they run and print what is off, but don't fail the suite. Each one has an
"explained" test next to it that reproduces Hyperliquid's numbers:

| Gap | Explained by |
|---|---|
| Margin tiers | Hyperliquid's tier formula (rate per tier minus a deduction) reproduces every classic position |
| Withdrawable | account value − Σ per position max(initial margin, 10% of notional); open orders only lower it |
| Unified account | spot USDC as equity, for most unified accounts |
| Portfolio margin | not explained yet |

Two traps found while writing them, both handled in `tests/hl-helpers.js`:
- `entryPx` is rounded. Rebuild the exact entry as `mark − unrealizedPnl / szi`,
  or a 174-position account drifts by $800.
- A position opened before Hyperliquid lowered a coin's max leverage keeps
  its old rate and its old tier table (WIF and POPCAT: table 52, matched to
  the cent). The API doesn't say which table that is.

The first comparison (step 2), with the earlier fixture set:

Maintenance margin matches to the cent in all 29 accounts.

Liquidation prices depend on the account mode (`mode`):

| Mode | Accounts | Result |
|---|---|---|
| `disabled` (classic: perps backed by perp USDC only) | 19 | 16 match within 0.007% |
| `unifiedAccount` (spot USDC also backs perps) | 9 | off by up to 90%: spot USDC moves the liquidation price |
| `portfolioMargin` (other spot assets count, with haircuts) | 1 | off by 1.4% |

The three classic accounts that don't match (`acct-21` XPL, `acct-22` BNB,
`acct-26` ZEC and others) are shorts whose liquidation price is 10–30× the
current price. On the way there the position grows past the next margin
tier ($3M–40M notional), maintenance margin rises, and Hyperliquid
liquidates sooner. `risk-model.js` uses one flat rate per coin, so it misses
this. It doesn't affect the demo account (largest position about $9k).

Gaps to model or state as limits, in order of how much they matter:

1. **Unified account mode.** Most active leaderboard accounts use it, so the
   simulator's numbers are wrong for many real Hyperliquid users. For a
   unified account, the margin available works out to spot USDC total minus
   maintenance margin (checked on one account to the dollar). Multi-position
   unified accounts don't fit that yet.
2. **Margin tiers** along the price path. These only matter for positions
   above $3M.
3. **Portfolio margin.** Rare, and it needs spot haircuts.
