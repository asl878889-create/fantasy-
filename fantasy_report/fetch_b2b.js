// 背靠背第二場會下滑多少：抓 ESPN 公開的球員比賽紀錄（去年整季＋今年），算每位球員背靠背第二場跟平常的差，存成 docs/b2b.json。
// 每人背靠背場次不多，所以用「縮小估計」：場次少的人往全聯盟平均靠，場次越多越相信他自己。
//   node fantasy_report/fetch_b2b.js
const { execFile } = require("child_process");
const fs = require("fs"), path = require("path");
const LEAGUE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2027/segments/0/leagues/406470928";
const curl = (url, filter) => new Promise((res, rej) => execFile("curl", ["-sS", "--max-time", "60", "-f", "-A", "Mozilla/5.0", ...(filter ? ["-H", "X-Fantasy-Filter: " + JSON.stringify(filter)] : []), url], { maxBuffer: 64 * 1024 * 1024 }, (e, out) => (e ? rej(e) : res(JSON.parse(out)))));
const SEASONS = [2026, 2027];
// 這個聯盟的計分（比賽紀錄沒有進攻籃板，少算那一項；勝場 +2 有算）
const fpts = (s, win) => s.pts + s.reb + 2 * s.ast + 4 * s.stl + 4 * s.blk - 2 * s.to - s.pf + 2 * s.fgm - s.fga + s.ftm - s.fta + 2 * s.tpm - s.tpa + (win ? 2 : 0);
let YR = 0;
function parse(d) {
  const out = [], names = d.names || [], ix = (n) => names.indexOf(n);
  for (const st of d.seasonTypes || []) {
    if (!/Regular Season/.test(st.displayName)) continue;
    for (const c of st.categories || []) for (const e of c.events || []) {
      const ev = (d.events || {})[e.eventId]; if (!ev) continue;
      const v = e.stats, two = (k) => String(v[ix(k)] || "0-0").split("-").map(Number);
      const [fgm, fga] = two("fieldGoalsMade-fieldGoalsAttempted"), [tpm, tpa] = two("threePointFieldGoalsMade-threePointFieldGoalsAttempted"), [ftm, fta] = two("freeThrowsMade-freeThrowsAttempted");
      const s = { min: Number(v[ix("minutes")]) || 0, pts: Number(v[ix("points")]) || 0, reb: Number(v[ix("totalRebounds")]) || 0, ast: Number(v[ix("assists")]) || 0, stl: Number(v[ix("steals")]) || 0, blk: Number(v[ix("blocks")]) || 0, to: Number(v[ix("turnovers")]) || 0, pf: Number(v[ix("fouls")]) || 0, fgm, fga, tpm, tpa, ftm, fta };
      out.push({ day: Math.round(Date.parse(ev.gameDate.slice(0, 10)) / 86400000), s, f: fpts(s, ev.gameResult === "W"), y: YR });
    }
  }
  return out;
}
(async () => {
  const ros = await curl(`${LEAGUE}?view=mRoster`);
  const ids = new Map();
  for (const t of ros.teams) for (const e of t.roster.entries) ids.set(e.playerId, e.playerPoolEntry.player.fullName);
  const fa = await curl(`${LEAGUE}?view=kona_player_info`, { players: { filterStatus: { value: ["FREEAGENT", "WAIVERS"] }, limit: 150, sortPercOwned: { sortPriority: 1, sortAsc: false } } });
  for (const x of fa.players) ids.set(x.player.id, x.player.fullName);
  const list = [...ids], per = {};
  for (let i = 0; i < list.length; i += 8) {
    await Promise.all(list.slice(i, i + 8).map(async ([id, name]) => {
      const games = [];
      for (const y of SEASONS) { try { const raw = await curl(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${id}/gamelog?season=${y}`); YR = y; games.push(...parse(raw)); } catch (e) { /* 這一季沒資料 */ } }
      const g = games.filter((z) => z.s.min >= 10).sort((a, b) => a.day - b.day), days = new Set(g.map((z) => z.day));
      // 同一季裡比：每場分數除以「他那一季不是背靠背第二場的平均」，避免把換隊、角色變化算成背靠背的影響
      const rs = [], mins = [];
      for (const y of SEASONS) {
        const gy = g.filter((z) => z.y === y), oth = gy.filter((z) => !days.has(z.day - 1)); if (oth.length < 5) continue;
        const mo = oth.reduce((a, z) => a + z.f, 0) / oth.length, mino = oth.reduce((a, z) => a + z.s.min, 0) / oth.length; if (mo < 10) continue;
        for (const z of gy.filter((z) => days.has(z.day - 1))) { rs.push(z.f / mo - 1); mins.push(z.s.min - mino); }
      }
      if (rs.length) { const m = rs.reduce((a, b) => a + b, 0) / rs.length, v = rs.length > 1 ? rs.reduce((a, b) => a + (b - m) ** 2, 0) / (rs.length - 1) : 0.12;
        per[id] = { n: name, b: rs.length, obs: m, se2: Math.max(v, 0.09) / rs.length, dmin: mins.reduce((a, b) => a + b, 0) / mins.length }; }
    }));
  }
  const P = Object.values(per);
  // 全聯盟平均（場次加權）；個人用「經驗貝氏」縮小：自己的樣本誤差越大，越往聯盟平均靠
  const W = P.reduce((a, p) => a + p.b, 0), lg = P.reduce((a, p) => a + p.b * p.obs, 0) / W, lgMin = P.reduce((a, p) => a + p.b * p.dmin, 0) / W;
  const big = P.filter((p) => p.b >= 5), tau2 = Math.max(0.0004, big.reduce((a, p) => a + (p.obs - lg) ** 2, 0) / big.length - big.reduce((a, p) => a + p.se2, 0) / big.length);
  const players = {};
  for (const [id, p] of Object.entries(per)) {
    const w = tau2 / (tau2 + p.se2), adj = lg + w * (p.obs - lg);
    players[id] = { n: p.n, b: p.b, obs: Math.round(p.obs * 1000) / 10, adj: Math.round(adj * 1000) / 10, w: Math.round(w * 100) / 100, dmin: Math.round(p.dmin * 10) / 10 };
  }
  const file = path.resolve(__dirname, "../docs/b2b.json");
  fs.writeFileSync(file, JSON.stringify({ generated: new Date().toISOString(), seasons: SEASONS, tau: Math.round(Math.sqrt(tau2) * 1000) / 10, league: { pct: Math.round(lg * 1000) / 10, dmin: Math.round(lgMin * 10) / 10, games: W, players: P.length }, players }));
  console.log(`已寫入 ${file}：${Object.keys(players).length} 位球員，背靠背第二場共 ${W} 場；全聯盟平均 ${(lg * 100).toFixed(1)}%、上場時間 ${lgMin.toFixed(1)} 分鐘`);
})().catch((e) => { console.error("抓不到比賽紀錄：", e.message); process.exit(1); });
