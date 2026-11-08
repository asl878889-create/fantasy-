// 下載球員進階數據，整理成 docs/adv.json 給網頁用。
// 優先直接抓源頭 pbpstats.com（比較即時，蘇人 NBA 也是從這裡抓）；抓不到才改抓「蘇人 NBA」(surennba.com)。
// 網站沒開 CORS，網頁不能直接抓，所以由這支程式定時抓、存進 repo。兩邊都抓不到就不更新（網頁自動略過進階區塊）。
//   node fantasy_report/fetch_adv.js
const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path");
const SEASON = process.argv[2] || "2026-27", PREV = "2025-26";
const curl = (url, t = 60) => JSON.parse(execFileSync("curl", ["-sS", "--max-time", String(t), "-A", "Mozilla/5.0", "-f", url], { maxBuffer: 80e6 }).toString());
const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const round = (v, d) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

// 聯盟基準（球隊平均、場均 20 分鐘以上球員的平均），兩個來源共用
function finish(players, teams, generated, source) {
  const base = Object.values(players).filter((p) => p.min >= 20 && p.ts != null && p.usg != null); // 太少上場時間的人命中率不穩，不算進去
  const avg = (k) => round(base.reduce((s, p) => s + p[k], 0) / base.length, 1);
  const tv = Object.values(teams), tavg = (k) => round(tv.reduce((s, t) => s + t[k], 0) / tv.length, 1);
  const lgOpp = Object.fromEntries(["pts", "reb", "ast", "stl", "blk", "tov"].map((k) => [k, round(tv.reduce((s, t) => s + (t.opp[k] || 0), 0) / tv.length, 2)]));
  return { generated, teams, lgTeam: { opp: lgOpp, off: tavg("off"), def: tavg("def"), pace: tavg("pace") }, season: SEASON, source,
    lg: { ts: avg("ts"), usg: avg("usg"), efg: avg("efg"), p100: avg("p100"), n: base.length }, players };
}

// 源頭 pbpstats：算法和蘇人一樣（每百回合得分、助攻＝÷進攻回合×100；籃板＝÷攻守回合合計×100）
function fromPbp() {
  const pbp = (type, season = SEASON) => curl(`https://api.pbpstats.com/get-totals/nba?Season=${season}&SeasonType=Regular%20Season&Type=${type}`, 120).multi_row_table_data;
  const cur = pbp("Player"), tm = pbp("Team"), opp = pbp("Opponent");
  const ly = {}; // 去年的真實命中率、場均分鐘（抓不到就略過，網頁會改用聯盟平均當基準）
  try { for (const p of pbp("Player", PREV)) if (p.GamesPlayed) ly[p.EntityId] = { ts0: round(p.TsPct * 100, 1), min0: round(p.Minutes / p.GamesPlayed, 1), gp0: p.GamesPlayed }; }
  catch (e) { console.error("去年的進階數據抓不到，略過：", e.message); }
  const players = {};
  for (const p of cur) {
    const g = p.GamesPlayed; if (!g) continue;
    const l = ly[p.EntityId] || {}, op = p.OffPoss || 0, tp = op + (p.DefPoss || 0);
    players[norm(p.Name)] = { n: p.Name, t: p.TeamAbbreviation, gp: g, min: round(p.Minutes / g, 1), pts: round((p.Points || 0) / g, 1),
      usg: round(p.Usage, 1), sq: round(p.ShotQualityAvg, 3), ts: round(p.TsPct * 100, 1), efg: round(p.EfgPct * 100, 1),
      ts0: l.ts0 ?? null, min0: l.min0 ?? null, gp0: l.gp0 ?? null, rim: round((p.AtRimFrequency || 0) * 100, 0), three: round((p.FG3APct || 0) * 100, 0),
      p100: op ? round(((p.Points || 0) / op) * 100, 1) : null, a100: op ? round(((p.Assists || 0) / op) * 100, 1) : null, r100: tp ? round(((p.Rebounds || 0) / tp) * 100, 1) : null };
  }
  const O = Object.fromEntries(opp.map((o) => [o.TeamAbbreviation || o.Name, o]));
  const teams = Object.fromEntries(tm.map((t) => {
    const o = O[t.TeamAbbreviation] || {}, og = o.GamesPlayed, per = (k) => (og ? round((o[k] || 0) / og, 2) : null);
    return [t.TeamAbbreviation, { g: t.GamesPlayed, off: round((t.Points / t.OffPoss) * 100, 1), def: round((t.OpponentPoints / t.DefPoss) * 100, 1), pace: round(t.Pace, 1),
      opp: { pts: per("Points"), reb: per("Rebounds"), ast: per("Assists"), stl: per("Steals"), blk: per("Blocks"), tov: per("Turnovers") } }];
  }));
  if (Object.keys(players).length < 100 || Object.keys(teams).length < 30) throw new Error(`資料不完整（${Object.keys(players).length} 位球員、${Object.keys(teams).length} 隊）`);
  return finish(players, teams, new Date().toISOString(), "pbpstats.com");
}

