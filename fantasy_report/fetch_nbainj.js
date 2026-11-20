// 格式：{ updated, file, report, items: { 正規化名字: [ { n, st, why, gd（美國比賽日 YYYY-MM-DD）, mu, tm } ] } }
// NBA 官方傷病報告（球隊依聯盟規定申報，分 Out / Doubtful / Questionable / Probable / Available），存成 docs/nbainj.json 給網頁用。
// ESPN 的傷病狀態只分 Out 和 Day-To-Day，官方報告分得比較細；先只顯示和記錄（預估比對紀錄第 14 欄），驗證過才拿來算出賽機率。
// 報告是 PDF，網址像 https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-11-20_02_00PM.pdf（美東時間），
// 比賽日一天更新好幾次；這支程式從現在往回每 15 分鐘找一次，用找到的最新一份。需要系統有 pdftotext（poppler），沒有就改用 python 的 pypdf。
//   node fantasy_report/fetch_nbainj.js
const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path"), os = require("os");
const FILE = process.env.NBAINJ_OUT || path.resolve(__dirname, "../docs/nbainj.json"); // NBAINJ_OUT：測試時寫到別的地方
const BASE = "https://ak-static.cms.nba.com/referee/injury/";
const STATUS = ["Out", "Doubtful", "Questionable", "Probable", "Available"];
const TEAMS = ["Atlanta Hawks", "Boston Celtics", "Brooklyn Nets", "Charlotte Hornets", "Chicago Bulls", "Cleveland Cavaliers", "Dallas Mavericks", "Denver Nuggets", "Detroit Pistons", "Golden State Warriors", "Houston Rockets", "Indiana Pacers", "LA Clippers", "Los Angeles Clippers", "Los Angeles Lakers", "Memphis Grizzlies", "Miami Heat", "Milwaukee Bucks", "Minnesota Timberwolves", "New Orleans Pelicans", "New York Knicks", "Oklahoma City Thunder", "Orlando Magic", "Philadelphia 76ers", "Phoenix Suns", "Portland Trail Blazers", "Sacramento Kings", "San Antonio Spurs", "Toronto Raptors", "Utah Jazz", "Washington Wizards"];
// 名字統一成「名 姓」小寫、去掉重音和 Jr./III 這類字尾（網頁用同樣的規則對 ESPN 的名字）
const normName = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w && !["jr", "sr", "ii", "iii", "iv"].includes(w)).join(" ");

// 美東時間的年月日時分
function etParts(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: true }).formatToParts(d).map((x) => [x.type, x.value]));
  return { y: p.year, m: p.month, d: p.day, h: p.hour === "00" ? "12" : p.hour, mi: p.minute, ap: p.dayPeriod.toUpperCase() };
}
const reportName = (d) => { const p = etParts(d); return `Injury-Report_${p.y}-${p.m}-${p.d}_${p.h}_${p.mi}${p.ap}.pdf`; };

function download(name, out) {
  try { execFileSync("curl", ["-sf", "--max-time", "30", "-A", "Mozilla/5.0", "-o", out, BASE + name]); } catch (e) { return false; }
  return fs.existsSync(out) && fs.readFileSync(out).slice(0, 4).toString() === "%PDF";
}
function pdfText(file) {
  try { return execFileSync("pdftotext", ["-layout", file, "-"], { maxBuffer: 32 * 1024 * 1024 }).toString(); } catch (e) { /* 沒有 pdftotext */ }
  // pypdf 的 layout 模式欄位間距跟 pdftotext 差不多
  return execFileSync("python3", ["-I", "-c", "import sys,pypdf;print('\\n'.join(p.extract_text(extraction_mode='layout') for p in pypdf.PdfReader(sys.argv[1]).pages))", file], { maxBuffer: 32 * 1024 * 1024 }).toString();
}

function parse(text) {
  const lines = text.split(/\r?\n/), items = {};
  const rowRe = new RegExp(`(?:^|\\s{2,})(\\p{L}(?:[\\p{L}.'\\-]| (?! ))*?, \\p{L}(?:[\\p{L}.'\\-]| (?! ))*?)\\s{2,}(${STATUS.join("|")})\\b\\s*(.*)$`, "u");
  const onlyReason = (s) => s && /^\s{30,}\S/.test(s) && !rowRe.test(s) && !/Injury Report:|Page \d+ of|Game Date/.test(s);
  let gd = null, mu = null, team = null, report = null;
  lines.forEach((ln, i) => {
    const rp = ln.match(/Injury Report:\s*([\d/]+ [\d:]+ [AP]M)/); if (rp && !report) report = rp[1];
    const dm = ln.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/); if (dm) gd = `${dm[3]}-${dm[1]}-${dm[2]}`;
    const mm = ln.match(/\b([A-Z]{2,4})@([A-Z]{2,4})\b/); if (mm) mu = mm[0];
    const tm = TEAMS.find((t) => ln.includes(t)); if (tm) team = tm;
    const r = ln.match(rowRe); if (!r) return;
    const [last, first] = r[1].split(", "), name = `${first} ${last}`.replace(/\s+/g, " ").trim();
    let why = r[3].trim();
    if (!why) why = [lines[i - 1], lines[i + 1]].filter(onlyReason).map((s) => s.trim()).join(" ");
    else if (onlyReason(lines[i + 1])) why += " " + lines[i + 1].trim();
    const k = normName(name), it = { n: name, st: r[2], why: why.replace(/^Injury\/Illness - /, ""), gd, mu, tm: team };
    // 報告通常同時列今天和明天的比賽，同一個人可能出現兩次：每個人存一個陣列（照比賽日排），網頁挑對應那天的
    (items[k] = items[k] || []).push(it); items[k].sort((a, b) => String(a.gd).localeCompare(String(b.gd)));
  });
  return { report, items };
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nbainj-")), pdf = path.join(tmp, "r.pdf");
  // 從現在（取整到 15 分鐘）往回找最多 48 小時
  const t0 = new Date(Math.floor(Date.now() / 900000) * 900000);
  let found = null;
  if (process.env.NBAINJ_REPORT && download(process.env.NBAINJ_REPORT, pdf)) found = process.env.NBAINJ_REPORT; // 測試用：指定某一份報告
  for (let k = 0; k <= 48 * 4 && !found; k++) { const name = reportName(new Date(t0 - k * 900000)); if (download(name, pdf)) found = name; }
  if (!found) throw new Error("48 小時內找不到官方傷病報告（非賽季或網址格式改了）");
  const { report, items } = parse(pdfText(pdf));
  const n = Object.keys(items).length;
  if (n < 5) throw new Error(`報告 ${found} 只解析出 ${n} 位球員，可能格式改了，不更新`);
  let old = null; try { old = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { /* 第一次 */ }
  if (old && old.file === found) { console.log(`官方傷病報告沒有新的一份（還是 ${found}），不更新`); return; }
  fs.writeFileSync(FILE, JSON.stringify({ updated: new Date().toISOString(), file: found, report, items }, null, 1));
  const cnt = {}; for (const l of Object.values(items)) for (const v of l) cnt[`${v.gd.slice(5)} ${v.st}`] = (cnt[`${v.gd.slice(5)} ${v.st}`] || 0) + 1;
  console.log(`已寫入 ${FILE}：${found}（${report}），${n} 位球員，` + Object.entries(cnt).sort().map(([k, v]) => `${k} ${v}`).join("、"));
})().catch((e) => { console.error("抓不到官方傷病報告：", e.message); process.exit(1); });
