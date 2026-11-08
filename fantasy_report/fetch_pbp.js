// pbpstats 額外數據（蘇人沒有的），存成 docs/pbp.json 給網頁用：
//   1. 近 7 天每位球員的球權、命中率、出手區域、每 36 分鐘 fantasy 分數（跟整季比，看變化是不是真的）
//   2. 近 7 天每隊的節奏和攻守效率（估今天比賽打得快不快）
//   3. 每隊近 14 天最常用的五人陣容（跟整季比，看誰新進主要陣容）
//   4. 整季細項：被助攻比例、補籃得分、活球失誤、犯規和造犯規、在場時球隊淨效率
//   node fantasy_report/fetch_pbp.js
const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path");
const SEASON = process.argv[2] || "2026-27", API = "https://api.pbpstats.com", Q = `Season=${SEASON}&SeasonType=Regular%20Season`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const curl = (url) => JSON.parse(execFileSync("curl", ["-sS", "--max-time", "120", "-A", "Mozilla/5.0", "-f", url], { maxBuffer: 80e6 }).toString());
const get = async (url) => { for (let i = 0; i < 4; i++) { try { return curl(url).multi_row_table_data; } catch (e) { if (i === 3) throw e; await sleep(15000 * (i + 1)); } } };
const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const round = (v, d = 1) => (v == null || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const pct = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 100));
const day = (n) => new Date(Date.now() - n * 86400000 - 8 * 3600000).toISOString().slice(0, 10); // 美國日期（比台灣慢）
// 聯盟計分（同 fetch_wowy.js）
function fp(p) {
  const g = (k) => Number(p[k]) || 0, fgm = g("FG2M") + g("FG3M"), fga = g("FG2A") + g("FG3A");
  return g("Points") + g("Rebounds") + g("OffRebounds") + 2 * g("Assists") + 4 * g("Steals") + 4 * g("Blocks") - 2 * g("Turnovers") - g("Fouls")
    + 2 * fgm - fga + g("FtPoints") - g("FTA") + 2 * g("FG3M") - g("FG3A");
}
const side = (p) => ({ gp: p.GamesPlayed, min: round(p.Minutes / p.GamesPlayed), usg: round(p.Usage), ts: pct(p.TsPct), rim: pct(p.AtRimFrequency), mid: pct((p.ShortMidRangeFrequency || 0) + (p.LongMidRangeFrequency || 0)),
  three: pct(p.FG3APct), fp36: p.Minutes ? round((fp(p) / p.Minutes) * 36) : null });

(async () => {
  const to = day(0), f7 = day(7), f14 = day(14);
  const all = await get(`${API}/get-totals/nba?${Q}&Type=Player`);
  const rec = await get(`${API}/get-totals/nba?${Q}&Type=Player&FromDate=${f7}&ToDate=${to}`);
  const R = Object.fromEntries(rec.filter((p) => p.GamesPlayed).map((p) => [p.EntityId, p]));
  const players = {};
  for (const p of all) {
    if (!p.GamesPlayed) continue;
    const m = p.Minutes || 0, r = R[p.EntityId];
    players[norm(p.Name)] = { n: p.Name, t: p.TeamAbbreviation, s: side(p), r: r ? side(r) : null,
      d: { ast2: pct(p.Assisted2sPct), ast3: pct(p.Assisted3sPct), putback: round((p.PtsPutbacks || 0) / p.GamesPlayed), lbto: round((p.LiveBallTurnovers || 0) / p.GamesPlayed),
        pf36: m ? round(((p.Fouls || 0) / m) * 36) : null, fd36: m ? round(((p.FoulsDrawn || 0) / m) * 36) : null,
        net: p.OnOffRtg != null && p.OnDefRtg != null ? round(p.OnOffRtg - p.OnDefRtg) : null, pm: round((p.PlusMinus || 0) / p.GamesPlayed) } };
  }
  const tAll = await get(`${API}/get-totals/nba?${Q}&Type=Team`), tRec = await get(`${API}/get-totals/nba?${Q}&Type=Team&FromDate=${f7}&ToDate=${to}`);
  const tside = (t) => ({ g: t.GamesPlayed, pace: round(t.Pace), off: round((t.Points / t.OffPoss) * 100), def: round((t.OpponentPoints / t.DefPoss) * 100) });
  const TR = Object.fromEntries(tRec.map((t) => [t.TeamAbbreviation, t]));
  const teams = Object.fromEntries(tAll.map((t) => [t.TeamAbbreviation, { s: tside(t), r: TR[t.TeamAbbreviation] ? tside(TR[t.TeamAbbreviation]) : null }]));
  const tid = {}; for (const p of all) tid[p.TeamAbbreviation] = p.TeamId;
  const lineups = {};
  for (const [abbr, id] of Object.entries(tid)) {
    const season = await get(`${API}/get-totals/nba?${Q}&Type=Lineup&TeamId=${id}`); await sleep(700);
    const recent = await get(`${API}/get-totals/nba?${Q}&Type=Lineup&TeamId=${id}&FromDate=${f14}&ToDate=${to}`); await sleep(700);
    const S = Object.fromEntries(season.map((l) => [l.EntityId, l])), mins = (l) => Math.round((l.SecondsPlayed || 0) / 60);
    const top = (L) => [...L].sort((a, b) => (b.SecondsPlayed || 0) - (a.SecondsPlayed || 0));
    const rows = (L, other) => top(L).slice(0, 3).map((l) => ({ ids: l.EntityId.split("-"), n: (l.ShortName || l.Name).split(", "), min: mins(l),
      net: l.OffPoss && l.DefPoss ? round(((l.Points || 0) / l.OffPoss - (l.OpponentPoints || 0) / l.DefPoss) * 100) : null, other: other[l.EntityId] ? mins(other[l.EntityId]) : 0 }));
    const RC = Object.fromEntries(recent.map((l) => [l.EntityId, l]));
    lineups[abbr] = { recent: rows(recent, S), season: rows(season, RC) }; // recent 的 other＝整季分鐘；season 的 other＝近 14 天分鐘
    process.stdout.write(`${abbr} `);
  }
  // 名字對照：pbpstats 用 NBA 的球員 ID，網頁用名字比對
  const ids = Object.fromEntries(all.map((p) => [p.EntityId, norm(p.Name)]));
  const file = path.resolve(__dirname, "../docs/pbp.json");
  fs.writeFileSync(file, JSON.stringify({ generated: new Date().toISOString(), season: SEASON, from7: f7, from14: f14, to, players, teams, lineups, ids }));
  console.log(`\n已寫入 ${file}：${Object.keys(players).length} 位球員（近 7 天有上場 ${Object.keys(R).length} 位）、${Object.keys(teams).length} 隊`);
})().catch((e) => { console.error("抓不到 pbpstats：", e.message); process.exit(1); });
