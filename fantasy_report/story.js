// 聯盟故事連載：把每週聯盟發生的事（對戰比分、誰打爆誰、交易、撿人丟人、排名變化）當素材，由排程（Claude）寫成一章小說，
// 存在 docs/story.json，網頁「聯盟」分頁的「聯盟連載」卡片會顯示。網頁本身不呼叫任何 AI。
// 用法：
//   node fantasy_report/story.js --pending [--week N]   印出下一章要用的素材（JSON：怎麼寫、設定、前情提要、素材）；這週還沒打完或都寫過了就印 []
//   node fantasy_report/story.js --facts --week N        只印某一週的素材（不管寫過沒）
//   node fantasy_report/story.js --set <檔案.json>       把一章寫進 docs/story.json：檔案內容 { week, title, body, summary }（同一週已有就覆蓋）
//   node fantasy_report/story.js --post [--week N] [--channel ID ...] [--dry]   把某一章（預設最新一章）發到 Discord（可給多個 --channel）
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const FILE = path.resolve(__dirname, "../docs/story.json");
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const args = (k) => process.argv.flatMap((v, i) => (v === k && process.argv[i + 1] ? [process.argv[i + 1]] : []));
const readStory = () => { try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { return { title: "", chapters: [] }; } };
const writeStory = (o) => { o.chapters.sort((a, b) => a.week - b.week); fs.writeFileSync(FILE, JSON.stringify(o, null, 1) + "\n"); };

// 寫法（跟著 --pending 一起印出來，排程照這個寫）
const GUIDE = [
  "這是聯盟的每週連載小說，一週一章，讀者是聯盟裡的 10 位經營者（大家都認識，可以開玩笑，但不要人身攻擊、不要酸到讓人不舒服）。",
  "世界觀照 story.json 的「設定」：每支隊伍是一個勢力、經營者是領主、NBA 球員是麾下的戰士，fantasy 分數是戰功（fpts）。設定裡已經有的人物性格、外號、恩怨要延續，可以在 新設定 補上新的。",
  "事實一定要對：誰贏誰、比分、差幾分、誰是本週最猛的球員和他拿幾 fpts、誰跟誰交易了誰、誰撿了誰丟了誰，都照素材寫，不要編造比賽結果、交易或傷勢。可以虛構的只有場面描寫、對白和心境。",
  "每章挑 2～3 條主線深寫（例如最懸殊或最驚險的一場對戰、一筆交易、連勝連敗、排名大洗牌、某位球員爆發或擺爛），其他對戰用一兩句帶過，但每一場對戰的勝負都要交代到。",
  "有交易時寫成結盟、聯姻或背叛；撿人丟人寫成招募流浪劍士、遣散舊部；素材裡有交易評語可以當成軍師的看法引用。",
  "章末留一個鉤子，接到下週的對戰（素材的 下週對戰）。",
  "繁體中文，1000～1800 字，分段好讀，可以有對白。標題 4～12 字，不要寫「第 N 章」（網頁會自己加）。",
  "另外寫一段 summary：60～120 字的本章摘要（之後寫下一章時當前情提要）。",
];

async function openPage() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const readJ = (f) => { try { return JSON.parse(fs.readFileSync(path.resolve(__dirname, "../docs/" + f), "utf8")); } catch (e) { return null; } };
  const inj = {}; for (const [k, f] of Object.entries({ __ADV: "adv.json", __INJN: "injnews.json", __HIST: "history.json", __TNOTES: "trade-notes.json" })) { const v = readJ(f); if (v) inj[k] = v; }
  await page.addInitScript((d) => { window.__NOAUTH = true; for (const [k, v] of Object.entries(d)) window[k] = v; }, inj);
  await page.goto("file://" + path.resolve(__dirname, "../docs/index.html"));
  await page.waitForFunction(() => typeof CUR !== "undefined" && CUR && CUR.A && document.querySelector(".tabs"), null, { timeout: 180000 });
  return { browser, page };
}

