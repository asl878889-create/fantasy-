"""從 ESPN Fantasy 讀取聯盟資料，整理成日報需要的格式。"""
from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass, field
from zoneinfo import ZoneInfo

from espn_api.basketball import League
from espn_api.basketball.constant import POSITION_MAP

ET = ZoneInfo("America/New_York")
BENCH, IR = 12, 13
WEEKDAYS = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"]


@dataclass
class P:
    """一位球員（簡化後）。"""
    id: int
    name: str
    team: str
    pos: str
    slots: list[int]          # 可以放的先發位置（數字代號）
    lineup_slot: int          # 目前在哪個位置
    injury: str
    avg: float                # 今年平均
    last7: float | None
    last15: float | None
    last_year: float | None = None
    own: float | None = None
    games: set[int] = field(default_factory=set)  # 有比賽的 scoring period

    @property
    def out(self) -> bool:
        return self.injury in ("OUT", "SUSPENSION") or self.lineup_slot == IR

    @property
    def proj(self) -> float:
        """預估每場分數：今年平均與近 15 場各半。"""
        if self.last15 is not None:
            return 0.5 * self.avg + 0.5 * self.last15
        return self.avg


def _stat_avg(player, key):
    s = player.stats.get(key) or {}
    v = s.get("applied_avg")
    return round(v, 1) if v else None


def to_p(player, year: int) -> P:
    slots = [POSITION_MAP[s] for s in player.eligibleSlots if s in POSITION_MAP]
    slots = [s for s in slots if isinstance(s, int) and s not in (BENCH, IR)]
    games = set()
    for k in (player.schedule or {}):
        try:
            games.add(int(k))
        except ValueError:
            pass
    slot = POSITION_MAP.get(player.lineupSlot, BENCH)
    return P(
        id=player.playerId,
        name=player.name,
        team=player.proTeam,
        pos=player.position,
        slots=slots,
        lineup_slot=slot if isinstance(slot, int) else BENCH,
        injury=player.injuryStatus or "ACTIVE",
        avg=round(player.avg_points or 0, 1),
        last7=_stat_avg(player, f"{year}_last_7"),
        last15=_stat_avg(player, f"{year}_last_15"),
        games=games,
    )


def best_lineup(players: list[P], slot_counts: dict[int, int]) -> list[P]:
    """當天能排上先發的最佳組合（依預估分數由高到低，用擴增路徑配位置）。"""
    seats = [s for s, n in slot_counts.items() for _ in range(n)]
    owner: dict[int, P] = {}  # seat index -> player

    def place(p: P, seen: set[int]) -> bool:
        for i, s in enumerate(seats):
            if s in p.slots and i not in seen:
                seen.add(i)
                if i not in owner or place(owner[i], seen):
                    owner[i] = p
                    return True
        return False

    for p in sorted(players, key=lambda x: -x.proj):
        place(p, set())
    return list(owner.values())


