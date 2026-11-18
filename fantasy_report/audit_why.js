// 檢查單場原因卡片（球員視窗點分數出現的「這場高低分的原因」）：
// 全聯盟每位球員（各隊陣容＋前 40 名自由球員）本季每一場都跑一次，用規則找出結論互相矛盾或說錯的地方。
// 改到 gameWhy() 之後跑一次，問題要是 0 才算改好。
//   node fantasy_report/audit_why.js [輸出 json，預設不存]
const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  const path = require("path");
  const readJ = (f) => { try { return JSON.parse(fs.readFileSync(path.resolve(__dirname, "../docs/" + f), "utf8")); } catch (e) { return null; } };
  const D0 = { __ADV: readJ("adv.json"), __INJN: readJ("injnews.json"), __PBP: readJ("pbp.json"), __PLOG: readJ("pbplog.json"), __WOWY: readJ("wowy.json") }; // file:// 讀不到資料檔，先塞進去
  await p.addInitScript((d) => { window.__NOAUTH = true; window.__TNOTES = {}; for (const [k, v] of Object.entries(d)) if (v) window[k] = v; }, D0);
  await p.goto("file://" + path.resolve(__dirname, "../docs/index.html"));
  await p.waitForFunction(() => typeof CUR !== "undefined" && CUR && document.querySelector(".tabs"), null, { timeout: 200000 });
  const res = await p.evaluate(async () => {
    const D = CUR;
    const players = [...new Map([...Object.values(D.rosters).flat(), ...D.fas.slice(0, 40)].map((x) => [x.id, x])).values()];
    const cards = {};
    for (let i = 0; i < players.length; i += 10) {
      await Promise.all(players.slice(i, i + 10).map(async (x) => {
        try {
          const r = await get(`${LEAGUE}?view=kona_playercard`, { players: { filterIds: { value: [x.id] }, filterStatsForTopScoringPeriodIds: { value: 200, additionalValue: ["00" + SEASON] } } });
          cards[x.id] = r.players && r.players[0] && r.players[0].player;
        } catch (e) { cards[x.id] = null; }
      }));
    }
    const V = [], stats = { players: 0, games: 0, dnp: 0 };
    const add = (x, st, rule, msg, o, html) => V.push({ player: x.name, period: st.scoringPeriodId, fpts: st.appliedTotal, rule, msg, causes: o.causes, html: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 700) });
    for (const x of players) {
      const pl = cards[x.id]; if (!pl) continue; stats.players++;
      const all = (pl.stats || []).filter((st) => st.statSplitTypeId === 5 && st.statSourceId === 0 && st.seasonId === SEASON && st.stats && st.stats["40"] != null).sort((a, b) => b.scoringPeriodId - a.scoringPeriodId);
      const ss = (pl.stats || []).find((st) => st.statSplitTypeId === 0 && st.statSourceId === 0 && st.seasonId === SEASON && st.stats), season = ss ? { gp: Number(ss.stats["42"]) || 0, tot: ss.stats } : null;
      const proId = pl.proTeamId;
      const oppOf = (st) => { const g = GAMES[Number(String(st.id).slice(2))]; if (!g) return ""; const home = g.homeProTeamId === proId; return ABBR[home ? g.awayProTeamId : g.homeProTeamId] || ""; };
      const avg = x.avg || (ss && ss.appliedAverage) || 0;
      for (const st of all) {
        stats.games++;
        const o = {}; let html;
        try { html = gameWhy(st, all.slice(0, 10), avg, season, oppOf(st), x, o); } catch (e) { add(x, st, "例外", String(e.message || e), {}, ""); continue; }
        if (o.dnp) { stats.dnp++; continue; }
        const g = (k) => Number(st.stats[k]) || 0, B = o.base, txt = html.replace(/<[^>]+>/g, " ");
        const has = (t) => o.causes.some((c) => c.includes(t));
        if (/打得保守|綁手綁腳/.test(txt)) add(x, st, "沒根據的推測", "犯規推測打得保守", o, html);
        if (/NaN|undefined|Infinity|null/.test(txt)) add(x, st, "壞數字", "卡片裡有 NaN／undefined／Infinity／null", o, html);
        for (const [k, v] of Object.entries(B)) if (v < -0.01) add(x, st, "基準為負", `基準 ${k} = ${v.toFixed(2)}（季總計可能不含這場）`, o, html);
        { const shownSum = o.diffs.reduce((t, z) => t + z.d, 0) + o.offSum + o.rest; if (Math.abs(shownSum - o.d) > 0.2) add(x, st, "加總不符", `各項 ${shownSum.toFixed(1)} vs 標題 ${o.d.toFixed(1)}`, o, html); }
        if (Math.abs(o.rest) >= 2 && !/其他小項合計[^（]*：/.test(txt)) add(x, st, "小項沒展開", `其他小項 ${o.rest.toFixed(1)} 沒列出內容`, o, html);
        for (const z of o.diffs.concat(o.offs)) if (!txt.includes(PART_NAME[z.k])) add(x, st, "項目沒顯示", z.k, o, html);
        if (o.even) { if (!/差不多/.test(txt)) add(x, st, "差不多", "差距小於 3 卻沒說差不多", o, html);
          const sw = Object.keys(o.parts).map((k) => o.parts[k] - o.mean[k]); if (sw.some((d) => d >= 5) && sw.some((d) => d <= -5) && !/內容不一樣/.test(txt)) add(x, st, "抵銷沒說", "差不多但有大幅互相抵銷", o, html); continue; }
        for (const z of o.diffs) if (Math.abs(z.d) >= 5 && !o.ck.includes(z.k) && !(z.k === "pf" || z.k === "win")) add(x, st, "大項沒進結論", `${z.k} ${z.d.toFixed(1)}`, o, html);
        if (/主要靠罰球/.test(txt) && !((g("15") - B["15"]) >= 0.5 * (g("0") - B["0"]))) add(x, st, "主要靠罰球不成立", `罰進多 ${(g("15") - B["15"]).toFixed(1)}、pts 多 ${(g("0") - B["0"]).toFixed(1)}`, o, html);
        if (/罰得多又準|罰球 \+[\d.]+ 也有加分/.test(txt)) add(x, st, "罰球說法錯", "罰球那塊只反映罰丟幾球", o, html);
        if (/（[^（）]*（/.test(txt.replace(/真實命中率[^；]*/g, ""))) add(x, st, "括號套括號", "", o, html);
        const main = o.ck.filter((k) => !["opp", "offs"].includes(k));
        if (!main.length && !(o.diffs.length === 0 && /沒有單一明顯原因/.test(txt))) add(x, st, "沒有原因", "差距 3 以上卻沒有主要原因", o, html);
        // 差最多的那一項一定要出現在結論（除非上場時間、犯規、球權已經是原因）
        if (o.diffs.length && !o.ck.includes(o.diffs[0].k) && !o.ck.some((k) => ["min-", "min+", "foul", "usg"].includes(k))) add(x, st, "主因沒寫", `差最多的是 ${o.diffs[0].k}（${o.diffs[0].d.toFixed(1)}）卻沒寫進結論`, o, html);
        // 每一項原因的方向要跟這場一致
        for (const k of o.ck) if (["reb", "ast", "stl", "blk", "tov", "pf", "win", "score"].includes(k)) { const d = o.parts[k] - o.mean[k]; if (o.low ? d >= 0 : d <= 0) add(x, st, "方向相反", `${k} 差 ${d.toFixed(1)}，跟這場${o.low ? "低分" : "高分"}方向相反`, o, html); }
        if (o.ck.includes("score") && o.scoreTop) { const sd = o.subD.find((z) => z.k === o.scoreTop).d; if (o.low ? sd >= 0 : sd <= 0) add(x, st, "拆項方向相反", `${o.scoreTop} 差 ${sd.toFixed(1)}`, o, html); }
        const pct = (m, a) => (a > 0 ? m / a : null);
        const efg = (fgm, tpm, a) => (a > 0 ? (fgm + 0.5 * tpm) / a : null), eG = efg(g("13"), g("17"), g("14")), eB = efg(B["13"], B["17"], B["14"]);
        const pr = (k1, k2) => [pct(g(k1), g(k2)), pct(B[k1], B[k2])];
        if (o.scoreTop === "tp" || o.scoreTop === "fg") { const [r, rb] = o.scoreTop === "tp" ? pr("17", "18") : pr("13", "14");
          if ((has("手感冷") || has("準度差")) && !(r != null && rb != null && r < rb)) add(x, st, "手感冷但命中率不低", `${r} vs ${rb}`, o, html);
          if ((has("手感熱") || has("很準")) && !(r != null && rb != null && r > rb)) add(x, st, "手感熱但命中率不高", `${r} vs ${rb}`, o, html); }
        if ((has("投得很準") || has("準度也差") || has("投籃其實偏冷")) && o.scoreTop === "pts") { const up = has("投得很準"); if (!(eG != null && eB != null && (up ? eG > eB : eG < eB))) add(x, st, "eFG 方向不符", `${eG} vs ${eB}`, o, html); }
        if (has("罰丟太多") && !(pct(g("15"), g("16")) != null && pct(g("15"), g("16")) < pct(B["15"], B["16"]))) add(x, st, "罰丟太多但罰球率不低", `${g("15")}/${g("16")}`, o, html);
        if (has("得分機會少") && !((o.usgD == null || o.usgD < 5) && o.fga < o.fgaAvg - 3 && g("0") < B["0"])) add(x, st, "得分機會少不成立", `出手 ${o.fga} vs ${o.fgaAvg.toFixed(1)}、pts ${g("0")} vs ${B["0"].toFixed(1)}、使用率差 ${o.usgD}`, o, html);
        if (has("得分機會多") && !((o.fga > o.fgaAvg + 3 || (o.usgD != null && o.usgD >= 5)))) add(x, st, "得分機會多不成立", `出手 ${o.fga} vs ${o.fgaAvg.toFixed(1)}`, o, html);
        if (has("pts 偏少") && !(g("0") < B["0"])) add(x, st, "pts 偏少不成立", `${g("0")} vs ${B["0"].toFixed(1)}`, o, html);
        if (has("pts 很多") && !(g("0") > B["0"])) add(x, st, "pts 很多不成立", `${g("0")} vs ${B["0"].toFixed(1)}`, o, html);
        if (has("上場時間只有") && !(o.min < o.mMin - 4)) add(x, st, "上場時間不成立", `${o.min} vs ${o.mMin.toFixed(1)}`, o, html);
        if (has("上場時間較長") && !(o.min > o.mMin + 4)) add(x, st, "上場時間不成立", `${o.min} vs ${o.mMin.toFixed(1)}`, o, html);
        if (o.ck.includes("foul") && !(o.low && g("9") >= 5 && o.min < o.mMin - 4)) add(x, st, "犯規不成立", `${g("9")} 犯、${o.min} 分鐘 vs ${o.mMin.toFixed(1)}`, o, html);
        { const e1 = (fgm, tpm, a) => (a > 0 ? (fgm + 0.5 * tpm) / a : null), dE = g("14") >= 5 && e1(g("13"), g("17"), g("14")) != null && e1(B["13"], B["17"], B["14"]) != null ? e1(g("13"), g("17"), g("14")) - e1(B["13"], B["17"], B["14"]) : null;
          if (o.ck.includes("score") && dE != null && (o.low ? dE <= -0.05 : dE >= 0.05) && !o.causes.some((c) => /準|手感|偏冷|罰丟/.test(c))) add(x, st, "準度沒提", `eFG 差 ${(dE * 100).toFixed(0)}%`, o, html); }
        if (o.causes.some((c) => c.includes("幾乎只靠")) && o.diffs.length !== 1) add(x, st, "只靠不成立", `同方向有 ${o.diffs.length} 項`, o, html);
        if (o.ck.includes("score") && o.scoreTop && o.subD) { const top = [...o.subD].sort((p, q) => (o.low ? p.d - q.d : q.d - p.d))[0]; if (top.k !== o.scoreTop) add(x, st, "拆項不是最大", `${o.scoreTop} vs ${top.k}`, o, html); }
        if (o.ck.includes("opp") && o.defRank != null && !(o.low ? o.defRank <= 8 : o.defRank >= 23) && !o.causes.some((c) => c.includes("讓對手拿得"))) add(x, st, "對手不相關", `第 ${o.defRank}`, o, html);
        if (o.ck.includes("offs") && !(Math.abs(o.offSum) >= 4)) add(x, st, "抵銷不成立", `${o.offSum}`, o, html);
        if (o.ck.includes("usg") && o.usgD != null && (o.low ? o.usgD > 0 : o.usgD < 0)) add(x, st, "球權方向相反", `${o.usgD}`, o, html);
        if (/罰進一球只值 1 fpts/.test(txt) && !(g("15") >= B["15"] + 4 && g("0") >= B["0"] - 3)) add(x, st, "罰球多不成立", `罰進 ${g("15")} vs ${B["15"].toFixed(1)}`, o, html);
        if (/主要靠罰球/.test(txt) && !(g("15") >= B["15"] + 4)) add(x, st, "靠罰球不成立", `罰進 ${g("15")} vs ${B["15"].toFixed(1)}`, o, html);
      }
    }
    return { stats, V };
  });
  const byRule = {};
  for (const v of res.V) byRule[v.rule] = (byRule[v.rule] || 0) + 1;
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(res, null, 1));
  for (const v of res.V.slice(0, 10)) console.log(`- [${v.rule}] ${v.player} 第 ${v.period} 天 ${v.fpts} fpts：${v.msg}`);
  console.log("球員", res.stats.players, "場次", res.stats.games, "DNP", res.stats.dnp, "問題", res.V.length);
  console.log(byRule);
  console.log("page errors:", errs.slice(0, 3));
  await b.close();
  process.exit(res.V.length ? 1 : 0);
})();
