"""聯盟連載做成影片：旁白（離線語音合成，不把文字送到外部服務）＋字幕＋各城徽章＋戰報和排名動畫。

用法：
  python fantasy_report/story_video.py [--week N] [--facts 素材.json] [--out 影片.mp4] [--speed 1.1]
    --week   要做哪一週的章節（預設最新一章）
    --facts  story.js --facts 印出的素材檔；沒給就自己跑 node fantasy_report/story.js --facts --week N（約 1 分鐘）
    --out    輸出檔（預設 output/story-第N週.mp4）

需要：ffmpeg、Playwright（node）、pip 的 sherpa-onnx、soundfile、numpy。
語音模型第一次用會從 GitHub 下載到 ~/.cache/story-tts（約 170 MB），之後就不用再下載。
"""
import argparse, json, os, re, subprocess, sys, tarfile, urllib.request

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-melo-tts-zh_en.tar.bz2"
SR = 44100

# 各城：故事裡的稱呼（找得到就算提到這一城）、顏色、徽章上的字、ESPN 隊名
TEAMS = [
    ("艾斯帕", ["艾斯帕", "aespa", "Leo"], "#ff4fd8", "艾", "aespa"),
    ("播客城", ["播客城", "說書人", "Hua"], "#4cc9f0", "播", "Podcast P"),
    ("布朗氏族", ["布朗氏族", "氏族", "外星巨人", "WeiChung"], "#f4a261", "布", "6布朗大急拔"),
    ("芝加哥火蟲", ["火蟲", "Hoyu"], "#ff6b2c", "火", "Chicago Firebugs"),
    ("原住民山莊", ["山莊", "Ching Hsuan"], "#2ec4b6", "山", "原住民山莊"),
    ("村BA省隊", ["村BA", "Caleb"], "#b5c99a", "村", "村BA省隊"),
    ("雲豹部族", ["雲豹", "字母哥", "關城主"], "#ffd166", "豹", "桃園台啤永豐雲豹"),
    ("嘟嘟嘟魔女團", ["魔女團", "魔女", "Sensen"], "#7bd389", "魔", "她很壞嘟嘟嘟"),
    ("三分射手公會", ["公會", "17*3"], "#9b5de5", "弓", "17*3PTS's Pointed Team"),
    ("K 鎮", ["K 鎮", "Lawns"], "#ef476f", "K", "K-Town Ja Wick"),
]
BY_ESPN = {t[4]: t for t in TEAMS}


def ensure_model():
    d = os.path.expanduser("~/.cache/story-tts")
    m = os.path.join(d, "vits-melo-tts-zh_en")
    if os.path.exists(os.path.join(m, "model.onnx")):
        return m
    os.makedirs(d, exist_ok=True)
    print("下載語音模型（約 170 MB，只有第一次）…", file=sys.stderr)
    tmp = os.path.join(d, "m.tar.bz2")
    urllib.request.urlretrieve(MODEL_URL, tmp)
    with tarfile.open(tmp) as tf:
        tf.extractall(d)
    os.remove(tmp)
    return m


def make_tts(speed):
    import sherpa_onnx
    d = ensure_model() + "/"
    cfg = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=d + "model.onnx", lexicon=d + "lexicon.txt", tokens=d + "tokens.txt", dict_dir=d + "dict"),
            num_threads=4),
        rule_fsts=f"{d}date.fst,{d}number.fst,{d}phone.fst,{d}new_heteronym.fst")
    tts = sherpa_onnx.OfflineTts(cfg)

    def say(text):
        spoken = speakable(text)
        a = tts.generate(spoken, sid=0, speed=speed)
        x = np.asarray(a.samples, dtype=np.float32)
        if a.sample_rate != SR:  # 簡單重取樣
            x = np.interp(np.linspace(0, len(x), int(len(x) * SR / a.sample_rate), endpoint=False), np.arange(len(x)), x).astype(np.float32)
        return x
    return say


def speakable(t):
    """給語音念的版本：模型不認得的符號換掉。"""
    t = t.replace("17*3", "十七乘三").replace("「", "").replace("」", "").replace("：", "，").replace("；", "，").replace("、", "，")
    t = re.sub(r"(\d+) 勝 (\d+) 敗", r"\1勝\2敗", t)
    t = re.sub(r"(\d+) 比 (\d+)", r"\1比\2", t)
    t = t.replace("K 鎮", "K鎮").replace("（", "，").replace("）", "，")
    return t


