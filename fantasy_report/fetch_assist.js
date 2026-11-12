// 助攻關係：每位球員「最常助攻誰」「最常被誰助攻」，用 pbpstats 的助攻網路（每隊一次），存成 docs/assist.json 給網頁用
//   node fantasy_report/fetch_assist.js
const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path");
const SEASON = process.argv[2] || "2026-27", API = "https://api.pbpstats.com", Q = `Season=${SEASON}&SeasonType=Regular%20Season`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const curl = (url) => JSON.parse(execFileSync("curl", ["-sS", "--max-time", "120", "-A", "Mozilla/5.0", "-f", url], { maxBuffer: 80e6 }).toString());
const get = async (url) => { for (let i = 0; i < 4; i++) { try { return curl(url); } catch (e) { if (i === 3) throw e; await sleep(15000 * (i + 1)); } } };
const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const TOP = 3, MIN = 2; // 每人各列前 3 位；至少 2 次助攻才算（1 次太偶然）

(async () => {
  const all = (await get(`${API}/get-totals/nba?${Q}&Type=Player`)).multi_row_table_data.filter((p) => p.GamesPlayed);
  const info = Object.fromEntries(all.map((p) => [p.EntityId, { n: p.Name, t: p.TeamAbbreviation, k: norm(p.Name) }]));
  const teams = [...new Set(all.map((p) => p.TeamId))];
  const give = {}, take = {}; let fail = 0;
  for (const tid of teams) {
    try {
      const d = await get(`${API}/get-assist-networks/nba?${Q}&EntityType=Team&EntityId=${tid}`);
      for (const l of (d.results && d.results.links) || (d.results || {}).links || []) {
        const s = info[l.source], t = info[l.target]; if (!s || !t) continue;
        (give[s.k] = give[s.k] || []).push({ k: t.k, n: t.n, a: l.value, p: l.AssistPts || 0 });
        (take[t.k] = take[t.k] || []).push({ k: s.k, n: s.n, a: l.value, p: l.AssistPts || 0 });
      }
    } catch (e) { fail++; console.error(`球隊 ${tid} 抓不到，略過：`, e.message); }
    await sleep(700);
  }
  const top = (L) => (L || []).filter((x) => x.a >= MIN).sort((a, b) => b.a - a.a || b.p - a.p).slice(0, TOP).map((x) => [x.n, x.a, x.p]);
  const sum = (L) => (L || []).reduce((s, x) => s + x.a, 0);
  const players = {};
  for (const p of Object.values(info)) {
    const g = give[p.k], t = take[p.k]; if (!g && !t) continue;
    players[p.k] = { n: p.n, t: p.t, give: top(g), gn: sum(g), take: top(t), tn: sum(t) };
  }
  const file = path.resolve(__dirname, "../docs/assist.json");
  fs.writeFileSync(file, JSON.stringify({ generated: new Date().toISOString(), season: SEASON, min: MIN, players }));
  console.log(`已寫入 ${file}：${Object.keys(players).length} 位球員（${teams.length} 隊、失敗 ${fail} 隊）`);
})().catch((e) => { console.error("抓不到助攻關係：", e.message); process.exit(1); });
