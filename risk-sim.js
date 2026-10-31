// Liquidation Risk Simulator: a live prototype for the Brighty case page.
//
// This file is the page side only: it draws the simulator and handles
// dragging, keys and buttons. All the math (cross margin, liquidation
// prices, stops, risk fixes) and the demo data live in risk-model.js,
// which must load first.
(function () {
  var root = document.querySelector('[data-risk-sim]');
  var M = window.RiskModel;
  if (!root || !M) return;

  var ICONS = root.getAttribute('data-icons') || '';
  var W = 576; // track width: market price ±50%
  var MINUS = '−';
  var HIGH = M.HIGH; // price buffer turns red below this (%)

  var ACCOUNT = M.DEMO;
  var POSITIONS = ACCOUNT.positions;
  var LEVEL_CLASS = { high: 'is-red', medium: 'is-orange', low: 'is-green' };

  // Preset buttons: the model has the prices, this adds the words
  var LABELS = {
    crash: { name: 'Market Crash', effect: MINUS + '30% all positions' },
    boom: { name: 'BTC Boom', effect: '+15% BTC' },
    recovery: { name: 'Market Recovery', effect: '+10% all positions' },
    oct10: { name: 'Oct 10, 2025' },
    apr25: { name: 'Apr 2025 tariffs' }
  };
  function preset(m) {
    return { id: m.id, down: !!m.down, ratios: m.ratios, name: LABELS[m.id].name, effect: LABELS[m.id].effect };
  }
  var SCENARIOS = M.SCENARIOS.map(preset);
  var SHOCKS = M.SHOCKS.map(function (m) {
    var sh = preset(m);
    // Button shows the range across coins; the tooltip lists each one
    var drops = Object.keys(m.ratios).map(function (k) { return Math.round((1 - m.ratios[k]) * 100); });
    sh.effect = MINUS + Math.min.apply(null, drops) + '% to ' + MINUS + Math.max.apply(null, drops) + '%';
    sh.title = m.range + ', daily open to low on Hyperliquid: ' + POSITIONS.map(function (p) {
      return p.ticker + ' ' + MINUS + ((1 - m.ratios[p.id]) * 100).toFixed(1) + '%';
    }).join(', ');
    return sh;
  });
  var PRESETS = SCENARIOS.concat(SHOCKS);

  // ---------- State ----------
  var ratios = M.marketRatios(ACCOUNT); // simulated price / market price, per position
  var scenario = null;  // active preset id
  var dragging = null;  // id of the position being dragged
  var hinted = false;   // "Drag to simulate" shows on BTC until the first move
  var adj = M.noAdjustments();
  var fixes = [];       // risk fixes offered in the last render

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

  // The live account, for "was → now"
  var BASE = M.simulate(ACCOUNT, M.marketRatios(ACCOUNT), M.noAdjustments());

  // Button text for a fix from the model
  function fixLabel(f) {
    var p = POSITIONS.filter(function (q) { return q.id === f.target; })[0];
    var out = { name: '', effect: 'Undo' };
    if (f.id === 'deposit') {
      out.name = (f.on ? 'Added ' : 'Add ') + usd(f.value, 0) + ' margin';
      if (!f.on) out.effect = '→ Low risk';
    } else if (f.id === 'cut') {
      if (f.on) out.name = (f.value >= 1 ? 'Closed ' : 'Cut ' + Math.round(f.value * 100) + '% of ') + p.ticker;
      else {
        out.name = f.value >= 1 ? 'Close ' + p.ticker : 'Cut ' + p.ticker + ' by ' + Math.round(f.value * 100) + '%';
        out.effect = f.liqAfter === null ? '→ Low risk' : 'liq. ' + usd(f.liqAfter, p.dp);
      }
    } else if (f.id === 'sl') {
      out.name = (f.on ? 'SL moved to ' : 'Move SL to ') + usd(f.value, p.dp);
      if (!f.on) out.effect = 'fires before liq.';
    }
    return Object.assign({}, f, out);
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
      buffer = stat('Price Buffer', bv, row.buffer < HIGH ? 'is-red' : '', bb);
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
    var s = M.simulate(ACCOUNT, ratios, adj);
    var moved = POSITIONS.some(function (p) { return Math.abs(ratios[p.id] - 1) > 1e-9; });
    var simulated = moved || M.hasAdjustments(adj);
    var b = simulated ? BASE : null;
    // Mid-animation prices are passing through; fixes settle when it lands
    if (!tween) fixes = M.findFixes(ACCOUNT, ratios, adj, s).map(fixLabel);

    var account =
      '<div class="sim-cmr ' + LEVEL_CLASS[s.level] + '">' +
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
      '</div>';

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
  // Safari can run this script before risk-sim.css is applied; measuring then
  // locks in the unstyled height (~2900px) and stretches the backdrop. So the
  // height is only held once the page, with its stylesheets, has loaded.
  var stageReady = document.readyState === 'complete';
  if (!stageReady) {
    window.addEventListener('load', function () {
      stageReady = true;
      holdStageHeight();
    });
  }
  function holdStageHeight() {
    if (!stage || !stageReady) return;
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
    '<div class="sim-body"><div class="sim-account"></div><div class="sim-positions"></div></div>' +
    // Window footer: a fixed note that never changes with the prices
    '<div class="sim-foot"><p class="sim-footnote t11">Stop orders are assumed to fill at the trigger price. Gaps are not simulated.</p></div>';
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
      var target = M.marketRatios(ACCOUNT);
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
        adj = M.applyFix(adj, fix);
        render();
      }
      return;
    }
    if (e.target.closest('[data-reset]')) {
      scenario = null;
      adj = M.noAdjustments();
      animateTo(M.marketRatios(ACCOUNT));
    }
  });

  root.closest('.sim-figure').classList.add('is-ready');
  render();
  // Chip widths change when Inter loads or the simulator first becomes visible
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutChips);
  var desktop = window.matchMedia('(min-width: 960px)');
  if (desktop.addEventListener) desktop.addEventListener('change', layoutChips);
})();
