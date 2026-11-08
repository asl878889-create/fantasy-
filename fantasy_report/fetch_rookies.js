// 新秀觀察：抓 NBA 30 隊名單裡今年第一年的球員（ESPN experience = 0），加上選秀順位、
// 本季 fantasy 平均、近 5 場、上場時間、先發比例、持有率、在聯盟哪一隊，存成 docs/rookies.json
//   node fantasy_report/fetch_rookies.js
const { execFile } = require("child_process");
const fs = require("fs"), path = require("path");
const LEAGUE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2027/segments/0/leagues/406470928";
const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const curl = (url, filter) => new Promise((res, rej) => execFile("curl", ["-sS", "--max-time", "90", "-f", ...(filter ? ["-H", "X-Fantasy-Filter: " + JSON.stringify(filter)] : []), url], { maxBuffer: 256 * 1024 * 1024 }, (e, out) => (e ? rej(e) : res(JSON.parse(out)))));
const rd = (x, k = 1) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** k) / 10 ** k);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

(async () => {
  const teams = (await curl(`${SITE}/teams`)).sports[0].leagues[0].teams.map((t) => t.team);
  const rk = {};
  for (const t of teams) {
    const r = await curl(`${SITE}/teams/${t.id}/roster`).catch(() => null);
    for (const a of (r && r.athletes) || []) if (a.experience && a.experience.years === 0) rk[a.id] = { n: a.fullName.replace(/ Jr\.$/, " Jr"), tm: t.abbreviation, pos: (a.position || {}).abbreviation || "", age: a.age || null };
  }
  const ids = Object.keys(rk);
  for (let i = 0; i < ids.length; i += 8) { // 選秀順位（「2026: Rd 1, Pk 8 (ATL)」）
    await Promise.all(ids.slice(i, i + 8).map(async (id) => {
      const d = await curl(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${id}`).catch(() => null);
      const m = d && d.athlete && /Rd (\d+), Pk (\d+)/.exec(d.athlete.displayDraft || "");
      rk[id].pick = m ? Number(m[2]) : null; // 總順位（ESPN 的 Pk 已經是總順位）；落選＝null
    }));
  }
  const num = ids.map(Number);
  for (let i = 0; i < num.length; i += 40) {
    const part = num.slice(i, i + 40);
    const info = await curl(`${LEAGUE}?view=kona_player_info`, { players: { filterIds: { value: part } } });
    for (const x of info.players || []) {
      const o = rk[x.player.id]; if (!o) continue;
      o.own = rd((x.player.ownership || {}).percentOwned, 1); o.team = x.onTeamId || 0; o.inj = x.player.injuryStatus && x.player.injuryStatus !== "ACTIVE" ? x.player.injuryStatus : "";
    }
    const card = await curl(`${LEAGUE}?view=kona_playercard`, { players: { filterIds: { value: part }, filterStatsForTopScoringPeriodIds: { value: 200, additionalValue: ["002027"] } } });
    for (const pp of card.players || []) {
      const pl = pp.player, o = rk[pl.id]; if (!o) continue;
      const gs = (pl.stats || []).filter((s) => s.statSplitTypeId === 5 && s.statSourceId === 0 && s.seasonId === 2027 && s.stats && Number(s.stats["40"]) > 0).sort((a, b) => a.scoringPeriodId - b.scoringPeriodId);
      const fp = gs.map((z) => z.appliedTotal || 0), mn = gs.map((z) => Number(z.stats["40"]) || 0), l5 = gs.slice(-5);
      Object.assign(o, { g: gs.length, avg: rd(mean(fp)), min: rd(mean(mn)), l5: rd(mean(l5.map((z) => z.appliedTotal || 0))), l5min: rd(mean(l5.map((z) => Number(z.stats["40"]) || 0))),
        gs: gs.filter((z) => Number(z.stats["41"]) > 0).length, best: fp.length ? rd(Math.max(...fp)) : null, log: fp.slice(-10).map((v) => Math.round(v)) });
    }
  }
  const players = {};
  for (const [id, o] of Object.entries(rk)) if (o.g || o.pick) players[id] = o; // 沒上場又是落選的就不列
  const file = path.resolve(__dirname, "../docs/rookies.json");
  fs.writeFileSync(file, JSON.stringify({ generated: new Date().toISOString(), players }));
  console.log(`已寫入 ${file}：${Object.keys(players).length} 位新秀（名單上共 ${ids.length} 位第一年球員）`);
})().catch((e) => { console.error("抓不到新秀資料：", e.message); process.exit(1); });
