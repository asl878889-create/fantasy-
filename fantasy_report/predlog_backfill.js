// 預估比對補跑：排程沒跑到的比賽日，事後回推「當天開打前」的預估再對答案（存進 docs/pred-log.json）
// 做法：只用那天以前打完的比賽，重算每個人當時的今年平均、近 15 天平均、出賽場數、近 7 天上場時間，
// 再照網頁同一套公式算「原本預估」和「混合 EPM 預估」。EPM 和球隊數據只有現在的版本（會用到一點之後的資訊），結果只能當參考。
//   node fantasy_report/predlog_backfill.js 21 22   （不給日子＝自動找出中間漏掉、已經打完的比賽日）
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const FILE = path.resolve(__dirname, "../docs/pred-log.json");
const readJ = (f) => { try { return JSON.parse(fs.readFileSync(path.resolve(__dirname, "../docs/" + f), "utf8")); } catch (e) { return null; } };
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const summarize = (rows) => {
  const ok = rows.filter((r) => typeof r[6] === "number" && r[4] != null);
  const one = (rs) => ({ n: rs.length, maeOld: mean(rs.map((r) => Math.abs(r[3] - r[6]))), maeMix: mean(rs.map((r) => Math.abs(r[4] - r[6]))), biasOld: mean(rs.map((r) => r[3] - r[6])), biasMix: mean(rs.map((r) => r[4] - r[6])) });
  const r1 = (o) => (o.n ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === "n" ? v : Math.round(v * 100) / 100])) : { n: 0 });
  return { days: new Set(ok.map((r) => r[0])).size, all: r1(one(ok)), low: r1(one(ok.filter((r) => r[7] < 5))), high: r1(one(ok.filter((r) => r[7] >= 5))) };
};
let periods = process.argv.slice(2).map(Number).filter(Boolean);
(async () => {
  const log = readJ("pred-log.json") || { rows: [] };
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.addInitScript((a) => { window.__NOAUTH = true; if (a.adv) window.__ADV = a.adv; if (a.epm) window.__EPM = a.epm; }, { adv: readJ("adv.json"), epm: readJ("epm.json") });
  await page.goto("file://" + path.resolve(__dirname, "../docs/index.html"));
  await page.waitForFunction(() => typeof CUR !== "undefined" && CUR && CUR.A && typeof trueProj === "function" && EPM, null, { timeout: 120000 });
  if (!periods.length) { // 自動：第一天到今天（不含）之間沒有紀錄的比賽日
    const cur = await page.evaluate(() => CUR.period), have = new Set(log.rows.map((r) => r[0])), first = Math.min(...have);
    for (let p = first + 1; p < cur; p++) if (!have.has(p)) periods.push(p);
    console.log(periods.length ? `漏掉的比賽日：${periods.join("、")}` : "沒有漏掉的比賽日");
  }
  for (const p of periods) {
    if (log.rows.some((r) => r[0] === p)) { console.log(`${p} 已經有紀錄，略過`); continue; }
    const rows = await page.evaluate(async (p) => {
      const D = CUR;
      // 那天的陣容（各隊名單、IR 不算）和實際分數
      const bx = await get(`${LEAGUE}?${qs({ view: ["mBoxscore", "mMatchupScore"], scoringPeriodId: p })}`);
      const ent = [];
      for (const m of bx.schedule) for (const side of [m.home, m.away]) {
        if (!side || !side.rosterForCurrentScoringPeriod) continue;
        for (const e of side.rosterForCurrentScoringPeriod.entries) if (e.lineupSlotId !== IR) ent.push({ id: e.playerId, act: e.playerPoolEntry.appliedStatTotal || 0 });
      }
      const ids = [...new Set(ent.map((e) => e.id))], logs = {};
      for (let i = 0; i < ids.length; i += 50) {
        const card = await get(`${LEAGUE}?view=kona_playercard`, { players: { filterIds: { value: ids.slice(i, i + 50) }, filterStatsForTopScoringPeriodIds: { value: 40, additionalValue: ["00" + SEASON] } } });
        for (const pl of card.players || []) logs[pl.player.id] = (pl.player.stats || []).filter((s) => s.statSplitTypeId === 5 && s.statSourceId === 0 && s.seasonId === SEASON && s.stats && s.stats["40"] != null);
      }
      const all = [...D.teams.flatMap((t) => D.rosters[t.id]), ...D.fas, ...Object.values(EXTRA)], byId = new Map(all.map((x) => [x.id, x]));
      const out = [];
      for (const e of ent) {
        const x0 = byId.get(e.id), L = logs[e.id]; if (!x0 || !L) continue;
        const day = L.find((s) => s.scoringPeriodId === p), teamGame = x0.games && x0.games.has(p);
        if (!day && !teamGame) continue; // 那天沒比賽
        const before = L.filter((s) => s.scoringPeriodId < p && s.stats["40"] > 0); if (!before.length) continue;
        const avg = (A, f) => A.reduce((t, s) => t + f(s), 0) / A.length, pts = (s) => s.appliedTotal || 0, min = (s) => s.stats["40"];
        const l15 = before.filter((s) => s.scoringPeriodId >= p - 15), l7 = before.filter((s) => s.scoringPeriodId >= p - 7);
        const a = avg(before, pts), last15 = l15.length ? avg(l15, pts) : null;
        const x = Object.assign(Object.create(x0), { avg: a, last15, proj: last15 != null ? (a + last15) / 2 : a, gp: before.length, min: avg(before, min), min7: l7.length ? avg(l7, min) : null });
        if (!(x.proj > 0)) continue;
        const tp = trueProj(x); if (!tp) continue;
        const act = day && day.stats["40"] > 0 ? Math.round(pts(day) * 10) / 10 : "dnp";
        out.push([p, x.id, x.name, Math.round(x.proj * 10) / 10, Math.round(tp.mix * 10) / 10, Math.round(tp.w * 100) / 100, act, x.gp, "bf"]);
      }
      return out;
    }, p);
    log.rows.push(...rows);
    console.log(`${p}：補上 ${rows.length} 筆（上場 ${rows.filter((r) => typeof r[6] === "number").length} 筆）`);
  }
  await browser.close();
  log.rows.sort((a, b) => a[0] - b[0]);
  log.updated = new Date().toISOString();
  log.summary = summarize(log.rows);
  console.log("目前結果：", JSON.stringify(log.summary));
  fs.writeFileSync(FILE, JSON.stringify(log)); console.log("已寫入", FILE);
})().catch((e) => { console.error(e); process.exit(1); });
