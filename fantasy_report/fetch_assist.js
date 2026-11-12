// 助攻關係：每位球員「最常助攻誰」「最常被誰助攻」，用 pbpstats 的助攻網路（每隊一次），存成 docs/assist.json 給網頁用
// 每一組還記「兩人都有上場的比賽有幾場」（用每位球員的逐場紀錄），網頁才能算「兩人同場時」的場均助攻
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
  const mm = (m) => { if (typeof m === "number") return m; const [a, b] = String(m || "0:0").split(":").map(Number); return (a || 0) + (b || 0) / 60; };
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
  const top = (L) => (L || []).filter((x) => x.a >= MIN).sort((a, b) => b.a - a.a || b.p - a.p).slice(0, TOP);
  const sum = (L) => (L || []).reduce((s, x) => s + x.a, 0);
  // 需要逐場紀錄的人：自己加上列在前 3 名裡的對象（大部分的人）；每次同時抓 4 位
  const picked = {}, need = new Set();
  for (const p of Object.values(info)) {
    const g = give[p.k], t = take[p.k]; if (!g && !t) continue;
    picked[p.k] = { p, give: top(g), take: top(t), gn: sum(g), tn: sum(t) };
    need.add(p.k); for (const x of [...picked[p.k].give, ...picked[p.k].take]) need.add(x.k);
  }
  const byK = Object.fromEntries(all.map((p) => [norm(p.Name), p])), games = {};
  // fetch_pbplog.js 已經抓過一批人的逐場紀錄（上場分鐘大於 0 的比賽），直接拿來用，只有沒抓過的才另外抓（省下大半時間）
  try {
    const L = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../docs/pbplog.json"), "utf8"));
    for (const [k, v] of Object.entries(L.players || {})) if (need.has(k) && v.g.length && v.g[0].gid) games[k] = new Set(v.g.filter((r) => r.min > 0).map((r) => r.gid));
    for (const list of Object.values(L.stars || {})) for (const st of list) { const k = norm(st.n); if (need.has(k) && !games[k]) games[k] = new Set(st.g); }
  } catch (e) { console.error("pbplog.json 讀不到，全部另外抓：", e.message); }
  const queue = [...need].filter((k) => byK[k] && !games[k]);
  console.log(`逐場紀錄：已有 ${Object.keys(games).length} 位，另外抓 ${queue.length} 位`);
  const worker = async () => { for (let k; (k = queue.shift());) {
    try { const rows = (await get(`${API}/get-game-logs/nba?${Q}&EntityId=${byK[k].EntityId}&EntityType=Player`)).multi_row_table_data || [];
      games[k] = new Set(rows.filter((r) => mm(r.Minutes) > 0).map((r) => r.GameId)); }
    catch (e) { fail++; console.error(`${k} 逐場抓不到，略過：`, e.message); }
    await sleep(400); } };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const together = (a, b) => { const A = games[a], B = games[b]; if (!A || !B) return null; let n = 0; for (const g of A) if (B.has(g)) n++; return n; };
  const players = {};
  for (const [k, v] of Object.entries(picked)) {
    const row = (x) => [x.n, x.a, together(k, x.k)]; // [名字, 助攻次數, 兩人同場的比賽數]
    players[k] = { n: v.p.n, t: v.p.t, gp: games[k] ? games[k].size : null, give: v.give.map(row), gn: v.gn, take: v.take.map(row), tn: v.tn };
  }
  const file = path.resolve(__dirname, "../docs/assist.json");
  fs.writeFileSync(file, JSON.stringify({ generated: new Date().toISOString(), season: SEASON, min: MIN, players }));
  console.log(`已寫入 ${file}：${Object.keys(players).length} 位球員（${teams.length} 隊、失敗 ${fail} 隊）`);
})().catch((e) => { console.error("抓不到助攻關係：", e.message); process.exit(1); });
