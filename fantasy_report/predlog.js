// 預估比對：每天記錄「原本預估」和「混合 EPM 的預估」，隔天用實際 FPTS 比對，結果存在 docs/pred-log.json。
//   node fantasy_report/predlog.js            記錄今天、並比對已經打完的日子
//   node fantasy_report/predlog.js --dry      只印出，不寫檔
// 一筆紀錄：[比賽日, 球員ID, 名字, 原本預估, 混合預估, EPM佔比, 實際(null=還沒打完, "dnp"=沒上場), 當時出賽場數, 考慮對手的預估, 旗標]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const DRY = process.argv.includes("--dry");
const FILE = path.resolve(__dirname, "../docs/pred-log.json");
const readJ = (f) => { try { return JSON.parse(fs.readFileSync(path.resolve(__dirname, "../docs/" + f), "utf8")); } catch (e) { return null; } };
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
let teamSummary = null;
const summarize = (rows) => {
  const ok = rows.filter((r) => typeof r[6] === "number" && r[4] != null);
  const one = (rs) => ({ n: rs.length, maeOld: mean(rs.map((r) => Math.abs(r[3] - r[6]))), maeMix: mean(rs.map((r) => Math.abs(r[4] - r[6]))), biasOld: mean(rs.map((r) => r[3] - r[6])), biasMix: mean(rs.map((r) => r[4] - r[6])) });
  const r1 = (o) => (o.n ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === "n" ? v : Math.round(v * 100) / 100])) : { n: 0 });
  const three = ok.filter((r) => typeof r[8] === "number"); // 三種預估都有的那批（同一批人比，才公平）
  const opp = three.length ? { ...one(three), maeOpp: mean(three.map((r) => Math.abs(r[8] - r[6]))), biasOpp: mean(three.map((r) => r[8] - r[6])) } : { n: 0 };
  return { team: teamSummary, days: new Set(ok.map((r) => r[0])).size, all: r1(one(ok)), low: r1(one(ok.filter((r) => r[7] < 5))), high: r1(one(ok.filter((r) => r[7] >= 5))), opp: r1(opp) };
};
const norm = (r) => { if (r[8] === "bf") { r[9] = "bf"; r[8] = null; } if (r[8] === undefined) r[8] = null; return r; }; // 舊格式：第 9 欄原本是 "bf" 旗標
(async () => {
  const log = readJ("pred-log.json") || { rows: [] };
  log.rows.forEach(norm);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.addInitScript((a) => { window.__NOAUTH = true; if (a.adv) window.__ADV = a.adv; if (a.epm) window.__EPM = a.epm; }, { adv: readJ("adv.json"), epm: readJ("epm.json") });
  await page.goto("file://" + (process.env.REPORT_PAGE || path.resolve(__dirname, "../docs/index.html")));
  await page.waitForFunction(() => typeof CUR !== "undefined" && CUR && CUR.A && typeof predSnapshot === "function", null, { timeout: 120000 });
  const snap = await page.evaluate(() => predSnapshot());
  if (!snap) { console.log("沒有 EPM 資料，這次不記錄"); await browser.close(); return; }
  const have = new Set(log.rows.map((r) => r[0] + "_" + r[1]));
  let added = 0;
  for (const r of snap.rows) if (!have.has(r[0] + "_" + r[1])) { log.rows.push(r); added++; }
  // 比對：比賽日已經過去、還沒有實際分數的紀錄
  const pending = [...new Set(log.rows.filter((r) => r[6] === null && r[0] < snap.period).map((r) => r[0]))];
  let filled = 0;
  for (const p of pending) {
    const act = await page.evaluate((p) => actualsOf(p), p).catch(() => null);
    if (!act) continue;
    for (const r of log.rows) if (r[0] === p && r[6] === null) { const v = act[r[1]]; if (v === undefined) continue; r[6] = Math.abs(v) < 0.001 ? "dnp" : Math.round(v * 10) / 10; filled++; }
  }
  // 隊伍層級：每隊每天先發的預估加總 vs 實際先發加總（預估只有球員，沒有隊伍，所以用當天實際先發名單去加）
  log.teams = log.teams || [];
  const doneT = new Set(log.teams.map((x) => x.p + "_" + x.t));
  const dayRows = {}; for (const r of log.rows) if (typeof r[6] === "number" || r[6] === "dnp") (dayRows[r[0]] = dayRows[r[0]] || {})[r[1]] = r;
  for (const p of Object.keys(dayRows).map(Number)) {
    if (log.teams.some((x) => x.p === p) && [...doneT].filter((k) => k.startsWith(p + "_")).length >= 10) continue;
    const ta = await page.evaluate((p) => teamActualsOf(p), p).catch(() => null);
    if (!ta) continue;
    for (const [tid, v] of Object.entries(ta)) {
      if (doneT.has(p + "_" + tid)) continue;
      let o = 0, m = 0, h = 0, third = true, act = 0, miss = 0;
      v.ids.forEach((id, i) => { act += v.act[i]; const r = dayRows[p][id]; if (!r) { miss++; return; } o += r[3]; m += r[4]; if (typeof r[8] === "number") h += r[8]; else third = false; });
      log.teams.push({ p, t: Number(tid), o: Math.round(o * 10) / 10, m: Math.round(m * 10) / 10, h: third ? Math.round(h * 10) / 10 : null, a: Math.round(act * 10) / 10, miss });
    }
  }
  await browser.close();
  { const T = log.teams, me = (f) => mean(T.map(f)), r1 = (v) => (v == null ? null : Math.round(v * 100) / 100), H = T.filter((x) => x.h != null);
    teamSummary = T.length ? { n: T.length, avgAct: r1(me((x) => x.a)), maeOld: r1(me((x) => Math.abs(x.o - x.a))), maeMix: r1(me((x) => Math.abs(x.m - x.a))), biasOld: r1(me((x) => x.o - x.a)), biasMix: r1(me((x) => x.m - x.a)), maeOpp: H.length >= 10 ? r1(mean(H.map((x) => Math.abs(x.h - x.a)))) : null, biasOpp: H.length >= 10 ? r1(mean(H.map((x) => x.h - x.a))) : null } : null; }
  log.updated = new Date().toISOString();
  log.summary = summarize(log.rows);
  console.log(`今天 ${snap.period}：新增 ${added} 筆；比對 ${pending.length} 天、補上 ${filled} 筆實際分數`);
  console.log("目前結果：", JSON.stringify(log.summary));
  if (!DRY) { fs.writeFileSync(FILE, JSON.stringify(log)); console.log("已寫入", FILE); }
})().catch((e) => { console.error(e); process.exit(1); });
