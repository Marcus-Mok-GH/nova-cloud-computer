"""Claude-style animated explainer cards for the walkthrough.

Warm cream panels, coral accents, generous radius and springy motion - the
look of Anthropic's product videos - composited lower-left while the voice
explains a static screen.
"""
import math
import os
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
FFMPEG = "/home/marcus/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"
CLIPS = os.path.join(WORK, "clipsW")

CW, CH = 640, 340
FPS = 25

CREAM = (250, 246, 240)
INK = (26, 22, 20)
MUTED = (122, 113, 104)
CORAL = (217, 119, 87)
CORAL_DEEP = (196, 90, 60)
HAIRLINE = (227, 219, 209)
WHITE = (255, 255, 255)

FONT = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
FONT_B = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
MONO = "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf"

PX0, PY0, PX1, PY1 = 24, 18, 616, 322


def spring(t):
    t = max(0.0, min(1.0, t))
    c1 = 1.70158
    c3 = c1 + 1
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2


def card_base():
    """Shadow + panel sprite, built once and copied per frame."""
    im = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    sh = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    sd.rounded_rectangle([PX0 + 5, PY0 + 9, PX1 + 5, PY1 + 11], radius=22,
                         fill=(60, 40, 30, 70))
    sh = sh.filter(ImageFilter.GaussianBlur(10))
    im = Image.alpha_composite(sh, im)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([PX0, PY0, PX1, PY1], radius=24,
                        fill=CREAM + (255,), outline=HAIRLINE + (255,), width=2)
    return im


class Card:
    def __init__(self, base, offset_y=0.0, alpha=1.0):
        self.alpha = alpha
        self.base = base
        self.offset_y = offset_y
        self.im = base.copy()
        self.d = ImageDraw.Draw(self.im)
        self.x0, self.y0, self.x1, self.y1 = PX0, PY0, PX1, PY1
        self.f_eyebrow = ImageFont.truetype(FONT_B, 14)
        self.f_title = ImageFont.truetype(FONT_B, 31)
        self.f_body = ImageFont.truetype(FONT, 18)
        self.f_chip = ImageFont.truetype(FONT_B, 14)
        self.f_mono = ImageFont.truetype(MONO, 15)

    def header(self, eyebrow, title):
        x = self.x0 + 26
        self.d.text((x, self.y0 + 20), eyebrow.upper(), font=self.f_eyebrow, fill=CORAL_DEEP)
        self.d.text((x, self.y0 + 40), title, font=self.f_title, fill=INK)

    def pill(self, x, y, w, label, accent=CORAL):
        h = 36
        self.d.rounded_rectangle([x, y, x + w, y + h], radius=h // 2,
                                 fill=WHITE + (255,), outline=HAIRLINE + (255,), width=1)
        if accent:
            self.d.ellipse([x + 10, y + h / 2 - 4, x + 18, y + h / 2 + 4],
                           fill=accent + (255,))
        tw = self.d.textlength(label, font=self.f_chip)
        self.d.text((x + w / 2 - tw / 2, y + 9), label, font=self.f_chip, fill=INK)
        return y + h

    def finish(self, t, dur, fade=0.55):
        a = min(1.0, t / fade, (dur - t) / fade) * self.alpha
        arr = np.asarray(self.im, dtype=np.float32) * max(0.0, a)
        return Image.fromarray(arr.astype(np.uint8), "RGBA")


def render(out, dur, drawer):
    frames = os.path.join(WORK, "ovframes")
    os.makedirs(frames, exist_ok=True)
    for f in os.listdir(frames):
        os.remove(os.path.join(frames, f))
    n = int(round(dur * FPS))
    base = card_base()
    for i in range(n):
        t = i / FPS
        enter = spring(min(1.0, t / 0.7)) if t < 0.7 else 1.0
        exit_k = min(1.0, max(0.0, (dur - t) / 0.6))
        off = 30 * (1 - enter) - 8 * (1 - exit_k)
        drift = 2.2 * math.sin(t * 1.15) * enter
        oy = off + drift
        c = Card(base, offset_y=oy, alpha=exit_k)
        drawer(c, t)
        frame = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
        frame.paste(c.im, (0, int(round(oy))), c.im)
        c.im = frame
        c.finish(t, dur).save(os.path.join(frames, f"o{i:05d}.png"))
    tmp = os.path.join(CLIPS, out)
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-framerate", str(FPS),
                    "-i", os.path.join(frames, "o%05d.png"),
                    "-c:v", "prores_ks", "-profile:v", "4444",
                    "-pix_fmt", "yuva444p10le", "-r", str(FPS), tmp], check=True)
    print("wrote", tmp, round(dur, 2))