// ---------- 在網頁裡執行：某一週的素材 ----------
const IN_PAGE = async ({ week, tnotes, hist }) => {
  const D = CUR, sched = D.lg.schedule, r0 = (x) => Math.round(x || 0), r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
  const cur = D.week;
  const W = week || cur - 1;
  if (W < 1) return { error: "還沒有打完的一週" };
  const ms = sched.filter((m) => m.matchupPeriodId === W && m.away);
  if (!ms.length) return { error: `第 ${W} 週沒有對戰` };
  const pts = (sd) => (sd.totalPointsLive != null ? sd.totalPointsLive : sd.totalPoints || 0);
  const done = ms.every((m) => m.winner && m.winner !== "UNDECIDED");
  const team = (id) => D.teams.find((t) => t.id === id) || {};
  const mgr = (id) => (hist && hist.cur2027 && hist.cur2027[team(id).name]) || null;
  const nm = (id) => team(id).name || `隊伍 ${id}`;
  // 這一週的比賽日：用對戰資料裡有分數的日子（第一週可能比 7 天長），沒有就用 7 天推算
  const ps = [...new Set(ms.flatMap((m) => [m.home, m.away].flatMap((s) => Object.keys(s.pointsByScoringPeriod || {}).map(Number))))].sort((a, b) => a - b);
  const periods = ps.length ? ps : D.weekPeriods.map((p) => p + 7 * (W - cur));
  const box = await loadWeekBox(W, periods);
  // 每隊本週：先發球員實際得分加總（板凳不算），前 3 名和最慘的先發
  const stars = (tid) => {
    const by = new Map();
    for (const [p, es] of Object.entries(box[tid] || {})) for (const e of es) {
      const o = by.get(e.id) || { 名字: e.name, 先發得分: 0, 先發場數: 0, 板凳得分: 0 };
      if (e.slot !== 12 && e.slot !== 13) { o.先發得分 += e.pts; if (e.pts) o.先發場數++; } else o.板凳得分 += e.pts;
      by.set(e.id, o);
    }
    const all = [...by.values()].map((o) => ({ ...o, 先發得分: r0(o.先發得分), 板凳得分: r0(o.板凳得分) }));
    return { 前三: [...all].sort((a, b) => b.先發得分 - a.先發得分).slice(0, 3), 板凳浪費最多: [...all].sort((a, b) => b.板凳得分 - a.板凳得分).filter((o) => o.板凳得分 >= 20).slice(0, 1) };
  };
  // 每週累積戰績（算到 W 週為止）和名次變化
  const table = (upto) => {
    const T = Object.fromEntries(D.teams.map((t) => [t.id, { id: t.id, w: 0, l: 0, t: 0, pf: 0 }]));
    for (const m of sched.filter((x) => x.away && x.matchupPeriodId <= upto && x.winner && x.winner !== "UNDECIDED")) {
      const h = T[m.home.teamId], a = T[m.away.teamId]; h.pf += pts(m.home); a.pf += pts(m.away);
      if (m.winner === "HOME") { h.w++; a.l++; } else if (m.winner === "AWAY") { a.w++; h.l++; } else { h.t++; a.t++; }
    }
    return Object.values(T).sort((a, b) => (b.w + b.t / 2) - (a.w + a.t / 2) || b.pf - a.pf).map((x, i) => ({ ...x, rank: i + 1 }));
  };
  const now = table(W), before = table(W - 1), rankBefore = Object.fromEntries(before.map((x) => [x.id, x.rank]));
  // 連勝連敗
  const streak = (tid) => { let s = 0, k = null; for (let w = W; w >= 1; w--) { const m = sched.find((x) => x.matchupPeriodId === w && x.away && [x.home.teamId, x.away.teamId].includes(tid)); if (!m || !m.winner || m.winner === "TIE" || m.winner === "UNDECIDED") break; const won = (m.winner === "HOME") === (m.home.teamId === tid); if (k === null) k = won; if (won !== k) break; s++; } return s >= 2 ? `${s} 連${k ? "勝" : "敗"}` : null; };
  // 這一週的時間範圍（美東比賽日 → 毫秒），用來挑出這週的交易和撿人丟人
  const t0 = (p) => addDays(D.base, p).getTime() + 5 * 3600000;
  const from = t0(periods[0]), to = t0(periods[periods.length - 1] + 1);
  const pname = (id) => { const x = findAny(D, id); return x ? x.name : "某位球員"; };
  // 交易：網頁的 D.moves 只有最近 3 天，所以改用每天的陣容比對：前一天在 A 隊、隔天在 B 隊的球員就是交易（同一天同兩隊算一筆）
  const prevBox = periods[0] > 1 ? await loadWeekBox(W - 1, [periods[0] - 1]).catch(() => ({})) : {};
  const owner = (bx, p) => { const m = new Map(); for (const [tid, days] of Object.entries(bx)) for (const e of (days[p] || [])) m.set(e.id, { t: Number(tid), n: e.name }); return m; };
  const tmap = new Map();
  for (const p of periods) {
    const A0 = owner(p === periods[0] ? prevBox : box, p - 1), B0 = owner(box, p);
    if (!A0.size || !B0.size) continue;
    for (const [id, v] of B0) { const o = A0.get(id); if (!o || o.t === v.t) continue;
      const k = p + ":" + [o.t, v.t].sort().join("-"); const t = tmap.get(k) || { p, teams: [o.t, v.t].sort(), items: [] };
      t.items.push({ from: o.t, to: v.t, name: v.n }); tmap.set(k, t); }
  }
  // 交易評語（trade-notes.json 用 ESPN 交易紀錄的 id 當 key）：讀那幾天「接受交易」的紀錄，用隊伍和日期對回去
  const acc = (await Promise.all([...new Set([...tmap.values()].flatMap((t) => [t.p - 1, t.p]))].filter((p) => p > 0).map((p) =>
    get(`${LEAGUE}?${qs({ view: "mTransactions2", scoringPeriodId: p })}`, { transactions: { filterType: { value: ["TRADE_ACCEPT"] } } }).then((r) => r.transactions || []).catch(() => [])))).flat();
  const trades = [...tmap.values()].map((t) => {
    const a = acc.find((x) => x.status === "EXECUTED" && t.teams.includes(x.teamId) && Math.abs(x.proposedDate - t0(t.p)) < 36 * 3600000);
    return { 日期: addDays(D.base, t.p).toISOString().slice(5, 10), 雙方: t.teams.map(nm), 內容: t.teams.map((s) => `${nm(s)} 得到 ${t.items.filter((i) => i.to === s).map((i) => i.name).join("、") || "（無）"}`),
      軍師評語: (a && tnotes && (tnotes[String(a.proposedDate)] || tnotes[String(a.id)])) || null };
  });
  const seen = new Set(), adds = [];
  for (const t of (D.txs || []).concat((D.moves || []).filter((x) => !x.trade))) {
    if (!(t.proposedDate >= from && t.proposedDate < to)) continue;
    const key = String(t.id || t.proposedDate); if (seen.has(key)) continue; seen.add(key);
    const a = t.items.filter((i) => i.type === "ADD").map((i) => pname(i.playerId)), d = t.items.filter((i) => i.type === "DROP").map((i) => pname(i.playerId));
    adds.push({ 隊伍: nm(t.teamId), 撿: a, 丟: d, 評語: (tnotes && tnotes[key]) || null });
  }
  const cnt = {}; adds.forEach((x) => (cnt[x.隊伍] = (cnt[x.隊伍] || 0) + x.撿.length));
  const nextMs = sched.filter((m) => m.matchupPeriodId === W + 1 && m.away);
  return {
    週次: W, 這週打完了: done, 日期: `${addDays(D.base, periods[0]).toISOString().slice(5, 10)} ~ ${addDays(D.base, periods[periods.length - 1]).toISOString().slice(5, 10)}`,
    是季後賽: W > D.lg.settings.scheduleSettings.matchupPeriodCount,
    隊伍: D.teams.map((t) => ({ 隊名: t.name, 經營者: mgr(t.id) })),
    對戰: ms.map((m) => {
      const [h, a] = [m.home, m.away], hp = pts(h), ap = pts(a), win = m.winner === "HOME" ? h : m.winner === "AWAY" ? a : null;
      return { 主: nm(h.teamId), 客: nm(a.teamId), 比分: `${r0(hp)} : ${r0(ap)}`, 勝方: win ? nm(win.teamId) : "平手", 差距: r0(Math.abs(hp - ap)),
        主隊本週: stars(h.teamId), 客隊本週: stars(a.teamId) };
    }).sort((x, y) => y.差距 - x.差距),
    本週最高分: (() => { const all = ms.flatMap((m) => [m.home, m.away]).sort((a, b) => pts(b) - pts(a)); return { 最高: `${nm(all[0].teamId)} ${r0(pts(all[0]))}`, 最低: `${nm(all[all.length - 1].teamId)} ${r0(pts(all[all.length - 1]))}` }; })(),
    排名: now.map((x) => ({ 名次: x.rank, 隊名: nm(x.id), 戰績: `${x.w}-${x.l}${x.t ? "-" + x.t : ""}`, 總得分: r0(x.pf), 名次變化: W > 1 ? rankBefore[x.id] - x.rank : 0, 連勝連敗: streak(x.id) })),
    交易: trades,
    交易說明: trades.length ? "交易內容是比對每天陣容找出來的：當天才撿來又換出去的球員會漏掉（顯示「（無）」）；有軍師評語時以評語寫的球員為準。" : undefined,
    撿人丟人: adds.filter((x) => x.撿.length || x.丟.length).slice(0, 30),
    撿人次數: cnt,
    下週對戰: nextMs.map((m) => `${nm(m.home.teamId)} vs ${nm(m.away.teamId)}`),
  };
};

