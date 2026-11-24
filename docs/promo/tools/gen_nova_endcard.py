"""Grok-style animated Nova end card: dark stage, glowing particle orb, swirl rings.

16 seconds at 25 fps. Shows the beta -> 1.0 version swap next to the NOVA
wordmark, with the URL and tagline kept clear below.
"""
import math
import os
import shutil
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
FFMPEG = "/home/marcus/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"
OUT_CLIP = os.path.join(WORK, "clipsW", "V15x-endcard.mp4")
FRAMES = os.path.join(WORK, "endframes2")

W, H = 1280, 720
FPS = 25
DUR = 19.0
CX, CY = 640, 268
R = 108

BG_TOP = np.array([26, 24, 26], dtype=float)
BG_BOT = np.array([5, 5, 6], dtype=float)

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

ORANGE = np.array([240, 106, 57])
WHITE = np.array([244, 240, 233])


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def radial_bg():
    yy = np.linspace(0, 1, H)[:, None]
    xx = np.linspace(0, 1, W)[None, :]
    dist = np.sqrt(((xx - 0.5) * 1.15) ** 2 + ((yy - 0.42) * 1.35) ** 2)
    dist = np.clip(dist / 0.95, 0, 1)[:, :, None]
    base = BG_TOP * (1 - dist) + BG_BOT * dist
    return base


BG = radial_bg()


def make_glow():
    size = 520
    im = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(im)
    d.ellipse([10, 10, size - 10, size - 10], fill=70)
    im = im.filter(ImageFilter.GaussianBlur(60))
    return np.asarray(im, dtype=float) / 255.0


GLOW = make_glow()


def stamp_glow(frame, cx, cy, scale, strength):
    """Add a soft orange glow sprite centred at (cx, cy)."""
    h, w = GLOW.shape
    s = scale
    gw, gh = int(w * s), int(h * s)
    if gw < 8 or gh < 8:
        return
    sprite = np.asarray(
        Image.fromarray((GLOW * 255).astype(np.uint8)).resize((gw, gh)),
        dtype=float,
    ) / 255.0
    x0, y0 = int(cx - gw / 2), int(cy - gh / 2)
    sx0, sy0 = max(0, -x0), max(0, -y0)
    dx0, dy0 = max(0, x0), max(0, y0)
    dx1, dy1 = min(W, x0 + gw), min(H, y0 + gh)
    if dx1 <= dx0 or dy1 <= dy0:
        return
    patch = sprite[sy0:sy0 + (dy1 - dy0), sx0:sx0 + (dx1 - dx0)]
    region = frame[dy0:dy1, dx0:dx1]
    region += ORANGE[None, None, :] * patch[:, :, None] * strength


def make_sphere_base():
    """Dark glossy sphere with a specular highlight, once."""
    size = 2 * (R + 8)
    im = Image.new("RGB", (size, size), (0, 0, 0))
    d = ImageDraw.Draw(im, "RGBA")
    c = size // 2
    for r in range(R, 0, -1):
        shade = 12 + int(26 * (r / R))
        d.ellipse([c - r, c - r, c + r, c + r], fill=(shade, shade, shade + 4, 255))
    # specular
    spec = Image.new("L", (size, size), 0)
    sd = ImageDraw.Draw(spec)
    sd.ellipse([c - R * 0.62, c - R * 0.78, c - R * 0.05, c - R * 0.28], fill=95)
    spec = spec.filter(ImageFilter.GaussianBlur(10))
    arr = np.asarray(im, dtype=float)
    arr += WHITE[None, None, :] * (np.asarray(spec, dtype=float) / 255.0)[:, :, None] * 0.55
    return arr


SPHERE = make_sphere_base()


