// 抓「傷兵快報」要用的傷病說明（ESPN 傷兵頁 espn.com/nba/injuries），存成 docs/injnews.json 給網頁用。
// 英文新聞存在 head / story；中文說明 zh 由人工（Claude）補寫，下次更新時如果新聞沒變就保留。
//   node fantasy_report/fetch_injnews.js
const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path");
const LEAGUE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2027/segments/0/leagues/406470928";
const curl = (url, filter) => JSON.parse(execFileSync("curl", ["-sS", "--max-time", "60", "-f", "-A", "Mozilla/5.0", ...(filter ? ["-H", "X-Fantasy-Filter: " + JSON.stringify(filter)] : []), url], { maxBuffer: 64 * 1024 * 1024 }).toString());
const IMPORTANT = /injur|sprain|strain|surgery|ruled out|\bout\b|will not play|won't play|not play|questionable|doubtful|probable|returns?\b|sidelined|(will|to) miss|day-to-day|resting|rest\b|soreness|contusion|fracture|tear|re-?evaluat|illness|knee|ankle|hamstring|calf|back\b|wrist|shoulder|foot|hip/i;
const IR = 13, hurt = (p, slot) => (p.injuryStatus && p.injuryStatus !== "ACTIVE" && p.injuryStatus !== "NORMAL") || slot === IR;
(async () => {
  const ids = new Map();
  const ros = curl(`${LEAGUE}?view=mRoster`);
  for (const t of ros.teams) for (const e of t.roster.entries) { const p = e.playerPoolEntry.player; if (hurt(p, e.lineupSlotId)) ids.set(p.id, p.fullName); }
  try {
    const fa = curl(`${LEAGUE}?view=kona_player_info`, { players: { filterStatus: { value: ["FREEAGENT", "WAIVERS"] }, limit: 120, sortPercOwned: { sortPriority: 1, sortAsc: false } } });
    for (const x of fa.players) { const p = x.player; if (hurt(p, 0)) ids.set(p.id, p.fullName); }
  } catch (e) { console.error("自由球員傷兵讀不到，略過：", e.message); }
  const file = path.resolve(__dirname, "../docs/injnews.json");
  let old = {}; try { old = JSON.parse(fs.readFileSync(file, "utf8")).items || {}; } catch (e) { /* 第一次 */ }
  // 資料來源：ESPN 傷兵頁（espn.com/nba/injuries）背後的資料；全部 NBA 傷兵
  const feed = curl("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries");
  const items = {};
  for (const t of feed.injuries) for (const it of t.injuries) {
    const a = it.athlete || {}, m = ((a.links || []).map((l) => String(l.href).match(/\/id\/(\d+)\//)).find(Boolean) || [])[1];
    if (!m) continue; // 全部 NBA 傷兵都翻（傷兵快報最下面「其他 NBA 傷兵」也要中文）
    const head = it.shortComment || "", prev = old[m];
    items[m] = { n: a.displayName, when: it.date, head, story: (it.longComment || "").slice(0, 600), zh: prev && prev.head === head ? prev.zh || "" : "" };
  }
  fs.writeFileSync(file, JSON.stringify({ updated: new Date().toISOString(), items }, null, 1));
  const need = Object.values(items).filter((x) => !x.zh).length;
  console.log(`已寫入 ${file}：${Object.keys(items).length} 位球員，${need} 則還沒有中文說明`);
})().catch((e) => { console.error("抓不到傷病新聞：", e.message); process.exit(1); });
