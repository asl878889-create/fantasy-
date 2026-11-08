// 開竅觀察名單：最近 5 場比之前明顯變好，而且原因是「會持續」的（上場時間、先發、球權、穩定數據變多），不是只有手感
// 抓聯盟 10 隊陣容＋前 150 位自由球員的今年逐場紀錄，算好存成 docs/breakout.json（網頁每次打開只讀這個小檔案）
//   node fantasy_report/fetch_breakout.js
const { execFile } = require("child_process");
const fs = require("fs"), path = require("path");
const LEAGUE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2027/segments/0/leagues/406470928";
const curl = (url, filter) => new Promise((res, rej) => execFile("curl", ["-sS", "--max-time", "90", "-f", ...(filter ? ["-H", "X-Fantasy-Filter: " + JSON.stringify(filter)] : []), url], { maxBuffer: 256 * 1024 * 1024 }, (e, out) => (e ? rej(e) : res(JSON.parse(out)))));
const R = 5, PRIOR_MIN = 4; // 最近幾場、之前至少幾場
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length, vr = (a) => { const m = mean(a); return a.length > 1 ? a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1) : 0; };
function sideOf(gs) {
  const g = (z, k) => Number(z.stats[k]) || 0, sum = (k) => gs.reduce((s, z) => s + g(z, k), 0), mins = sum("40");
  const tsDen = 2 * (sum("14") + 0.44 * sum("16"));
  return { n: gs.length, v: mean(gs.map((z) => z.appliedTotal || 0)), min: mins / gs.length, gs: gs.filter((z) => g(z, "41") > 0).length / gs.length,
    use: mins ? ((sum("14") + 0.44 * sum("16") + sum("11")) / mins) * 36 : 0, stab: mins ? ((sum("6") + sum("3") + sum("2") + sum("1")) / mins) * 36 : 0, ts: tsDen ? sum("0") / tsDen : null };
}
(async () => {
  const ros = await curl(`${LEAGUE}?view=mRoster`), ids = new Map();
  for (const t of ros.teams) for (const e of t.roster.entries) ids.set(e.playerId, e.playerPoolEntry.player.fullName);
  const fa = await curl(`${LEAGUE}?view=kona_player_info`, { players: { filterStatus: { value: ["FREEAGENT", "WAIVERS"] }, limit: 150, sortPercOwned: { sortPriority: 1, sortAsc: false } } });
  for (const x of fa.players) ids.set(x.player.id, x.player.fullName);
  const list = [...ids.keys()], players = {};
  for (let i = 0; i < list.length; i += 40) {
    const d = await curl(`${LEAGUE}?view=kona_playercard`, { players: { filterIds: { value: list.slice(i, i + 40) }, filterStatsForTopScoringPeriodIds: { value: 200, additionalValue: ["002027"] } } });
    for (const pp of d.players || []) {
      const pl = pp.player, gs = (pl.stats || []).filter((s) => s.statSplitTypeId === 5 && s.statSourceId === 0 && s.seasonId === 2027 && s.stats && Number(s.stats["40"]) > 0).sort((a, b) => a.scoringPeriodId - b.scoringPeriodId);
      if (gs.length < R + PRIOR_MIN) continue;
      const rec = gs.slice(-R), pri = gs.slice(0, -R), a = rec.map((z) => z.appliedTotal || 0), b = pri.map((z) => z.appliedTotal || 0);
      const diff = mean(a) - mean(b), se = Math.sqrt(vr(a) / a.length + vr(b) / b.length) || 1, z = diff / se;
      if (!(diff >= Math.max(4, 0.15 * mean(b)) && z >= 1.5)) continue; // 變好要夠多、而且不太像隨機起伏
      const r = sideOf(rec), p = sideOf(pri), sig = [];
      if (r.min - p.min >= 3) sig.push("min");
      if (r.gs - p.gs >= 0.4) sig.push("start");
      if (p.use > 0 && r.use / p.use - 1 >= 0.15) sig.push("use");
      if (p.stab > 0 && r.stab / p.stab - 1 >= 0.15) sig.push("stab");
      const luck = r.ts != null && p.ts != null && r.ts - p.ts >= 0.08 && !sig.includes("min") && !sig.includes("start");
      if (!sig.length) continue; // 至少要有一項會持續的原因
      const rd = (x, k = 1) => (x == null ? null : Math.round(x * 10 ** k) / 10 ** k);
      players[pl.id] = { n: pl.fullName, z: rd(z, 2), sig, luck, rec: { n: r.n, v: rd(r.v), min: rd(r.min), gs: rd(r.gs, 2), use: rd(r.use), stab: rd(r.stab), ts: rd(r.ts, 3) }, pri: { n: p.n, v: rd(p.v), min: rd(p.min), gs: rd(p.gs, 2), use: rd(p.use), stab: rd(p.stab), ts: rd(p.ts, 3) } };
    }
  }
  const file = path.resolve(__dirname, "../docs/breakout.json");
  fs.writeFileSync(file, JSON.stringify({ generated: new Date().toISOString(), recent: R, players }));
  console.log(`已寫入 ${file}：${Object.keys(players).length} 位球員符合（共看了 ${list.length} 位）`);
})().catch((e) => { console.error("抓不到逐場紀錄：", e.message); process.exit(1); });