def draw_env(c, t):
    c.header("Settings", "Environment variables")
    y = c.y0 + 104
    vx0, vx1 = c.x0 + 26, c.x0 + 190
    dx0, dx1 = c.x0 + 300, c.x0 + 556
    c.pill(vx0, y, vx1 - vx0, "ACCOUNT VAULT")
    c.pill(dx0, y, dx1 - dx0, "DEPLOYMENT")
    py = y + 18
    for k in range(18):
        px = vx1 + 14 + k * 6
        c.d.ellipse([px, py - 2, px + 4, py + 2], fill=CORAL + (140,))
    p = (t % 2.2) / 2.2
    xdot = vx1 + 8 + p * (dx0 - vx1 - 8)
    c.d.ellipse([xdot - 5, py - 5, xdot + 5, py + 5], fill=CORAL + (255,))
    lx, ly = vx0 + 34, y + 62
    c.d.rounded_rectangle([lx - 10, ly, lx + 10, ly + 16], radius=4, fill=CORAL_DEEP + (255,))
    c.d.arc([lx - 7, ly - 11, lx + 7, ly + 5], 180, 360, fill=CORAL_DEEP + (255,), width=3)
    c.d.text((lx + 20, ly - 4), "values encrypted at rest", font=c.f_body, fill=MUTED)
    c.d.text((c.x0 + 26, c.y0 + 222), "Names travel. Values never leave your account.",
             font=c.f_body, fill=INK)


def draw_auto(c, t):
    c.header("Settings", "Automations")
    # cycle ring: fills once per loop, with the run counter in the middle
    cx, cy, r = c.x0 + 96, c.y0 + 168, 48
    cycle = 4.5
    frac = (t % cycle) / cycle
    c.d.arc([cx - r, cy - r, cx + r, cy + r], 0, 360, fill=HAIRLINE + (255,), width=7)
    c.d.arc([cx - r, cy - r, cx + r, cy + r], -90, -90 + 360 * frac,
            fill=CORAL + (255,), width=7)
    run = int(t // cycle) + 1
    lab = f"RUN {run}"
    tw = c.d.textlength(lab, font=c.f_chip)
    c.d.text((cx - tw / 2, cy - 9), lab, font=c.f_chip, fill=INK)
    # a dot travelling around the ring marks the current phase
    a = -90 + 360 * frac
    dx, dy = cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))
    c.d.ellipse([dx - 6, dy - 6, dx + 6, dy + 6], fill=CORAL + (255,))

    # three-phase pipeline: the active step lights up in turn
    phases = ["DESCRIBE", "SCHEDULE", "RUN"]
    active = int((t / 1.5) % 3)
    px, pw, ph = c.x0 + 214, 168, 38
    for i, name in enumerate(phases):
        y = c.y0 + 102 + i * 54
        on = i == active
        c.d.rounded_rectangle([px, y, px + pw, y + ph], radius=ph // 2,
                              fill=WHITE + (255,),
                              outline=(CORAL if on else HAIRLINE) + (255,),
                              width=2 if on else 1)
        c.d.ellipse([px + 14, y + ph / 2 - 5, px + 24, y + ph / 2 + 5],
                    fill=(CORAL if on else HAIRLINE) + (255,))
        tw = c.d.textlength(name, font=c.f_chip)
        c.d.text((px + 36, y + 11), name, font=c.f_chip,
                 fill=INK if on else MUTED)
        if i < len(phases) - 1:  # connector between steps
            for k in range(3):
                yy = y + ph + 6 + k * 6
                c.d.ellipse([px + 18, yy, px + 22, yy + 4],
                            fill=CORAL + (150,) if i == active else HAIRLINE + (255,))
    c.d.text((c.x0 + 26, c.y0 + 276), "Repeats on its own - no prompting needed.",
             font=c.f_body, fill=INK)


