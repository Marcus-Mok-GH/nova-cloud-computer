"""Burn captions onto the demo video (ASS subtitles, bottom-centre)."""
import os
import re
import subprocess

WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
AUDIO = "/home/marcus/.hermes/cache/audio"
FFMPEG = "/home/marcus/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"

LINES = [
    ("tts_20261121_064813_661461.ogg", 0.2, "Meet Nova — an AI agent that works inside its own computer."),
    ("tts_20261121_064841_419871.ogg", 5.01, "Getting started takes one email address: no passwords, no setup forms."),
    ("tts_20261121_064842_797489.ogg", 10.88, "Nova emails you a six-digit code…"),
    ("tts_20261121_064843_927710.ogg", 14.20, "…and seconds later, you’re straight into your workspace."),
    ("tts_20261121_064845_282084.ogg", 18.20, "Everything starts from one question — what does Nova need done?"),
    ("tts_20261121_064846_327835.ogg", 22.60, "Ask it to build something real — here, a one-page website, published live."),
    ("tts_20261121_064857_854347.ogg", 28.18, "Nova plans the work first, and waits for your approval before it touches anything."),
    ("tts_20261121_064859_050388.ogg", 33.69, "One word — approve — and it’s off."),
    ("tts_20261121_064900_030199.ogg", 39.20, "It scaffolds the project, writes the code, and publishes to a real URL."),
    ("tts_20261121_064901_117181.ogg", 51.80, "Minutes later, the site is live on the open web — not a mockup."),
    ("tts_20261121_064902_495445.ogg", 58.80, "Files, deployments, terminal, settings —"),
    ("tts_20261121_064903_611449.ogg", 62.72, "every publish tracked,"),
    ("tts_20261121_064913_383992.ogg", 65.80, "a real shell in the sandbox,"),
    ("tts_20261121_064914_528148.ogg", 69.70, "and preferences that stick."),
    ("tts_20261121_064915_442988.ogg", 72.90, "Agents and skills slot right in."),
    ("tts_20261121_064916_444682.ogg", 76.10, "And the finished site? One click away."),
    ("tts_20261121_064917_645152.ogg", 80.41, "Nova — an agent with a computer. Start free."),
]


def duration(path):
    err = subprocess.run([FFMPEG, "-i", path], capture_output=True, text=True).stderr
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def stamp(seconds):
    seconds = max(0.0, seconds)
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hours}:{minutes:02d}:{secs:05.2f}"


header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,28,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,2.5,1,2,70,70,24,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

events = []
for name, start, text in LINES:
    dur = duration(os.path.join(AUDIO, name))
    end = min(start + dur + 0.15, 87.0)
    events.append(f"Dialogue: 0,{stamp(start)},{stamp(end)},Default,,0,0,0,,{text}")

ass_path = os.path.join(WORK, "subtitles.ass")
with open(ass_path, "w") as handle:
    handle.write(header + "\n".join(events) + "\n")

src = os.path.join(WORK, "nova-demo.mp4")
out = os.path.join(WORK, "nova-demo-subtitled.mp4")
subprocess.run([FFMPEG, "-y", "-i", src, "-vf", f"ass={ass_path}",
                "-c:a", "copy", "-movflags", "+faststart", out], check=True)

info = subprocess.run([FFMPEG, "-i", out], capture_output=True, text=True).stderr
print([line for line in info.splitlines() if "Duration" in line][0])
print("out:", out, os.path.getsize(out))
