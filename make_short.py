#!/usr/bin/env python3
"""Render a vertical 1080x1920 YouTube Short (NBA fantasy waiver picks) from an episode JSON.

Usage:
    python3 make_short.py episodes/2026-wk06.json
    python3 make_short.py episodes/2026-wk06.json --voice my_voiceover.wav
    python3 make_short.py episodes/2026-wk06.json --stills      # key-frame PNGs only
"""
import argparse
import json
import math
import random
import re
import subprocess
import sys
import urllib.request
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1080, 1920, 30
ROOT = Path(__file__).resolve().parent
NOTO = ROOT / "assets/fonts/NotoSansTC.ttf"
NOTO_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf"
INTER_DIR = Path("/usr/share/fonts/opentype/inter")

WHITE = (255, 255, 255, 255)
DIM = (255, 255, 255, 150)
BG_TOP = (10, 14, 32)
BG_BOT = (22, 10, 40)
HOOK_ACCENT = (255, 120, 40)
CAPTION_Y = 1440  # keep above YouTube Shorts bottom UI

# --------------------------------------------------------------------------- fonts

_fonts = {}


def ensure_fonts():
    if NOTO.exists():
        return
    NOTO.parent.mkdir(parents=True, exist_ok=True)
    print("Downloading Noto Sans TC (OFL)…", file=sys.stderr)
    urllib.request.urlretrieve(NOTO_URL, NOTO)


def font(kind, size, weight="Black"):
    """kind: 'latin' (Inter if installed, else Noto) or 'cjk' (Noto Sans TC)."""
    key = (kind, size, weight)
    if key not in _fonts:
        inter = INTER_DIR / f"Inter-{weight}.otf"
        if kind == "latin" and inter.exists():
            f = ImageFont.truetype(str(inter), size)
        else:
            f = ImageFont.truetype(str(NOTO), size)
            f.set_variation_by_name(weight)
        _fonts[key] = f
    return _fonts[key]


def fit_font(kind, text, max_w, size, weight="Black", min_size=24):
    while size > min_size:
        f = font(kind, size, weight)
        b = f.getbbox(text)
        if b[2] - b[0] <= max_w:
            return f
        size -= 4
    return font(kind, min_size, weight)


# --------------------------------------------------------------------------- sprites

_sprites = {}


def text_sprite(text, f, fill=WHITE, stroke=0, stroke_fill=(0, 0, 0, 255), outline_only=False, tracking=0):
    key = (text, id(f), fill, stroke, stroke_fill, outline_only, tracking)
    if key in _sprites:
        return _sprites[key]
    pad = stroke + 8
    if tracking:
        widths = [f.getlength(c) for c in text]
        tw = int(sum(widths) + tracking * (len(text) - 1))
    else:
        tw = int(f.getlength(text))
    asc, desc = f.getmetrics()
    w, h = tw + pad * 2 + 8, asc + desc + pad * 2

    def draw(img, color, sw):
        d = ImageDraw.Draw(img)
        if tracking:
            x = pad
            for c, cw in zip(text, widths):
                d.text((x, pad), c, font=f, fill=color, stroke_width=sw, stroke_fill=color)
                x += cw + tracking
        else:
            d.text((pad, pad), text, font=f, fill=color, stroke_width=sw, stroke_fill=color)

    if outline_only:
        outer = Image.new("L", (w, h), 0)
        inner = Image.new("L", (w, h), 0)
        draw(outer, 255, stroke)
        draw(inner, 255, 0)
        a = np.clip(np.asarray(outer, np.int16) - np.asarray(inner, np.int16), 0, 255).astype(np.uint8)
        img = Image.new("RGBA", (w, h), fill[:3] + (0,))
        img.putalpha(Image.fromarray(a))
    else:
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        if stroke:
            d = ImageDraw.Draw(img)
            d.text((pad, pad), text, font=f, fill=fill, stroke_width=stroke, stroke_fill=stroke_fill)
        else:
            draw(img, fill, 0)
    img = img.crop(img.getbbox() or (0, 0, 1, 1))
    _sprites[key] = img
    return img