def draw_api(c, t):
    c.header("Developers", "OpenAI-compatible API")
    x0, y0, x1 = c.x0 + 24, c.y0 + 102, c.x1 - 24
    c.d.rounded_rectangle([x0, y0, x1, y0 + 158], radius=14,
                          fill=WHITE + (255,), outline=HAIRLINE + (255,), width=1)
    for k, col in enumerate([(235, 120, 100), (235, 180, 90), (120, 190, 120)]):
        c.d.ellipse([x0 + 14 + k * 18, y0 + 12, x0 + 24 + k * 18, y0 + 22], fill=col + (255,))
    lines = [
        ("$ curl /api/v1/chat/completions", (90, 130, 100)),
        ("  -H \"Bearer $NOVA_KEY\"", (90, 130, 100)),
        ("{ \"model\": \"nova-lite\", \"stream\": true }", INK),
        ("<- 200 OK   choices[], usage, id", CORAL_DEEP),
    ]
    shown = int((t * 2.2) % (len(lines) + 2))
    for k, (text, col) in enumerate(lines[:min(shown, len(lines))]):
        c.d.text((x0 + 16, y0 + 40 + k * 26), text, font=c.f_mono, fill=col)
    if int(t * 2) % 2 == 0 and shown:
        last = min(shown, len(lines)) - 1
        ly = y0 + 40 + last * 26
        lx = x0 + 16 + len(lines[last][0]) * 8.6
        c.d.rectangle([lx, ly, lx + 8, ly + 16], fill=CORAL + (255,))
    c.d.text((c.x0 + 26, c.y0 + 286), "Point tools you already use at Nova.",
             font=c.f_body, fill=INK)


def draw_models(c, t):
    c.header("Models", "One workspace, every model")
    chips = ["LITE", "ULTRA", "DEEPSEEK", "GEMINI", "GPT-6.1"]
    cols = [CORAL, (90, 140, 200), (140, 120, 200), (100, 170, 130), (210, 150, 100)]
    x = c.x0 + 26
    for k, (label, col) in enumerate(zip(chips, cols)):
        appear = spring(min(1.0, max(0.0, (t - 0.15 - k * 0.12) / 0.5)))
        slide = 24 * (1 - appear)
        alpha = int(255 * max(0.0, appear))
        w = 96
        y = c.y0 + 112 + slide
        c.d.rounded_rectangle([x, y, x + w, y + 40], radius=20,
                              fill=WHITE + (alpha,), outline=HAIRLINE + (alpha,), width=1)
        c.d.ellipse([x + 10, y + 16, x + 18, y + 24], fill=col + (alpha,))
        tw = c.d.textlength(label, font=c.f_chip)
        c.d.text((x + 28 + (w - 28) / 2 - tw / 2, y + 12), label,
                 font=c.f_chip, fill=INK + (alpha,))
        x += w + 10
    c.d.text((c.x0 + 26, c.y0 + 196), "Pick per chat, or bring your own endpoint.",
             font=c.f_body, fill=INK)
    c.d.text((c.x0 + 26, c.y0 + 224), "Free tier included.", font=c.f_body, fill=MUTED)


if __name__ == "__main__":
    import json
    tl = json.load(open(os.path.join(WORK, "timeline-walk.json")))
    wins = {r["name"]: (r["start"], r["end"]) for r in tl}
    specs = [
        ("ov_env.mov", "S-set-Environment", draw_env),
        ("ov_auto.mov", "S-set-Automations", draw_auto),
        ("ov_api.mov", "S-docs", draw_api),
        ("ov_models.mov", "S-models", draw_models),
    ]
    for out, seg, fn in specs:
        s, e = wins[seg]
        render(out, e - s, fn)
