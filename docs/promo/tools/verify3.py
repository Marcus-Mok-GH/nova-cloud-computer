"""Deterministic checks for the full-feature cut."""
import json
import os
import subprocess

import numpy as np
from PIL import Image

WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
FFMPEG = "/home/marcus/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"
VIDEO = os.path.join(WORK, "captioned-silent3.mp4")
MIX = os.path.join(WORK, "audio-final3.m4a")

timeline = {r["name"]: r for r in json.load(open(os.path.join(WORK, "timeline3.json")))}


def frame_at(path, t, out):
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", path,
                    "-frames:v", "1", out], check=True)
    img = Image.open(out).convert("L")
    # ignore the burnt-in caption band when comparing to clean screenshots
    img = img.crop((0, 0, img.width, int(img.height * 0.86)))
    return np.asarray(img.resize((320, 180)), dtype=float)


def mad(a, b):
    return float(np.abs(a - b).mean())


print("== new scene frames vs reference screenshots ==")
checks = [
    ("N-chats", "new-a-card.png"),
    ("N-profile", "new-b-profile.png"),
    ("N-billing", "new-c-card.png"),
    ("N-env", "new-d-environment.png"),
]
for clip, ref in checks:
    row = timeline[clip]
    t = min(row["end"], row["start"] + 2.5)
    got = frame_at(VIDEO, t, os.path.join(WORK, "verify", f"chk-{clip}.png"))
    wimg = Image.open(os.path.join(WORK, ref)).convert("L")
    wimg = wimg.crop((0, 0, wimg.width, int(wimg.height * 0.86)))
    want = np.asarray(wimg.resize((320, 180)), dtype=float)
    print(f"{clip:10s} t={t:6.2f} mean-abs-diff={mad(got, want):6.2f}")

print("== audio levels ==")


def rms(path, ss, to):
    p = subprocess.run([FFMPEG, "-ss", str(ss), "-to", str(to), "-i", path,
                        "-af", "astats=metadata=1:reset=0,ametadata=print:key=lavfi.astats.Overall.RMS_level",
                        "-f", "null", "-"], capture_output=True, text=True).stderr
    vals = [float(line.split("=")[1]) for line in p.splitlines() if "RMS_level" in line]
    return round(sum(vals) / len(vals), 2) if vals else None


music_gap = rms(MIX, 41.0, 49.0)
speech = rms(MIX, 21.0, 24.5)
print("music-only gap 41-49s RMS:", music_gap, "dB")
print("speech segment 21-24.5s RMS:", speech, "dB")
if music_gap is not None and speech is not None:
    print("delta (speech - music):", round(speech - music_gap, 2), "dB")

peak = subprocess.run([FFMPEG, "-i", MIX, "-af",
                       "astats=metadata=1:reset=0,ametadata=print:key=lavfi.astats.Overall.Peak_level",
                       "-f", "null", "-"], capture_output=True, text=True).stderr
print("mix peak:", [line for line in peak.splitlines() if "Peak_level" in line][-1])

print("== captions present in ASS ==")
ass = open(os.path.join(WORK, "subtitles3.ass")).read()
print("dialogue lines:", ass.count("Dialogue:"))
