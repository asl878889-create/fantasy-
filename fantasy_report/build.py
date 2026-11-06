"""產生每日報告 HTML。用法：python -m fantasy_report.build"""
from __future__ import annotations

import datetime as dt
import html as htmllib
import os
from pathlib import Path
from zoneinfo import ZoneInfo

from jinja2 import Environment, FileSystemLoader

from .data import Report

ROOT = Path(__file__).resolve().parent.parent


def todo_list(r: Report, days, ideas, worst, rest):
    items = []
    diff = r.my_score - r.opp_score
    # 1. 先發排錯
    for d in days:
        if d["issues"]["benched"]:
            names = "、".join(p.name for p in d["issues"]["benched"])
            items.append(("要做", f"{d['label']} 把 {names} 換上先發",
                          f"他們這天有比賽，但 ESPN 上現在排在替補。"))
        if d["issues"]["injured"]:
            names = "、".join(f"{p.name}({INJ.get(p.injury, p.injury)})" for p in d["issues"]["injured"])
            items.append(("要做", f"{d['label']} 先發有傷兵：{names}",
                          "受傷的球員不會得分，請換成健康、當天有比賽的人。"))
    if not any(d["issues"]["benched"] or d["issues"]["injured"] for d in days):
        items.append(("留意", "本週剩下的先發都排好了",
                      "我逐日讀了 ESPN 的先發：每天有比賽、能排上的人都在先發。"))

    # 2. 比分預估
    my_rest = sum(d["my_proj"] for d in days)
    opp_rest = sum(d["opp_proj"] for d in days)
    final = diff + my_rest - opp_rest
    lead = "領先" if diff >= 0 else "落後"
    tag = "留意" if final >= 0 else "要做"
    items.append((tag, f"目前{lead} {abs(diff):.0f} 分，預估最後{'贏' if final >= 0 else '輸'} {abs(final):.0f} 分",
                  f"剩下 {len(days)} 天，預估你再拿 {my_rest:.0f} 分、對手 {opp_rest:.0f} 分"
                  "（用今年平均和近 15 場各半估算）。"))

    # 3. 先發空位
    for d in days:
        empty = r.starters - len(d["mine"])
        if empty > 0:
            names = "、".join(f"{f.name}（{f.avg}）" for f in r.stream_for(d["period"]))
            items.append(("建議", f"{d['label']} 你只有 {len(d['mine'])} 人上場",
                          f"對手這天 {len(d['theirs'])} 人。" + (f"這天有比賽的自由球員：{names}。" if names else "")))

    # 4. 換人建議
    limit = r.acq.get("matchupAcquisitionLimit", -1)
    added = r.adds_this_week(r.me.team_id)
    if ideas and worst:
        f = ideas[0]
        items.append(("建議", f"可以考慮用 {f.name} 換掉 {worst.name}",
                      f"{f.name} 平均 {f.avg}、近 7 場 {f.last7 or '-'}，本週還有 {f.week_games} 場；"
                      f"{worst.name} 平均 {worst.avg}、近 7 場 {worst.last7 or '-'}。"
                      f"本週你已經加了 {added} 人"
                      + (f"（聯盟規定每{'天' if r.acq.get('matchupLimitPerScoringPeriod') else '週'}最多 {limit:.0f} 人）" if limit and limit > 0 else "")
                      + "。"))
    return items


INJ = {"OUT": "OUT", "DAY_TO_DAY": "DTD", "SUSPENSION": "SSPD", "QUESTIONABLE": "Q", "DOUBTFUL": "D", "PROBABLE": "P"}