def pill_sprite(text, f, bg, fg=WHITE, padx=34, pady=16, radius=None):
    key = ("pill", text, id(f), bg, fg)
    if key in _sprites:
        return _sprites[key]
    t = text_sprite(text, f, fg)
    w, h = t.width + padx * 2, t.height + pady * 2
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle((0, 0, w - 1, h - 1), radius or h // 2, fill=bg)
    img.alpha_composite(t, (padx, pady))
    _sprites[key] = img
    return img


def card_sprite(stat, accent, w=450, h=230):
    key = ("card", stat["value"], stat["zh"], accent)
    if key in _sprites:
        return _sprites[key]
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, w - 1, h - 1), 30, fill=(255, 255, 255, 22), outline=(255, 255, 255, 50), width=2)
    d.rounded_rectangle((26, 30, 34, h - 30), 4, fill=accent + (255,))
    v = text_sprite(stat["value"], fit_font("latin", stat["value"], w - 90, 112), accent + (255,))
    img.alpha_composite(v, (60, 28))
    zh = text_sprite(stat["zh"], fit_font("cjk", stat["zh"], w - 90, 38, "Bold"))
    img.alpha_composite(zh, (60, h - 92))
    en = text_sprite(stat["en"], font("latin", 22, "Bold"), DIM, tracking=3)
    img.alpha_composite(en, (60, h - 42))
    _sprites[key] = img
    return img


def glow_sprite(color, r=700):
    key = ("glow", color, r)
    if key in _sprites:
        return _sprites[key]
    yy, xx = np.mgrid[-r:r, -r:r]
    dist = np.sqrt(xx * xx + yy * yy) / r
    a = (np.clip(1 - dist, 0, 1) ** 2.2 * 120).astype(np.uint8)
    img = Image.new("RGBA", (2 * r, 2 * r), color + (0,))
    img.putalpha(Image.fromarray(a))
    _sprites[key] = img
    return img


# --------------------------------------------------------------------------- compositing

SHAKE = [0, 0]


def blit(frame, spr, x, y, alpha=1.0, scale=1.0, anchor="lt", shake=True):
    """Composite spr onto frame. anchor: 'lt' left-top, 'ct' center-top, 'cc' center-center."""
    if alpha <= 0.01 or scale <= 0.01:
        return
    s = spr
    if abs(scale - 1) > 0.005:
        s = spr.resize((max(1, round(spr.width * scale)), max(1, round(spr.height * scale))), Image.BILINEAR)
    if alpha < 0.99:
        s = s.copy()
        s.putalpha(s.getchannel("A").point(lambda v: int(v * alpha)))
    if anchor[0] == "c":
        x -= s.width / 2
    if anchor[1] == "c":
        y -= s.height / 2
    if shake:
        x += SHAKE[0]
        y += SHAKE[1]
    x, y = int(round(x)), int(round(y))
    l, t = max(0, -x), max(0, -y)
    r, b = min(s.width, W - x), min(s.height, H - y)
    if r <= l or b <= t:
        return
    if (l, t, r, b) != (0, 0, s.width, s.height):
        s = s.crop((l, t, r, b))
    frame.alpha_composite(s, (x + l, y + t))


def clamp(v, a=0.0, b=1.0):
    return max(a, min(b, v))


def prog(t, start, dur):
    return clamp((t - start) / dur)


def ease_out(x):
    return 1 - (1 - clamp(x)) ** 3


def ease_back(x, s=1.9):
    x = clamp(x) - 1
    return x * x * ((s + 1) * x + s) + 1


def make_background():
    g = np.linspace(0, 1, H)[:, None, None]
    top, bot = np.array(BG_TOP), np.array(BG_BOT)
    arr = (top * (1 - g) + bot * g).repeat(W, axis=1).astype(np.uint8)
    img = Image.fromarray(arr, "RGB").convert("RGBA")
    lines = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(lines)
    line = (255, 255, 255, 14)
    # stylised half-court lines
    d.ellipse((W / 2 - 360, H - 520, W / 2 + 360, H + 200), outline=line, width=4)
    d.rectangle((W / 2 - 250, H - 760, W / 2 + 250, H + 10), outline=line, width=4)
    d.ellipse((W / 2 - 180, H - 940, W / 2 + 180, H - 580), outline=line, width=4)
    d.arc((-260, H - 1500, W + 260, H + 400), 180, 360, fill=line, width=4)
    for i in range(-H, W, 90):  # faint diagonal texture
        d.line((i, 0, i + H * 0.45, H), fill=(255, 255, 255, 6), width=2)
    img.alpha_composite(lines)
    return img


