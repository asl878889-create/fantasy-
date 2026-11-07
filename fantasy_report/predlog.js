// 預估比對：每天記錄「原本預估」和「混合 EPM 的預估」，隔天用實際 FPTS 比對，結果存在 docs/pred-log.json。
//   node fantasy_report/predlog.js            記錄今天、並比對已經打完的日子
//   node fantasy_report/predlog.js --dry      只印出，不寫檔
// 一筆紀錄：[比賽日, 球員ID, 名字, 原本預估, 混合預估, EPM佔比, 實際(null=還沒打完, "dnp"=沒上場), 當時出賽場數]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const DRY = process.argv.includes("--dry");
const FILE = path.resolve(__dirname, "../docs/pred-log.json");
const readJ = (f) => { try { return JSON.parse(fs.readFileSync(path.resolve(__dirname, "../docs/" + f), "utf8")); } catch (e) { return null; } };
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const summarize = (rows) => {
  const ok = rows.filter((r) => typeof r[6] === "number" && r[4] != null);
  const one = (rs) => ({ n: rs.length, maeOld: mean(rs.map((r) => Math.abs(r[3] - r[6]))), maeMix: mean(rs.map((r) => Math.abs(r[4] - r[6]))), biasOld: mean(rs.map((r) => r[3] - r[6])), biasMix: mean(rs.map((r) => r[4] - r[6])) });
  const r1 = (o) => (o.n ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === "n" ? v : Math.round(v * 100) / 100])) : { n: 0 });
  return { days: new Set(ok.map((r) => r[0])).size, all: r1(one(ok)), low: r1(one(ok.filter((r) => r[7] < 5))), high: r1(one(ok.filter((r) => r[7] >= 5))) };
};
(async () => {
  const log = readJ("pred-log.json") || { rows: [] };
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
  await browser.close();
  log.updated = new Date().toISOString();
  log.summary = summarize(log.rows);
  console.log(`今天 ${snap.period}：新增 ${added} 筆；比對 ${pending.length} 天、補上 ${filled} 筆實際分數`);
  console.log("目前結果：", JSON.stringify(log.summary));
  if (!DRY) { fs.writeFileSync(FILE, JSON.stringify(log)); console.log("已寫入", FILE); }
})().catch((e) => { console.error(e); process.exit(1); });
