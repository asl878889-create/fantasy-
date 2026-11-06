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
            names = "、".join(f"{p.name}({p.injury})" for p in d["issues"]["injured"])
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
        now=dt.datetime.now(ZoneInfo("Asia/Taipei")).strftime("%Y-%m-%d %H:%M"),
    )
    out = ROOT / "output" / "report.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"已產生 {out}")


if __name__ == "__main__":
    main()