async function facts(week) {
  const { browser, page } = await openPage();
  const readJ = (f) => { try { return JSON.parse(fs.readFileSync(path.resolve(__dirname, "../docs/" + f), "utf8")); } catch (e) { return null; } };
  try {
    const cur = await page.evaluate(() => CUR.week);
    const r = await page.evaluate(IN_PAGE, { week, tnotes: readJ("trade-notes.json"), hist: readJ("history.json") });
    return { cur, r };
  } finally { await browser.close(); }
}

async function post(text, channels) {
  // Discord 一則最多 2000 字：照段落切開
  const parts = []; let buf = "";
  for (const para of text.split("\n")) { if ((buf + "\n" + para).length > 1900) { parts.push(buf); buf = para; } else buf = buf ? buf + "\n" + para : para; }
  if (buf) parts.push(buf);
  for (const ch of channels) for (const p of parts) {
    const body = JSON.stringify({ content: p, allowed_mentions: { parse: [] } });
    // Discord 機器人 Token 由雲端環境的網路代理自動加上，這裡的 "proxy-injected" 只是佔位
    const out = execFileSync("curl", ["-sS", "-X", "POST", `https://discord.com/api/v10/channels/${ch}/messages`,
      "-H", "Authorization: Bot proxy-injected", "-H", "Content-Type: application/json", "--data-binary", "@-"], { input: body }).toString();
    const r = JSON.parse(out);
    if (!r.id) { console.error("Discord 發送失敗（頻道 " + ch + "）：", out); process.exitCode = 1; break; }
  }
}

