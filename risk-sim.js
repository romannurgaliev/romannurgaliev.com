// Liquidation Risk Simulator: a live prototype for the Brighty case page.
//
// Risk model: Hyperliquid cross margin.
//   account value     = collateral + Σ unrealized P&L
//   maintenance margin = Σ notional × mmr, mmr = 1 / (2 × max leverage)
//   cross margin ratio = maintenance margin / account value (liquidated at 100%)
//   liq. price         = price − side × (account value − MM) / size / (1 − mmr × side)
// The demo account and its five positions match the Figma frames to the cent.
//
// Prices move along a straight line from market to the simulated prices.
// Stops, take-profits and the account liquidation fire in the order the
// price reaches them, so a stop can close a position before a crash
// liquidates the account, or a liquidation can come before the stop.
//
// On top of prices the trader can try fixes: add margin, cut a position,
// move a stop. They apply now, at market prices, before the simulated move.
(function () {
  var root = document.querySelector('[data-risk-sim]');
  if (!root) return;

  var ICONS = root.getAttribute('data-icons') || '';
  var W = 576; // track width: market price ±50%
  var MINUS = '−';
  var LOW = 15; // distance to liquidation (%) where risk turns Low

  var COLLATERAL = 2500;
  var POSITIONS = [
    { id: 'btc', name: 'BTC-USDC', ticker: 'BTC', side: 1, size: 0.1, entry: 101000, mark: 89740, lev: 10, maxLev: 40, dp: 0, sl: 81000, tp: 104000 },
    { id: 'eth', name: 'ETH-USDC', ticker: 'ETH', side: 1, size: 0.5, entry: 3120, mark: 3010, lev: 5, maxLev: 25, dp: 2 },
    { id: 'zec', name: 'ZEC-USDC', ticker: 'ZEC', side: 1, size: 1.5, entry: 402, mark: 388.5, lev: 5, maxLev: 10, dp: 2 },
    { id: 'sol', name: 'SOL-USDC', ticker: 'SOL', side: -1, size: 10, entry: 128.4, mark: 131.2, lev: 10, maxLev: 20, dp: 2 },
    { id: 'hype', name: 'HYPE-USDC', ticker: 'HYPE', side: -1, size: 30, entry: 24.1, mark: 23.35, lev: 10, maxLev: 10, dp: 3 }
  ];
  POSITIONS.forEach(function (p) { p.mmr = 1 / (2 * p.maxLev); });

  var SCENARIOS = [
    { id: 'crash', down: true, name: 'Market Crash', effect: MINUS + '30% all positions', ratios: { btc: 0.7, eth: 0.7, zec: 0.7, sol: 0.7, hype: 0.7 } },
    { id: 'boom', name: 'BTC Boom', effect: '+15% BTC', ratios: { btc: 1.15 } },
    { id: 'recovery', name: 'Market Recovery', effect: '+10% all positions', ratios: { btc: 1.1, eth: 1.1, zec: 1.1, sol: 1.1, hype: 1.1 } }
  ];

  // Real crashes, replayed per coin: daily open to daily low on Hyperliquid
  // (api.hyperliquid.xyz candleSnapshot, 1d, UTC). Lows were not all at the
  // same minute, so this is the worst case of the day.
  var SHOCKS = [
    { id: 'oct10', name: 'Oct 10, 2025', range: 'Oct 10, 2025',
      prices: { btc: [121615, 100837], eth: [4369.2, 3241.2], sol: [221.02, 137.51], hype: [43.976, 31.8], zec: [212.9, 123.91] } },
    { id: 'apr25', name: 'Apr 2025 tariffs', range: 'Apr 2–7, 2025',
      prices: { btc: [85123, 74442], eth: [1904.3, 1415], sol: [126.65, 95.333], hype: [13.327, 9.3061], zec: [40.66, 27.92] } }
  ];
  SHOCKS.forEach(function (sh) {
    sh.down = true;
    sh.ratios = {};
    Object.keys(sh.prices).forEach(function (k) { sh.ratios[k] = sh.prices[k][1] / sh.prices[k][0]; });
    // Button shows the range across coins; the tooltip lists each one
    var drops = Object.keys(sh.ratios).map(function (k) { return Math.round((1 - sh.ratios[k]) * 100); });
    sh.effect = MINUS + Math.min.apply(null, drops) + '% to ' + MINUS + Math.max.apply(null, drops) + '%';
    sh.title = sh.range + ', daily open to low on Hyperliquid: ' + POSITIONS.map(function (p) {
      return p.ticker + ' ' + MINUS + ((1 - sh.ratios[p.id]) * 100).toFixed(1) + '%';
    }).join(', ');
  });
  var PRESETS = SCENARIOS.concat(SHOCKS);

  // ---------- State ----------
  var ratios = {};      // simulated price / market price, per position
  var scenario = null;  // active preset id
  var dragging = null;  // id of the position being dragged
  var hinted = false;   // "Drag to simulate" shows on BTC until the first move
  var adj = noAdjustments();
  var fixes = [];       // risk fixes offered in the last render
  POSITIONS.forEach(function (p) { ratios[p.id] = 1; });

  function noAdjustments() { return { deposit: 0, cut: {}, sl: {} }; }
  function withAdj(change) {
    var a = { deposit: adj.deposit, cut: Object.assign({}, adj.cut), sl: Object.assign({}, adj.sl) };
    change(a);
    return a;
  }
  function hasAdjustments() {
    return adj.deposit > 0 || Object.keys(adj.cut).length > 0 || Object.keys(adj.sl).length > 0;
  }
  function marketRatios() {
    var t = {};
    POSITIONS.forEach(function (p) { t[p.id] = 1; });
    return t;
  }

  // ---------- Formatting ----------
  function num(v, dp) {
    return Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  function usd(v, dp) { return (v < 0 && num(v, dp) !== num(0, dp) ? MINUS : '') + '$' + num(v, dp); }
  function signedUsd(v, dp) {
    var s = num(v, dp);
    if (s === num(0, dp)) return '$' + s;
    return (v < 0 ? MINUS : '+') + '$' + s;
  }
  function pct(v, dp) {
    var s = num(v, dp);
    if (s === num(0, dp)) return s + '%';
    return (v < 0 ? MINUS : '+') + s + '%';
  }
  // As in the mockup script: green above zero, red otherwise
  function tone(v) { return v > 0.004 ? 'is-green' : 'is-red'; }
  // The market value, struck through, before the simulated one
  function was(before, now) {
    return before !== null && before !== now ? '<s class="sim-was">' + before + '</s> ' : '';
  }

  // ---------- Model ----------
  function priceAt(p, t, rt) { return p.mark * (1 + t * (rt[p.id] - 1)); }

  // Account value and maintenance margin are linear in t between events
  function account(open, collateral, t, rt) {
    var av = collateral, mm = 0;
    open.forEach(function (p) {
      var px = priceAt(p, t, rt);
      av += p.side * p.size * (px - p.entry);
      mm += p.size * px * p.mmr;
    });
    return { av: av, mm: mm };
  }

  function simulate(rt, a) {
    var collateral = COLLATERAL + a.deposit;
    var closed = {};
    var cutPnl = 0;
    var open = [];

    // Fixes happen now, at market: a cut realizes its share of the P&L
    POSITIONS.forEach(function (base) {
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

      // Stops and take-profits
      open.forEach(function (p) {
        var r = rt[p.id];
        if (r === 1) return;
        [['SL', p.sl], ['TP', p.tp]].forEach(function (pair) {
          if (!pair[1]) return;
          var tt = (pair[1] / p.mark - 1) / (r - 1);
          if (tt > t + EPS && tt <= 1 + EPS && (!next || tt < next.t)) {
            next = { t: tt, kind: pair[0], pos: p, price: pair[1] };
          }
        });
      });

      // Account liquidation: account value falls to maintenance margin
      var a0 = account(open, collateral, t, rt);
      var a1 = account(open, collateral, 1, rt);
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
    var acc = account(open, collateral, 1, rt);
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
    var totalPnl = POSITIONS.reduce(function (sum, p) {
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
    var level = distance < 7.5 ? 'is-red' : distance < LOW ? 'is-orange' : 'is-green';

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
      level: level,
      rows: rows,
      sized: sized,
      closed: closed
    };
  }

  // The live account, for "was → now"
  var BASE = simulate(marketRatios(), noAdjustments());

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

  function niceAbove(v, side) {
    var step = Math.pow(10, Math.floor(Math.log10(v)) - 2);
    return side > 0 ? Math.ceil(v / step) * step : Math.floor(v / step) * step;
  }

  function findFixes(s) {
    var list = [];
    var lowEnough = function (a) {
      var r = simulate(ratios, a);
      return !r.liquidated && r.distance >= LOW;
    };

    // 1. Add margin until risk is Low
    if (adj.deposit > 0) {
      list.push({ id: 'deposit', on: true, name: 'Added ' + usd(adj.deposit, 0) + ' margin', effect: 'Undo' });
    } else if (s.distance < LOW) {
      var x = bisect(0, 100000, function (v) { return lowEnough(withAdj(function (a) { a.deposit = v; })); });
      if (x !== null) {
        x = Math.ceil(x / 10) * 10;
        list.push({ id: 'deposit', name: 'Add ' + usd(x, 0) + ' margin', effect: '→ Low risk', value: x });
      }
    }

    // 2. Cut the position closest to liquidation
    var cutId = Object.keys(adj.cut)[0];
    if (cutId) {
      var cp = POSITIONS.filter(function (p) { return p.id === cutId; })[0];
      list.push({ id: 'cut', target: cutId, on: true,
        name: (adj.cut[cutId] >= 1 ? 'Closed ' : 'Cut ' + Math.round(adj.cut[cutId] * 100) + '% of ') + cp.ticker, effect: 'Undo' });
    } else if (s.distance < LOW && s.riskiest) {
      var p = POSITIONS.filter(function (q) { return q.id === s.riskiest; })[0];
      var f = bisect(0, 1, function (v) { return lowEnough(withAdj(function (a) { a.cut[p.id] = v; })); });
      if (f !== null) {
        f = Math.min(1, Math.ceil(f * 20) / 20); // 5% steps
        var after = simulate(ratios, withAdj(function (a) { a.cut[p.id] = f; }));
        var row = after.rows[p.id];
        list.push({ id: 'cut', target: p.id, value: f,
          name: f >= 1 ? 'Close ' + p.ticker : 'Cut ' + p.ticker + ' by ' + Math.round(f * 100) + '%',
          effect: f >= 1 || !row || row.liq === null ? '→ Low risk' : 'liq. ' + usd(row.liq, p.dp) });
      }
    }

    // 3. A stop the liquidation would beat: move it in front
    var slId = Object.keys(adj.sl)[0];
    if (slId) {
      var sp = POSITIONS.filter(function (q) { return q.id === slId; })[0];
      list.push({ id: 'sl', target: slId, on: true, name: 'SL moved to ' + usd(adj.sl[slId], sp.dp), effect: 'Undo' });
    } else {
      POSITIONS.some(function (q) {
        var r = s.rows[q.id];
        if (!r || !r.sl || r.liq === null) return false;
        var beaten = q.side > 0 ? r.liq >= r.sl : r.liq <= r.sl;
        if (!beaten) return false;
        var to = niceAbove(r.liq * (1 + q.side * 0.01), q.side);
        if (q.side > 0 ? to >= r.price : to <= r.price) return false;
        list.push({ id: 'sl', target: q.id, value: to, name: 'Move SL to ' + usd(to, q.dp), effect: 'fires before liq.' });
        return true;
      });
    }
    return list;
  }

  function applyFix(fix) {
    if (fix.id === 'deposit') adj.deposit = fix.on ? 0 : fix.value;
    if (fix.id === 'cut') { if (fix.on) delete adj.cut[fix.target]; else adj.cut[fix.target] = fix.value; }
    if (fix.id === 'sl') { if (fix.on) delete adj.sl[fix.target]; else adj.sl[fix.target] = fix.value; }
  }

  // ---------- Rendering ----------
  function x(price, p) { return (price / p.mark - 0.5) * W; }
  function inRange(v) { return v >= 0 && v <= W; }

  function coin(p) {
    return '<span class="sim-coin sim-coin--' + p.id + '"><img src="' + ICONS + p.id + '.svg" alt="" width="20" height="20"></span>';
  }

  function stat(label, value, cls, before) {
    return '<div class="sim-stat"><p class="t11">' + label + '</p><p class="' + (cls || '') + '">' + was(before === undefined ? null : before, value) + value + '</p></div>';
  }

  // Chips are centred on their markers, then pushed apart so they never overlap
  function placeChips(chips) {
    // Markers within a few pixels keep a fixed order: liq. price, stop, take-profit
    chips.sort(function (a, b) { return Math.abs(a.cx - b.cx) < 8 ? a.rank - b.rank : a.cx - b.cx; });
    var GAP = 4;
    chips.forEach(function (c) { c.left = c.align === 'start' ? 0 : c.align === 'end' ? W - c.w : c.cx - c.w / 2; });
    for (var i = 1; i < chips.length; i++) {
      var min = chips[i - 1].left + chips[i - 1].w + GAP;
      if (chips[i].left < min) chips[i].left = min;
    }
    var over = chips.length ? chips[chips.length - 1].left + chips[chips.length - 1].w - W : 0;
    if (over > 0) {
      chips[chips.length - 1].left -= over;
      for (var j = chips.length - 2; j >= 0; j--) {
        var max = chips[j + 1].left - GAP - chips[j].w;
        if (chips[j].left > max) chips[j].left = max;
      }
    }
    chips.forEach(function (c) { if (c.left < 0) c.left = 0; });
  }

  function chip(kind, title, value, cx, full, align) {
    var html = (full && title ? '<p>' + title + '</p>' : '') + '<p>' + value + '</p>';
    return { kind: kind, html: html, cx: cx, align: align || '' };
  }

  // Chips are placed once they are on the page and their widths are known
  function layoutChips() {
    Array.prototype.forEach.call(root.querySelectorAll('.sim-labels'), function (box) {
      var chips = Array.prototype.map.call(box.children, function (el) {
        var kind = el.getAttribute('data-kind');
        return { el: el, cx: +el.getAttribute('data-cx'), align: el.getAttribute('data-align'), w: el.offsetWidth, rank: kind === 'tp' ? 2 : kind === 'liq' ? 0 : 1 };
      });
      if (chips.some(function (c) { return !c.w; })) return; // hidden: no widths yet
      placeChips(chips);
      chips.forEach(function (c) { c.el.style.left = c.left + 'px'; });
    });
  }

  function track(p, row, ratio, simulated) {
    var px = p.mark * ratio;
    var tx = x(px, p);
    var parts = ['<div class="sim-base' + (row && row.liquidated ? ' is-liquidated' : '') + '"></div>'];
    var sl = row ? row.sl : p.sl;
    var full = !!(sl || p.tp);
    var chips = [];
    var baseLiq = BASE.rows[p.id] ? BASE.rows[p.id].liq : null;

    if (row && row.liq !== null) {
      var lx = x(row.liq, p);
      if (inRange(lx)) {
        if (p.side > 0) parts.push('<div class="sim-zone" style="left:0;width:' + lx + 'px"></div>');
        else parts.push('<div class="sim-zone" style="left:' + lx + 'px;right:0"></div>');
      }
    }

    var slx = sl ? x(sl, p) : null;
    var tpx = p.tp ? x(p.tp, p) : null;
    if (slx !== null && tpx !== null) {
      var a = Math.max(0, Math.min(slx, tpx)), b = Math.min(W, Math.max(slx, tpx));
      if (b > a) parts.push('<div class="sim-range" style="left:' + a + 'px;width:' + (b - a) + 'px"></div>');
    }
    if (slx !== null && inRange(slx)) parts.push('<div class="sim-tick sim-tick--sl" style="left:' + (slx - 1) + 'px"></div>');
    if (tpx !== null && inRange(tpx)) parts.push('<div class="sim-tick sim-tick--tp" style="left:' + (tpx - 1) + 'px"></div>');
    if (Math.abs(ratio - 1) > 1e-9) parts.push('<div class="sim-tick sim-tick--market" style="left:' + (W / 2 - 1) + 'px"></div>');

    // Where the liquidation price was before the simulation
    if (simulated && row && !row.liquidated && baseLiq !== null) {
      var gx = x(baseLiq, p);
      var moved = row.liq === null || Math.abs(x(row.liq, p) - gx) > 3;
      if (moved && inRange(gx)) parts.push('<div class="sim-liq-marker is-ghost" style="left:' + (gx - 2) + 'px"></div>');
    }

    if (row && !row.liquidated) {
      if (row.liq === null) {
        chips.push(chip('muted', '', 'No liquidation', W / 2, false));
      } else {
        var lx2 = x(row.liq, p);
        var lv = usd(row.liq, p.dp);
        var before = simulated && baseLiq !== null ? was(usd(baseLiq, p.dp), lv) : '';
        if (lx2 < 0) chips.push(chip('liq', '', '← ' + before + lv, 0, false, 'start'));
        else if (lx2 > W) chips.push(chip('liq', '', before + lv + ' →', W, false, 'end'));
        else {
          parts.push('<div class="sim-liq-marker" style="left:' + (lx2 - 2) + 'px"></div>');
          chips.push(chip('liq', 'Liq. Price', before + lv, lx2, full));
        }
      }

      if (sl) {
        var slFirst = row.liq !== null && (p.side > 0 ? row.liq >= sl : row.liq <= sl);
        var cx = Math.max(0, Math.min(W, slx));
        if (slFirst) {
          chips.push(chip('warn', 'SL won’t trigger', 'Liq. ' + usd(row.liq, p.dp) + ' comes first', cx, true));
        } else {
          chips.push(chip('sl', 'SL', pct((sl / px - 1) * 100, 1) + ' / ' + signedUsd(p.side * row.size(sl), 0), cx, true));
        }
      }
      if (p.tp) {
        chips.push(chip('tp', 'TP', pct((p.tp / px - 1) * 100, 1) + ' / ' + signedUsd(p.side * row.size(p.tp), 0), Math.max(0, Math.min(W, tpx)), true));
      }
    }

    var moved2 = (ratio - 1) * 100;
    var tip = dragging === p.id || Math.abs(moved2) > 1e-9
      ? usd(px, p.dp) + ' · ' + pct(moved2, 1)
      : 'Drag to simulate';
    var thumbCls = 'sim-thumb' + (dragging === p.id ? ' is-dragging' : '') + (!hinted && p.id === 'btc' ? ' is-hint' : '');
    parts.push(
      '<div class="' + thumbCls + '" style="left:' + (tx - 5) + 'px" role="slider" tabindex="0"' +
      ' aria-label="' + p.name + ' simulated price" aria-valuemin="-50" aria-valuemax="50" aria-valuenow="' + moved2.toFixed(1) + '"' +
      ' aria-valuetext="' + usd(px, p.dp) + ', ' + pct(moved2, 1) + ' from market" data-thumb="' + p.id + '">' +
      '<span class="sim-tip t11">' + tip + '</span></div>'
    );

    var labels = chips.map(function (c) {
      return '<div class="sim-chip sim-chip--' + c.kind + ' t11" data-kind="' + c.kind + '" data-cx="' + c.cx + '" data-align="' + c.align + '">' + c.html + '</div>';
    }).join('');

    return '<div class="sim-track-block">' +
      '<div class="sim-track" data-track="' + p.id + '">' + parts.join('') + '</div>' +
      '<div class="sim-labels' + (full ? ' sim-labels--full' : '') + '">' + labels + '</div>' +
      '</div>';
  }

  function positionRow(p, s, simulated) {
    var row = s.rows[p.id];
    var closed = s.closed[p.id];
    var ratio = ratios[p.id];
    var px = p.mark * ratio;
    var moved = Math.abs(ratio - 1) > 1e-9;
    var pnl = closed ? closed.pnl : row.pnl;
    var cut = adj.cut[p.id] || 0;
    var base = BASE.rows[p.id];
    if (row) {
      // P&L at a trigger price, for the position size left after a cut
      var size = s.sized[p.id].size;
      row.size = function (price) { return size * (price - p.entry); };
    }

    var buffer;
    if (closed) buffer = stat('Price Buffer', 'Closed', 'is-muted');
    else if (row.liquidated) buffer = stat('Price Buffer', 'Liquidated', 'is-red');
    else if (row.buffer === null) buffer = stat('Price Buffer', '—');
    else {
      var bv = num(row.buffer, 1) + '%';
      var bb = simulated && base.buffer !== null ? num(base.buffer, 1) + '%' : null;
      buffer = stat('Price Buffer', bv, row.buffer < 7.5 ? 'is-red' : '', bb);
    }

    var side = (cut > 0 && cut < 1 ? Math.round((1 - cut) * 100) + '% · ' : '') + p.lev + 'x ' + (p.side > 0 ? 'Long' : 'Short');
    var html = '<div class="sim-row">' +
      '<div class="sim-row-head">' +
        '<div class="sim-asset">' + coin(p) + '<p>' + p.name + '</p>' +
          '<span class="sim-side t11 ' + (p.side > 0 ? 'is-green' : 'is-red') + '">' + side + '</span>' +
        '</div>' +
        stat('P&amp;L', signedUsd(pnl, 2), tone(pnl)) +
        stat('Current Price', usd(px, p.dp), moved ? 'is-orange' : '') +
        buffer +
      '</div>';

    // While a thumb is held, rows keep their tracks so nothing jumps under the pointer
    if (closed && !dragging) {
      // Same height as the track it replaces, so rows below stay put
      html += '<div class="sim-closed' + ((s.sized[p.id] || p).sl || p.tp ? ' sim-closed--full' : '') + '"><span class="sim-tag">' + closed.kind + '</span>' +
        '<p class="t11 is-muted">' + (closed.manual ? 'at market, ' + usd(closed.price, p.dp) : 'at ' + usd(closed.price, p.dp) + ' · Realized ' + signedUsd(closed.pnl, 2)) + '</p></div>';
    } else {
      html += track(p, closed ? null : row, ratio, simulated);
    }
    return html + '</div>';
  }

  function metric(label, value, cls, before) {
    return '<div class="sim-metric"><p>' + label + '</p><p class="' + (cls || '') + '">' + was(before === undefined ? null : before, value) + value + '</p></div>';
  }

  function moveText(s) {
    if (s.move === null) return '—';
    if (!isFinite(s.move) || Math.abs(s.move) > 1) return '&gt; 100%';
    return pct(s.move * 100, 2);
  }
  function cmrText(s) { return isFinite(s.cmr) && s.cmr < 1000 ? num(s.cmr, 1) + '%' : '&gt; 999%'; }

  function presetButton(sc) {
    var on = scenario === sc.id;
    return '<button type="button" class="sim-scenario' + (on ? ' is-active' : '') + (sc.down ? ' is-down' : '') + '" data-scenario="' + sc.id + '" aria-pressed="' + on + '"' +
      (sc.title ? ' title="' + sc.title + '"' : '') + '><b>' + sc.name + '</b><span>' + sc.effect + '</span></button>';
  }

  function render() {
    var s = simulate(ratios, adj);
    var moved = POSITIONS.some(function (p) { return Math.abs(ratios[p.id] - 1) > 1e-9; });
    var simulated = moved || hasAdjustments();
    var b = simulated ? BASE : null;
    // Mid-animation prices are passing through; fixes settle when it lands
    if (!tween) fixes = findFixes(s);

    var account =
      '<div class="sim-cmr ' + s.level + '">' +
        '<div class="sim-cmr-head"><p class="is-white">Cross Margin Ratio</p><p>' + was(b && cmrText(b), cmrText(s)) + cmrText(s) + '</p></div>' +
        '<div class="sim-cmr-bar"><div class="sim-cmr-fill" style="width:' + Math.min(100, s.cmr) + '%"></div></div>' +
        '<p class="t11 is-muted">Your cross positions will be liquidated at 100%</p>' +
      '</div>' +
      (s.liquidated
        ? '<p class="sim-liq-note t11">At these prices your cross positions are liquidated: Equity ' + usd(s.av, 2) +
          ' is below Maintenance Margin ' + usd(s.mm, 2) + '.</p>'
        : '') +
      '<div class="sim-metrics">' +
        metric('Total P&amp;L', signedUsd(s.totalPnl, 2), tone(s.totalPnl), b && signedUsd(b.totalPnl, 2)) +
        metric('Equity Reserve', s.reserve === null ? '—' : usd(s.reserve, 2), '', b && s.reserve !== null ? usd(b.reserve, 2) : null) +
        '<div class="sim-divider"></div>' +
        metric('Maintenance Margin', usd(s.mm, 2), '', b && usd(b.mm, 2)) +
        metric('Eff. leverage', s.lev === null ? '—' : num(s.lev, 2) + 'x', '', b && s.lev !== null ? num(b.lev, 2) + 'x' : null) +
        metric('Market move to liq.', moveText(s), '', b && s.move !== null ? moveText(b) : null) +
        '<div class="sim-divider"></div>' +
        metric('Withdrawable', usd(s.withdrawable, 2), '', b && usd(b.withdrawable, 2)) +
      '</div>' +
      '<div class="sim-scenarios"><p class="sim-label-caps">Quick scenarios</p>' + SCENARIOS.map(presetButton).join('') + '</div>' +
      '<div class="sim-scenarios"><p class="sim-label-caps">Real crashes</p>' + SHOCKS.map(presetButton).join('') + '</div>' +
      // Below the presets and always the same height, so offering or
      // dropping a fix never moves a button under the pointer
      '<div class="sim-scenarios sim-fixes"><p class="sim-label-caps">Reduce risk</p>' +
        (fixes.length
          ? fixes.map(function (f, i) {
              return '<button type="button" class="sim-scenario sim-fix' + (f.on ? ' is-active' : '') + '" data-fix="' + i + '" aria-pressed="' + !!f.on + '">' +
                '<b>' + f.name + '</b><span>' + f.effect + '</span></button>';
            }).join('')
          : '<p class="sim-fixes-empty t11">Risk is low. Nothing to fix at these prices.</p>') +
      '</div>' +
      '<p class="sim-footnote t11">Stop orders are assumed to fill at the trigger price. Gaps are not simulated.</p>';

    var positions =
      '<div class="sim-pos-head"><b>Active Positions</b><span class="sim-count">' + POSITIONS.length + '</span>' +
        (simulated ? '<span class="sim-tag sim-tag--warn">Simulated</span>' : '') +
        '<span class="sim-spacer"></span>' +
        '<button type="button" class="sim-reset" data-reset' + (simulated ? '' : ' disabled') + '>Reset to Market</button>' +
      '</div>' +
      POSITIONS.map(function (p) { return positionRow(p, s, simulated); }).join('');

    var ae = document.activeElement;
    var focused = ae && root.contains(ae)
      ? (ae.getAttribute('data-thumb') ? '[data-thumb="' + ae.getAttribute('data-thumb') + '"]'
        : ae.getAttribute('data-scenario') ? '[data-scenario="' + ae.getAttribute('data-scenario') + '"]'
        : ae.getAttribute('data-fix') ? '[data-fix="' + ae.getAttribute('data-fix') + '"]'
        : ae.hasAttribute('data-reset') ? '[data-reset]' : null)
      : null;

    accountEl.innerHTML = account;
    positionsEl.innerHTML = positions;
    layoutChips();
    holdStageHeight();

    if (focused) {
      var el = root.querySelector(focused);
      if (el && !el.disabled) el.focus({ preventScroll: true });
    }
  }

  // The stage only grows: a state with fewer rows (a position closed by SL)
  // leaves empty backdrop below the modal instead of shrinking the page
  var stage = root.closest('.sim-stage');
  var stageMin = 0;
  function holdStageHeight() {
    if (!stage) return;
    var h = stage.offsetHeight;
    if (h > stageMin) {
      stageMin = h;
      stage.style.minHeight = h + 'px';
    }
  }

  // ---------- Shell ----------
  root.innerHTML =
    '<div class="sim-head"><p class="sim-title">Liquidation Risk Simulator</p>' +
      '<span class="sim-close" aria-hidden="true"><img src="' + ICONS + 'close.svg" alt="" width="20" height="20"></span></div>' +
    '<div class="sim-body"><div class="sim-account"></div><div class="sim-positions"></div></div>';
  var accountEl = root.querySelector('.sim-account');
  var positionsEl = root.querySelector('.sim-positions');

  // ---------- Interaction ----------
  function setRatio(id, r) {
    r = Math.max(0.5, Math.min(1.5, Math.round(r * 1000) / 1000));
    if (r === ratios[id] && scenario === null) return false;
    ratios[id] = r;
    scenario = null;
    hinted = true;
    return true;
  }

  function ratioFromPointer(trackEl, clientX) {
    var box = trackEl.getBoundingClientRect();
    var scale = box.width / W; // in case the page is zoomed
    return 0.5 + ((clientX - box.left) / scale) / W;
  }

  var dragTrack = null;

  root.addEventListener('pointerdown', function (e) {
    var t = e.target.closest('[data-track]');
    if (!t || e.button !== 0) return;
    e.preventDefault();
    dragging = t.getAttribute('data-track');
    dragTrack = t;
    setRatio(dragging, ratioFromPointer(t, e.clientX));
    render();
    var thumb = root.querySelector('[data-thumb="' + dragging + '"]');
    if (thumb) thumb.focus({ preventScroll: true });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });

  function onMove(e) {
    if (!dragging) return;
    // The track element is re-rendered; find the current one
    dragTrack = root.querySelector('[data-track="' + dragging + '"]') || dragTrack;
    if (setRatio(dragging, ratioFromPointer(dragTrack, e.clientX))) render();
  }

  function onUp() {
    dragging = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    render();
  }

  root.addEventListener('keydown', function (e) {
    var id = e.target.getAttribute && e.target.getAttribute('data-thumb');
    if (!id) return;
    var r = ratios[id];
    var step = e.shiftKey ? 0.05 : 0.01;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') r -= step;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') r += step;
    else if (e.key === 'PageDown') r -= 0.1;
    else if (e.key === 'PageUp') r += 0.1;
    else if (e.key === 'Home') r = 0.5;
    else if (e.key === 'End') r = 1.5;
    else return;
    e.preventDefault();
    if (setRatio(id, r)) render();
  });

  // Presets and Reset glide to their prices in 0.3s (spec §5)
  var tween = null;
  var tweenTimer = null;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function stopTween() {
    if (tween) cancelAnimationFrame(tween);
    clearTimeout(tweenTimer);
    tween = null;
  }

  function animateTo(target) {
    stopTween();
    var from = {};
    POSITIONS.forEach(function (p) { from[p.id] = ratios[p.id]; });
    if (reduceMotion.matches) {
      POSITIONS.forEach(function (p) { ratios[p.id] = target[p.id]; });
      render();
      return;
    }
    var start = performance.now();
    function frame(now) {
      var k = Math.min(1, (now - start) / 300);
      var e = 1 - Math.pow(1 - k, 3); // ease-out
      POSITIONS.forEach(function (p) { ratios[p.id] = from[p.id] + (target[p.id] - from[p.id]) * e; });
      if (k === 1) {
        POSITIONS.forEach(function (p) { ratios[p.id] = target[p.id]; });
        tween = null;
      } else {
        tween = requestAnimationFrame(frame);
      }
      render();
    }
    tween = requestAnimationFrame(frame);
    // Where frames don't run (background tab), land on the target anyway
    tweenTimer = setTimeout(function () {
      if (!tween) return;
      stopTween();
      POSITIONS.forEach(function (p) { ratios[p.id] = target[p.id]; });
      render();
    }, 350);
  }

  // A drag or a key press takes over from a running animation
  root.addEventListener('pointerdown', stopTween, true);
  root.addEventListener('keydown', function (e) {
    if (e.target.getAttribute && e.target.getAttribute('data-thumb')) stopTween();
  }, true);

  root.addEventListener('click', function (e) {
    var sc = e.target.closest('[data-scenario]');
    if (sc) {
      var id = sc.getAttribute('data-scenario');
      var preset = PRESETS.filter(function (s) { return s.id === id; })[0];
      var target = marketRatios();
      if (scenario === id) {
        scenario = null;
      } else {
        Object.keys(preset.ratios).forEach(function (k) { target[k] = preset.ratios[k]; });
        scenario = id;
      }
      hinted = true;
      animateTo(target);
      return;
    }
    var fx = e.target.closest('[data-fix]');
    if (fx) {
      var fix = fixes[+fx.getAttribute('data-fix')];
      if (fix) {
        applyFix(fix);
        render();
      }
      return;
    }
    if (e.target.closest('[data-reset]')) {
      scenario = null;
      adj = noAdjustments();
      animateTo(marketRatios());
    }
  });

  root.closest('.sim-figure').classList.add('is-ready');
  render();
  // Chip widths change when Inter loads or the simulator first becomes visible
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutChips);
  var desktop = window.matchMedia('(min-width: 960px)');
  if (desktop.addEventListener) desktop.addEventListener('change', layoutChips);
})();
