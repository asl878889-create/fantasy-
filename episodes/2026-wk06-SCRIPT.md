# Week 6 Waiver Wire：本週必撿 3 人（NBA）

約 39 秒 · 1080×1920 · **AI 旁白已內建**（離線 Kokoro 模型，普通話，中英混講），字幕跟著語音逐句出現。

## 旁白腳本（AI 會念這些；也可以自己照著錄）

| 時間 | 畫面 | 旁白（中英混講） |
|---|---|---|
| 0:00–0:05 | WEEK 6／本週必撿 3 人 | 這週 Fantasy 有三個人，一定要去 waiver 撿！ |
| 0:05–0:14 | #3 Kevin Huerter（DET） | 第三名，活塞的 Kevin Huerter。隊友 Robinson 受傷，他已經連續四場打超過 36 分鐘，缺三分的直接撿。 |
| 0:14–0:25 | #2 Mo Bamba（UTA） | 第二名，爵士的 Mo Bamba。前幾天單場砍下 26 分，三分球六投六中！爵士長人傷兵一堆，他很有機會升先發。 |
| 0:25–0:34 | #1 Julian Champagnie（SAS） | 第一名，馬刺的 Julian Champagnie。Harper 髖部拉傷，要休兩到三週，他可望直接升上先發。 |
| 0:34–0:39 | 你撿了誰？／訂閱 | 你這週撿了誰？留言告訴我，記得訂閱，每週更新！ |

旁白文字＝JSON 裡每段的 `caption`。如果 AI 念錯某個字，可以在那段加一個 `narration` 欄位寫「念法」（例如用同音字），字幕仍顯示 `caption`。英文名字念錯的話，把念法加到 `assets/lexicon_extra.txt`。

想換成自己的聲音：
```bash
python3 make_short.py episodes/2026-wk06.json --voice voice.m4a
```
調整 AI 語速（預設 1.05），或換聲音（3–57 女聲、58–102 男聲，預設 58）：
```bash
python3 make_short.py episodes/2026-wk06.json --speed 1.3
```
```bash
python3 make_short.py episodes/2026-wk06.json --voice-id 30
```

## 上傳資訊

**標題（擇一，都 ≤ 40 字，關鍵字放前面）**
1. 本週 Fantasy 必撿 3 人！第一名你還來得及 🏀 #shorts
2. NBA Fantasy Week 6 必撿｜Huerter、Bamba、Champagnie #shorts
3. 撿到賺到！這 3 個人你的聯盟可能還沒人撿 #NBAFantasy #shorts
4. 6 投 6 中的中鋒還在 waiver？本週必撿 3 人 #shorts
5. 傷兵潮＝撿人良機！ESPN Fantasy 本週必撿 #shorts
6. 不撿會後悔：NBA Fantasy Waiver 本週 Top 3 #shorts

建議：系列固定用「本週 Fantasy 必撿 3 人｜Week N」當開頭，觀眾一看就知道是每週更新的系列；第 4 個那種「問句＋數據」最容易引起點擊，可以拿來做 A/B 測試（YouTube Studio 的「測試與比較」）。

**說明**
```
NBA Fantasy Week 6（11/23–11/29）Waiver Wire 撿人推薦 🏀
#3 Kevin Huerter（活塞）— Duncan Robinson 傷缺，連 4 場 36+ 分鐘
#2 Mo Bamba（爵士）— 單場 26 分、三分 6/6，有望升先發
#1 Julian Champagnie（馬刺）— Dylan Harper 左髖拉傷預計休 2–3 週

你這週撿了誰？留言告訴我 👇
每週更新 ESPN Fantasy / Yahoo Fantasy 撿人推薦，記得訂閱！

※ 資料截至 2026/11/25，傷病消息每天變，請以最新報告為準。
※ 旁白為 AI 語音。
```

**Hashtags**：`#shorts #NBA #FantasyBasketball #ESPNFantasy #NBAFantasy #籃球 #夢幻籃球`

## 資料來源（上片前請再確認一次）
- Huerter 連 4 場 36+ 分鐘（Robinson 股四頭肌傷）、Champagnie 角色提升：[Yahoo Sports – Week 6 waiver](https://sports.yahoo.com/articles/fantasy-basketball-waiver-wire-week-152344766.html)、[NBC Sports – Week 6 waiver](https://www.nbcsports.com/fantasy/basketball/news/fantasy-basketball-waiver-wire-week-6-charles-bassey-julian-champagnie-filling-in-for-injured-stars)
- Mo Bamba 26 分、三分 6/6、ESPN 近一週熱門新增：[ESPN – Bamba, Grimes seizing opportunity](https://www.espn.com/fantasy/basketball/story/_/id/50541974/fantasy-basketball-tips-nba-betting-picks-today)
- Dylan Harper 左髖外旋肌拉傷、預計缺陣 2–3 週：[RotoBaller](https://www.rotoballer.com/player-news/dylan-harper-hip-expected-to-miss-2-to-3-weeks/1998250)

## 版權注意
影片內**沒有**使用 ESPN／NBA 的 logo、球員照片或比賽畫面（這些素材有版權，Shorts 很容易被 Content ID 認領）。「ESPN Fantasy」只用文字提到平台名稱。如果要加球員畫面，建議使用自己的螢幕錄影（例如自己的 ESPN Fantasy App 畫面）。
