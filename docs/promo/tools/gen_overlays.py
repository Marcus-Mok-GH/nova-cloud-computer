"""Animated B-roll overlays for the walkthrough.

During long static settings shots, a glassy card pops into the lower-left with
a looping diagram of what the narration is describing (Tech-with-Tim style),
so the screen is never just a frozen page while the voice explains.
"""
import math
import os
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFont

WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
FFMPEG = "/home/marcus/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"
CLIPS = os.path.join(WORK, "clipsW")
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

W, H = 1280, 720
FPS = 25
ORANGE = (240, 106, 57)
WHITE = (245, 242, 236)
GREY = (168, 162, 154)
PANEL = (14, 14, 17)
BOX = (28, 28, 33)

# Card geometry (lower-left, clear of the caption band).
CX0, CY0, CX1, CY1 = 44, 372, 596, 664


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


class Card:
    def __init__(self):
        self.im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)
        self.d.rounded_rectangle([CX0, CY0, CX1, CY1], radius=18,
                                 fill=PANEL + (232,), outline=(255, 255, 255, 34),
                                 width=2)
        self.f_title = ImageFont.truetype(FONT_BOLD, 27)
        self.f_body = ImageFont.truetype(FONT_REG, 19)
        self.f_mono = ImageFont.truetype(FONT_MONO, 17)
        self.f_chip = ImageFont.truetype(FONT_BOLD, 16)

    def title(self, text, sub=None):
        self.d.text((CX0 + 24, CY0 + 18), text, font=self.f_title, fill=WHITE)
        if sub:
            self.d.text((CX0 + 24, CY0 + 54), sub, font=self.f_body, fill=GREY)

    def box(self, x0, y0, x1, y1, label, accent=ORANGE):
        self.d.rounded_rectangle([x0, y0, x1, y1], radius=10,
                                 fill=BOX + (255,), outline=accent + (220,), width=2)
        tw = self.d.textlength(label, font=self.f_chip)
        self.d.text(((x0 + x1) / 2 - tw / 2, (y0 + y1) / 2 - 11), label,
                    font=self.f_chip, fill=WHITE)

    def arrow(self, x0, y, x1, colour=ORANGE):
        self.d.line([x0, y, x1, y], fill=colour + (255,), width=3)
        self.d.polygon([(x1, y), (x1 - 9, y - 6), (x1 - 9, y + 6)], fill=colour + (255,))

    def finish(self, t, dur, fade=0.5):
        a = min(1.0, t / fade, (dur - t) / fade)
        arr = np.asarray(self.im, dtype=np.float32) * a
        return Image.fromarray(arr.astype(np.uint8), "RGBA")


def render(name, dur, drawer, out):
    frames = os.path.join(WORK, "ovframes")
    os.makedirs(frames, exist_ok=True)
    for f in os.listdir(frames):
        os.remove(os.path.join(frames, f))
    n = int(round(dur * FPS))
    for i in range(n):
        t = i / FPS
        c = Card()
        drawer(c, t, dur)
        c.finish(t, dur).save(os.path.join(frames, f"o{i:05d}.png"))
    tmp = os.path.join(CLIPS, out)
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-framerate", str(FPS),
                    "-i", os.path.join(frames, "o%05d.png"),
                    "-c:v", "prores_ks", "-profile:v", "4444",
                    "-pix_fmt", "yuva444p10le", "-r", str(FPS), tmp], check=True)
    print("wrote", tmp, round(dur, 2), "s")


def draw_env(c, t, dur):
    c.title("Environment variables", "stored on your account")
    c.box(CX0 + 30, 480, CX0 + 200, 540, "ACCOUNT VAULT")
    c.box(CX0 + 380, 480, CX0 + 540, 540, "DEPLOYMENT")
    c.arrow(CX0 + 210, 510, CX0 + 372)
    # lock sits in the vault
    lx, ly = CX0 + 100, 565
    c.d.rounded_rectangle([lx - 12, ly, lx + 12, ly + 18], radius=4,
                          fill=ORANGE + (255,))
    c.d.arc([lx - 8, ly - 12, lx + 8, ly + 6], 180, 360, fill=ORANGE + (255,), width=3)
    c.d.text((lx + 22, ly - 4), "values encrypted at rest", font=c.f_body, fill=GREY)
    # packets carrying names only
    phase = (t % 2.4) / 2.4
    for k in range(3):
        p = (phase + k / 3) % 1
        x = CX0 + 210 + p * 162
        c.d.ellipse([x - 5, 505, x + 5, 515], fill=ORANGE + (255,))
    c.d.text((CX0 + 238, 522), "variable names only", font=c.f_body, fill=GREY)
    c.d.text((CX0 + 30, 610), "the server fills in the values -", font=c.f_body, fill=GREY)
    c.d.text((CX0 + 30, 636), "the agent never sees them", font=c.f_body, fill=GREY)


