"""Rebuild narration + captions from the rewritten (more human) script."""
import os
import re
import subprocess

WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
AUDIO = "/home/marcus/.hermes/cache/audio"
FFMPEG = "/home/marcus/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"

# (preferred start, caption text) - clips are human/hNN.mp3 from gen_voice.py
LINES = [
    (0.3, "This is Nova — an AI agent with its own computer."),
    (4.3, "Getting in is simple. You put in your email address."),
    (7.3, "They send you a six digit code. No passwords, nothing else."),
    (10.3, "And that’s it — you’re straight into your workspace."),
    (15.3, "Your workspace starts with one question: what needs doing?"),
    (19.0, "I asked it to build me a one-page website, and publish it for real."),
    (24.5, "It plans the work first, then waits for me to say go."),
    (32.3, "So I just approve it. And off it goes."),
    (39.2, "It scaffolds, writes the code, and publishes to a real URL."),
    (51.8, "Minutes later, the site is live — a real page, not a mockup."),
    (57.5, "Files, deployments, settings — it’s all in one place."),
    (62.0, "Every publish keeps a history."),
    (65.5, "There’s a real terminal into the agent’s sandbox."),
    (69.5, "Env vars stay encrypted; the browser only sees their names."),
    (74.6, "You can hook up GitHub, Gmail, Vercel and Telegram right here."),
    (80.6, "The finished site — one click away."),
    (85.0, "That’s Nova — go give it a try."),
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


placed = []
cursor = 0.0
for index, (desired, text) in enumerate(LINES, start=1):
    name = f"human/h{index:02d}.mp3"
    dur = duration(os.path.join(AUDIO, name))
    start = max(desired, cursor + 0.15)
    placed.append((name, start, dur, text))
    cursor = start + dur

print("placements:")
for name, start, dur, text in placed:
    print(f"  {start:6.2f} -> {start+dur:6.2f}  {text}")

inputs = []
chain = []
labels = []
for index, (name, start, dur, _text) in enumerate(placed):
    inputs += ["-i", os.path.join(AUDIO, name)]
    chain.append(f"[{index}:a]adelay={int(round(start*1000))}|{int(round(start*1000))}[a{index}]")
    labels.append(f"[a{index}]")
chain.append("".join(labels) + f"amix=inputs={len(placed)}:duration=longest:normalize=0[out]")
chain.append("[out]apad=whole_dur=94[padded]")

narration = os.path.join(WORK, "narration.m4a")
subprocess.run([FFMPEG, "-y", *inputs, "-filter_complex", ";".join(chain),
                "-map", "[padded]", "-c:a", "aac", "-b:a", "192k", "-ar", "44100", narration], check=True)

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
events = [
    f"Dialogue: 0,{stamp(start)},{stamp(min(start + dur + 0.15, 87.0))},Default,,0,0,0,,{text}"
    for _name, start, dur, text in placed
]
with open(os.path.join(WORK, "subtitles.ass"), "w") as handle:
    handle.write(header + "\n".join(events) + "\n")
print("wrote narration.m4a and subtitles.ass")