def make_verdict(worst, ideas):
    """每位球員一句話的判斷：(顏色, 文字)。"""
    f = lambda v: "-" if v is None else f"{v:.1f}"

    def verdict(x):
        a, l7, ly = f(x.avg), f(x.last7), f(x.last_year)
        if x.out:
            return "mute", f"{INJ.get(x.injury, '傷兵')}，暫時不會得分。去年 {ly}，回來後再看狀況。"
        if worst and x.id == worst.id and ideas:
            return "bad", f"今年 {a}、去年 {ly}，是陣容最弱的一環，可以換成 {ideas[0].name}（今年 {f(ideas[0].avg)}）。"
        if x.avg >= 38 or (x.last_year is not None and x.last_year >= 40 and x.avg >= 33):
            return "core", f"核心。今年 {a}、去年 {ly}，不要動。"
        if x.last_year is None:
            return "good", f"新秀或去年沒上場，沒有去年樣本。今年 {a}、近 7 場 {l7}。"
        if x.last7 is not None and x.last7 >= x.avg + 5:
            return "good", f"近 7 場 {l7}，比今年 {a} 高，手感正熱。"
        if x.last7 is not None and x.last7 <= x.avg - 5:
            return "bad", f"近 7 場 {l7}，比今年 {a} 低，要留意。"
        if x.last_year >= x.avg + 5:
            return "mid", f"今年 {a}、去年 {ly}，還沒回到去年水準，可以再等等。"
        if x.avg >= x.last_year + 5:
            return "good", f"今年 {a} 比去年 {ly} 好，進步明顯。"
        return "mid", f"表現穩定：今年 {a}、去年 {ly}。"
    return verdict


def make_fa_verdict(worst):
    f = lambda v: "-" if v is None else f"{v:.1f}"

    def verdict(x):
        a, l7, ly = f(x.avg), f(x.last7), f(x.last_year)
        if x.injury == "DAY_TO_DAY":
            return "mid", f"DTD，撿之前先確認能不能上場。今年 {a}。"
        if worst and x.proj > worst.proj + 3:
            if x.week_games == 0:
                return "mid", f"比你的 {worst.name}（今年 {f(worst.avg)}）好，但本週沒比賽了，可以下週再撿。"
            return "good", f"比你的 {worst.name}（今年 {f(worst.avg)}）好，本週還有 {x.week_games} 場，值得撿。"
        if x.last7 is not None and x.last7 >= x.avg + 5:
            return "good", f"近 7 場 {l7}，比今年 {a} 高，手感正熱，可以觀察。"
        if x.last7 is not None and x.last7 <= x.avg - 5:
            return "bad", f"近 7 場 {l7}，比今年 {a} 低，先不要撿。"
        if x.last_year is not None and x.last_year >= x.avg + 5:
            return "mid", f"去年 {ly}，今年 {a} 還沒回到水準，有反彈空間。"
        return "mute", f"跟你現有的人差不多，不急著撿。"
    return verdict


def strength(roster, key, n):
    """健康球員中，某項平均最高的 n 人加總。"""
    vals = sorted((getattr(p, key) or 0 for p in roster if not p.out), reverse=True)
    return sum(vals[:n])


def compare(r: Report, days):
    n = r.starters
    def side(team, roster, score, proj, starts):
        return {"score": score, "starts": starts, "proj": proj, "final": score + proj,
                "power": strength(roster, "avg", n), "hot": strength(roster, "last7", n),
                "out": sum(1 for p in roster if p.injury == "OUT" or p.lineup_slot == 13),
                "adds": r.adds_this_week(team.team_id)}
    vs = [side(r.me, r.my_roster, r.my_score, sum(d["my_proj"] for d in days), sum(len(d["mine"]) for d in days)),
          side(r.opp, r.opp_roster, r.opp_score, sum(d["opp_proj"] for d in days), sum(len(d["theirs"]) for d in days))]
    rows = [("目前得分", "score", 1), ("剩餘出賽人次", "starts", 1), ("預估剩餘得分", "proj", 1),
            ("預估最終得分", "final", 1), ("陣容實力", "power", 1), ("近 7 場實力", "hot", 1),
            ("OUT 人數", "out", -1), ("本週已加人數", "adds", 0)]
    table = []
    for name, k, d in rows:
        m, o = vs[0][k], vs[1][k]
        cm = ("win" if (m - o) * d > 0 else "lose") if d and m != o else ""
        co = {"win": "lose", "lose": "win"}.get(cm, "")
        table.append((name, f"{m:.0f}", cm, f"{o:.0f}", co))
    league = sorted(({"t": t, "week": r.week_scores.get(t.team_id, 0),
                      "power": strength(r.rosters[t.team_id], "avg", n),
                      "hot": strength(r.rosters[t.team_id], "last7", n)} for t in r.lg.teams),
                    key=lambda x: -x["power"])
    return table, league