def draw_auto(c, t, dur):
    c.title("Automations", "plain English -> scheduled job")
    cx, cy, r = CX0 + 118, 545, 52
    c.d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=GREY + (120,), width=3)
    ang = t * 1.6
    for k in range(3):
        a = ang + k * 2 * math.pi / 3
        x, y = cx + r * math.cos(a), cy + r * math.sin(a)
        c.d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=ORANGE + (255,))
    # clock hand
    hx, hy = cx + 34 * math.cos(ang / 3), cy + 34 * math.sin(ang / 3)
    c.d.line([cx, cy, hx, hy], fill=WHITE + (255,), width=3)
    c.box(CX0 + 210, 500, CX0 + 330, 545, "SCHEDULE")
    c.box(CX0 + 350, 500, CX0 + 450, 545, "PROMPT")
    c.box(CX0 + 470, 500, CX0 + 550, 545, "LIMITS")
    # progress dots: one fills per loop
    loops = int(t // 2.0) % 4
    for k in range(4):
        on = k <= loops
        c.d.ellipse([CX0 + 236 + k * 26, 576, CX0 + 250 + k * 26, 590],
                    fill=ORANGE + (255,) if on else GREY + (90,))
    c.d.text((CX0 + 30, 622), "repeats on its own - no prompting needed",
             font=c.f_body, fill=GREY)


def draw_api(c, t, dur):
    c.title("OpenAI-compatible API", "/api/v1")
    x0, y0 = CX0 + 22, 470
    c.d.rounded_rectangle([x0, y0, CX1 - 22, y0 + 168], radius=12,
                          fill=(10, 10, 12, 255), outline=(255, 255, 255, 28), width=1)
    lines = [
        ("$ curl /api/v1/chat/completions \\", (120, 220, 140)),
        ("    -H \"Authorization: Bearer $NOVA_KEY\"", (120, 220, 140)),
        ("{", WHITE),
        ("  \"model\": \"nova-lite\",", WHITE),
        ("  \"messages\": [{\"role\": \"user\", \"content\": \"hi\"}]", WHITE),
        ("}", WHITE),
        ("<- 200 OK  {\"choices\": [...], \"stream\": true}", ORANGE),
    ]
    visible = int((t * 4) % (len(lines) + 2))
    for k, (text, col) in enumerate(lines[:min(visible, len(lines))]):
        c.d.text((x0 + 16, y0 + 16 + k * 21), text, font=c.f_mono, fill=col)
    if int(t * 2) % 2 == 0:
        last_y = y0 + 16 + min(visible, len(lines)) * 21 - 21
        c.d.rectangle([x0 + 16, last_y, x0 + 26, last_y + 16], fill=ORANGE + (255,))
    c.d.text((CX0 + 30, 648), "the same shape your scripts already speak",
             font=c.f_body, fill=GREY)


def draw_models(c, t, dur):
    c.title("Models", "built in and bring-your-own")
    chips = ["LITE", "ULTRA", "DEEPSEEK", "GEMINI", "GPT-6.1"]
    cols = [ORANGE, (120, 190, 255), (150, 130, 255), (120, 220, 160), (230, 160, 120)]
    for k, (label, col) in enumerate(zip(chips, cols)):
        slide = ease((t * 1.6 - k * 0.28) % 3.2 / 1.0)
        x = CX0 + 24 + k * 98 + 26 * (1 - min(1.0, slide))
        y = 500
        w = 90
        alpha = int(255 * min(1.0, slide))
        c.d.rounded_rectangle([x, y, x + w, y + 44], radius=10,
                              fill=BOX + (alpha,), outline=col + (alpha,), width=2)
        tw = c.d.textlength(label, font=c.f_chip)
        c.d.text((x + w / 2 - tw / 2, y + 13), label, font=c.f_chip,
                 fill=WHITE + (alpha,))
    c.d.text((CX0 + 30, 585), "one workspace, pick per chat", font=c.f_body, fill=GREY)
    c.d.text((CX0 + 30, 622), "or plug in your own OpenAI-compatible endpoint",
             font=c.f_body, fill=GREY)


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
        render(out, e - s, fn, out)