# --------------------------------------------------------------------------- scenes

def draw_progress(frame, idx, n, local):
    x0, x1, y, gap = 80, W - 80, 150, 12
    seg = (x1 - x0 - gap * (n - 1)) / n
    d = ImageDraw.Draw(frame)
    for i in range(n):
        sx = x0 + i * (seg + gap)
        d.rounded_rectangle((sx, y, sx + seg, y + 8), 4, fill=(255, 255, 255, 50))
        fill = 1 if i < idx else (local if i == idx else 0)
        if fill > 0:
            d.rounded_rectangle((sx, y, sx + max(8, seg * fill), y + 8), 4, fill=WHITE)


def scene_hook(frame, ep, t, dur):
    h = ep["hook"]
    a = HOOK_ACCENT
    blit(frame, glow_sprite(a), W / 2 + 120 * math.sin(t * 1.3), 900, alpha=0.9, anchor="cc", shake=False)
    k = text_sprite(h["kicker"], font("latin", 40, "Bold"), DIM, tracking=10)
    blit(frame, k, W / 2, 360 + 30 * (1 - ease_out(prog(t, 0, 0.4))), alpha=prog(t, 0, 0.4), anchor="ct")
    wk = text_sprite(ep["week_label"], font("latin", 180), a + (255,))
    p = prog(t, 0.1, 0.35)
    blit(frame, wk, W / 2, 430, alpha=p, scale=1.5 - 0.5 * ease_out(p), anchor="ct")
    l1 = text_sprite(h["line1"], font("cjk", 160), WHITE)
    p = prog(t, 0.35, 0.3)
    blit(frame, l1, W / 2, 690, alpha=p, scale=1.6 - 0.6 * ease_out(p), anchor="ct")
    num = text_sprite(h["number"], font("latin", 460), a + (255,))
    unit = text_sprite(h["unit"], font("cjk", 200), WHITE)
    p = prog(t, 0.7, 0.28)
    total = num.width + 30 + unit.width
    sc = 2.2 - 1.2 * ease_out(p)
    blit(frame, num, W / 2 - total / 2 + num.width / 2, 1110, alpha=p, scale=sc, anchor="cc")
    blit(frame, unit, W / 2 + total / 2 - unit.width / 2, 1180, alpha=prog(t, 0.85, 0.2), anchor="cc")
    sub = text_sprite(h["sub"], font("latin", 44, "ExtraBold"), WHITE, tracking=8)
    blit(frame, sub, W / 2, 1340, alpha=prog(t, 1.1, 0.3), anchor="ct")
    dr = text_sprite(ep["date_range"], font("latin", 36, "Bold"), DIM, tracking=4)
    blit(frame, dr, W / 2, 600, alpha=prog(t, 0.3, 0.3), anchor="ct")