def sentences(p):
    """一段拆成句子（字幕一次一句）；太長的句子在逗號切開。"""
    out = []
    for s in re.findall(r"[^。！？]+[。！？」]*", p):
        s = s.strip()
        if not s:
            continue
        while len(s) > 46:
            cut = max((m.end() for m in re.finditer(r"[，；：]", s[:46])), default=0)
            if cut < 12:
                break
            out.append(s[:cut]); s = s[cut:].strip()
        out.append(s)
    return out


def team_in(s):
    best = None
    for t in TEAMS:
        for a in t[1]:
            i = s.find(a)
            if i >= 0 and (best is None or i < best[0]):
                best = (i, t)
    return best[1] if best else None


def stat_in(s):
    """句子裡的重點數字：比分「1315 比 1267」，或「Jokic 243」這種球員戰功。"""
    m = re.search(r"(\d{3,4}) 比 (\d{3,4})", s)
    if m:
        return {"kind": "score", "a": int(m.group(1)), "b": int(m.group(2))}
    best = None
    for m in re.finditer(r"([A-Z][A-Za-z.'\-]*(?: [A-Z][A-Za-z.'\-]*)*) (?:打了 |打出 |也有 |單人 |一週 |這週打出 )?(\d{2,3})(?! 分鐘)(?: 戰功)?", s):
        v = int(m.group(2))
        if v >= 100 and (best is None or v > best["v"]):
            best = {"kind": "player", "name": m.group(1), "v": v}
    m = re.search(r"打出 (\d{4})", s)
    if not best and m:
        return {"kind": "team", "v": int(m.group(1))}
    m = re.search(r"差(?:距|了)? ?(\d{2,3}) 分", s)
    if not best and m:
        best = {"kind": "gap", "v": int(m.group(1))}
    return best


