# ESPN Fantasy 籃球日報

讀取 ESPN Fantasy 聯盟資料，產生一份手機好讀的每日報告：

- 本週比分、領先/落後幾分、預估最後比分
- 今天要做的事（先發有沒有排錯、哪天先發有空位、可以撿哪個自由球員）
- 剩下每天你和對手各有幾人上場
- 陣容平均分、自由球員推薦、傷兵、聯盟排名

## 使用方式

```bash
pip install -r requirements.txt
python -m fantasy_report.build
```

報告會產生在 `output/report.html`。

## 設定（環境變數）

| 名稱 | 說明 | 預設 |
|---|---|---|
| `ESPN_LEAGUE_ID` | 聯盟 ID | `406470928` |
| `ESPN_SEASON` | 球季（2026-27 球季是 2027） | `2027` |
| `ESPN_TEAM` | 你的隊名或隊伍編號 | `Podcast P` |
| `ESPN_S2`、`ESPN_SWID` | 私人聯盟才需要的登入 cookie | 不用設 |

聯盟目前是公開可見，所以不需要 cookie。

## 預估方式

每位球員每場預估分數 = 今年平均和近 15 場平均各一半。每天只算排得上先發的人（依位置限制挑最佳組合），受傷缺陣和傷兵名單的人不算。
