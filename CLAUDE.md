# YouTube Shorts 頻道：工作方式

這個程式庫用 `make_short.py` 產生 NBA／ESPN Fantasy 的中文 YouTube Shorts。

## 使用者的固定偏好

- **只做剪映（CapCut）版**：`python3 make_short.py episodes/<集>.json`（預設就是剪映版）。交付時要給：
  - `-capcut.mp4`（沒旁白、沒字幕）
  - `-capcut-voice.srt`（朗讀用）
  - `-capcut.srt`（畫面字幕用）

  不用做 AI 旁白版，除非使用者要求（`--ai-voice`）。
- **數據一律用最新的**：使用者的 Fantasy 日報網站每天更新，數據在本程式庫的分支 `claude/espn-fantasy-program-5xkd16` 的 `docs/*.json`（`git fetch --depth 1 origin claude/espn-fantasy-program-5xkd16`）。不要用 claude.ai 上的「Fantasy 日報預覽」頁面，那份是舊的。
- **推薦任何球員前，先用 `docs/nbainj.json`（NBA 官方傷病報告）確認他沒受傷**，也要確認相關主力的傷病狀態。
- **給一般 NBA 觀眾的影片（冷知識類）只用真實數據**（得分、籃板、助攻、命中率），不要用 fpts；真實數據可從 ESPN 公開 API 抓（`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/<ESPN 球員 ID>/overview`，ID 就是 `rookies.json` 等檔案的鍵），`gameLog` 有最近 5 場。fpts 只用在 Fantasy 類影片。
- Fantasy 類影片字幕寫「N fpts」，念的時候是「N fantasy points」（`-voice.srt` 會自動轉）。
- 畫面上不要放頂部的白色進度條（預設已關閉）。
- 列「第一招、第二招、第三招」這種教學時，從第一個講起（episode JSON 加 `"order": "ascending"`）；只有排名類（例如必撿第 3 名到第 1 名）才倒數。
- 球員要挑有細節、比較冷門的，不要大家都知道的名字；每支影片要有「只有使用者網站算得出來」的數字。
- 內容要重質：第 1 秒就有鉤子、一支只講一件事、25–40 秒、結尾提問好引留言。完整計畫見 `PLAN-YPP.md`。
- 用中文（繁體）和使用者溝通。

## 檔案

- `episodes/*.json`：每一集的內容。可以用固定格式（hook／players／cta），或用自由場景 `scenes`，種類有 hook2、versus、ranking、trend、question。
- `episodes/*-SCRIPT.md`：每集的旁白、數據來源、標題、說明、置頂留言。
- `videos/`：交付給使用者的成品，`out/` 是暫存。
- `assets/lexicon_extra.txt`：AI 念錯的英文名字，在這裡補念法。
