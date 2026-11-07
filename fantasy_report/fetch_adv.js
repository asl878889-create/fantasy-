// 下載「蘇人 NBA」(surennba.com) 的球員進階數據，整理成 docs/adv.json 給網頁用。
// 網站沒開 CORS，網頁不能直接抓，所以由這支程式每天抓一次、存進 repo。抓不到就不更新（網頁自動略過進階區塊）。
//   node fantasy_report/fetch_adv.js
const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path");
const BASE = "https://www.surennba.com/NBA/data/player/player-stats-";
const get = (kind) => { const out = execFileSync("curl", ["-sS", "--max-time", "60", "-A", "Mozilla/5.0", "-f", `${BASE}${process.argv[2] || "2026-27"}-${kind}.json`], { maxBuffer: 50e6 }).toString(); return JSON.parse(out); };
const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const round = (v, d) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
(async () => {
  const [pg, adv, shoot, p100] = ["per-game", "advanced", "shooting", "per-100"].map(get);
  const by = (d) => Object.fromEntries(d.players.map((p) => [p.player_id, p]));
  const A = by(adv), S = by(shoot), H = by(p100);
  const players = {};
  for (const p of pg.players) {
    const a = (A[p.player_id] || {}).stats || {}, s = (S[p.player_id] || {}).stats || {}, h = (H[p.player_id] || {}).stats || {};
    players[norm(p.player_name)] = { n: p.player_name, t: p.team_abbreviation, gp: p.stats.minutes ? Math.round(p.minutes_total / p.stats.minutes) : null, min: round(p.stats.minutes, 1), pts: round(p.stats.points, 1),
      usg: round(a.usage, 1), sq: round(a.shot_quality, 3), ts: round(s.true_shooting_pct * 100, 1), efg: round(s.effective_field_goal_pct * 100, 1),
      rim: round(a.at_rim_frequency * 100, 0), three: round(a.three_point_attempt_share * 100, 0), p100: round(h.points, 1), a100: round(h.assists, 1), r100: round(h.rebounds, 1) };
  }
  // 聯盟平均：場均 20 分鐘以上的球員（太少上場時間的人命中率不穩，不算進去）
  const base = Object.values(players).filter((p) => p.min >= 20 && p.ts != null && p.usg != null);
  const avg = (k) => round(base.reduce((s, p) => s + p[k], 0) / base.length, 1);
  // 球隊數據（防守評分、進攻評分、節奏）：網頁用來估「這個球員對上這支球隊」的表現
  const tm = JSON.parse(execFileSync("curl", ["-sS", "--max-time", "60", "-A", "Mozilla/5.0", "-f", `https://www.surennba.com/NBA/data/teams/${process.argv[2] || "2026-27"}-regular.json`], { maxBuffer: 50e6 }).toString());
  const teams = Object.fromEntries(tm.teams.map((t) => [t.abbr, { g: t.games, off: round(t.off_rating, 1), def: round(t.def_rating, 1), pace: round(t.pace, 1) }]));
  const tv = Object.values(teams), lgTeam = { off: round(tv.reduce((s, t) => s + t.off, 0) / tv.length, 1), def: round(tv.reduce((s, t) => s + t.def, 0) / tv.length, 1), pace: round(tv.reduce((s, t) => s + t.pace, 0) / tv.length, 1) };
  const out = { generated: adv.meta.generated_at, teams, lgTeam, season: adv.meta.season, source: "surennba.com", lg: { ts: avg("ts"), usg: avg("usg"), efg: avg("efg"), p100: avg("p100"), n: base.length }, players };
  const file = path.resolve(__dirname, "../docs/adv.json");
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`已寫入 ${file}：${Object.keys(players).length} 位球員，聯盟平均 TS ${out.lg.ts}% 使用率 ${out.lg.usg}%`);
})().catch((e) => { console.error("抓不到進階數據：", e.message); process.exit(1); });
