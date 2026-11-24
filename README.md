# fantasy-

用程式自動產生 NBA Fantasy（ESPN Fantasy）YouTube Shorts：每週撿人推薦。

- 畫面：1080×1920 直式、30fps，有動態文字、轉場和燒進畫面的中文字幕
- 音樂：程式現場合成的節拍 + 轉場音效（沒有版權問題）
- AI 旁白：離線 Kokoro 語音模型（Apache-2.0），中英混講，字幕逐句跟著語音；第一次執行會自動下載模型（約 360 MB）
- 也可以用 `--voice` 換成你自己錄的旁白（背景音樂會自動降低音量）
- 參數：`--speed` 語速、`--voice-id` 換聲音、`--no-tts` 不要旁白
- 想用 CapCut／剪映的配音（較自然）：`--capcut` 產生沒配音、沒字幕的影片＋時間對好的 `.srt`，步驟見 [CAPCUT.md](CAPCUT.md)
- 一般模式也會輸出 `.srt`，可以上傳到 YouTube 當 CC 字幕

## 使用方式

需要 Python 3、ffmpeg，再執行 `pip install -r requirements.txt`。第一次執行會自動下載 Noto Sans TC 字型（OFL 授權）。

```bash
python3 make_short.py episodes/2026-wk06.json
```

輸出：`out/2026-wk06-waiver.mp4`

```bash
python3 make_short.py episodes/2026-wk06.json --stills
```
只輸出每一段的關鍵畫面 PNG，方便快速檢查排版。

```bash
python3 make_short.py episodes/2026-wk06.json --voice voice.m4a
```
混入旁白。

## 每週做新的一集

1. 複製 `episodes/2026-wk06.json` → `episodes/2026-wk07.json`
2. 改 `slug`、`week_label`、`date_range`、`as_of`，以及 3 位球員的 `first`/`last`/`team`/`team_zh`/`stats`/`reason`/`tags`/`caption`
3. `caption` 就是字幕兼旁白稿，用「，。！」斷句。AI 念錯字可以加 `narration` 欄位寫念法；英文人名念錯就把念法加到 `assets/lexicon_extra.txt`
4. 跑 `make_short.py`

每集的旁白腳本和上傳資訊放在 `episodes/*-SCRIPT.md`。
