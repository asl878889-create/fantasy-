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
const readNotes = () => { try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { return {}; } };
const writeNotes = (o) => fs.writeFileSync(FILE, JSON.stringify(o, null, 1) + "\n");
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };

async function collect() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const adv = (() => { try { return JSON.parse(fs.readFileSync(path.resolve(__dirname, "../docs/adv.json"), "utf8")); } catch (e) { return null; } })();
  await page.addInitScript((a) => { window.__NOAUTH = true; window.__TNOTES = {}; if (a) window.__ADV = a; }, adv); // __TNOTES 先給空的：要的是「沒評語時」的規則文字
  await page.goto("file://" + path.resolve(__dirname, "../docs/index.html"));
  await page.waitForFunction(() => typeof CUR !== "undefined" && CUR && document.querySelector(".tabs"), null, { timeout: 120000 });
  const items = await page.evaluate(() => [...document.querySelectorAll(".mvx[data-key]")].map((el) => ({
    key: el.dataset.key, kind: el.classList.contains("trade") ? "交易" : "撿人丟人",
    time: (el.querySelector(".mvtm") || {}).textContent, day: (el.closest(".mvtl") && [...el.closest(".mvtl").children].reduce((d, c) => (c.classList.contains("mvday") && !d.done ? (c === el ? d : d) : d), { done: false }).day) || "",
    text: [...el.querySelector(".mvb").children].map((c) => c.textContent.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n"),
  })));
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
    console.log(JSON.stringify(items.filter((x) => !n[x.key]).map(({ key, kind, time, text }) => ({ key, kind, time, text })), null, 1));
    return;
  }
  console.error("請指定 --pending、--set 或 --prune"); process.exit(1);
})();