class Report:
    def __init__(self, league_id: int, year: int, team: str, espn_s2=None, swid=None):
        self.lg = League(league_id=league_id, year=year, espn_s2=espn_s2, swid=swid)
        self.year = year
        lg = self.lg
        raw = lg.espn_request.league_get(params={"view": ["mSettings", "mTeam"]})
        counts = raw["settings"]["rosterSettings"]["lineupSlotCounts"]
        self.slot_counts = {int(k): v for k, v in counts.items() if v and int(k) not in (BENCH, IR)}
        self.acq = raw["settings"]["acquisitionSettings"]
        self.tx = {t["id"]: t.get("transactionCounter", {}) for t in raw["teams"]}
        self.waiver = {t["id"]: t.get("waiverRank") for t in raw["teams"]}

        self.me = self._find_team(team)
        self.period = lg.scoringPeriodId
        self.week = lg.currentMatchupPeriod
        # 今天（美東）對應 scoring period，用來換算日期
        self.today_et = dt.datetime.now(ET).date()
        self.base = self.today_et - dt.timedelta(days=self.period)
        monday = self.today_et - dt.timedelta(days=self.today_et.weekday())
        self.week_periods = [self.period - self.today_et.weekday() + i for i in range(7)]
        self.week_start, self.week_end = monday, monday + dt.timedelta(days=6)
        self.remaining = [p for p in self.week_periods if p >= self.period]

        boxes = lg.box_scores(matchup_period=self.week)
        self.week_scores = {}
        for b in boxes:
            if b.home_team:
                self.week_scores[b.home_team.team_id] = b.home_score
            if b.away_team:
                self.week_scores[b.away_team.team_id] = b.away_score
        box = next(b for b in boxes if self.me in (b.home_team, b.away_team))
        home = box.home_team == self.me
        self.opp = box.away_team if home else box.home_team
        self.my_score = box.home_score if home else box.away_score
        self.opp_score = box.away_score if home else box.home_score

        self.my_roster = [to_p(x, year) for x in self.me.roster]
        self.opp_roster = [to_p(x, year) for x in self.opp.roster]
        self.rosters = {t.team_id: [to_p(x, year) for x in t.roster] for t in lg.teams}
        self.rosters[self.me.team_id] = self.my_roster
        self.rosters[self.opp.team_id] = self.opp_roster
        # espn-api 沒有去年平均和持有率，另外從 ESPN 原始資料補上（所有隊伍）
        raw_all = lg.espn_request.league_get(params={"view": "mRoster"})
        extra = {}
        for t in raw_all["teams"]:
            for e in t["roster"]["entries"]:
                pl = e["playerPoolEntry"]["player"]
                ly = next((st.get("appliedAverage") for st in pl.get("stats", [])
                           if st["id"] == f"00{year - 1}" and st["statSourceId"] == 0), None)
                extra[pl["id"]] = (round(ly, 1) if ly else None, (pl.get("ownership") or {}).get("percentOwned"))
        for ros in self.rosters.values():
            for p in ros:
                p.last_year, p.own = extra.get(p.id, (None, None))
        self.my_daily_slots = {p: self._lineup_on(self.me.team_id, p) for p in self.remaining}
        self.starters = sum(self.slot_counts.values())

        # 自由球員的資料沒有賽程，所以用聯盟裡所有被選走的球員拼出各 NBA 球隊的賽程
        self.team_games: dict[str, set[int]] = {}
        for t in lg.teams:
            for x in t.roster:
                self.team_games.setdefault(x.proTeam, set()).update(to_p(x, year).games)
        self._fas = None

    def _find_team(self, name):
        for t in self.lg.teams:
            if name.lower() in (t.team_name.lower(), t.team_abbrev.lower(), str(t.team_id)):
                return t
        names = "、".join(t.team_name for t in self.lg.teams)
        raise SystemExit(f"找不到隊伍「{name}」，聯盟裡的隊伍有：{names}")

    def _lineup_on(self, team_id: int, period: int) -> dict[int, int]:
        """ESPN 上某一天（scoring period）的先發設定：player id -> slot。"""
        r = self.lg.espn_request.league_get(
            params={"view": "mRoster", "scoringPeriodId": period, "forTeamId": team_id})
        team = next(t for t in r["teams"] if t["id"] == team_id)
        return {e["playerId"]: e["lineupSlotId"] for e in team["roster"]["entries"]}

    # ---- 分析 ----
    def day_label(self, period: int) -> str:
        d = self.base + dt.timedelta(days=period)
        return f"{WEEKDAYS[d.weekday()]} {d.month}/{d.day}"

    def playing(self, roster: list[P], period: int) -> list[P]:
        return [p for p in roster if period in p.games and not p.out]

    def days(self):
        rows = []
        for per in self.remaining:
            mine = best_lineup(self.playing(self.my_roster, per), self.slot_counts)
            theirs = best_lineup(self.playing(self.opp_roster, per), self.slot_counts)
            rows.append({
                "period": per, "label": self.day_label(per),
                "mine": sorted(mine, key=lambda p: -p.proj),
                "theirs": sorted(theirs, key=lambda p: -p.proj),
                "my_proj": sum(p.proj for p in mine),
                "opp_proj": sum(p.proj for p in theirs),
                "issues": self.lineup_issues(per, mine),
            })
        return rows

    def lineup_issues(self, period: int, best: list[P]):
        """ESPN 當天的設定和最佳先發比較：有比賽卻坐板凳的人。"""
        slots = self.my_daily_slots.get(period, {})
        best_ids = {p.id for p in best}
        benched = [p for p in self.my_roster
                   if p.id in best_ids and slots.get(p.id) in (BENCH, None)]
        idle = [p for p in self.my_roster
                if slots.get(p.id) not in (BENCH, IR, None) and period not in p.games]
        injured_start = [p for p in self.my_roster
                         if slots.get(p.id) not in (BENCH, IR, None) and p.out]
        return {"benched": benched, "idle": idle, "injured": injured_start}

    def adds_this_week(self, team_id: int) -> int:
        tot = self.tx.get(team_id, {}).get("matchupAcquisitionTotals", {})
        return int(tot.get(str(self.week), 0))

    def free_agents(self) -> list[P]:
        if self._fas is None:
            fas = [to_p(x, self.year) for x in self.lg.free_agents(size=100)]
            fas = [f for f in fas if not f.out and f.avg > 0]
            # espn-api 沒有去年平均、持有率和 waiver 狀態，另外從 ESPN 原始資料補上
            flt = {"players": {"filterStatus": {"value": ["FREEAGENT", "WAIVERS"]}, "limit": 150,
                               "sortPercOwned": {"sortPriority": 1, "sortAsc": False}}}
            raw = self.lg.espn_request.league_get(
                params={"view": "kona_player_info", "scoringPeriodId": self.period},
                headers={"x-fantasy-filter": json.dumps(flt)})
            extra = {}
            for x in raw.get("players", []):
                pl = x["player"]
                ly = next((st.get("appliedAverage") for st in pl.get("stats", [])
                           if st["id"] == f"00{self.year - 1}" and st["statSourceId"] == 0), None)
                extra[pl["id"]] = (round(ly, 1) if ly else None,
                                   (pl.get("ownership") or {}).get("percentOwned"), x.get("status"))
            for f in fas:
                f.games = self.team_games.get(f.team, set())
                f.week_games = len(f.games & set(self.remaining))
                f.last_year, f.own, f.status = extra.get(f.id, (None, None, None))
            self._fas = sorted(fas, key=lambda f: -f.proj)
        return self._fas

    def stream_for(self, period: int, n=3) -> list[P]:
        """某天先發有空位時，當天有比賽、最值得撿的自由球員。"""
        return [f for f in self.free_agents() if period in f.games][:n]

    def waiver_ideas(self, n=5):
        rest = len(self.remaining)
        fas = self.free_agents()
        droppable = sorted([p for p in self.my_roster if not p.out], key=lambda p: p.proj)
        worst = droppable[0] if droppable else None
        ideas = []
        for f in fas:
            if worst and f.proj > worst.proj + 3:
                ideas.append(f)
            if len(ideas) >= n:
                break
        return ideas, worst, rest

    def threats(self, n=3):
        rem = set(self.remaining)
        ps = [p for p in self.opp_roster if not p.out and p.games & rem]
        ps.sort(key=lambda p: -p.proj)
        return [(p, len(p.games & rem)) for p in ps[:n]]

    def injuries(self):
        return [p for p in self.my_roster if p.injury not in ("ACTIVE", "NORMAL")]

    def standings(self):
        return sorted(self.lg.teams, key=lambda t: (-t.wins, t.losses, -t.points_for))