def draw_sphere(frame, cx, cy, rot):
    size = SPHERE.shape[0]
    x0, y0 = int(cx - size / 2), int(cy - size / 2)
    dx0, dy0 = max(0, x0), max(0, y0)
    dx1, dy1 = min(W, x0 + size), min(H, y0 + size)
    if dx1 <= dx0 or dy1 <= dy0:
        return
    patch = SPHERE[dy0 - y0:dy1 - y0, dx0 - x0:dx1 - x0]
    region = frame[dy0:dy1, dx0:dx1]
    # moving rim light on the upper-left limb
    ang = rot * 0.7
    rim = np.zeros((dy1 - dy0, dx1 - dx0), dtype=float)
    yy, xx = np.mgrid[0:rim.shape[0], 0:rim.shape[1]]
    d = np.sqrt((xx - size / 2) ** 2 + (yy - size / 2) ** 2)
    band = np.exp(-((d - (R - 2)) ** 2) / 18.0)
    lx = (xx - size / 2) * math.cos(ang) + (yy - size / 2) * math.sin(ang)
    ly = -(xx - size / 2) * math.sin(ang) + (yy - size / 2) * math.cos(ang)
    lit = np.clip((lx * -0.7 + ly * -0.7) / R, 0, 1) ** 2
    rim = band * lit
    region[:] = np.maximum(region, patch)
    region += ORANGE[None, None, :] * rim[:, :, None] * 0.7
    region += WHITE[None, None, :] * rim[:, :, None] * 0.25


def particles(n=340):
    i = np.arange(n)
    golden = math.pi * (3 - math.sqrt(5))
    y = 1 - (i / (n - 1)) * 2
    rad = np.sqrt(np.clip(1 - y * y, 0, 1))
    theta = golden * i
    x = np.cos(theta) * rad
    z = np.sin(theta) * rad
    speed = 0.55 + np.random.default_rng(7).random(n) * 0.5
    jitter = np.random.default_rng(11).random(n) * 2 * math.pi
    warm = np.random.default_rng(3).random(n)
    return y, x, z, speed, jitter, warm


PY, PX, PZ, SPD, JIT, WARM = particles()


def draw_particles(frame, t, grow):
    rot = t * 0.85
    alpha = 1.0
    ys = PY
    xs = PX * np.cos(rot + JIT * 0.15) - PZ * np.sin(rot + JIT * 0.15)
    zs = PX * np.sin(rot + JIT * 0.15) + PZ * np.cos(rot + JIT * 0.15)
    px = CX + R * grow * xs
    py = CY + R * grow * ys * 0.94
    pz = R * grow * zs
    front = np.clip(pz / R, 0, 1)
    size = 1 + np.round(front * 2.2 * grow).astype(int)
    brightness = (0.25 + 0.75 * front) * alpha
    color = WHITE[None, :] * (1 - WARM)[:, None] + ORANGE[None, :] * WARM[:, None]
    xi = np.round(px).astype(int)
    yi = np.round(py).astype(int)
    ok = (xi >= 2) & (xi < W - 2) & (yi >= 2) & (yi < H - 2)
    for k in np.nonzero(ok)[0]:
        s = int(size[k])
        v = color[k] * brightness[k]
        frame[yi[k] - s:yi[k] + s + 1, xi[k] - s:xi[k] + s + 1] += v


def draw_ring(frame, t, tilt, phase, radius, color, width=1.6, a=0.5):
    n = 160
    u = np.linspace(0, 2 * math.pi, n)
    rx = np.cos(u) * radius
    ry = np.sin(u) * radius * math.sin(tilt)
    rz = np.sin(u) * radius * math.cos(tilt)
    ca, sa = math.cos(phase), math.sin(phase)
    x2 = rx * ca - rz * sa
    z2 = rx * sa + rz * ca
    px = CX + x2
    py = CY + ry * math.cos(tilt * 0.6) + z2 * 0.16
    front = np.clip(z2 / radius, 0, 1)
    xi = np.round(px).astype(int)
    yi = np.round(py).astype(int)
    ok = (xi >= 1) & (xi < W - 1) & (yi >= 1) & (yi < H - 1)
    for k in np.nonzero(ok)[0]:
        b = (0.2 + 0.8 * front[k]) * a
        s = width
        frame[max(0, yi[k] - 1):yi[k] + 2, max(0, xi[k] - 1):xi[k] + 2] += color * b


