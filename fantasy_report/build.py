"""產生每日報告 HTML。用法：python -m fantasy_report.build"""
from __future__ import annotations

import datetime as dt
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
            names = "、".join(f"{f.name}（{f.team}，今年 {f.avg}）" for f in r.stream_for(d["period"]))
            items.append(("建議", f"{d['label']} 你只有 {len(d['mine'])} 人上場，先發空 {empty} 格",
                          f"對手這天 {len(d['theirs'])} 人。" + (f"這天有比賽的自由球員：{names}。" if names else "")))

    # 4. 換人建議
    limit = r.acq.get("matchupAcquisitionLimit", -1)
    added = r.adds_this_week(r.me.team_id)
    if ideas and worst:
        f = ideas[0]
        items.append(("建議", f"可以考慮用 {f.name} 換掉 {worst.name}",
                      f"{f.name}（{f.team}）今年 {f.avg}、近 7 場 {f.last7 or '-'}，本週還有 {f.week_games} 場；"
                      f"{worst.name} 今年 {worst.avg}、近 7 場 {worst.last7 or '-'}。"
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
        compare=compare(r, days),
        fa_list=r.free_agents()[:20],
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
