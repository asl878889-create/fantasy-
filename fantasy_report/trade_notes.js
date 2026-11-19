// 交易、撿人丟人的評語：由排程（Claude）事先寫好，存成 docs/trade-notes.json，網頁有評語就顯示，沒有就用原本的固定句。
// 網頁本身不呼叫任何 AI，沒有金鑰，也不花 API 費用。
// 用法：
//   node fantasy_report/trade_notes.js --pending            印出「還沒有評語」的動態（JSON：key、時間、內容），沒有就印 []
//   node fantasy_report/trade_notes.js --set <key> "評語"    把一則評語寫進 docs/trade-notes.json（已有就覆蓋）
//   node fantasy_report/trade_notes.js --prune [天數]        刪掉聯盟動態已經看不到的舊評語（預設保留目前清單內的）
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const FILE = path.resolve(__dirname, "../docs/trade-notes.json");
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

(async () => {
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
