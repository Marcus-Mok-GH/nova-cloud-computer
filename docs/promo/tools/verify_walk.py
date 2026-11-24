"""Deterministic checks for the walkthrough cut."""
import json
import os
import subprocess

import numpy as np
from PIL import Image

WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
FFMPEG = "/home/marcus/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"
VIDEO = os.path.join(WORK, "captioned-silent-walk.mp4")
MIX = os.path.join(WORK, "audio-final-walk.m4a")

timeline = {r["name"]: r for r in json.load(open(os.path.join(WORK, "timeline-walk.json")))}


def frame_at(path, t, out):
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", path,
                    "-frames:v", "1", out], check=True)
    img = Image.open(out).convert("L")
    img = img.crop((0, 0, img.width, int(img.height * 0.86)))
    return np.asarray(img.resize((320, 180)), dtype=float)


print("== new scene frames vs reference screenshots ==")
checks = [
    ("S-onboard", "walk-w1-typed.png"),
    ("S-home", "walk-w2-model.png"),
    ("S-files", "walk-w3-folder.png"),
    ("S-agents", "walk-w4-hold.png"),
    ("S-skills", "walk-w5-hold.png"),
    ("S-terminal", "walk-w6-idle.png"),
    ("S-docs", "walk-w13-endpoints.png"),
    ("S-models", "walk-w12-models-hold.png"),
    ("S-slash", "walk-w12-slash-hold.png"),
    ("S-set-General", "walk-w7-General.png"),
    ("S-status", "walk-w8-status.png"),
]
os.makedirs(os.path.join(WORK, "verify"), exist_ok=True)
for clip, ref in checks:
    row = timeline[clip]
    t = min(row["end"] - 0.4, row["start"] + 2.0)
    got = frame_at(VIDEO, t, os.path.join(WORK, "verify", f"walk-{clip}.png"))
    wimg = Image.open(os.path.join(WORK, ref)).convert("L")
    wimg = wimg.crop((0, 0, wimg.width, int(wimg.height * 0.86)))
    want = np.asarray(wimg.resize((320, 180)), dtype=float)
    print(f"{clip:16s} t={t:7.2f} mean-abs-diff={float(np.abs(got - want).mean()):6.2f}")

print("== privacy blur on fresh footage ==")
rail = (slice(608, 676), slice(44, 244))
for clip in ["S-models", "S-slash", "S-home", "S-files", "S-agents", "S-skills", "S-terminal", "S-set-General", "S-status"]:
    row = timeline[clip]
    img = Image.open(os.path.join(WORK, "verify", f"walk-{clip}.png")).convert("L")
    a = np.asarray(img, dtype=float)[rail]
    hf = float(np.abs(np.diff(a, axis=1)).mean())
    print(f"{clip:16s} rail HF energy={hf:5.2f}")

print("== audio levels ==")


def rms(path, ss, to):
    p = subprocess.run([FFMPEG, "-ss", str(ss), "-to", str(to), "-i", path,
                        "-af", "astats=metadata=1:reset=0,ametadata=print:key=lavfi.astats.Overall.RMS_level",
                        "-f", "null", "-"], capture_output=True, text=True).stderr
    vals = [float(line.split("=")[1]) for line in p.splitlines() if "RMS_level" in line]
    return round(sum(vals) / len(vals), 2) if vals else None


music_gap = rms(MIX, 45.0, 52.0)
speech = rms(MIX, 20.0, 23.5)
print("music-only gap 45-52s RMS:", music_gap, "dB")
print("speech segment 20-23.5s RMS:", speech, "dB")
if music_gap is not None and speech is not None:
    print("delta (speech - music):", round(speech - music_gap, 2), "dB")

peak = subprocess.run([FFMPEG, "-i", MIX, "-af",
                       "astats=metadata=1:reset=0,ametadata=print:key=lavfi.astats.Overall.Peak_level",
                       "-f", "null", "-"], capture_output=True, text=True).stderr
print("mix peak:", [line for line in peak.splitlines() if "Peak_level" in line][-1])

ass = open(os.path.join(WORK, "subtitles-walk.ass")).read()
print("caption lines:", ass.count("Dialogue:"))