CN = ["零", "一", "兩", "三", "四", "五"]


def last_name(n):
    parts = n.split(" ")
    return " ".join(parts[1:]) if len(parts) > 1 else n


def team_report(r: Report, v, views, schedule):
    """每隊的「核心 / 判斷 / 對你」三行重點，依數據自動產生（和即時版同樣規則）。"""
    t, ros, verdict = v["t"], r.rosters[v["t"].team_id], v["verdict"]
    r0 = lambda x: str(int(x + 0.5)) if x >= 0 else str(-int(-x + 0.5))

    def flag(x):
        if x.lineup_slot == 13:
            return f"(IR {INJ.get(x.injury, 'OUT') if x.injury not in ('ACTIVE', 'NORMAL') else 'OUT'})"
        return f"({INJ.get(x.injury, x.injury)})" if x.injury not in ("ACTIVE", "NORMAL") else ""

    core = sorted((x for x in ros if verdict(x)[0] == "core"), key=lambda x: -x.avg)
    if len(core) < 2:
        core = sorted(ros, key=lambda x: -max(x.avg, 0))[:3]
    core_text = "、".join(
        f"{last_name(x.name)} {r0(x.avg)}/{'-' if x.last7 is None else r0(x.last7)}/{'-' if x.last_year is None else r0(x.last_year)}{flag(x)}"
        if i < 2 else f"{last_name(x.name)} {r0(x.avg)}{flag(x)}" for i, x in enumerate(core[:4]))

    healthy = sorted((x for x in ros if not x.out), key=lambda x: -x.avg)
    stars = [x for x in healthy if x.avg >= 38]
    mid = [x for x in healthy if x.avg < 38][:max(0, r.starters - len(stars))]
    lo = r0(min(x.avg for x in mid)) if mid else "0"
    hi_v = max((x.avg for x in mid), default=0)
    hi = r0(hi_v)
    parts = []
    if len(stars) >= 2:
        n = CN[len(stars)] if len(stars) < len(CN) else f"{len(stars)} "
        parts.append(f"{n}個一線球員（{'、'.join(last_name(x.name) for x in stars)}），其他主力多在 {lo} 到 {hi} 分")
    elif len(stars) == 1:
        s0 = stars[0]
        parts.append(f"{last_name(s0.name)} 撐起陣容（今年 {r0(s0.avg)}），其他主力多在 {lo} 到 {hi} 分"
                     + ("，頭重腳輕" if s0.avg - hi_v >= 15 else ""))
    else:
        parts.append(f"沒有一線球員，主力多在 {lo} 到 {hi} 分，靠平均分散")
    hurt = [x for x in ros if x.out and max(x.avg, x.last_year or 0) >= 30]
    if hurt:
        parts.append("、".join(f"{last_name(x.name)}（OUT，{'今年 ' + r0(x.avg) if x.avg > 0 else '去年 ' + r0(x.last_year)}）"
                              for x in hurt) + "傷停中，回來後陣容會更深")
    down = [x for x in healthy[:8] if x.last_year is not None and x.last_year - x.avg >= 6][:2]
    if down:
        parts.append("、".join(f"{last_name(x.name)} 今年 {r0(x.avg)} 低於去年 {r0(x.last_year)}" for x in down) + "，要看能不能回升")
    hot = [x for x in healthy[:10] if x.last7 is not None and x.last7 - x.avg >= 8][:2]
    if hot:
        parts.append("、".join(f"{last_name(x.name)} 近 7 場 {r0(x.last7)}" for x in hot) + "，手感正熱")
    teams = r.lg.teams
    win_rank = sorted(teams, key=lambda x: (-x.wins, -x.points_for)).index(t) + 1
    pf_rank = sorted(teams, key=lambda x: -x.points_for).index(t) + 1
    pa_rank = sorted(teams, key=lambda x: x.points_against).index(t) + 1
    if pf_rank - win_rank >= 3:
        parts.append(f"戰績 {t.wins}-{t.losses} 但總得分只排第 {pf_rank}，戰績偏好看，較可能往下掉")
    elif win_rank - pf_rank >= 3:
        parts.append(f"總得分排第 {pf_rank}，實力比戰績 {t.wins}-{t.losses} 好")
    elif pa_rank == 1 and t.wins >= t.losses:
        parts.append(f"失分 {r0(t.points_against)} 是全聯盟最低，戰績有賽程運氣成分；總得分排第 {pf_rank}")
    else:
        parts.append(f"總得分排第 {pf_rank}")
    for m in schedule:
        if m["matchupPeriodId"] == r.week and m.get("away") and t.team_id in (m["home"]["teamId"], m["away"]["teamId"]):
            mine, op = (m["home"], m["away"]) if m["home"]["teamId"] == t.team_id else (m["away"], m["home"])
            pts = lambda x: x.get("totalPointsLive") if x.get("totalPointsLive") is not None else x.get("totalPoints", 0)
            d = pts(mine) - pts(op)
            parts.append(f"本週{'領先' if d >= 0 else '落後'} {abs(d):.0f} 分")

    to_you = ""
    if t.team_id != r.me.team_id:
        mine = next(x for x in views if x["t"].team_id == r.me.team_id)
        d = v["power"] - mine["power"]
        bits = []
        if t.team_id == r.opp.team_id:
            diff = r.my_score - r.opp_score
            bits.append(f"本週對手，你{'領先' if diff >= 0 else '落後'} {abs(diff):.0f} 分")
        if d >= 10:
            bits.append(f"陣容實力 {r0(v['power'])} 比你的 {r0(mine['power'])} 強，是要追的對象")
        elif d <= -25:
            bits.append(f"弱隊，陣容實力 {r0(v['power'])} 比你的 {r0(mine['power'])} 低很多，沒有威脅")
        else:
            bits.append(f"實力跟你接近（{r0(v['power'])} 對 {r0(mine['power'])}）")
        meets = [m["matchupPeriodId"] for m in schedule if m["matchupPeriodId"] > r.week and m.get("away")
                 and {m["home"]["teamId"], m["away"]["teamId"]} == {r.me.team_id, t.team_id}]
        if meets:
            bits.append(f"第 {meets[0]} 週" + (f"與第 {meets[1]} 週" if len(meets) > 1 else "") + "會跟你碰面")
        to_you = "。".join(bits) + "。"
    return {"core": core_text, "judge": "。".join(parts) + "。", "to_you": to_you}


