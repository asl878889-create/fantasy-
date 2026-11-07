// 每天把重點提醒發到 Discord。
// 用法：node fantasy_report/notify.js [--team 隊伍編號] [--channel 頻道ID] [--dry]   （--dry 只印出訊息，不發送）
// 不指定時是 Podcast P（隊伍 1）和預設頻道；例如 aespa 是 --team 11。
// 頻道 ID 用環境變數 DISCORD_CHANNEL_ID 設定；機器人 Token 由雲端環境的網路代理自動帶上。
// 做法：用無頭瀏覽器打開即時版網頁（docs/index.html），直接用網頁裡的計算結果，數字和網頁完全一致。
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const path = require("path");

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const TEAM = arg("--team");
const CHANNEL = arg("--channel") || process.env.DISCORD_CHANNEL_ID || "1568289576332566689";
const SITE = "https://asl878889-create.github.io/fantasy-/" + (TEAM ? `?team=${TEAM}` : "");
const DRY = process.argv.includes("--dry");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.addInitScript(() => { window.__NOAUTH = true; }); // 網頁有密碼，這支程式在雲端自己打開，直接略過
  await page.goto("file://" + path.resolve(__dirname, "../docs/index.html") + (TEAM ? `?team=${TEAM}` : ""));
  await page.waitForFunction(() => typeof CUR !== "undefined" && CUR && document.querySelector(".tabs"), null, { timeout: 120000 });
  const text = await page.evaluate(async (site) => {
    const D = CUR, A = analyse(D);
    const L = [];
    const f0 = (x) => Math.round(x);
    const pc = (v) => (v >= 0.995 ? ">99%" : v < 0.005 ? "<1%" : Math.round(v * 100) + "%");
    const day = A.label(D.period);
    const diff = D.myScore - D.oppScore;
    L.push(`🏀 **${D.me.name} 日報**　${day}`);
    L.push(`第 ${D.week} 週 vs ${D.opp.name}：目前 ${f0(D.myScore)} : ${f0(D.oppScore)}（${diff >= 0 ? "領先" : "落後"} ${f0(Math.abs(diff))}）`);
    L.push(`預估最終 ${f0(D.myScore + A.myRest)} : ${f0(D.oppScore + A.oppRest)}，本週勝率 ${pc(A.winProb)}`);

    // 要動手的事：有比賽卻在替補、先發有傷兵
    const must = A.todos.filter((t) => t[1] === "要做");
    if (must.length) { L.push("", "🚨 **要做**"); must.forEach((t) => L.push(`• ${t[2]}`)); }

    // 今天的比賽：開打時間、DTD/Q 先發
    const tpe = (ms) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
    const gameOf = (x, p) => Object.values(GAMES).find((g) => g.scoringPeriodId === p && (ABBR[g.homeProTeamId] === x.team || ABBR[g.awayProTeamId] === x.team));
    const slots = D.dailySlots[D.period] || {};
    const starter = (x) => slots[x.id] != null && slots[x.id] !== BENCH && slots[x.id] !== IR;
    const today = D.myRoster.filter((x) => gameOf(x, D.period) && x.lineupSlot !== IR); // 跟網頁一樣，IR 的人不算
    if (today.length) {
      const first = Math.min(...today.map((x) => gameOf(x, D.period).date));
      L.push("", `📅 **今天** ${today.length} 人有比賽，最早 ${tpe(first)} 開打（台灣時間）`);
      const risky = today.filter((x) => starter(x) && ["DAY_TO_DAY", "QUESTIONABLE", "DOUBTFUL"].includes(x.injury));
      risky.forEach((x) => L.push(`• ⚠ ${x.name}（${INJURY[x.injury]}）${tpe(gameOf(x, D.period).date)} 開打，開打前確認能不能打`));
    }

    // 連兩天比賽：今天和明天都有比賽的主力
    const b2b = D.myRoster.filter((x) => !x.out && x.avg >= 35 && x.games.has(D.period) && x.games.has(D.period + 1));
    if (b2b.length) L.push("", `🔁 **連兩天比賽**：${b2b.map((x) => x.name).join("、")} 今天和明天都有比賽，明天開打前看一下有沒有被排休`);

    // 撿人
    if (A.plan.steps.length) {
      L.push("", `➕ **撿人排程**（本週還可以加 ${A.plan.left} 人，預估多 ${f0(A.plan.total)} 分）`);
      A.plan.steps.forEach((s) => L.push(`• ${A.label(s.p)}：撿 ${s.f.name}（${s.f.avg.toFixed(1)}）、丟 ${s.d.name}（${s.d.avg.toFixed(1)}）`));
    }

    // 可以搶：最近 2 天被丟掉、比你陣容最弱的人好的球員
    try {
      const lists = await Promise.all([D.period, D.period - 1].map((p) =>
        get(`${LEAGUE}?${qs({ view: "mTransactions2", scoringPeriodId: p })}`, { transactions: { filterType: { value: ["FREEAGENT", "WAIVER"] } } })));
      const dropped = [...new Set(lists.flatMap((l) => l.transactions || []).filter((t) => t.status === "EXECUTED")
        .flatMap((t) => t.items.filter((i) => i.type === "DROP").map((i) => i.playerId)))];
      const fa = new Map(D.fas.map((f) => [f.id, f]));
      const bar = A.drop ? A.drop.val + UPG : Infinity; // 跟網頁同一套：綜合評分比你最該換掉的人多 3 分以上
      const steal = dropped.map((id) => fa.get(id)).filter((f) => f && f.val >= bar);
      if (steal.length) L.push("", `🔥 **可以搶**：${steal.map((f) => `${f.name}（${f.avg.toFixed(1)}${f.status === "WAIVERS" ? "，waiver" : ""}）`).join("、")} 剛被丟掉，比你的 ${A.drop.name}（綜合 ${A.drop.val.toFixed(1)}）好`);
    } catch (e) { /* 讀不到聯盟動態就略過 */ }

    if (site) L.push("", `詳細內容：${site}`); // 朋友的頻道沒有密碼，不附連結
    return L.join("\n");
  }, TEAM ? "" : SITE);
  await browser.close();

  console.log(text);
  if (DRY) return;
  const body = JSON.stringify({ content: text.slice(0, 1990), allowed_mentions: { parse: [] } });
  // Discord 機器人 Token 由雲端環境的網路代理自動加上，這裡的 "proxy-injected" 只是佔位
  const out = execFileSync("curl", ["-sS", "-X", "POST", `https://discord.com/api/v10/channels/${CHANNEL}/messages`,
    "-H", "Authorization: Bot proxy-injected", "-H", "Content-Type: application/json", "--data-binary", "@-"], { input: body }).toString();
  const r = JSON.parse(out);
  if (!r.id) { console.error("Discord 發送失敗：", out); process.exit(1); }
  console.log("已發送到 Discord");
})().catch((e) => { console.error(e); process.exit(1); });
