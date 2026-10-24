// Liquidation risk model behind the simulator on the Brighty case page.
// Pure math and data, no page code, so it can be tested on its own and
// handed to developers as the reference: risk-sim.js only draws what this
// returns. Loads as a plain script (window.RiskModel) and in Node (require).
//
// Risk model: Hyperliquid cross margin.
//   account value      = collateral + Σ unrealized P&L
//   maintenance margin = Σ notional × mmr, mmr = 1 / (2 × max leverage)
//   cross margin ratio = maintenance margin / account value (liquidated at 100%)
//   liq. price         = price − side × (account value − MM) / size / (1 − mmr × side)
//
// Prices move along a straight line from market to the simulated prices.
// Stops, take-profits and the account liquidation fire in the order the
// price reaches them, so a stop can close a position before a crash
// liquidates the account, or a liquidation can come before the stop.
//
// On top of prices the trader can try fixes: add margin, cut a position,
// move a stop. They apply now, at market prices, before the simulated move.
//
// Terms used below:
//   account      { collateral, positions: [...] }
//   ratios (rt)  simulated price / market price, per position id
//   adjustments  { deposit, cut: { id: share 0–1 }, sl: { id: new stop price } }
// Stryker disable all: the loader picks Node or browser; Node tests can only
// see one side, and the page check covers the other
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RiskModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Stryker restore all
  var LOW = 15;  // distance to liquidation (%) at or above which risk is Low
  var HIGH = 7.5; // below this it is High; in between, Medium

  function withMmr(p) {
    var q = Object.assign({}, p);
    q.mmr = 1 / (2 * q.maxLev);
    return q;
  }

  // The demo account; matches the Figma frames A–F to the cent
  var DEMO = {
    collateral: 2500,
    positions: [
      { id: 'btc', name: 'BTC-USDC', ticker: 'BTC', side: 1, size: 0.1, entry: 101000, mark: 89740, lev: 10, maxLev: 40, dp: 0, sl: 81000, tp: 104000 },
      { id: 'eth', name: 'ETH-USDC', ticker: 'ETH', side: 1, size: 0.5, entry: 3120, mark: 3010, lev: 5, maxLev: 25, dp: 2 },
      { id: 'zec', name: 'ZEC-USDC', ticker: 'ZEC', side: 1, size: 1.5, entry: 402, mark: 388.5, lev: 5, maxLev: 10, dp: 2 },
      { id: 'sol', name: 'SOL-USDC', ticker: 'SOL', side: -1, size: 10, entry: 128.4, mark: 131.2, lev: 10, maxLev: 20, dp: 2 },
      { id: 'hype', name: 'HYPE-USDC', ticker: 'HYPE', side: -1, size: 30, entry: 24.1, mark: 23.35, lev: 10, maxLev: 10, dp: 3 }
    ].map(withMmr)
  };

  // Price moves offered as one-click presets
  var SCENARIOS = [
    { id: 'crash', down: true, ratios: { btc: 0.7, eth: 0.7, zec: 0.7, sol: 0.7, hype: 0.7 } },
    { id: 'boom', ratios: { btc: 1.15 } },
    { id: 'recovery', ratios: { btc: 1.1, eth: 1.1, zec: 1.1, sol: 1.1, hype: 1.1 } }
  ];

  // Real crashes, replayed per coin: daily open to daily low on Hyperliquid
  // (api.hyperliquid.xyz candleSnapshot, 1d, UTC). Lows were not all at the
  // same minute, so this is the worst case of the day.
  var SHOCKS = [
    { id: 'oct10', range: 'Oct 10, 2025',
      prices: { btc: [121615, 100837], eth: [4369.2, 3241.2], sol: [221.02, 137.51], hype: [43.976, 31.8], zec: [212.9, 123.91] } },
    { id: 'apr25', range: 'Apr 2–7, 2025',
      prices: { btc: [85123, 74442], eth: [1904.3, 1415], sol: [126.65, 95.333], hype: [13.327, 9.3061], zec: [40.66, 27.92] } }
  ];
  SHOCKS.forEach(function (sh) {
    sh.down = true;
    sh.ratios = {};
    Object.keys(sh.prices).forEach(function (k) { sh.ratios[k] = sh.prices[k][1] / sh.prices[k][0]; });
  });

  // ---------- Inputs ----------
  function marketRatios(account) {
    var t = {};
    account.positions.forEach(function (p) { t[p.id] = 1; });
    return t;
  }
  function noAdjustments() { return { deposit: 0, cut: {}, sl: {} }; }
  function copyAdjustments(a) {
    return { deposit: a.deposit, cut: Object.assign({}, a.cut), sl: Object.assign({}, a.sl) };
  }
  function withAdj(a, change) {
    var b = copyAdjustments(a);
    change(b);
    return b;
  }
  function hasAdjustments(a) {
    return a.deposit > 0 || Object.keys(a.cut).length > 0 || Object.keys(a.sl).length > 0;
  }

  // ---------- Simulation ----------
  function priceAt(p, t, rt) { return p.mark * (1 + t * (rt[p.id] - 1)); }

  // Account value and maintenance margin are linear in t between events
  function accountAt(open, collateral, t, rt) {
    var av = collateral, mm = 0;
    open.forEach(function (p) {
      var px = priceAt(p, t, rt);
      av += p.side * p.size * (px - p.entry);
      mm += p.size * px * p.mmr;
    });
    return { av: av, mm: mm };
  }

  function riskLevel(distance) {
    return distance < HIGH ? 'high' : distance < LOW ? 'medium' : 'low';
  }

  function simulate(account, rt, a) {
    var collateral = account.collateral + a.deposit;
    var closed = {};
    var cutPnl = 0;
    var open = [];

    // Fixes happen now, at market: a cut realizes its share of the P&L
    account.positions.forEach(function (base) {
      var cut = a.cut[base.id] || 0;
      var p = Object.assign({}, base, { size: base.size * (1 - cut), sl: a.sl[base.id] || base.sl });
      var realized = base.side * base.size * cut * (base.mark - base.entry);
      collateral += realized;
      // A full close shows its P&L in its own row; a partial one adds to the total
      if (cut >= 1) closed[base.id] = { kind: 'Closed', price: base.mark, pnl: realized, manual: true };
      else { cutPnl += realized; open.push(p); }
    });
    var sized = {};
    open.forEach(function (p) { sized[p.id] = p; });

    var liquidated = false;
    var t = 0;
    var EPS = 1e-9;

    for (var guard = 0; guard < 20; guard++) {
      var next = null;

      // Stops and take-profits ahead of the start. Events are taken earliest
      // first, so anything still open is at or after t, and others at the
      // same moment as the last one still fire (two stops 10% away, hit by
      // one uniform crash, both close)
      open.forEach(function (p) {
        var r = rt[p.id];
        if (r === 1) return;
        [['SL', p.sl], ['TP', p.tp]].forEach(function (pair) {
          if (!pair[1]) return;
          var tt = (pair[1] / p.mark - 1) / (r - 1);
          if (tt > EPS && tt <= 1 + EPS && (!next || tt < next.t)) {
            next = { t: tt, kind: pair[0], pos: p, price: pair[1] };
          }
        });
      });

      // Account liquidation: account value falls to maintenance margin
      var a0 = accountAt(open, collateral, t, rt);
      var a1 = accountAt(open, collateral, 1, rt);
      var f0 = a0.av - a0.mm, f1 = a1.av - a1.mm;
      if (f0 <= 0) {
        next = { t: t, kind: 'liq' };
      } else if (f1 <= 0) {
        var tl = t + (1 - t) * f0 / (f0 - f1);
        if (!next || tl <= next.t) next = { t: tl, kind: 'liq' };
      }

      if (!next) break;

      // Liquidation: the spec keeps the rows on screen (tracks turn red) and
      // reports equity and MM at the simulated prices, so nothing closes here
      if (next.kind === 'liq') {
        liquidated = true;
        break;
      }

      var pnl = next.pos.side * next.pos.size * (next.price - next.pos.entry);
      collateral += pnl;
      closed[next.pos.id] = { kind: 'Closed by ' + next.kind, price: next.price, pnl: pnl };
      open = open.filter(function (p) { return p !== next.pos; });
      t = next.t;
    }

    // Final state at the simulated prices
    var acc = accountAt(open, collateral, 1, rt);
    var av = acc.av, mm = acc.mm;
    var avail = av - mm;
    var notional = 0, im = 0, netLong = 0;
    var rows = {};

    open.forEach(function (p) {
      var px = priceAt(p, 1, rt);
      var n = p.size * px;
      var pnl = p.side * p.size * (px - p.entry);
      notional += n;
      im += n / p.lev;
      netLong += p.side * n;
      var liq = liquidated ? null : px - p.side * avail / p.size / (1 - p.mmr * p.side);
      if (liq !== null && liq <= 0) liq = null;
      rows[p.id] = {
        price: px,
        pnl: pnl,
        liq: liq,
        sl: p.sl,
        liquidated: liquidated,
        buffer: liq === null ? null : p.side * (px - liq) / px * 100
      };
    });
    // Total P&L adds up per position, in table order, like the mockup script
    var totalPnl = account.positions.reduce(function (sum, p) {
      return sum + (closed[p.id] ? closed[p.id].pnl : rows[p.id].pnl);
    }, 0) + cutPnl;

    // Uniform market move that takes the account to liquidation
    var move = null;
    if (open.length) {
      var denom = netLong - mm;
      move = Math.abs(denom) < 1e-9 ? Infinity : -avail / denom;
    }

    var minBuffer = Infinity, riskiest = null;
    Object.keys(rows).forEach(function (id) {
      if (rows[id].buffer !== null && rows[id].buffer < minBuffer) {
        minBuffer = rows[id].buffer;
        riskiest = id;
      }
    });
    var distance = liquidated ? 0 : Math.min(minBuffer, move === null ? Infinity : Math.abs(move) * 100);

    return {
      liquidated: liquidated,
      av: av,
      totalPnl: totalPnl,
      mm: mm,
      reserve: liquidated ? null : Math.max(0, avail),
      cmr: av > 0 ? mm / av * 100 : Infinity,
      lev: liquidated || av <= 0 ? null : notional / av,
      move: liquidated ? null : move,
      withdrawable: liquidated ? 0 : Math.max(0, av - im),
      distance: distance,
      riskiest: riskiest,
      level: riskLevel(distance),
      rows: rows,
      sized: sized,
      closed: closed
    };
  }

  // ---------- Risk fixes ----------
  // Smallest value in [lo, hi] for which ok() holds (ok is monotonic)
  function bisect(lo, hi, ok) {
    if (!ok(hi)) return null;
    for (var i = 0; i < 40; i++) {
      var mid = (lo + hi) / 2;
      if (ok(mid)) hi = mid; else lo = mid;
    }
    return hi;
  }

  // Rounds a price to three significant digits, away from the market
  function niceAbove(v, side) {
    var e = Math.floor(Math.log10(v)) - 2;
    var step = Math.pow(10, e);
    var r = side > 0 ? Math.ceil(v / step) * step : Math.floor(v / step) * step;
    // ceil(851) × 0.1 is 85.10000000000001 in floating point: cut to the
    // step's decimals so the price is exactly 85.1 (found by vectors.json)
    return e < 0 ? +r.toFixed(-e) : r;
  }

  // Fixes to offer for state s (= simulate(account, rt, a)). Each one is
  // { id: 'deposit' | 'cut' | 'sl', target?, value, on? }. on = already applied,
  // so the button undoes it. A cut also reports liqAfter: the position's new
  // liquidation price, or null when the cut takes risk to Low outright.
  function findFixes(account, rt, a, s) {
    var list = [];
    var byId = function (id) { return account.positions.filter(function (p) { return p.id === id; })[0]; };
    var lowEnough = function (b) {
      var r = simulate(account, rt, b);
      return !r.liquidated && r.distance >= LOW;
    };

    // 1. Add margin until risk is Low
    if (a.deposit > 0) {
      list.push({ id: 'deposit', on: true, value: a.deposit });
    } else if (s.distance < LOW) {
      var depositOk = function (v) { return lowEnough(withAdj(a, function (b) { b.deposit = v; })); };
      var x = bisect(0, 100000, depositOk);
      if (x !== null) {
        x = Math.ceil(x / 10) * 10;
        // The search stops a hair above an exact answer, and rounding up
        // would then ask $10 too much (found by tests/invariants.test.js)
        if (x >= 10 && depositOk(x - 10)) x -= 10;
        list.push({ id: 'deposit', value: x });
      }
    }

    // 2. Cut the position closest to liquidation
    var cutId = Object.keys(a.cut)[0];
    if (cutId) {
      list.push({ id: 'cut', target: cutId, on: true, value: a.cut[cutId] });
    } else if (s.distance < LOW && s.riskiest) {
      var p = byId(s.riskiest);
      var cutOk = function (v) { return lowEnough(withAdj(a, function (b) { b.cut[p.id] = v; })); };
      var f = bisect(0, 1, cutOk);
      if (f !== null) {
        f = Math.min(1, Math.ceil(f * 20) / 20); // 5% steps
        if (f >= 0.1 && cutOk(f - 0.05)) f = Math.round((f - 0.05) * 20) / 20; // as for margin above
        var row = simulate(account, rt, withAdj(a, function (b) { b.cut[p.id] = f; })).rows[p.id];
        list.push({ id: 'cut', target: p.id, value: f, liqAfter: row ? row.liq : null });
      }
    }

    // 3. A stop the liquidation would beat: move it in front
    var slId = Object.keys(a.sl)[0];
    if (slId) {
      list.push({ id: 'sl', target: slId, on: true, value: a.sl[slId] });
    } else {
      account.positions.some(function (q) {
        var r = s.rows[q.id];
        if (!r || !r.sl || r.liq === null) return false;
        var beaten = q.side > 0 ? r.liq >= r.sl : r.liq <= r.sl;
        if (!beaten) return false;
        var to = niceAbove(r.liq * (1 + q.side * 0.01), q.side);
        if (q.side > 0 ? to >= r.price : to <= r.price) return false;
        list.push({ id: 'sl', target: q.id, value: to });
        return true;
      });
    }
    return list;
  }

  // Applies a fix, or undoes it if it is on; returns new adjustments
  function applyFix(a, fix) {
    return withAdj(a, function (b) {
      if (fix.id === 'deposit') b.deposit = fix.on ? 0 : fix.value;
      if (fix.id === 'cut') { if (fix.on) delete b.cut[fix.target]; else b.cut[fix.target] = fix.value; }
      if (fix.id === 'sl') { if (fix.on) delete b.sl[fix.target]; else b.sl[fix.target] = fix.value; }
    });
  }

  return {
    LOW: LOW,
    HIGH: HIGH,
    DEMO: DEMO,
    SCENARIOS: SCENARIOS,
    SHOCKS: SHOCKS,
    withMmr: withMmr,
    marketRatios: marketRatios,
    noAdjustments: noAdjustments,
    hasAdjustments: hasAdjustments,
    priceAt: priceAt,
    accountAt: accountAt,
    riskLevel: riskLevel,
    simulate: simulate,
    bisect: bisect,
    niceAbove: niceAbove,
    findFixes: findFixes,
    applyFix: applyFix
  };
});
