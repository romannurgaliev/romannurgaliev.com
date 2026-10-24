// Saves real Hyperliquid data as test fixtures for risk-model.js, so the
// simulator's math can be checked against the exchange itself rather than
// against our own Figma frames.
//
//   node scripts/hl-fixtures.js
//
// Writes tests/fixtures/hyperliquid/:
//   meta.json      max leverage and margin tiers per coin, plus mark prices
//   accounts.json  snapshots of public accounts holding cross positions,
//                  with Hyperliquid's own liquidation prices
//
// Accounts come from the public leaderboard. Addresses are not saved:
// the fixtures only need the numbers, not who holds them.
// Needs Node 18+ (built-in fetch). No dependencies.

const fs = require('fs');
const path = require('path');

const API = 'https://api.hyperliquid.xyz/info';
const LEADERBOARD = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';
const OUT = path.resolve(__dirname, '..', 'tests', 'fixtures', 'hyperliquid');

// Account sizes to cover, from one like the demo ($2.5k) to whales whose
// positions may reach the higher margin tiers
const BANDS = [
  { name: 'under $20k', min: 1e3, max: 2e4 },
  { name: '$20k–200k', min: 2e4, max: 2e5 },
  { name: '$200k–2M', min: 2e5, max: 2e6 },
  { name: '$2M–20M', min: 2e6, max: 2e7 },
  { name: 'over $20M', min: 2e7, max: Infinity },
];
// Account modes (POST /info {type: userAbstraction}):
//   disabled         classic: perps margined by perp USDC only. This is
//                    what risk-model.js models, so these are the main check.
//   unifiedAccount   spot USDC also backs perps
//   portfolioMargin  other spot assets count too, with haircuts
// The others are kept as evidence of where the model stops being right.
const PER_BAND = { disabled: 4, other: 2 };
const MAX_TRIES_PER_BAND = 150;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const info = async body => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) return res.json();
    // 429 = rate limit: wait and try again
    await sleep(1000 * (attempt + 1));
  }
  throw new Error(`Hyperliquid API failed for ${body.type}`);
};

const marksByCoin = ([meta, ctxs]) =>
  Object.fromEntries(meta.universe.map((u, i) => [u.name, ctxs[i].markPx]));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  // 1. Coins: max leverage, margin tier table, mark price
  const mac = await info({ type: 'metaAndAssetCtxs' });
  const [meta, ctxs] = mac;
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({
    source: 'POST /info {type: metaAndAssetCtxs}',
    fetchedAt: new Date().toISOString(),
    universe: meta.universe.map((u, i) => ({ ...u, markPx: ctxs[i].markPx, oraclePx: ctxs[i].oraclePx })),
    marginTables: meta.marginTables,
  }, null, 1) + '\n');
  console.log(`meta.json: ${meta.universe.length} coins, ${meta.marginTables.length} margin tables`);

  // 2. Candidate accounts, most active first within each size band
  const rows = (await (await fetch(LEADERBOARD)).json()).leaderboardRows;
  const monthVolume = r => +((r.windowPerformances.find(w => w[0] === 'month') || [, { vlm: 0 }])[1].vlm);
  const accounts = [];
  let skippedIsolated = 0;

  for (const band of BANDS) {
    const candidates = rows
      .filter(r => +r.accountValue >= band.min && +r.accountValue < band.max)
      .sort((a, b) => monthVolume(b) - monthVolume(a))
      .slice(0, MAX_TRIES_PER_BAND);
    const kept = { disabled: 0, other: 0 };
    for (const row of candidates) {
      if (kept.disabled >= PER_BAND.disabled && kept.other >= PER_BAND.other) break;
      const user = row.ethAddress;
      const state = await info({ type: 'clearinghouseState', user });
      const positions = state.assetPositions.map(a => a.position);
      if (positions.length === 0) continue;
      // The simulator models cross margin only
      if (positions.some(p => p.leverage.type !== 'cross')) { skippedIsolated++; continue; }
      const mode = await info({ type: 'userAbstraction', user });
      const group = mode === 'disabled' ? 'disabled' : 'other';
      if (kept[group] >= PER_BAND[group]) continue;
      const spot = await info({ type: 'spotClearinghouseState', user });
      // Resting orders reserve margin, which lowers Withdrawable
      const orders = await info({ type: 'frontendOpenOrders', user });
      // Mark prices right after the snapshot, for reference; the exact mark
      // used by the exchange is positionValue / |size| in each position
      const marks = marksByCoin(await info({ type: 'metaAndAssetCtxs' }));
      await sleep(150);
      kept[group]++;
      accounts.push({
        id: `acct-${String(accounts.length + 1).padStart(2, '0')}`,
        band: band.name,
        mode,
        time: state.time,
        marginSummary: state.marginSummary,
        crossMarginSummary: state.crossMarginSummary,
        crossMaintenanceMarginUsed: state.crossMaintenanceMarginUsed,
        withdrawable: state.withdrawable,
        positions,
        marks: Object.fromEntries(positions.map(p => [p.coin, marks[p.coin]])),
        // Non-zero spot balances: [coin, total, hold]. In unified and
        // portfolio modes these move the liquidation price.
        spotBalances: (spot.balances || []).filter(b => +b.total !== 0).map(b => [b.coin, b.total, b.hold]),
        openOrders: orders.map(o => ({ coin: o.coin, side: o.side, sz: o.sz, limitPx: o.limitPx, reduceOnly: o.reduceOnly, isTrigger: o.isTrigger })),
      });
      console.log(`${accounts.at(-1).id} ${band.name} ${mode}: ${positions.length} cross positions`);
    }
    if (kept.disabled < PER_BAND.disabled) console.log(`  only ${kept.disabled} classic accounts found in ${band.name}`);
  }

  fs.writeFileSync(path.join(OUT, 'accounts.json'), JSON.stringify({
    source: 'POST /info {type: clearinghouseState}, accounts from the public leaderboard, addresses removed',
    fetchedAt: new Date().toISOString(),
    skippedWithIsolatedPositions: skippedIsolated,
    accounts,
  }, null, 1) + '\n');
  console.log(`accounts.json: ${accounts.length} accounts (${skippedIsolated} skipped for isolated positions)`);
})().catch(e => { console.error(e); process.exit(1); });