// 備用：蘇人 NBA
function fromSuren() {
  const BASE = "https://www.surennba.com/NBA/data/player/player-stats-";
  const get = (kind, season = SEASON) => curl(`${BASE}${season}-${kind}.json`);
  const [pg, adv, shoot, p100] = ["per-game", "advanced", "shooting", "per-100"].map((k) => get(k));
  const ly = {};
  try {
    const lsh = Object.fromEntries(get("shooting", PREV).players.map((p) => [p.player_id, p])), lpg = get("per-game", PREV).players;
    for (const p of lpg) { const sh = lsh[p.player_id]; if (sh) ly[p.player_id] = { ts0: round(sh.stats.true_shooting_pct * 100, 1), min0: round(p.stats.minutes, 1), gp0: p.stats.minutes ? Math.round(p.minutes_total / p.stats.minutes) : null }; }
  } catch (e) { console.error("去年的進階數據抓不到，略過：", e.message); }
  const by = (d) => Object.fromEntries(d.players.map((p) => [p.player_id, p]));
  const A = by(adv), S = by(shoot), H = by(p100);
  const players = {};
  for (const p of pg.players) {
    const a = (A[p.player_id] || {}).stats || {}, s = (S[p.player_id] || {}).stats || {}, h = (H[p.player_id] || {}).stats || {}, l = ly[p.player_id] || {};
    players[norm(p.player_name)] = { n: p.player_name, t: p.team_abbreviation, gp: p.stats.minutes ? Math.round(p.minutes_total / p.stats.minutes) : null, min: round(p.stats.minutes, 1), pts: round(p.stats.points, 1),
      usg: round(a.usage, 1), sq: round(a.shot_quality, 3), ts: round(s.true_shooting_pct * 100, 1), efg: round(s.effective_field_goal_pct * 100, 1),
      ts0: l.ts0 ?? null, min0: l.min0 ?? null, gp0: l.gp0 ?? null, rim: round(a.at_rim_frequency * 100, 0), three: round(a.three_point_attempt_share * 100, 0), p100: round(h.points, 1), a100: round(h.assists, 1), r100: round(h.rebounds, 1) };
  }
  const tm = curl(`https://www.surennba.com/NBA/data/teams/${SEASON}-regular.json`);
  const pgOpp = (t, k) => { const o = t.stats && t.stats.opponent && t.stats.opponent.raw; return o && o.gamesplayed ? round(o[k] / o.gamesplayed, 2) : null; };
  const teams = Object.fromEntries(tm.teams.map((t) => [t.abbr, { g: t.games, off: round(t.off_rating, 1), def: round(t.def_rating, 1), pace: round(t.pace, 1),
    opp: { pts: pgOpp(t, "points"), reb: pgOpp(t, "rebounds"), ast: pgOpp(t, "assists"), stl: pgOpp(t, "steals"), blk: pgOpp(t, "blocks"), tov: pgOpp(t, "turnovers") } }]));
  return finish(players, teams, adv.meta.generated_at, "surennba.com");
}

(async () => {
  let out;
  try { out = fromPbp(); } catch (e) { console.error("pbpstats 抓不到，改抓蘇人 NBA：", e.message); out = fromSuren(); }
  const file = path.resolve(__dirname, "../docs/adv.json");
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`已寫入 ${file}（來源 ${out.source}）：${Object.keys(out.players).length} 位球員，聯盟平均 TS ${out.lg.ts}% 使用率 ${out.lg.usg}%`);
})().catch((e) => { console.error("抓不到進階數據：", e.message); process.exit(1); });