def scene_player(frame, ep, pl, t, dur):
    a = tuple(pl["accent"])
    blit(frame, glow_sprite(a), 820 + 60 * math.sin(t), 520 + 40 * math.cos(t * 0.8), alpha=0.85, anchor="cc", shake=False)

    kick = pill_sprite(f"PICK #{pl['rank']}  ·  必撿第 {pl['rank']} 名", font("cjk", 34, "Bold"), a + (255,), (15, 15, 25, 255))
    blit(frame, kick, 80 - 40 * (1 - ease_out(prog(t, 0, 0.35))), 200, alpha=prog(t, 0, 0.3))

    big = text_sprite(f"#{pl['rank']}", font("latin", 430), a + (255,), stroke=6, outline_only=True)
    p = prog(t, 0.05, 0.5)
    blit(frame, big, 1010 - big.width + 300 * (1 - ease_back(p)), 250, alpha=min(1, p * 2) * 0.95)

    fn = text_sprite(pl["first"].upper(), font("latin", 84, "ExtraBold"), (255, 255, 255, 190), tracking=6)
    blit(frame, fn, 80 - 80 * (1 - ease_out(prog(t, 0.25, 0.4))), 600, alpha=prog(t, 0.25, 0.3))
    ln = text_sprite(pl["last"].upper(), fit_font("latin", pl["last"].upper(), W - 160, 176), WHITE)
    p = prog(t, 0.35, 0.4)
    blit(frame, ln, 80 - 120 * (1 - ease_out(p)), 690, alpha=p)

    team = pill_sprite(f"{pl['team']}  {pl['team_zh']}", font("cjk", 40, "Black"), (255, 255, 255, 235), (15, 15, 25, 255))
    blit(frame, team, 80, 880, alpha=prog(t, 0.6, 0.3), scale=0.8 + 0.2 * ease_back(prog(t, 0.6, 0.35)))
    tx = 80 + team.width + 18
    for i, tag in enumerate(pl["tags"]):
        chip = pill_sprite(tag, font("latin", 34, "Black"), a + (60,), a + (255,), padx=24)
        p = prog(t, 0.75 + i * 0.08, 0.3)
        blit(frame, chip, tx, 880 + (team.height - chip.height) / 2, alpha=p, scale=0.6 + 0.4 * ease_back(p))
        tx += chip.width + 12

    for i, st in enumerate(pl["stats"]):
        c = card_sprite(st, a)
        p = prog(t, 1.1 + i * 0.35, 0.4)
        blit(frame, c, 80 + c.width / 2 + i * (c.width + 20), 975 + c.height / 2, alpha=p,
             scale=0.5 + 0.5 * ease_back(p), anchor="cc")

    for j, line in enumerate(pl["reason"].split("\n")):
        r = text_sprite(line, fit_font("cjk", line, W - 160, 46, "Bold"), WHITE if j == 0 else a + (255,))
        p = prog(t, 2.0 + j * 0.3, 0.35)
        blit(frame, r, 80 - 40 * (1 - ease_out(p)), 1250 + j * 64, alpha=p)


def scene_cta(frame, ep, t, dur):
    c = ep["cta"]
    a = HOOK_ACCENT
    blit(frame, glow_sprite(a), W / 2, 900 + 50 * math.sin(t * 2), alpha=0.8, anchor="cc", shake=False)
    l1 = text_sprite(c["line1"], font("cjk", 140), WHITE)
    p = prog(t, 0, 0.3)
    blit(frame, l1, W / 2, 560, alpha=p, scale=1.5 - 0.5 * ease_out(p), anchor="ct")
    l2 = text_sprite(c["line2"], font("cjk", 96), a + (255,))
    p = prog(t, 0.3, 0.3)
    blit(frame, l2, W / 2, 760, alpha=p, scale=1.4 - 0.4 * ease_out(p), anchor="ct")
    btn = pill_sprite(c["button"], font("cjk", 64), (230, 33, 23, 255), WHITE, padx=70, pady=30)
    p = prog(t, 0.7, 0.4)
    pulse = 1 + 0.04 * math.sin(max(0, t - 1.1) * 7) if t > 1.1 else 1
    blit(frame, btn, W / 2, 1060, alpha=p, scale=(0.5 + 0.5 * ease_back(p)) * pulse, anchor="cc")
    sub = text_sprite(c["sub"], font("cjk", 48, "Bold"), WHITE)
    blit(frame, sub, W / 2, 1200, alpha=prog(t, 1.0, 0.3), anchor="ct")
    asof = text_sprite(ep["as_of"], font("cjk", 30, "Medium"), DIM)
    blit(frame, asof, W / 2, 1300, alpha=prog(t, 1.2, 0.3), anchor="ct")


# --------------------------------------------------------------------------- captions

def split_phrases(text):
    out, cur = [], ""
    for ch in text:
        cur += ch
        if ch in "，。！？、":
            out.append(cur.strip("，。、"))
            cur = ""
    if cur.strip():
        out.append(cur)
    return [p for p in out if p]


def caption_at(text, t, dur):
    phrases = split_phrases(text)
    weights = [len(p) for p in phrases]
    span = dur - 0.25
    acc = 0.1
    for p, w in zip(phrases, weights):
        d = span * w / sum(weights)
        if t < acc + d:
            return p, (t - acc) / d
        acc += d
    return phrases[-1], 1.0