def team_views(r: Report, league, my_worst, my_ideas):
    """每一隊的陣容、判斷和重點卡片（本週對手排第一個，其餘依陣容實力）。"""
    ranked = [x["t"].team_id for x in league]  # league 已依陣容實力排序
    fas = r.free_agents()
    views = []
    for t in r.lg.teams:
        ros = r.rosters[t.team_id]
        if t.team_id == r.me.team_id:
            worst, ideas = my_worst, my_ideas
        else:
            healthy = sorted((p for p in ros if not p.out), key=lambda p: p.proj)
            worst = healthy[0] if healthy else None
            ideas = [f for f in fas if worst and f.proj > worst.proj + 3][:5]
        v = make_verdict(worst, ideas)
        rows = sorted(sorted(ros, key=lambda p: -p.avg), key=lambda p: p.lineup_slot)
        lg_row = next(x for x in league if x["t"].team_id == t.team_id)
        views.append({"t": t, "verdict": v, "rows": [(p, v(p)) for p in rows], "power": lg_row["power"],
                      "rank": ranked.index(t.team_id) + 1,
                      "core": sum(1 for p in ros if v(p)[0] == "core"),
                      "out": sum(1 for p in ros if p.injury == "OUT" or p.lineup_slot == 13),
                      "is_opp": t.team_id == r.opp.team_id, "is_me": t.team_id == r.me.team_id})
    views.sort(key=lambda x: (not x["is_opp"], -x["power"]))
    schedule = r.lg.espn_request.league_get(params={"view": "mMatchupScore"})["schedule"]
    for v in views:
        v["report"] = team_report(r, v, views, schedule)
    return views


