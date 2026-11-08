// 主力缺陣時誰受惠：每隊挑 3 位主力（場均 fantasy 分數最高的人），用 pbpstats 的 WOWY（with or without you）
// 比較隊友在「主力在場」和「主力不在場」時的球權、每 36 分鐘 fantasy 分數，存成 docs/wowy.json
//   node fantasy_report/fetch_wowy.js
const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path");
const SEASON = process.argv[2] || "2026-27", STARS = 3, MIN_SPLIT = 50; // 每隊幾位主力、在場／不在場各至少幾分鐘才算
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const curl = (url) => JSON.parse(execFileSync("curl", ["-sS", "--max-time", "90", "-A", "Mozilla/5.0", "-f", url], { maxBuffer: 80e6 }).toString());
const API = "https://api.pbpstats.com";
const Q = `Season=${SEASON}&SeasonType=Regular%20Season`;
const round = (v, d = 1) => (v == null || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
// 聯盟計分（ESPN 設定）：得分 1、籃板 1、進攻籃板再 +1、助攻 2、抄截 4、阻攻 4、失誤 −2、犯規 −1、
// 命中 +2／出手 −1、罰進 +1／罰球 −1、三分進 +2／三分出手 −1（球隊贏球 +2、大四喜 +20 無法從合計算，略過）
function fp(p) {
  const g = (k) => Number(p[k]) || 0, fgm = g("FG2M") + g("FG3M"), fga = g("FG2A") + g("FG3A");
  return g("Points") + g("Rebounds") + g("OffRebounds") + 2 * g("Assists") + 4 * g("Steals") + 4 * g("Blocks") - 2 * g("Turnovers") - g("Fouls")
    + 2 * fgm - fga + g("FtPoints") - g("FTA") + 2 * g("FG3M") - g("FG3A");
}
const per36 = (p) => (p.Minutes > 0 ? (fp(p) / p.Minutes) * 36 : null);
const get = async (url) => { for (let i = 0; i < 4; i++) { try { return curl(url); } catch (e) { if (i === 3) throw e; await sleep(15000 * (i + 1)); } } };

(async () => {
  const all = (await get(`${API}/get-totals/nba?${Q}&Type=Player`)).multi_row_table_data.filter((p) => p.GamesPlayed);
  const byTeam = {};
  for (const p of all) (byTeam[p.TeamId] = byTeam[p.TeamId] || []).push(p);
  const teams = {};
  for (const [tid, ros] of Object.entries(byTeam)) {
    const abbr = ros[0].TeamAbbreviation;
    const stars = ros.filter((p) => p.GamesPlayed >= 3).sort((a, b) => fp(b) / b.GamesPlayed - fp(a) / a.GamesPlayed).slice(0, STARS);
    const out = [];
    for (const s of stars) {
      let on, off;
      try {
        on = (await get(`${API}/get-wowy-stats/nba?${Q}&TeamId=${tid}&Type=Player&0Exactly1OnFloor=${s.EntityId}`)).multi_row_table_data; await sleep(800);
        off = (await get(`${API}/get-wowy-stats/nba?${Q}&TeamId=${tid}&Type=Player&0Exactly0OnFloor=${s.EntityId}`)).multi_row_table_data; await sleep(800);
      } catch (e) { console.error(`\n${abbr} ${s.Name} 抓不到，略過：`, e.message); continue; }
      const ON = Object.fromEntries(on.filter((x) => x.EntityId).map((x) => [x.EntityId, x]));
      const rows = [];
      for (const b of off) {
        const a = ON[b.EntityId];
        if (!b.EntityId || b.EntityId === s.EntityId || !a || a.Minutes < MIN_SPLIT || b.Minutes < MIN_SPLIT) continue;
        const f0 = per36(a), f1 = per36(b);
        rows.push({ id: b.EntityId, n: b.Name, minOn: Math.round(a.Minutes), minOff: Math.round(b.Minutes), usgOn: round(a.Usage), usgOff: round(b.Usage), fpOn: round(f0), fpOff: round(f1), d: round(f1 - f0) });
      }
      rows.sort((x, y) => y.d - x.d);
      out.push({ id: s.EntityId, n: s.Name, gp: s.GamesPlayed, fpg: round(fp(s) / s.GamesPlayed), min: round(s.Minutes / s.GamesPlayed), usg: round(s.Usage), fp36: round(per36(s)), mates: rows });
    }
    teams[abbr] = out;
    process.stdout.write(`${abbr} `);
  }
  const file = path.resolve(__dirname, "../docs/wowy.json");
  fs.writeFileSync(file, JSON.stringify({ generated: new Date().toISOString(), season: SEASON, minSplit: MIN_SPLIT, teams }));
  console.log(`\n已寫入 ${file}：${Object.keys(teams).length} 隊、${Object.values(teams).reduce((s, t) => s + t.length, 0)} 位主力`);
})().catch((e) => { console.error("抓不到 WOWY：", e.message); process.exit(1); });