def pad_music(total):
    """背景音樂：Am–F–C–G 和弦的柔和長音，音量很小，不蓋過旁白。"""
    n = int(total * SR); t = np.arange(n) / SR
    chords = [[220.0, 261.63, 329.63], [174.61, 220.0, 261.63], [261.63, 329.63, 392.0], [196.0, 246.94, 293.66]]
    seg = 4.0
    y = np.zeros(n, dtype=np.float32)
    for k in range(int(total / seg) + 1):
        a, b = int(k * seg * SR), min(n, int((k + 1) * seg * SR + SR))
        if a >= n:
            break
        tt = t[a:b] - k * seg
        env = np.minimum(1, tt / 1.2) * np.clip((seg + 1 - tt) / 1.5, 0, 1)
        for f in chords[k % 4]:
            for h, g in ((1, 1.0), (2, 0.25), (0.5, 0.35)):
                y[a:b] += (g * np.sin(2 * np.pi * f * h * tt + 0.3 * np.sin(2 * np.pi * 0.2 * tt)) * env).astype(np.float32)
    y /= max(1e-6, np.abs(y).max())
    fade = np.minimum(1, np.minimum(t / 2, (total - t) / 3))
    return (y * 0.07 * fade).astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--week", type=int)
    ap.add_argument("--facts")
    ap.add_argument("--out")
    ap.add_argument("--speed", type=float, default=1.1)
    ap.add_argument("--fps", type=int, default=24)
    ap.add_argument("--no-render", action="store_true", help="只做旁白和時間軸（測試用）")
    o = ap.parse_args()

    S = json.load(open(os.path.join(ROOT, "docs/story.json"), encoding="utf8"))
    chs = S["chapters"]
    ch = next((c for c in chs if c["week"] == o.week), None) if o.week else chs[-1]
    if not ch:
        sys.exit(f"沒有第 {o.week} 週的章節")
    no = chs.index(ch) + 1
    W = ch["week"]
    if o.facts:
        F = json.load(open(o.facts, encoding="utf8"))
    else:
        print("讀取這一週的素材…", file=sys.stderr)
        F = json.loads(subprocess.check_output(["node", os.path.join(ROOT, "fantasy_report/story.js"), "--facts", "--week", str(W)], cwd=ROOT))
    out = o.out or os.path.join(ROOT, "output", f"story-第{W}週.mp4")
    work = os.path.join(os.path.dirname(os.path.abspath(out)), f".story-work-{W}")
    os.makedirs(work, exist_ok=True)

    say = make_tts(o.speed)
    clips, scenes, t = [], [], 0.0

    def add_voice(text, at):
        x = say(text); clips.append((at, x)); return len(x) / SR

    def tinfo(t):
        return {"name": t[0], "color": t[2], "glyph": t[3], "espn": t[4]} if t else None

    # 1. 片頭
    d = add_voice(f"{S.get('title', '聯盟連載')}，第{no}章，{ch['title']}。", 1.0)
    scenes.append({"type": "title", "start": 0, "dur": d + 2.6, "series": S.get("title", "聯盟連載"), "no": no, "title": ch["title"], "week": W, "dates": F.get("日期", "")})
    t = d + 2.6

    # 2. 本週戰報
    ms = [{"a": BY_ESPN.get(m["主"], [m["主"]])[0], "b": BY_ESPN.get(m["客"], [m["客"]])[0], "ca": BY_ESPN.get(m["主"], [0, 0, "#888"])[2], "cb": BY_ESPN.get(m["客"], [0, 0, "#888"])[2],
           "sa": int(m["比分"].split(":")[0]), "sb": int(m["比分"].split(":")[1]), "win": m["勝方"]} for m in F["對戰"]]
    for m, src in zip(ms, F["對戰"]):
        m["wa"] = src["勝方"] == src["主"]; m["wb"] = src["勝方"] == src["客"]
    d = add_voice(f"第{W}週，五場對決的結果。", t + 0.4)
    scenes.append({"type": "board", "start": t, "dur": max(d + 0.4, 7.5), "week": W, "ms": ms})
    t += max(d + 0.4, 7.5)

    # 3. 故事本文：一段一個場景，一句一個字幕
    cur_team = None
    for p in [x.strip() for x in ch["body"].split("\n") if x.strip()]:
        subs, st = [], t
        cur_team = None  # 每段重新判斷主角城
        for s in sentences(p):
            dd = add_voice(s, t)
            tm = team_in(s) or cur_team
            cur_team = tm
            subs.append({"text": s, "start": t, "dur": dd + 0.35, "team": tinfo(tm), "stat": stat_in(s)})
            t += dd + 0.35
        t += 0.4
        scenes.append({"type": "para", "start": st, "dur": t - st, "subs": subs})

    # 4. 排名
    rk = [{"rank": x["名次"], "name": BY_ESPN.get(x["隊名"], [x["隊名"]])[0], "color": BY_ESPN.get(x["隊名"], [0, 0, "#888"])[2], "glyph": BY_ESPN.get(x["隊名"], [0, 0, 0, "?"])[3],
           "rec": x["戰績"], "chg": x["名次變化"], "streak": x.get("連勝連敗")} for x in F["排名"]]
    d = add_voice(f"第{W}週結束後的排名。", t + 0.4)
    scenes.append({"type": "standings", "start": t, "dur": max(d + 0.4, 8.0), "week": W, "rows": rk})
    t += max(d + 0.4, 8.0)

    # 5. 片尾：下週對戰
    nxt = []
    for s in F.get("下週對戰", []):
        a, b = s.split(" vs ")
        ta, tb = BY_ESPN.get(a), BY_ESPN.get(b)
        nxt.append({"a": ta[0] if ta else a, "b": tb[0] if tb else b, "ca": ta[2] if ta else "#888", "cb": tb[2] if tb else "#888", "ga": ta[3] if ta else "?", "gb": tb[3] if tb else "?"})
    d = add_voice("下週，未完待續。", t + 0.6)
    scenes.append({"type": "end", "start": t, "dur": max(d + 2.5, 7.0), "next": nxt, "series": S.get("title", "聯盟連載")})
    t += max(d + 2.5, 7.0)

    total = t
    y = pad_music(total)
    for at, x in clips:
        a = int(at * SR); y[a:a + len(x)] += x[: max(0, len(y) - a)] * 0.95
    y = np.clip(y, -1, 1)
    import soundfile as sf
    sf.write(os.path.join(work, "audio.wav"), y, SR)
    json.dump({"total": total, "fps": o.fps, "scenes": scenes}, open(os.path.join(work, "timeline.json"), "w", encoding="utf8"), ensure_ascii=False)
    print(f"旁白和時間軸好了：{total:.1f} 秒，開始畫影片…", file=sys.stderr)
    if o.no_render:
        print(work); return
    subprocess.check_call(["node", os.path.join(ROOT, "fantasy_report/story_video_render.js"), work, out], cwd=ROOT)
    print(out)


if __name__ == "__main__":
    main()
