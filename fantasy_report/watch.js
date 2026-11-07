// 兩種即時型通知（發到 Discord）：
//   node fantasy_report/watch.js --drops  [--since 分鐘] [--team N] [--channel ID] [--now ISO時間] [--dry]
//       有人把「對你有用的好球員」丟掉時通知（只看最近 --since 分鐘內的撿人丟人，預設 120）。
//   node fantasy_report/watch.js --waiver [--hours 小時] [--team N] [--channel ID] [--now ISO時間] [--dry]
//       waiver 快要處理前提醒：列出你可以下 claim 的好球員（預設看接下來 6 小時內處理的）。
// 沒有符合的就不發。「好球員」的標準跟網頁的「可以搶」一樣：綜合評分比你最該換掉的人多 3 分以上。
// --now 是測試用，假裝現在是某個時間（ISO 格式，例如 2026-11-06T04:00:00Z）。
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const path = require("path");

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const TEAM = arg("--team");
const CHANNEL = arg("--channel") || process.env.DISCORD_CHANNEL_ID || "1568289576332566689";
const SITE = "https://asl878889-create.github.io/fantasy-/" + (TEAM ? `?team=${TEAM}` : "");
const DRY = process.argv.includes("--dry");
const MODE = process.argv.includes("--waiver") ? "waiver" : process.argv.includes("--drops") ? "drops" : null;
const NOW = arg("--now") ? Date.parse(arg("--now")) : Date.now();
const SINCE = Number(arg("--since") || 120), HOURS = Number(arg("--hours") || 6);
if (!MODE) { console.error("請指定 --drops 或 --waiver"); process.exit(1); }

const IN_PAGE = ({ mode, now, since, hours, site }) => {
  const D = CUR, A = D.A;
  const f1 = (x) => (x == null ? "-" : x.toFixed(1));
  const teamName = (id) => (D.teams.find((t) => t.id === id) || {}).name || "";
  const tpe = (ms) => { const p = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(ms)); const g = (t) => p.find((x) => x.type === t).value; return `${g("month")}/${g("day")} ${g("hour")}:${g("minute")}`; };
  // 跟你的隊上比：最該換掉的人；沒有就拿綜合評分最低的先發
  const base = A.drop || A.worst;
  if (!base) return { text: null };
  const bar = base.val + UPG;
  const rank = D.me.waiverRank ? `（你的 waiver 順位第 ${D.me.waiverRank}）` : "";
  const dtd = (f) => (["DAY_TO_DAY", "QUESTIONABLE", "DOUBTFUL"].includes(f.injury) ? `，${INJURY[f.injury]}` : "");
  const L = [];

  if (mode === "drops") {
    // 時間窗：現在往前取整到 10 分鐘，再往前 since 分鐘；這樣每次排程剛好接起來，不會重複也不會漏
    const end = Math.floor(now / 600000) * 600000, start = end - since * 60000;
    const dropped = (D.txs || []).flatMap((t) => t.items.filter((i) => i.type === "DROP").map((i) => ({ id: i.playerId, by: t.teamId, at: t.proposedDate })))
      .filter((d) => d.at >= start && d.at < end && d.by !== D.me.id);
    const seen = new Set(), rows = [];
    for (const d of dropped.sort((a, b) => b.at - a.at)) {
      if (seen.has(d.id)) continue; seen.add(d.id);
      const f = D.fas.find((x) => x.id === d.id) || EXTRA[d.id];
      if (!f || f.out || !["FREEAGENT", "WAIVERS"].includes(f.status) || f.val < bar) continue; // 已經被撿走、受傷、或沒比你的人好就跳過
      const how = f.status === "WAIVERS" ? `在 waiver，台北 ${f.waiverAt ? tpe(f.waiverAt) : "之後"} 處理，要先下 claim` : "自由球員，現在就能直接撿";
      rows.push(`• **${f.name}**（今年 ${f1(f.avg)}、綜合 ${f1(f.val)}${dtd(f)}）被 ${teamName(d.by)} 丟掉：${how}；比你的 ${base.name}（綜合 ${f1(base.val)}）好 ${f1(f.val - base.val)} 分`);
    }
    if (!rows.length) return { text: null };
    L.push(`🔥 **有人丟了好球員**　最近 ${since >= 120 ? Math.round(since / 60) + " 小時" : since + " 分鐘"}（到台北 ${tpe(end)}）`, ...rows.slice(0, 5)); if (rank) L.push(rank.slice(1, -1)); if (site) L.push("", `詳細內容：${site}`);
    return { text: L.filter((x, i) => x !== "" || i > 0).join("\n") };
  }

  // waiver 提醒：接下來 hours 小時內會處理、而且對你有幫助的
  const soon = D.fas.filter((f) => f.status === "WAIVERS" && f.waiverAt && f.waiverAt > now && f.waiverAt <= now + hours * 3600000 && !f.out && f.val >= bar)
    .sort((a, b) => b.val - a.val).slice(0, 5);
  if (!soon.length) return { text: null };
  const at = soon[0].waiverAt;
  L.push(`⏰ **Waiver 提醒**　台北 ${tpe(at)} 處理，之前可以下 claim`);
  soon.forEach((f) => L.push(`• **${f.name}**（今年 ${f1(f.avg)}、綜合 ${f1(f.val)}${dtd(f)}）比你的 ${base.name}（綜合 ${f1(base.val)}）好 ${f1(f.val - base.val)} 分`));
  if (rank) L.push(rank.slice(1, -1));
  L.push("沒人 claim 的話，處理後會變成自由球員，誰都能直接撿。"); if (site) L.push("", `詳細內容：${site}`);
  return { text: L.join("\n") };
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.addInitScript(() => { window.__NOAUTH = true; }); // 網頁有密碼，這支程式在雲端自己打開，直接略過
  await page.goto("file://" + (process.env.REPORT_PAGE || path.resolve(__dirname, "../docs/index.html")) + (TEAM ? `?team=${TEAM}` : ""));
  await page.waitForFunction(() => typeof CUR !== "undefined" && CUR && CUR.A && document.querySelector(".tabs"), null, { timeout: 120000 });
  const res = await page.evaluate(IN_PAGE, { mode: MODE, now: NOW, since: SINCE, hours: HOURS, site: TEAM ? "" : SITE });
  await browser.close();
  if (!res.text) { console.log("沒有發送：沒有符合的"); return; }
  console.log(res.text);
  if (DRY) return;
  const body = JSON.stringify({ content: res.text.slice(0, 1990), allowed_mentions: { parse: [] } });
  // Discord 機器人 Token 由雲端環境的網路代理自動加上，這裡的 "proxy-injected" 只是佔位
  const out = execFileSync("curl", ["-sS", "-X", "POST", `https://discord.com/api/v10/channels/${CHANNEL}/messages`,
    "-H", "Authorization: Bot proxy-injected", "-H", "Content-Type: application/json", "--data-binary", "@-"], { input: body }).toString();
  const r = JSON.parse(out);
  if (!r.id) { console.error("Discord 發送失敗：", out); process.exit(1); }
  console.log("已發送到 Discord");
})().catch((e) => { console.error(e); process.exit(1); });