(async () => {
  const S = readStory();
  if (process.argv.includes("--set")) {
    const f = arg("--set"); const c = JSON.parse(fs.readFileSync(f, "utf8"));
    if (!c.week || !c.title || !c.body) { console.error("檔案要有 week、title、body"); process.exit(1); }
    if (c.新設定 && typeof c.新設定 === "object") S.設定 = Object.assign(S.設定 || {}, { 人物: Object.assign((S.設定 || {}).人物 || {}, c.新設定) });
    S.chapters = (S.chapters || []).filter((x) => x.week !== c.week).concat([{ week: c.week, title: c.title.trim(), body: c.body.trim(), summary: (c.summary || "").trim(), at: new Date().toISOString() }]);
    writeStory(S); console.log("已寫入第", c.week, "週：", c.title); return;
  }
  if (process.argv.includes("--post")) {
    const w = arg("--week") ? Number(arg("--week")) : null, chs = args("--channel");
    const list = S.chapters || [], c = w ? list.find((x) => x.week === w) : list[list.length - 1];
    if (!c) { console.log("沒有發送：還沒有這一章"); return; }
    const no = list.indexOf(c) + 1;
    const text = `📖 **${S.title || "聯盟連載"}　第 ${no} 章：${c.title}**（第 ${c.week} 週）\n\n${c.body}`;
    if (process.argv.includes("--dry") || !chs.length) { console.log(text); if (!chs.length) console.log("\n（沒給 --channel，只印出來）"); return; }
    await post(text, chs); if (!process.exitCode) console.log("已發送到 Discord"); return;
  }
  if (process.argv.includes("--facts")) { const { r } = await facts(Number(arg("--week")) || null); console.log(JSON.stringify(r, null, 1)); return; }
  if (process.argv.includes("--pending")) {
    const written = new Set((S.chapters || []).map((x) => x.week));
    let w = arg("--week") ? Number(arg("--week")) : null;
    const { cur, r } = await facts(w || null);
    if (!w) { // 從還沒寫的最早一週開始補（一次只寫一章）
      const first = [...Array(Math.max(cur - 1, 0)).keys()].map((i) => i + 1).find((x) => !written.has(x));
      if (!first) { console.log("[]"); return; }
      w = first;
    }
    const F = w === r.週次 ? r : (await facts(w)).r;
    if (F.error || !F.這週打完了 || (written.has(w) && !arg("--week"))) { console.log("[]"); return; }
    const prev = (S.chapters || []).filter((x) => x.week < w).slice(-4).map((x) => ({ 週次: x.week, 標題: x.title, 摘要: x.summary }));
    console.log(JSON.stringify({ 怎麼寫: GUIDE, 連載名稱: S.title, 設定: S.設定 || null, 前情提要: prev, 章節編號: (S.chapters || []).filter((x) => x.week < w).length + 1, 素材: F,
      寫完: "存成 JSON 檔 { week, title, body, summary, 新設定(可省略，{ 名字: 一句設定 }) }，再執行 node fantasy_report/story.js --set 檔案.json" }, null, 1));
    return;
  }
  console.error("請指定 --pending、--facts、--set 或 --post"); process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