def draw_text(base, t):
    im = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).convert("RGBA")
    d = ImageDraw.Draw(im)

    # NOVA wordmark
    wm = ImageFont.truetype(FONT_BOLD, 78)
    url_font = ImageFont.truetype(FONT_BOLD, 33)
    tag_font = ImageFont.truetype(FONT_REG, 21)
    ver_font = ImageFont.truetype(FONT_BOLD, 78)

    word_w = d.textlength("NOVA", font=wm)
    slot_w = d.textlength("beta", font=ver_font)
    word_x = CX - (word_w + 18 + slot_w) / 2
    fade = min(1.0, t / 1.2) if t < 1.2 else 1.0
    d.text((word_x, 486), "NOVA", font=wm, anchor="ls",
           fill=tuple(WHITE.astype(int)) + (int(255 * fade),))

    # version: beta slides down, 1.0 rises
    HOLD, SLIDE = 4.0, 1.2
    p = 0.0 if t < HOLD else ease((t - HOLD) / SLIDE)
    vx = word_x + word_w + 18
    # exit and entrance overlap only slightly so the labels never collide
    p_out = ease(p / 0.6) if p < 0.6 else 1.0
    p_in = ease((p - 0.4) / 0.6) if p > 0.4 else 0.0
    if p_out < 1:
        d.text((vx, 486 + 46 * p_out), "beta", font=ver_font,
               fill=tuple(ORANGE.astype(int)) + (int(235 * (1 - p_out)),), anchor="ls")
    if p_in > 0:
        d.text((vx, 486 + 46 * (1 - p_in)), "1.0", font=ver_font,
               fill=tuple(ORANGE.astype(int)) + (int(255 * p_in),), anchor="ls")

    # URL + tagline
    url_fade = min(1.0, max(0.0, (t - 0.8) / 1.4))
    url = "nova-cloud-computer.vercel.app"
    url_w = d.textlength(url, font=url_font)
    d.text((CX - url_w / 2, 566), url, font=url_font,
           fill=(196, 190, 182, int(235 * url_fade)))
    tag = "your cloud workspace, with an AI agent"
    tag_w = d.textlength(tag, font=tag_font)
    d.text((CX - tag_w / 2, 612), tag, font=tag_font,
           fill=(110, 105, 99, int(220 * url_fade)))

    return np.asarray(im.convert("RGB"), dtype=float)


def main():
    os.makedirs(FRAMES, exist_ok=True)
    for f in os.listdir(FRAMES):
        os.remove(os.path.join(FRAMES, f))

    for i in range(int(DUR * FPS)):
        t = i / FPS
        frame = BG.copy()

        intro_fade = min(1.0, t / 1.0)
        breathe = 1.0 + 0.025 * math.sin(t * 0.9)
        grow = (0.25 + 0.75 * ease(min(1.0, t / 1.6))) * breathe
        pulse = 0.75 + 0.25 * math.sin(t * 1.7)
        stamp_glow(frame, CX, CY, 1.9 * grow, 0.5 * pulse)
        stamp_glow(frame, CX, CY, 0.95 * grow, 0.55 * pulse)

        draw_ring(frame, t, tilt=0.42, phase=t * 0.9, radius=R + 34,
                  color=ORANGE * 0.9, a=0.45)
        draw_ring(frame, t, tilt=-0.7, phase=-t * 0.6 + 1.1, radius=R + 58,
                  color=WHITE * 0.7, a=0.3)
        draw_ring(frame, t, tilt=1.15, phase=t * 0.45 + 2.4, radius=R + 20,
                  color=ORANGE, a=0.5)

        draw_particles(frame, t, grow)
        draw_sphere(frame, CX, CY, t * 0.85)

        frame = draw_text(frame, t) * intro_fade

        Image.fromarray(np.clip(frame, 0, 255).astype(np.uint8)).save(
            os.path.join(FRAMES, f"f{i:05d}.png"))

    tmp = OUT_CLIP + ".tmp.mp4"
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-framerate", str(FPS),
                    "-i", os.path.join(FRAMES, "f%05d.png"),
                    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
                    "-r", str(FPS), "-an", "-movflags", "+faststart", tmp], check=True)
    shutil.move(tmp, OUT_CLIP)
    err = subprocess.run([FFMPEG, "-i", OUT_CLIP], capture_output=True, text=True).stderr
    print([l for l in err.splitlines() if "Duration" in l][0])


main()