def caption_from_timings(timings, t):
    """timings: [(phrase, start, end)] in scene-local seconds."""
    for i, (ph, st, en) in enumerate(timings):
        nxt = timings[i + 1][1] if i + 1 < len(timings) else 1e9
        if t < nxt:
            return ph, clamp((t - st) / max(0.1, en - st))
    return timings[-1][0], 1.0


def draw_caption(frame, sc, t, dur):
    if sc.get("timings"):
        phrase, p = caption_from_timings(sc["timings"], t)
    else:
        phrase, p = caption_at(sc["caption"], t, dur)
    f = fit_font("cjk", phrase, W - 140, 58, "Black")
    s = text_sprite(phrase, f, WHITE, stroke=7, stroke_fill=(0, 0, 0, 255))
    blit(frame, s, W / 2, CAPTION_Y + 10 * (1 - ease_out(p * 6)), alpha=min(1, p * 8), anchor="ct", shake=False)


# --------------------------------------------------------------------------- timeline

def build_timeline(ep, narration=None):
    """narration: optional list (one per scene) of (audio, timings) from the TTS step."""
    scenes = [("hook", None, ep["hook"]["duration"], ep["hook"]["caption"])]
    for pl in sorted(ep["players"], key=lambda p: -p["rank"]):
        scenes.append(("player", pl, pl["duration"], pl["caption"]))
    scenes.append(("cta", None, ep["cta"]["duration"], ep["cta"]["caption"]))
    out, start = [], 0.0
    for i, (kind, pl, dur, cap) in enumerate(scenes):
        sc = dict(kind=kind, pl=pl, start=start, dur=dur, caption=cap)
        if narration:
            audio, timings = narration[i]
            sc["voice"] = audio
            sc["timings"] = [(ph, VOICE_LEAD + a, VOICE_LEAD + b) for ph, a, b in timings]
            sc["dur"] = dur = max(dur if kind == "hook" else 2.5, VOICE_LEAD + len(audio) / SR + VOICE_TAIL)
        out.append(sc)
        start += dur
    return out, start


def impacts(timeline):
    times = [sc["start"] + 0.72 for sc in timeline if sc["kind"] == "hook"]
    times += [sc["start"] + 0.3 for sc in timeline if sc["kind"] == "player"]
    return times


def render_frame(ep, timeline, bg, T, shakes):
    frame = bg.copy()
    idx = next(i for i, sc in enumerate(timeline) if T < sc["start"] + sc["dur"] or i == len(timeline) - 1)
    sc = timeline[idx]
    t, dur = T - sc["start"], sc["dur"]

    amp = sum(max(0, 1 - (T - s) / 0.35) * 16 for s in shakes if 0 <= T - s < 0.35)
    SHAKE[0] = random.uniform(-amp, amp)
    SHAKE[1] = random.uniform(-amp, amp)

    if sc["kind"] == "hook":
        scene_hook(frame, ep, t, dur)
    elif sc["kind"] == "player":
        scene_player(frame, ep, sc["pl"], t, dur)
    else:
        scene_cta(frame, ep, t, dur)

    draw_progress(frame, idx, len(timeline), clamp(t / dur))
    draw_caption(frame, sc, t, dur)
    draw_wipes(frame, timeline, T)
    return frame


def draw_wipes(frame, timeline, T):
    half = 0.2
    for i, sc in enumerate(timeline[1:], 1):
        b = sc["start"]
        if abs(T - b) < half:
            p = (T - b + half) / (2 * half)
            color = tuple(sc["pl"]["accent"]) if sc["pl"] else HOOK_ACCENT
            cx = -900 + p * (W + 1800)
            skew, bw = 500, 900
            d = ImageDraw.Draw(frame)
            d.polygon([(cx - bw / 2 + skew, 0), (cx + bw / 2 + skew, 0), (cx + bw / 2 - skew, H), (cx - bw / 2 - skew, H)],
                      fill=color + (255,))


# --------------------------------------------------------------------------- audio

SR = 44100
VOICE_LEAD = 0.22   # voice starts this long after a scene cut (after the wipe)
VOICE_TAIL = 0.45   # breathing room after the last phrase

