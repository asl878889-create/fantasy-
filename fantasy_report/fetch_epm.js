// 下載「蘇人 NBA」的 EPM 預期能力（Dunks & Threes）：每位球員預期的每百回合得分、籃板、助攻…，存成 docs/epm.json。
// 這份資料是上季結束時（2026/6）算的，整季不會變，所以只需要跑一次（賽季中不用排程）。
//   node fantasy_report/fetch_epm.js
const { spawn, execFileSync } = require("child_process");
const fs = require("fs"), path = require("path");
const BASE = "https://www.surennba.com/NBA/data/predict/";
const SEASON = process.argv[2] || "2025-26";
const getJson = (url) => new Promise((resolve, reject) => { const c = spawn("curl", ["-sS", "--max-time", "40", "-f", "-A", "Mozilla/5.0", url]); let o = ""; c.stdout.on("data", (d) => (o += d)); c.on("close", (code) => { try { code ? reject(new Error("curl " + code)) : resolve(JSON.parse(o)); } catch (e) { reject(e); } }); });
const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const r = (v, d) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
(async () => {
  const list = await getJson(`${BASE}${SEASON}.json`);
  const ids = list.players.map((p) => p.player_id), out = {}; let i = 0, fail = 0;
  const worker = async () => { while (i < ids.length) { const id = ids[i++]; try {
    const d = await getJson(`${BASE}${SEASON}/${id}.json`), m = (k) => (d.metrics[k] || {}).value;
    out[norm(d.player_name)] = { n: d.player_name, pos: d.position_group, age: d.age, off: r(m("off"), 2), def: r(m("def"), 2), tot: r(m("tot"), 2),
      usg: r(m("p_usg") * 100, 1), ts: r(m("p_tspct") * 100, 1), pts: r(m("p_pts_100"), 1), ast: r(m("p_ast_100"), 1), tov: r(m("p_tov_100"), 1), orb: r(m("p_orb_100"), 1), drb: r(m("p_drb_100"), 1),
      stl: r(m("p_stl_100"), 2), blk: r(m("p_blk_100"), 2), fg2a: r(m("p_fg2a_100"), 1), fg3a: r(m("p_fg3a_100"), 1), fta: r(m("p_fta_100"), 1), fg2p: r(m("p_fg2pct"), 3), fg3p: r(m("p_fg3pct"), 3), ftp: r(m("p_ftpct"), 3) };
  } catch (e) { fail++; } } };
  await Promise.all(Array.from({ length: 12 }, worker));
  const file = path.resolve(__dirname, "../docs/epm.json");
  fs.writeFileSync(file, JSON.stringify({ season: SEASON, updated: list.meta.updated_at, source: "Dunks & Threes EPM via surennba.com", players: out }));
  console.log(`已寫入 ${file}：${Object.keys(out).length} 位球員（失敗 ${fail}）`);
})().catch((e) => { console.error("抓不到 EPM：", e.message); process.exit(1); });
