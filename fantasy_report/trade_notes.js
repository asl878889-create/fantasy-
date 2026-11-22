// 交易、撿人丟人的評語：由排程（Claude）事先寫好，存成 docs/trade-notes.json，網頁有評語就顯示，沒有就用原本的固定句。
// 網頁本身不呼叫任何 AI，沒有金鑰，也不花 API 費用。
// 用法：
//   node fantasy_report/trade_notes.js --pending            印出「還沒有評語」的動態（JSON：key、時間、內容），沒有就印 []
//   node fantasy_report/trade_notes.js --set <key> "評語"    把一則評語寫進 docs/trade-notes.json（已有就覆蓋）
//   node fantasy_report/trade_notes.js --prune [天數]        刪掉聯盟動態已經看不到的舊評語（預設保留目前清單內的）
// 撿人前的評語（補強建議卡上的候選：撿誰、丟誰），存成 docs/pick-notes.json：
//   node fantasy_report/trade_notes.js --pending-picks [--teams 4,11]   印出還沒有評語、或評語超過 24 小時的候選（不給 --teams 就是網頁預設隊伍）
//   node fantasy_report/trade_notes.js --set-pick <key> "評語"           寫入一則（會記下寫的時間）
//   node fantasy_report/trade_notes.js --prune-picks [--teams 4,11]     刪掉不在目前候選裡的舊評語
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const FILE = path.resolve(__dirname, "../docs/trade-notes.json");
const PFILE = path.resolve(__dirname, "../docs/pick-notes.json");
const PICK_REFRESH = 24 * 3600000; // 超過 24 小時就重寫（網頁超過 36 小時就不顯示）
const PICK_GUIDE = [
  "這是寫給這一隊經營者「撿人之前」看的，幫他決定要不要撿：先講結論（值得撿／可以賭／可以等／不建議撿），再講主要原因。",
  "以 facts 為依據：剩下球季每週差幾分（兩種估法 × 例行賽／季後賽）、本週剩下和下週差幾分、兩人的今年／去年／近況、上場時間變化、傷病新聞、季後賽場數、持有率、是不是 waiver、丟的人淨貢獻。",
  "兩種估法都正（或都負）才下明確結論；正負不一時說清楚好處建立在什麼前提上（例如手感能不能維持、會不會回到去年水準）。只是本週多、長期少（或相反）也要點出來。",
  "有「賭中的話」時一定要講：照他最近變好的依據打下去每週能多拿多少、沒中會少多少、依據穩不穩（隊友缺陣的人主力回來就會掉）。賭中多、沒中少、丟的人淨貢獻低，結論可以寫「可以賭」並說要看什麼（例如上場時間能不能維持）；賭中也沒多多少就說不值得賭。賭中的話寫「沒有可賭的空間」時，照它的原因說他沒有可賭的上檔（例如上場時間變多已經算進預估）。",
  "有「缺陣隊友回來」時一定要講：誰預計哪天回來、回來後他每場大約多少（他在時的平均和場數），而且模擬已經照這個算了；最近的好表現多半是靠隊友缺陣，不要把缺陣時的分數當成他的水準。隊友一週內就回來時，通常是「不建議撿」或「只撿這幾天」。",
  "差距在每週 5 fpts 以內就說差不多；丟的人淨貢獻很低時可以提「丟掉幾乎沒損失」。",
  "繁體中文，1～3 句，口語、先講結論，不要逐項列數字。fantasy 分數寫 fpts、真實得分寫 pts。不要自己編傷勢或預測，只用 facts 裡的資料；不要提 ESPN 預測。",
];
const readPicks = () => { try { return JSON.parse(fs.readFileSync(PFILE, "utf8")); } catch (e) { return {}; } };
const writePicks = (o) => fs.writeFileSync(PFILE, JSON.stringify(o, null, 1) + "\n");
// 寫評語的方法（跟著 --pending 一起印出來，排程照這個寫）
const WRITING_GUIDE = [
  "看 facts，不要只看 text 的固定句：text 裡的「合計平均」在 2 換 1 時會誤導。",
  "結論以「剩下球季每週差幾分」為主：兩種估法（每場預估、長期水準）都正（或都負）才下明確結論；估法之間正負不一時，說清楚好處建立在什麼前提上（例如球員今年的表現能不能維持、會不會回到去年的水準）。",
  "交易兩隊都要評，並點出雙方的動機（例如對方傷兵多、需要 2 換 1 騰名額）。",
  "用球員的今年和去年判斷是不是賣在高點、買在低點；上場時間變化、傷病新聞、季後賽場數有影響就提。",
  "差距在每週 5 分以內就說差不多。用繁體中文，2～4 句，口語、先講結論，不要逐項列數字。",
];
const readNotes = () => { try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { return {}; } };
const writeNotes = (o) => fs.writeFileSync(FILE, JSON.stringify(o, null, 1) + "\n");
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };

