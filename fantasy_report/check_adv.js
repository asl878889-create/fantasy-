// 檢查 pbpstats 有沒有更新到「昨天（美國日期）」的比賽：ESPN 已打完的場數 vs pbpstats 收錄的場數
// 印出「OK …」或「MISSING …」，給排程判斷要不要通知使用者
//   node fantasy_report/check_adv.js            （預設檢查台灣今天的前一天，也就是美國的昨天）
const { execFileSync } = require("child_process");
const curl = (url) => JSON.parse(execFileSync("curl", ["-sS", "--max-time", "90", "-A", "Mozilla/5.0", "-f", url], { maxBuffer: 80e6 }).toString());
const SEASON = "2026-27";
const tpe = new Date(Date.now() + 8 * 3600000), us = new Date(tpe.getTime() - 86400000); // 台灣今天 → 美國昨天
const day = process.argv[2] || us.toISOString().slice(0, 10);
try {
  const sb = curl(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${day.replace(/-/g, "")}`);
  const done = (sb.events || []).filter((e) => e.status && e.status.type && e.status.type.completed).length;
  const games = curl(`https://api.pbpstats.com/get-games/nba?Season=${SEASON}&SeasonType=Regular%20Season`).results || [];
  const have = games.filter((g) => g.Date === day).length;
  if (!done) console.log(`OK ${day} 沒有比賽`);
  else if (have >= done) console.log(`OK ${day} pbpstats 已收錄 ${have}/${done} 場`);
  else console.log(`MISSING ${day} pbpstats 只收錄 ${have}/${done} 場`);
} catch (e) { console.log(`MISSING 檢查失敗：${e.message}`); }