TTS_DIR = ROOT / "assets/tts/kokoro-multi-lang-v1_1"
TTS_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2"
LEXICON_EXTRA = ROOT / "assets/lexicon_extra.txt"


def ensure_tts():
    if not (TTS_DIR / "model.onnx").exists():
        import tarfile
        TTS_DIR.parent.mkdir(parents=True, exist_ok=True)
        tmp = TTS_DIR.parent / "kokoro.tar.bz2"
        print("Downloading Kokoro multi-lang voice model (~360 MB, one time)…", file=sys.stderr)
        urllib.request.urlretrieve(TTS_URL, tmp)
        with tarfile.open(tmp) as tf:
            tf.extractall(TTS_DIR.parent)
        tmp.unlink()
    # prepend our extra pronunciations (player names missing from the stock English lexicon)
    merged = TTS_DIR / "lexicon-us-en-merged.txt"
    extra = LEXICON_EXTRA.read_text(encoding="utf-8") if LEXICON_EXTRA.exists() else ""
    extra = "\n".join(l.strip() for l in extra.splitlines() if l.strip() and not l.startswith("#"))
    base = (TTS_DIR / "lexicon-us-en.txt").read_text(encoding="utf-8")
    merged.write_text(extra + "\n" + base, encoding="utf-8")
    return merged


def make_tts():
    import sherpa_onnx
    en_lex = ensure_tts()
    d = TTS_DIR
    cfg = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=str(d / "model.onnx"), voices=str(d / "voices.bin"), tokens=str(d / "tokens.txt"),
                data_dir=str(d / "espeak-ng-data"), dict_dir=str(d / "dict"),
                lexicon=f"{en_lex},{d / 'lexicon-zh.txt'}"),
            num_threads=4),
        rule_fsts=",".join(str(d / f) for f in ("date-zh.fst", "phone-zh.fst", "number-zh.fst")))
    return sherpa_onnx.OfflineTts(cfg)


def tts_text(t2s, text):
    """Kokoro's lexicons are Simplified Chinese and lowercase English."""
    return re.sub(r"[A-Za-z]+", lambda m: m.group(0).lower(), t2s.convert(text))


def synth_narration(ep, speed, sid):
    """Speak every scene's caption phrase by phrase; returns [(audio, [(phrase, start, end)])] per scene."""
    from opencc import OpenCC
    t2s = OpenCC("t2s")  # the model's lexicon is Simplified Chinese
    tts = make_tts()
    texts = [ep["hook"].get("narration", ep["hook"]["caption"])]
    texts += [p.get("narration", p["caption"]) for p in sorted(ep["players"], key=lambda p: -p["rank"])]
    texts += [ep["cta"].get("narration", ep["cta"]["caption"])]
    caps = [ep["hook"]["caption"]] + [p["caption"] for p in sorted(ep["players"], key=lambda p: -p["rank"])]
    caps += [ep["cta"]["caption"]]
    result = []
    for text, cap in zip(texts, caps):
        spoken, shown = split_phrases(text), split_phrases(cap)
        if len(spoken) != len(shown):
            shown = spoken  # narration override with different phrasing: show what is said
        # one pass per scene so the model keeps natural sentence intonation
        g = tts.generate(tts_text(t2s, text), sid=sid, speed=speed)
        a = trim_silence(resample(np.asarray(g.samples, dtype=np.float32), g.sample_rate, SR))
        a = soften_edges(a)
        # phrase lengths measured by speaking each phrase alone: far better than character counts
        # (English names take longer); these estimates are then snapped to real pauses in `a`
        est = []
        for sp in spoken:
            gp = tts.generate(tts_text(t2s, sp), sid=sid, speed=speed)
            est.append(len(trim_silence(np.asarray(gp.samples, dtype=np.float64), pad=0)) / gp.sample_rate)
        bounds = align_phrases(a, est)
        timings = [(sh, b0, b1) for sh, (b0, b1) in zip(shown, bounds)]
        result.append((a, timings))
        print(f"  narration: {text}  ({len(a) / SR:.1f}s)", file=sys.stderr)
    return result


