// pbpstats 逐場紀錄：聯盟 10 隊陣容＋前 150 位自由球員，每場的上場時間、球權、真實命中率、出手區域、FPTS
// 給網頁的「單場為什麼高或低」說明用（例如「這場球權只有 18%，平常 26%」），存成 docs/pbplog.json
// 另外每場記犯規數、球隊比分差、是不是背靠背第二場（判斷上場時間少的原因），
// 和各隊主力（wowy.json 的那批）打了哪幾場（判斷「隊友缺陣才打得好」、主力復出提醒）
//   node fantasy_report/fetch_pbplog.js
const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path");
const SEASON = process.argv[2] || "2026-27", API = "https://api.pbpstats.com", Q = `Season=${SEASON}&SeasonType=Regular%20Season`;
const LEAGUE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2027/segments/0/leagues/406470928";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const curl = (url, filter) => JSON.parse(execFileSync("curl", ["-sS", "--max-time", "120", "-A", "Mozilla/5.0", "-f", ...(filter ? ["-H", "X-Fantasy-Filter: " + JSON.stringify(filter)] : []), url], { maxBuffer: 80e6 }).toString());
const get = async (url) => { for (let i = 0; i < 4; i++) { try { return curl(url); } catch (e) { if (i === 3) throw e; await sleep(15000 * (i + 1)); } } };
const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const alt = (s) => { const t = String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w && !["jr", "sr", "ii", "iii", "iv"].includes(w)); return t.length ? t[t.length - 1] + "_" + t[0][0] : ""; };
const round = (v, d = 1) => (v == null || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const pct = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 100));
const mmss = (m) => { if (typeof m === "number") return m; const [a, b] = String(m || "0:0").split(":").map(Number); return (a || 0) + (b || 0) / 60; };
function fp(p) { // 聯盟計分（同 fetch_wowy.js；球隊贏球 +2 另外算）
  const g = (k) => Number(p[k]) || 0, fgm = g("FG2M") + g("FG3M"), fga = g("FG2A") + g("FG3A");
  return g("Points") + g("Rebounds") + g("OffRebounds") + 2 * g("Assists") + 4 * g("Steals") + 4 * g("Blocks") - 2 * g("Turnovers") - g("Fouls")
    + 2 * fgm - fga + g("FtPoints") - g("FTA") + 2 * g("FG3M") - g("FG3A");
}

(async () => {
  // 要抓誰：聯盟陣容＋前 150 位自由球員（跟開竅名單同一批）
  const want = new Set();
  const ros = curl(`${LEAGUE}?view=mRoster`);
  for (const t of ros.teams) for (const e of t.roster.entries) want.add(e.playerPoolEntry.player.fullName);
  const fa = curl(`${LEAGUE}?view=kona_player_info`, { players: { filterStatus: { value: ["FREEAGENT", "WAIVERS"] }, limit: 150, sortPercOwned: { sortPriority: 1, sortAsc: false } } });
  for (const x of fa.players) want.add(x.player.fullName);
  // ESPN 名字 → pbpstats 的 NBA 球員 ID
  const all = (await get(`${API}/get-totals/nba?${Q}&Type=Player`)).multi_row_table_data.filter((p) => p.GamesPlayed);
  const byN = new Map(all.map((p) => [norm(p.Name), p])), byA = new Map(), dup = new Set();
  for (const p of all) { const a = alt(p.Name); if (byA.has(a)) dup.add(a); else byA.set(a, p); }
  dup.forEach((a) => byA.delete(a));
  const list = [...want].map((n) => byN.get(norm(n)) || byA.get(alt(n))).filter(Boolean);
  // 賽程和比分：每隊打過的比賽（日期、比分差、是不是連兩天的第二場）
  const games = ((await get(`${API}/get-games/nba?${Q}`)).results || []).sort((a, b) => (a.Date < b.Date ? -1 : 1));
  const teams = {}, G = {};
  for (const g of games) {
    const add = (ab, mg) => { const L = (teams[ab] = teams[ab] || []), prev = L[L.length - 1];
      const b2b = prev && (new Date(g.Date) - new Date(prev[1])) / 86400000 === 1 ? 1 : 0; L.push([g.GameId, g.Date, mg, b2b]); (G[g.GameId] = G[g.GameId] || {})[ab] = { mg, b2b }; };
    add(g.HomeTeamAbbreviation, g.HomePoints - g.AwayPoints); add(g.AwayTeamAbbreviation, g.AwayPoints - g.HomePoints);
  }
  // 主力：wowy.json 每隊 3 位，不在名單裡的也抓逐場（只記打了哪幾場）
  const stars = {}, starIds = new Map();
  try { const W = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../docs/wowy.json"))); for (const [ab, L] of Object.entries(W.teams)) for (const s of L) starIds.set(s.id, { ab, n: s.n }); }
  catch (e) { console.error("wowy.json 讀不到，略過主力：", e.message); }
  const players = {}; let fail = 0;
  const inList = new Set(list.map((p) => p.EntityId));
  for (const [id, s] of starIds) if (!inList.has(id)) { const p = all.find((q) => q.EntityId === id); if (p) list.push(p); }
  for (const p of list) {
    try {
      const rows = (await get(`${API}/get-game-logs/nba?${Q}&EntityId=${p.EntityId}&EntityType=Player`)).multi_row_table_data || [];
      const st = starIds.get(p.EntityId);
      if (st) (stars[st.ab] = stars[st.ab] || []).push({ n: p.Name, g: rows.filter((r) => mmss(r.Minutes) > 0).map((r) => r.GameId) });
      if (!inList.has(p.EntityId)) { await sleep(700); continue; }
      players[norm(p.Name)] = { n: p.Name, g: rows.map((r) => { const m = mmss(r.Minutes), gi = (G[r.GameId] || {})[r.Team] || {};
        return { d: r.Date, gid: r.GameId, o: r.Opponent, min: round(m), usg: round(r.Usage), ts: pct(r.TsPct), rim: pct(r.AtRimFrequency), three: pct(r.FG3APct), sq: round(r.ShotQualityAvg, 3), fp: round(fp(r)),
          pf: Number(r.Fouls) || 0, mg: gi.mg ?? null, b2b: gi.b2b ?? 0 }; }) };
    } catch (e) { fail++; console.error(`${p.Name} 抓不到，略過：`, e.message); }
    await sleep(700);
  }
  const file = path.resolve(__dirname, "../docs/pbplog.json");
  fs.writeFileSync(file, JSON.stringify({ generated: new Date().toISOString(), season: SEASON, players, teams, stars }));
  console.log(`已寫入 ${file}：${Object.keys(players).length} 位球員、${Object.values(stars).reduce((a, l) => a + l.length, 0)} 位主力（要抓 ${want.size} 位、對到 ${list.length} 位、失敗 ${fail} 位）`);
})().catch((e) => { console.error("抓不到逐場紀錄：", e.message); process.exit(1); });