def trade_analysis(r: Report):
    """賣高買低：你今年比去年好很多的球員，換別隊今年比去年差很多的球員。"""
    base = lambda x: (x.avg + x.last_year) / 2  # 兩季平均
    hot = lambda x: (x.last7 if x.last7 is not None else x.avg) - x.avg
    sell = []
    for x in r.my_roster:
        if x.out or x.last_year is None or x.avg <= 0:
            continue
        gap = x.avg - x.last_year
        if gap >= 5 or (gap >= 2 and hot(x) >= 6):
            sell.append({"p": x, "gap": gap, "hot": hot(x), "base": base(x)})
    sell.sort(key=lambda d: -d["gap"])
    buy = []
    for t in r.lg.teams:
        if t.team_id == r.me.team_id:
            continue
        for x in r.rosters[t.team_id]:
            if x.out or x.last_year is None or x.last_year < 25 or x.avg <= 0:
                continue
            gap = x.last_year - x.avg
            if gap >= 5:
                buy.append({"p": x, "team": t, "gap": gap, "hot": hot(x), "base": base(x)})
    buy.sort(key=lambda d: -(d["gap"] + max(d["hot"], 0)))
    ideas = []
    for b in buy:
        for m in sell:
            fair = m["p"].avg - b["p"].avg
            gain = b["base"] - m["base"]
            if fair >= -3 and gain >= 2:
                ideas.append({"m": m, "b": b, "fair": fair, "gain": gain})
    ideas.sort(key=lambda d: -d["gain"])
    used, picks = {}, []
    for i in ideas:
        mid, bid = i["m"]["p"].id, i["b"]["p"].id
        if used.get(mid, 0) >= 2 or any(p["b"]["p"].id == bid for p in picks):
            continue
        used[mid] = used.get(mid, 0) + 1
        picks.append(i)
        if len(picks) >= 6:
            break
    return {"sell": sell, "buy": buy[:12], "picks": picks}


def main():
    league_id = int(os.environ.get("ESPN_LEAGUE_ID", "406470928"))
    year = int(os.environ.get("ESPN_SEASON", "2027"))
    team = os.environ.get("ESPN_TEAM", "Podcast P")
    r = Report(league_id, year, team,
               espn_s2=os.environ.get("ESPN_S2"), swid=os.environ.get("ESPN_SWID"))

    days = r.days()
    ideas, worst, rest = r.waiver_ideas()
    env = Environment(loader=FileSystemLoader(ROOT / "fantasy_report"), autoescape=True)
    html = env.get_template("template.html").render(
        r=r, days=days, ideas=ideas, worst=worst,
        todos=todo_list(r, days, ideas, worst, rest),
        threats=r.threats(), injuries=r.injuries(), standings=r.standings(),
        adds=r.adds_this_week(r.me.team_id),
        verdict=make_verdict(worst, ideas),
        fa_verdict=make_fa_verdict(worst),
        compare=(cmp := compare(r, days)),
        trade=trade_analysis(r),
        team_views=team_views(r, cmp[1], worst, ideas),
        fa_list=r.free_agents()[:20],
        waiver_order="".join(
            (f"<span><b>{r.waiver[t.team_id]}. {htmllib.escape(t.team_name)}</b></span>" if t.team_id == r.me.team_id
             else f"<span>{r.waiver[t.team_id]}. {htmllib.escape(t.team_name)}</span>")
            for t in sorted((t for t in r.lg.teams if r.waiver.get(t.team_id)), key=lambda t: r.waiver[t.team_id])),
        next_week=[p + 7 for p in r.week_periods],
        day_char={p: r.day_label(p)[1] for p in r.remaining},
        now=dt.datetime.now(ZoneInfo("Asia/Taipei")).strftime("%Y-%m-%d %H:%M"),
    )
    out = ROOT / "output" / "report.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"已產生 {out}")


if __name__ == "__main__":
    main()
