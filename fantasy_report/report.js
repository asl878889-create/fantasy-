// 賽後日報、每週週報（發到 Discord）。
// 用法：
//   node fantasy_report/report.js --final  [--team N] [--channel ID] [--wait 分鐘] [--period 比賽日] [--dry]
//   node fantasy_report/report.js --weekly [--team N] [--channel ID] [--wait 分鐘] [--week 週次]   [--dry]
//   --force：不等了，現在就發（ESPN 有時要很久才把比賽標成「結算完成」，已經打完但還沒結算時用）
// --final：等「今天所有 NBA 比賽打完」才發賽後日報；--weekly：等「這一週的對戰結果出來」才發週報。
// --wait：還沒好時，每 4 分鐘重新讀一次，最多等這麼多分鐘（預設 0 = 不等，沒好就不發）。
// --period / --week：測試用，指定要看哪一天／哪一週。--dry 只印出訊息，不發送。
// 做法跟 notify.js 一樣：用無頭瀏覽器打開網頁（docs/index.html），直接用網頁裡的計算結果。
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const path = require("path");

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const TEAM = arg("--team");
const CHANNEL = arg("--channel") || process.env.DISCORD_CHANNEL_ID || "1568289576332566689";
const SITE = "https://asl878889-create.github.io/fantasy-/" + (TEAM ? `?team=${TEAM}` : "");
const DRY = process.argv.includes("--dry");
const MODE = process.argv.includes("--weekly") ? "weekly" : process.argv.includes("--final") ? "final" : null;
const WAIT = Number(arg("--wait") || 0);
const OPTS = { period: arg("--period") ? Number(arg("--period")) : null, week: arg("--week") ? Number(arg("--week")) : null, force: process.argv.includes("--force") };
if (!MODE) { console.error("請指定 --final 或 --weekly"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 在網頁裡執行：判斷好了沒、組訊息 ----------
const IN_PAGE = async ({ mode, opts, site }) => {
  const D = CUR, A = D.A;
  const f0 = (x) => Math.round(x), f1 = (x) => (x == null ? "-" : x.toFixed(1));
  const pc = (v) => (v >= 0.995 ? ">99%" : v < 0.005 ? "<1%" : Math.round(v * 100) + "%");
  const meId = D.me.id;
  const sched = D.lg.schedule;
  const matchOf = (w, tid) => sched.find((m) => m.matchupPeriodId === w && m.away && [m.home.teamId, m.away.teamId].includes(tid));
  const side = (m, tid) => (m.home.teamId === tid ? m.home : m.away);
  const wkPts = (sd) => (sd.totalPointsLive != null ? sd.totalPointsLive : sd.totalPoints || 0); // ESPN 的 totalPoints 有時會慢一步，優先用即時的
  const oppIdOf = (m, tid) => (m.home.teamId === tid ? m.away.teamId : m.home.teamId);
  const nameOf = (id) => { for (const t of D.teams) { const x = D.rosters[t.id].find((p) => p.id === id); if (x) return x.name; }
    const f = D.fas.find((p) => p.id === id) || EXTRA[id]; return f ? f.name : "某位球員"; };
  const teamName = (id) => (D.teams.find((t) => t.id === id) || {}).name || "";
  const lab = (p) => A.label(p);
  const wkOfPeriod = (p) => (p < D.weekPeriods[0] ? D.week - 1 - Math.floor((D.weekPeriods[0] - 1 - p) / 7) : D.week + Math.floor((p - D.weekPeriods[0]) / 7));
  const periodsOf = (w) => D.weekPeriods.map((p) => p + 7 * (w - D.week));

  if (mode === "final") {
    // 哪一天：最近一個「已經開打」的比賽日
    let P = opts.period;
    if (!P) for (let p = D.period; p >= Math.max(1, D.period - 2); p--) {
      const gs = Object.values(GAMES).filter((g) => g.scoringPeriodId === p);
      if (gs.some((g) => g.date <= Date.now())) { P = p; break; }
    }
    if (!P) return { ready: false, why: "找不到已經開打的比賽日" };
    const gs = Object.values(GAMES).filter((g) => g.scoringPeriodId === P);
    if (!gs.length) return { ready: true, skip: "那天沒有 NBA 比賽" };
    // 比賽開打 4 小時後就當作已經打完（ESPN 有時要很久才標成結算完成），不要一直等
    const over = (g) => g.statsOfficial || Date.now() >= g.date + 4 * 3600000;
    const left = gs.filter((g) => !over(g)).length;
    if (left && !opts.force) return { ready: false, why: `${lab(P)} 還有 ${left} 場沒打完` };
    const unsettled = gs.filter((g) => !g.statsOfficial).length;

    const W = wkOfPeriod(P), m = matchOf(W, meId);
    if (!m) return { ready: true, skip: "找不到這週的對手" };
    const oppId = oppIdOf(m, meId);
    const box = await loadWeekBox(W, [P]);
    const day = (tid) => { const es = (box[tid] || {})[P] || []; const st = es.filter((e) => e.slot !== BENCH && e.slot !== IR);
      return { total: st.reduce((s, e) => s + e.pts, 0), st: st.filter((e) => e.pts !== 0).sort((a, b) => b.pts - a.pts), es }; };
    const mine = day(meId), theirs = day(oppId);
    const C = contribution(D, meId, box, P);
    const L = [];
    L.push(`🌙 **${D.me.name} 賽後日報**　${lab(P)}`);
    L.push(`今天 ${f0(mine.total)} : ${f0(theirs.total)}（${teamName(oppId)}）`);
    const a = wkPts(side(m, meId)), b = wkPts(side(m, oppId));
    const weekDone = P >= periodsOf(W)[6];
    if (weekDone) L.push(`第 ${W} 週最終 ${f0(a)} : ${f0(b)}，${a > b ? "贏了 🎉" : a < b ? "輸了" : "平手"}（詳細看週報）`);
    else {
      L.push(`第 ${W} 週累計 ${f0(a)} : ${f0(b)}（${a >= b ? "領先" : "落後"} ${f0(Math.abs(a - b))}）`);
      if (W === D.week) { // 只算 P 之後還沒打的日子（A.days 可能還包含剛打完的這一天）
        const rem = A.days.filter((d) => d.p > P), mr = rem.reduce((t, d) => t + d.myProj, 0), orr = rem.reduce((t, d) => t + d.oppProj, 0);
        const sdv = Math.sqrt(rem.reduce((t, d) => t + d.mine.reduce((u, x) => u + (0.3 * x.proj) ** 2, 0) + d.theirs.reduce((u, x) => u + (0.3 * x.proj) ** 2, 0), 0));
        const wp = sdv > 0 ? normCdf((a - b + mr - orr) / sdv) : a > b ? 1 : a < b ? 0 : 0.5;
        L.push(`預估最終 ${f0(a + mr)} : ${f0(b + orr)}，本週勝率 ${pc(wp)}`);
      }
    }
    if (mine.st.length) {
      const top = mine.st.slice(0, 3);
      L.push("", `⭐ **今天最強**：${top.map((e) => `${nameOf(e.id)} ${f0(e.pts)}`).join("、")}`);
      const low = mine.st.filter((e) => e.pts < 15 && !top.includes(e)).slice(-2); // 已經列在「最強」的人不再列進「拖後腿」
      if (low.length) L.push(`😬 **拖後腿**：${low.map((e) => `${nameOf(e.id)} ${f0(e.pts)}`).join("、")}`);
    }
    const md = C.missDays.find((x) => x.p === P);
    if (md && md.miss >= 10) L.push(`🪑 **替補錯過**：事後最佳先發可以多 ${f0(md.miss)} 分${md.bench.length ? `（${md.bench.map((e) => `${nameOf(e.id)} ${f0(e.pts)} 分`).join("、")}在替補）` : ""}`);
    if (theirs.st.length) L.push(`🔥 **對手今天最強**：${theirs.st.slice(0, 2).map((e) => `${nameOf(e.id)} ${f0(e.pts)}`).join("、")}`);
    // 接下來要做的事（D.period 通常已經是下一個比賽日）
    const must = A.todos.filter((t) => t[1] === "要做" && !t[2].startsWith(lab(P)));
    if (!weekDone && must.length) { L.push("", "🚨 **接下來要做**"); must.slice(0, 4).forEach((t) => L.push(`• ${t[2]}`)); }
    if (unsettled) L.push("", `（還有 ${unsettled} 場 ESPN 還沒結算完，分數可能再微調）`);
   
    return { ready: true, text: L.join("\n") };
  }

  // ---------- 週報 ----------
  // 要發哪一週：ESPN 週一早上常常還沒換到下一週（「現在這週」還是剛打完的那週），所以先看現在這週的比賽是不是都打完了
  const curLast = periodsOf(D.week)[6], curDone = curLast != null && Object.values(GAMES).filter((g) => g.scoringPeriodId === curLast).every((g) => g.statsOfficial || Date.now() >= g.date + 4 * 3600000);
  const W = opts.week || (curDone ? D.week : D.week - 1);
  if (W < 1) return { ready: false, why: "還沒有已經結束的週" };
  const m = matchOf(W, meId);
  if (!m) return { ready: false, why: `找不到第 ${W} 週的對手` };
  // 結果出來了（winner 有值），或那週最後一天的比賽都打完了，就可以發
  const lastP = periodsOf(W)[6], lastGames = Object.values(GAMES).filter((g) => g.scoringPeriodId === lastP);
  const decided = m.winner && m.winner !== "UNDECIDED";
  const over = lastGames.every((g) => g.statsOfficial || Date.now() >= g.date + 4 * 3600000);
  if (!decided && !over && !opts.force) return { ready: false, why: `第 ${W} 週還沒結束` }; // 最後一天的比賽都打完（或開打 4 小時後）就算結束，不用等 ESPN 換週
  const oppId = oppIdOf(m, meId), a = wkPts(side(m, meId)), b = wkPts(side(m, oppId));
  const periods = periodsOf(W);
  const box = await loadWeekBox(W, periods);
  const C = contribution(D, meId, box, periods[6]);
  const all = sched.filter((x) => x.matchupPeriodId === W && x.away).flatMap((x) => [x.home, x.away]).map((s) => ({ id: s.teamId, pts: wkPts(s) })).sort((x, y) => y.pts - x.pts); // 用即時分數（ESPN 還沒結算時 totalPoints 是舊的）
  const rank = all.findIndex((x) => x.id === meId) + 1;
  const med = (all[4].pts + all[5].pts) / 2;
  const d0 = (ms) => { const x = new Date(ms); return `${x.getUTCMonth() + 1}/${x.getUTCDate()}`; };
  const st = addDays(D.base, periods[0]), en = addDays(D.base, periods[6]);
  const L = [];
  L.push(`🏆 **${D.me.name} 第 ${W} 週週報**（${st.getUTCMonth() + 1}/${st.getUTCDate()}–${en.getUTCMonth() + 1}/${en.getUTCDate()}）`);
  // 戰績：ESPN 還沒結算這週時，自己把這週的對戰（1 場）和聯盟前一半（1 場）加上去
  const rec = D.me.record.overall, half = Math.floor(all.length / 2);
  const wins = rec.wins + (decided ? 0 : (a > b ? 1 : 0) + (rank && rank <= half ? 1 : 0)), losses = rec.losses + (decided ? 0 : (a < b ? 1 : 0) + (rank && rank > half ? 1 : 0));
  L.push(`${a > b ? "贏了 🎉" : a < b ? "輸了" : "平手"}　${f0(a)} : ${f0(b)}（${teamName(oppId)}）　戰績 ${wins}-${losses}`);
  L.push(`聯盟本週得分第 ${rank} 名（最高 ${f0(all[0].pts)} ${teamName(all[0].id)}），${a >= med ? "高於" : "低於"}中位數 ${f0(med)}`);
  if (C.rows.length) {
    const top = C.rows.slice(0, 3);
    L.push("", `⭐ **貢獻榜**：${top.map((r) => `${r.name} ${f0(r.pts)}（${C.total ? Math.round(r.pts / C.total * 100) : 0}%）`).join("、")}`);
    const worst = C.rows.filter((r) => r.played >= 2 && r.exp).map((r) => ({ r, d: r.pts - r.exp })).sort((x, y) => x.d - y.d)[0];
    if (worst && worst.d < -10) L.push(`😬 **最不如預期**：${worst.r.name}（比預估少 ${f0(-worst.d)} 分）`);
  }
  if (C.missed >= 10) {
    const md = [...C.missDays].sort((x, y) => y.miss - x.miss)[0];
    L.push(`🪑 **替補錯過**：事後最佳先發多 ${f0(C.missed)} 分${md && md.bench.length ? `，最多是 ${lab(md.p)}（${md.bench.map((e) => `${nameOf(e.id)} ${f0(e.pts)}`).join("、")}在替補）` : ""}`);
  }
  // 本週撿了誰：最後一天第一場比賽開打後撿的人，ESPN 算到下一週（隔天才生效），所以用「上週最後一天開打」到「這週最後一天開打」切
  const lockOf = (p) => { const gs = Object.values(GAMES).filter((g) => g.scoringPeriodId === p).map((g) => g.date); return gs.length ? Math.min(...gs) : null; };
  const lo = W > 1 ? lockOf(periodsOf(W - 1)[6]) : null, hi = lockOf(periods[6]);
  const inWeek = (t) => (lo == null && hi == null ? periods.includes(t.scoringPeriodId) : (lo == null || t.proposedDate >= lo) && (hi == null || t.proposedDate < hi));
  const adds = (D.txs || []).filter((t) => t.teamId === meId && inWeek(t)).sort((x, y) => x.proposedDate - y.proposedDate).flatMap((t) => t.items.filter((i) => i.type === "ADD").map((i) => nameOf(i.playerId)));
  const meT = D.teams.find((t) => t.id === meId) || D.me, official = Number((((meT.transactionCounter || {}).matchupAcquisitionTotals) || {})[W] || 0); // ESPN 官方的每週撿人次數
  const nAdd = official || adds.length;
  if (nAdd) L.push(`➕ 本週撿了 ${nAdd} 人${adds.length ? `：${adds.join("、")}` : ""}${official && adds.length !== official ? `（ESPN 算 ${official} 次，名單可能不完整）` : ""}`);
  // 下週（也就是現在這一週）的對手
  const nm = matchOf(W + 1, meId);
  if (nm) {
    const nid = oppIdOf(nm, meId), h = D.habits && D.habits[nid];
    const wkNext = periodsOf(W + 1);
    const cnt = (tid) => D.rosters[tid].filter((x) => !x.out && wkNext.some((p) => x.games.has(p))).length;
    L.push("", `📅 **下週對手**：${teamName(nid)}${h ? `（${h.style}，每週撿約 ${f1(h.rate)} 人）` : ""}`);
    if (h) L.push(`• ${h.notes.slice(1, 3).join("；")}`);
    const th = D.rosters[nid].filter((x) => !x.out).sort((x, y) => y.avg - x.avg).slice(0, 3).map((x) => `${x.name} ${f1(x.avg)}`);
    L.push(`• 他的主力：${th.join("、")}`);
  }
 
  return { ready: true, text: L.join("\n") };
};

(async () => {
  const browser = await chromium.launch();
  const deadline = Date.now() + WAIT * 60000;
  let res = null;
  for (;;) {
    const page = await browser.newPage();
    await page.addInitScript((adv) => { window.__NOAUTH = true; if (adv) window.__ADV = adv; }, (() => { try { return JSON.parse(require("fs").readFileSync(path.resolve(__dirname, "../docs/adv.json"), "utf8")); } catch (e) { return null; } })()); // 網頁有密碼，這支程式在雲端自己打開，直接略過
    await page.goto("file://" + (process.env.REPORT_PAGE || path.resolve(__dirname, "../docs/index.html")) + (TEAM ? `?team=${TEAM}` : ""));
    await page.waitForFunction(() => typeof CUR !== "undefined" && CUR && CUR.A && document.querySelector(".tabs"), null, { timeout: 120000 });
    res = await page.evaluate(IN_PAGE, { mode: MODE, opts: OPTS, site: TEAM ? "" : SITE }); // 朋友的頻道沒有密碼，不附連結
    await page.close();
    if (res.ready || Date.now() + 240000 > deadline) break;
    console.log("還沒好：" + res.why + "，4 分鐘後再看");
    await sleep(240000);
  }
  await browser.close();
  if (!res.ready) { console.log("沒有發送：" + res.why); return; }
  if (res.skip) { console.log("沒有發送：" + res.skip); return; }
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
