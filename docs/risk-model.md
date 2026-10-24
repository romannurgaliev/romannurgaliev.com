# Liquidation risk model

The math behind the Liquidation Risk Simulator (Entry.fi, Brighty case page).
Written for developers who build it for real. The reference implementation is
[`risk-model.js`](../risk-model.js), about 350 lines of plain JavaScript with
no dependencies. [`tests/vectors.json`](../tests/vectors.json) has 64 input →
output examples to check another implementation against.

Model: **Hyperliquid cross margin, classic account mode, one maintenance rate
per coin.** Checked against 29 real Hyperliquid accounts. Where it matches and
where it doesn't is in [Hyperliquid, in numbers](#hyperliquid-in-numbers).

---

## Inputs

**Account**

| Field | Meaning |
|---|---|
| `collateral` | USD in the cross account, before unrealized P&L |
| `positions[]` | open cross positions, below |

**Position**

| Field | Meaning |
|---|---|
| `id` | key used in `ratios` and `adjustments` |
| `side` | `1` long, `-1` short |
| `size` | coins, always positive |
| `entry` | average entry price |
| `mark` | mark price now |
| `lev` | leverage the trader set; only used for initial margin |
| `maxLev` | the coin's max leverage *for this position* (a position opened before Hyperliquid cut a coin's max leverage keeps the old one) |
| `sl`, `tp` | stop-loss and take-profit trigger prices, optional |

Derived: maintenance margin rate **`mmr = 1 / (2 × maxLev)`**. BTC at 40× → 1.25%.

**Simulation**

| Field | Meaning |
|---|---|
| `ratios` | simulated price / mark, per position. `0.92` = −8%. The sliders allow 0.5–1.5 |
| `adjustments.deposit` | USD added to collateral |
| `adjustments.cut` | share of a position closed at mark, `0`–`1` (`1` = closed) |
| `adjustments.sl` | new stop price for a position |

Adjustments ("Reduce risk" fixes) happen **now, at mark prices**, before the
simulated move.

---

## Formulas

All sums are over open positions. `n = size × price` is a position's notional.