def resample(a, sr_in, sr_out):
    """High-quality resampling through ffmpeg (avoids the aliasing of naive interpolation)."""
    if sr_in == sr_out:
        return a.astype(np.float64)
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(sr_in), "-ac", "1", "-i", "-",
         "-af", f"aresample={sr_out}:filter_size=64:cutoff=0.97", "-f", "f32le", "-"],
        input=a.astype(np.float32).tobytes(), capture_output=True, check=True).stdout
    return np.frombuffer(out, np.float32).astype(np.float64)


def trim_silence(a, thresh=0.008, pad=0.06):
    idx = np.where(np.abs(a) > thresh)[0]
    if len(idx) == 0:
        return a
    p = int(pad * SR)
    return a[max(0, idx[0] - p): idx[-1] + p]


def soften_edges(a, ms=15):
    n = min(len(a) // 2, int(ms / 1000 * SR))
    a = a.copy()
    a[:n] *= np.linspace(0, 1, n)
    a[-n:] *= np.linspace(1, 0, n)
    return a


def align_phrases(a, weights):
    """Map caption phrases onto the audio by snapping estimated boundaries to real pauses."""
    total = len(a) / SR
    if len(weights) == 1:
        return [(0.0, total)]
    hop = int(0.01 * SR)
    env = np.sqrt(np.convolve(a * a, np.ones(hop * 3) / (hop * 3), mode="same")[::hop])
    quiet = env < max(env.max() * 0.08, 1e-4)
    gaps, i = [], 0  # (centre_seconds, length_seconds) of each pause
    while i < len(quiet):
        if quiet[i]:
            j = i
            while j < len(quiet) and quiet[j]:
                j += 1
            if j - i >= 4 and i > 0 and j < len(quiet):  # >= 40 ms, not at the edges
                gaps.append(((i + j) / 2 * 0.01, (j - i) * 0.01))
            i = j
        else:
            i += 1
    cum = np.cumsum(weights) / sum(weights)
    cuts, last = [], 0.0
    for k in range(len(weights) - 1):
        want = cum[k] * total
        cands = [g for g in gaps if g[0] > last + 0.25]
        if cands:  # nearest pause, longer pauses preferred
            best = min(cands, key=lambda g: abs(g[0] - want) - 0.5 * g[1])
            cut = best[0] if abs(best[0] - want) < 0.6 else want
        else:
            cut = want
        cuts.append(cut)
        last = cut
    edges = [0.0] + cuts + [total]
    return list(zip(edges[:-1], edges[1:]))


def voice_track(timeline, total):
    out = np.zeros(int(total * SR) + SR)
    for sc in timeline:
        v = sc.get("voice")
        if v is None:
            continue
        i = int((sc["start"] + VOICE_LEAD) * SR)
        out[i:i + len(v)] += v[: len(out) - i]
    out = out[: int(total * SR)]
    peak = np.abs(out).max()
    return out / peak * 0.95 if peak > 0 else out


def synth_music(total, timeline, bpm=118):
    n = int(total * SR) + SR
    out = np.zeros(n)
    beat = 60 / bpm
    rng = np.random.default_rng(7)

    def add(sig, at, gain=1.0):
        i = int(at * SR)
        if i >= n:
            return
        j = min(n, i + len(sig))
        out[i:j] += sig[: j - i] * gain

    tk = np.arange(int(0.35 * SR)) / SR
    kick = np.sin(2 * np.pi * (45 * tk + 90 * (1 - np.exp(-tk * 25)) / 25)) * np.exp(-tk * 9)
    th = np.arange(int(0.05 * SR)) / SR
    hat = np.diff(rng.standard_normal(len(th) + 1)) * np.exp(-th * 90) * 0.25
    ts = np.arange(int(0.22 * SR)) / SR
    snare = (rng.standard_normal(len(ts)) * 0.6 + np.sin(2 * np.pi * 190 * ts)) * np.exp(-ts * 18) * 0.5
    roots = [55.0, 43.65, 65.41, 49.0]  # A1 F1 C2 G1

    nbeats = int(total / beat) + 1
    for b in range(nbeats):
        at = b * beat
        add(kick, at, 0.9)
        add(hat, at + beat / 2, 0.8)
        if b % 2 == 1:
            add(snare, at, 0.7)
        f0 = roots[(b // 4) % 4]
        tb = np.arange(int(beat * SR)) / SR
        bass = np.tanh(2.5 * np.sin(2 * np.pi * f0 * tb)) * np.minimum(1, tb * 60) * np.exp(-tb * 3) * 0.35
        add(bass, at)

    # whoosh on scene changes, boom on impacts
    tw = np.arange(int(0.45 * SR)) / SR
    noise = rng.standard_normal(len(tw))
    env = np.sin(np.pi * tw / tw[-1]) ** 2
    whoosh = np.convolve(noise, np.ones(12) / 12, mode="same") * env * 0.9
    for sc in timeline[1:]:
        add(whoosh, sc["start"] - 0.25)
    tb = np.arange(int(0.8 * SR)) / SR
    boom = np.sin(2 * np.pi * (38 * tb + 120 * (1 - np.exp(-tb * 12)) / 12)) * np.exp(-tb * 4.5)
    for s in impacts(timeline):
        add(boom, s, 1.0)

    out = out[: int(total * SR)]
    fade = int(0.6 * SR)
    out[-fade:] *= np.linspace(1, 0, fade)
    out = out / (np.abs(out).max() + 1e-9) * 0.8
    return out


def write_wav(path, sig):
    data = (np.clip(sig, -1, 1) * 32767).astype(np.int16)
    stereo = np.repeat(data[:, None], 2, axis=1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(stereo.tobytes())


# --------------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("episode")
    ap.add_argument("--out", default=None, help="output .mp4 (default out/<slug>.mp4)")
    ap.add_argument("--voice", help="optional voice-over audio file; music is ducked under it")
    ap.add_argument("--no-music", action="store_true")
    ap.add_argument("--no-tts", action="store_true", help="skip the AI voice-over")
    ap.add_argument("--speed", type=float, default=1.05, help="AI voice speaking speed (default 1.05)")
    ap.add_argument("--voice-id", type=int, default=58,
                    help="Kokoro speaker: 3-57 Mandarin female, 58-102 Mandarin male (default 58)")
    ap.add_argument("--stills", action="store_true", help="only write key-frame PNGs for review")
    args = ap.parse_args()

    ensure_fonts()
    ep = json.loads(Path(args.episode).read_text(encoding="utf-8"))
    narration = None
    if not args.no_tts and not args.voice:
        narration = synth_narration(ep, args.speed, args.voice_id)
    timeline, total = build_timeline(ep, narration)
    shakes = impacts(timeline)
    bg = make_background()
    outdir = ROOT / "out"
    outdir.mkdir(exist_ok=True)
    out = Path(args.out) if args.out else outdir / f"{ep['slug']}.mp4"
    random.seed(1)

    if args.stills:
        for sc in timeline:
            for off in (sc["dur"] * 0.6,):
                T = sc["start"] + off
                p = outdir / f"{ep['slug']}_{T:05.2f}s.png"
                render_frame(ep, timeline, bg, T, shakes).convert("RGB").save(p)
                print(p)
        return

    music = outdir / f"{ep['slug']}_audio.wav"
    mix = synth_music(total, timeline) * (0 if args.no_music else 1)
    if narration:
        mix = mix * 0.22 + voice_track(timeline, total)  # duck music under the AI voice
        mix = mix / max(1.0, np.abs(mix).max() / 0.97)
    write_wav(music, mix)

    cmd = ["ffmpeg", "-y", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-i", str(music)]
    if args.voice:
        cmd += ["-i", args.voice, "-filter_complex",
                "[1:a]volume=0.3[m];[2:a]volume=1.0[v];[m][v]amix=inputs=2:duration=first:normalize=0[a]",
                "-map", "0:v", "-map", "[a]"]
    else:
        cmd += ["-map", "0:v", "-map", "1:a"]
    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-t", f"{total:.3f}", "-movflags", "+faststart", str(out)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    nframes = int(round(total * FPS))
    for i in range(nframes):
        frame = render_frame(ep, timeline, bg, i / FPS, shakes)
        proc.stdin.write(frame.convert("RGB").tobytes())
        if i % FPS == 0:
            print(f"\r{i / FPS:5.1f}s / {total:.1f}s", end="", file=sys.stderr)
    proc.stdin.close()
    if proc.wait() != 0:
        sys.exit("ffmpeg failed")
    print(f"\nwrote {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
