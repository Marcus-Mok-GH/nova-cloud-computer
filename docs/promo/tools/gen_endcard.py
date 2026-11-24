"""End-card version animation: NOVA beta -> beta slides down to 1.0.

Takes the existing cream end card and repaints the version slot: it starts as
"beta", which slides down and fades while "1.0" rises into its place.
"""
import os
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont

WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
FFMPEG = "/home/marcus/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"
SRC = os.path.join(WORK, "clipsW", "V15x-endcard.mp4")
BACKUP = os.path.join(WORK, "clipsW", "V15x-base.mp4")
FRAMES = os.path.join(WORK, "endframes")

BG = (247, 240, 232)
ORANGE = (240, 106, 57)
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

# Slot where the original "1.0" sits on the card.
ERASE_BOX = (724, 188, 862, 302)
TEXT_X = 742
BASELINE = 286          # bottom of the version text
VERSION_SIZE = 62
DROP = 72


def ease(t):
    """Smoothstep 0..1."""
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def main():
    if not os.path.exists(BACKUP):
        shutil.copy2(SRC, BACKUP)
    os.makedirs(FRAMES, exist_ok=True)

    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", BACKUP,
                    os.path.join(FRAMES, "f%05d.png")], check=True)
    frames = sorted(os.listdir(FRAMES))

    font = ImageFont.truetype(FONT_PATH, VERSION_SIZE)
    HOLD = 1.6
    SLIDE = 1.2

    for index, name in enumerate(frames):
        t = index / 25.0
        im = Image.open(os.path.join(FRAMES, name)).convert("RGBA")
        draw = ImageDraw.Draw(im)
        draw.rectangle(ERASE_BOX, fill=BG + (255,))

        p = 0.0 if t < HOLD else ease((t - HOLD) / SLIDE)

        layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        if p < 1:
            ld.text((TEXT_X, BASELINE + DROP * p), "beta", font=font,
                    fill=ORANGE + (int(255 * (1 - p)),), anchor="ls")
        if p > 0:
            ld.text((TEXT_X, BASELINE + DROP * (1 - p)), "1.0", font=font,
                    fill=ORANGE + (int(255 * p),), anchor="ls")
        out = Image.alpha_composite(im, layer).convert("RGB")
        out.save(os.path.join(FRAMES, name))

    tmp_out = os.path.join(WORK, "clipsW", "V15x-animated.mp4")
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-framerate", "25",
                    "-i", os.path.join(FRAMES, "f%05d.png"),
                    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
                    "-r", "25", "-an", "-movflags", "+faststart", tmp_out], check=True)
    shutil.move(tmp_out, SRC)

    err = subprocess.run([FFMPEG, "-i", SRC], capture_output=True, text=True).stderr
    print([l for l in err.splitlines() if "Duration" in l][0])


main()