async function collect() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const readJ = (f) => { try { return JSON.parse(fs.readFileSync(path.resolve(__dirname, "../docs/" + f), "utf8")); } catch (e) { return null; } };
  const adv = readJ("adv.json"), injn = readJ("injnews.json"); // 用 file:// 開網頁時 fetch 讀不到資料檔，先塞進去（傷病新聞給 facts 用）
  await page.addInitScript(([a, n]) => { window.__NOAUTH = true; window.__TNOTES = {}; if (a) window.__ADV = a; if (n) window.__INJN = n; }, [adv, injn]); // __TNOTES 先給空的：要的是「沒評語時」的規則文字
  await page.goto("file://" + path.resolve(__dirname, "../docs/index.html"));
  await page.waitForFunction(() => typeof CUR !== "undefined" && CUR && document.querySelector(".tabs"), null, { timeout: 120000 });
  const items = await page.evaluate(() => [...document.querySelectorAll(".mvx[data-key]")].map((el) => ({
    key: el.dataset.key, kind: el.classList.contains("trade") ? "交易" : "撿人丟人",
    time: (el.querySelector(".mvtm") || {}).textContent, day: (el.closest(".mvtl") && [...el.closest(".mvtl").children].reduce((d, c) => (c.classList.contains("mvday") && !d.done ? (c === el ? d : d) : d), { done: false }).day) || "",
    text: [...el.querySelector(".mvb").children].map((c) => c.textContent.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n"),
  })));
  // 每筆動態的模擬結果和球員細節（網頁的 window.moveFacts()）：寫評語時用這些，不要只看上面的固定句
  let facts = null;
  try { facts = await page.evaluate(() => (window.moveFacts ? window.moveFacts() : null)); } catch (e) { facts = null; }
  if (facts) for (const it of items) if (facts.動態[it.key]) it.facts = facts.動態[it.key];
  items.note = facts ? facts.說明 : null;
  await browser.close();
  return items;
}

async function collectPicks(teams) { // 每隊補強建議卡上的候選和資料（網頁的 window.pickFacts）；資料檔跟網頁讀的一樣，數字才會跟卡片上一致
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const readJ = (f) => { try { return JSON.parse(fs.readFileSync(path.resolve(__dirname, "../docs/" + f), "utf8")); } catch (e) { return null; } };
  const inj = {}; for (const [k, f] of Object.entries({ __ADV: "adv.json", __EPM: "epm.json", __INJN: "injnews.json", __PBP: "pbp.json", __WOWY: "wowy.json", __PLOG: "pbplog.json", __ASSIST: "assist.json", __BRK: "breakout.json", __B2B: "b2b.json", __RKS: "rookies.json", __HIST: "history.json" })) { const v = readJ(f); if (v) inj[k] = v; }
  await page.addInitScript((d) => { window.__NOAUTH = true; window.__TNOTES = {}; window.__PICKN = {}; for (const [k, v] of Object.entries(d)) window[k] = v; }, inj);
  await page.goto("file://" + path.resolve(__dirname, "../docs/index.html"));
  await page.waitForFunction(() => typeof CUR !== "undefined" && CUR && CUR.A && window.pickFacts, null, { timeout: 180000 });
  const out = { 說明: null, 候選: {} };
  for (const t of teams.length ? teams : [null]) {
    try { const r = await page.evaluate((t) => window.pickFacts(t), t); out.說明 = r.說明; Object.assign(out.候選, r.候選); } catch (e) { console.error("隊伍", t, "讀取失敗：", e.message); }
  }
  await browser.close();
  return out;
}

(async () => {
  const teams = (arg("--teams") || "").split(",").map(Number).filter(Boolean);
  if (process.argv.includes("--set-pick")) {
    const i = process.argv.indexOf("--set-pick"), key = process.argv[i + 1], text = process.argv[i + 2];
    if (!key || !text) { console.error("用法：--set-pick <key> \"評語\""); process.exit(1); }
    const n = readPicks(); n[key] = { t: text.trim(), at: new Date().toISOString() }; writePicks(n); console.log("已寫入", key); return;
  }
  if (process.argv.includes("--pending-picks") || process.argv.includes("--prune-picks")) {
    const c = await collectPicks(teams), n = readPicks(), now = Date.now();
    if (process.argv.includes("--prune-picks")) { let d = 0; for (const k of Object.keys(n)) if (!c.候選[k] || now - new Date(n[k].at).getTime() > 3 * 86400000) { delete n[k]; d++; } writePicks(n); console.log("刪除", d, "則舊的撿人評語"); return; }
    const pend = Object.entries(c.候選).filter(([k]) => !n[k] || !(now - new Date(n[k].at).getTime() < PICK_REFRESH)).map(([key, facts]) => ({ key, facts }));
    console.log(JSON.stringify(pend.length ? { 怎麼寫: PICK_GUIDE, 資料說明: c.說明, 待寫: pend } : [], null, 1));
    return;
  }
  if (process.argv.includes("--set")) {
    const i = process.argv.indexOf("--set"), key = process.argv[i + 1], text = process.argv[i + 2];
    if (!key || !text) { console.error("用法：--set <key> \"評語\""); process.exit(1); }
    const n = readNotes(); n[key] = text.trim(); writeNotes(n); console.log("已寫入", key); return;
  }
  const items = await collect();
  if (process.argv.includes("--prune")) {
    const n = readNotes(), keep = new Set(items.map((x) => x.key)); let d = 0;
    for (const k of Object.keys(n)) if (!keep.has(k)) { delete n[k]; d++; }
    writeNotes(n); console.log("刪除", d, "則過期評語"); return;
  }
  if (process.argv.includes("--pending")) {
    const n = readNotes();
    const pend = items.filter((x) => !n[x.key]).map(({ key, kind, time, text, facts }) => ({ key, kind, time, text, ...(facts ? { facts } : {}) }));
    // 有資料時多印一份寫評語的說明（沒有待寫的動態還是印 []，排程看到 [] 就結束）
    console.log(JSON.stringify(pend.length && items.note ? { 怎麼寫: WRITING_GUIDE, 資料說明: items.note, 待寫: pend } : pend, null, 1));
    return;
  }
  console.error("請指定 --pending、--set 或 --prune"); process.exit(1);
})();