| Output | Formula |
|---|---|
| P&L of a position | `side × size × (price − entry)` |
| Account value `AV` | `collateral + Σ P&L` |
| Maintenance margin `MM` | `Σ n × mmr` |
| Initial margin `IM` | `Σ n / lev` |
| Cross margin ratio | `MM / AV × 100%`; infinite when `AV ≤ 0`. Liquidated at 100% |
| Equity reserve | `max(0, AV − MM)` |
| Effective leverage | `Σ n / AV` |
| Withdrawable | `max(0, AV − IM)` (see [gap 3](#gaps)) |
| Liquidation price | `price − side × (AV − MM) / (size × (1 − mmr × side))`; none if `≤ 0` |
| Price buffer | `side × (price − liq) / price × 100%` |
| Market move to liq. | `−(AV − MM) / (Σ side × n − MM)`; infinite if the denominator is 0 |
| Distance to liq. | `min(smallest price buffer, |market move| × 100%)`; 0 when liquidated |
| Risk level | **High** below 7.5%, **Medium** below 15%, **Low** from 15% |

**Liquidation price, why that formula.** Move one coin to price `x`, others
held still. The free margin `AV − MM` changes by `size × (x − price) × side`
(P&L) minus `size × (x − price) × mmr` (its margin grows with its notional).
Solve free margin = 0:
`x = price − (AV − MM) / (size × (side − mmr))`, and `side − mmr = side × (1 − mmr × side)` for `side = ±1`.
Each position's liquidation price assumes **only that coin moves**.

**Market move, why that formula.** Move every price by the same share `m`.
Free margin changes by `m × Σ side × n` (P&L) minus `m × MM`. Zero at
`m = −(AV − MM) / (Σ side × n − MM)`. This catches a market-wide drop, which
can liquidate sooner than any single position's buffer suggests: two equal
longs each show a 35.9% buffer, but a uniform drop of 17.9% liquidates the
account (vector `edge-move-before-buffers`).

---

## The simulated move: events in order

Prices travel in a straight line from mark (`t = 0`) to the simulated price
(`t = 1`): `price(t) = mark × (1 + t × (ratio − 1))`. Along the way, three
things can happen, **earliest first**:

1. **A stop or take-profit triggers** at `t = (level / mark − 1) / (ratio − 1)`,
   if that is in `(0, 1]`. The position closes **at the trigger price** (no
   gaps, no slippage) and its P&L moves into collateral.
2. **Several trigger at the same moment:** all of them fire (two longs with
   stops 10% away, run through one −30% crash, both close).
3. **The account is liquidated** when `AV − MM` reaches 0. Between events both
   are linear in `t`, so the moment is
   `t + (1 − t) × f₀ / (f₀ − f₁)`, with `f` = free margin at the last event and
   at the end. An account already at or below 0 at the start is liquidated at
   once and stays liquidated even if prices would recover.

After liquidation the simulation stops. Rows stay on screen, values are shown
at the simulated prices, and there is no reserve, leverage, market move or
liquidation price, and nothing to withdraw.

A stop never liquidates the account by itself. Closing at the stop turns that
position's unrealized loss into a realized one (account value unchanged) and
frees its margin.

---

## Reduce risk: the three fixes

Offered only when distance to liquidation is below 15%. At most one of each
kind. Once applied, a fix shows as on and its button undoes it.

| Fix | How it is found |
|---|---|
| **Add margin** | smallest deposit in $0–100,000 that makes risk Low (bisection, 40 steps), rounded up to $10. If $10 less also works, that is offered instead (the search lands a hair above an exact answer) |
| **Cut a position** | the position with the smallest price buffer ("riskiest"); smallest share 0–1 that makes risk Low, rounded up to 5%, with the same one-step-down check. 100% = close. Not offered when the account is already liquidated (no buffers to rank) |
| **Move the stop** | the first position, in table order, whose stop the liquidation price beats (long: `liq ≥ sl`; short: `liq ≤ sl`). New stop: 1% in front of the liquidation price, rounded to 3 significant digits away from the market ($81,109 × 1.01 → $82,000; $84.21 × 1.01 → $85.10). Not offered if that would already be at or past the current price |

---

## Assumptions

What the model leaves out, roughly by how much it matters:

1. **Classic account mode only.** Spot balances don't count as collateral. Most
   active Hyperliquid accounts now use unified mode, where they do (gap 1).
2. **One maintenance rate per coin.** Hyperliquid raises it for positions above
   $3M–150M notional (gap 2).
3. **Withdrawable ignores Hyperliquid's transfer rule** and open orders (gap 3).
4. **Straight-line price path.** All coins move together in time. In a real
   crash lows come at different minutes. The crash presets use each coin's
   daily open → daily low, which is the worst case for the day.
5. **Stops fill at the trigger price.** No gaps, no slippage.
6. **No funding, fees, open orders or isolated positions.**
7. **Liquidation is an account-level event.** The model says *when*, not how
   Hyperliquid then unwinds the positions.

---

## Hyperliquid, in numbers

29 public accounts, 603 cross positions, fetched Oct 23, 2026
(`tests/fixtures/hyperliquid/`, rebuilt with `node scripts/hl-fixtures.js`).
19 classic, 9 unified, 1 portfolio margin.

**Where the model matches**

| What | Positions / accounts | Difference from Hyperliquid |
|---|---|---|
| Maintenance margin | 29 accounts, every mode | $0.00 on all |
| Liquidation price, classic accounts | 278 positions | median 0.000000004%, worst 0.0000006% |
| Liquidation price "none" (long that can fall to zero) | 269 positions, every mode | none on both sides, all |

### Gaps

| # | Gap | Size | Cause, reproduced in `tests/hyperliquid.test.js` | Effect on the demo |
|---|---|---|---|---|
| 1 | **Unified accounts** | 9 accounts; liq. price median 87% off, worst 90% | Spot USDC backs perps. Equity = spot USDC total reproduces 7 of 9 to 0.01% | none (classic by design), but matters for real Entry.fi users |
| 2 | **Margin tiers** | 24 classic positions; median 2.1% off, worst 4.3% | The maintenance rate steps up above a notional bound (BTC: 40× to $150M then 20×). Hyperliquid's tier formula, `n × rate − deduction`, reproduces all 302 classic liquidation prices to 0.0000006% | none: the largest demo position is about $13k even at +50% |
| 3 | **Withdrawable** | overstated in 4 of 7 checkable accounts, by up to $19,610 (5.5% of account value) | Hyperliquid keeps, per position, `max(initial margin, 10% of notional)`; open orders reserve more | none: at 10× or less the 10% never exceeds initial margin |
| 4 | **Portfolio margin** | 1 account; 0.9% off | other spot assets count, with haircuts | none |

Two traps in Hyperliquid's API, for whoever reads it next:
- `entryPx` is rounded for display. Rebuild the entry as
  `mark − unrealizedPnl / szi`, where `mark = positionValue / |szi|`, or a
  174-position account drifts by $800.
- A position opened before a max-leverage cut keeps the old rate *and* the old
  tier table. The API returns the old `maxLeverage` on the position, but not
  the table (WIF and POPCAT: table 52, matched to the cent).

To close the gaps for Entry.fi, in order: unified accounts (equity from spot
USDC, then multi-position accounts), the withdrawable rule (a few lines), and
tiers (a per-coin table plus a numeric solve for the liquidation price, since
the closed-form formula above assumes one rate).

---

## The demo account

From the Figma frames. $2,500 collateral.

| Position | Side | Size | Entry | Mark | Leverage | Max | Stop | Take-profit |
|---|---|---|---|---|---|---|---|---|
| BTC | long | 0.1 | 101,000 | 89,740 | 10× | 40× | 81,000 | 104,000 |
| ETH | long | 0.5 | 3,120 | 3,010 | 5× | 25× | | |
| ZEC | long | 1.5 | 402 | 388.50 | 5× | 10× | | |
| SOL | short | 10 | 128.40 | 131.20 | 10× | 20× | | |
| HYPE | short | 30 | 24.10 | 23.35 | 10× | 10× | | |

At market: account value $1,293.25, maintenance margin $239.24, cross margin
ratio 18.5%, effective leverage 10.11×, market move to liquidation −11.96%,
BTC liquidation price $79,066 (11.9% buffer, the riskiest), distance 11.9%,
risk **Medium**. Crash presets: Oct 10, 2025 and Apr 2–7, 2025, daily open →
daily low per coin from Hyperliquid's daily candles.

---

## Checking an implementation

1. For each case in `tests/vectors.json`, build the account from `input`
   (derive `mmr` from `maxLev`), apply `adjustments`, run the move to
   `ratios`.
2. Compare with `expected`: numbers within 1e-9 relative (absolute near
   zero), `"inf"` for infinity, `null` for no value, everything else exact.
   Fix values (`$1,000`, `0.3`, `85.1`) are exact decimals.
3. `tests/vectors.test.js` does exactly this for `risk-model.js` and is the
   reference for the comparison rules.

The 64 cases: the demo in every case-page state and preset, edge cases, event
order, each fix including its rounding, the risk-level thresholds either side
of 7.5% and 15%, three real Hyperliquid accounts (with the exchange's own
numbers under `exchange`), and 20 random accounts. Regenerate with
`node scripts/vectors.js`, on purpose only, after a model change you mean.
