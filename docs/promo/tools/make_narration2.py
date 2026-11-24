"""Narration + captions for the updated demo, placed on the assembled timeline."""
import json
import os
import re
import subprocess

WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
AUDIO = "/home/marcus/.hermes/cache/audio"
VOICE_DIR = "human2"
FFMPEG = "/home/marcus/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"

TEXTS = [
    "This is Nova — an AI agent with its own computer.",
    "Getting in is simple. You put in your email address.",
    "They send you a six digit code. No passwords, nothing else.",
    "And that’s it — you’re straight into your workspace.",
    "Your workspace starts with one question: what needs doing?",
    "So I asked it to build a one-page site for a coffee brand, Ember Roast, and publish it.",
    "It plans the work first, then waits for my go-ahead.",
    "I approve it — and off it goes.",
    "See that amber blob? That means it’s really working.",
    "It scaffolds, writes the copy, and publishes to a real URL.",
    "Minutes later, the site is live — a real page, not a mockup.",
    "And when an answer calls for a table, it renders as one.",
    "Files, deployments, settings — it’s all in one place.",
    "Every publish stays in your account and keeps its history.",
    "There’s a real terminal into the agent’s sandbox.",
    "Your keys save to this account only — encrypted, and never shown in the browser.",
    "You can hook up GitHub, Gmail, Vercel and Telegram right here.",
    "Now we’re switching to the live deployed site — this is the real page Nova just published.",
    "And now we’re back in Nova. That’s the whole loop.",
]

# Which clip carries each line, and where inside it (seconds).
PLACEMENTS = [
    ("L1-landing", 0.2),
    ("L2-signin", 0.2),
    ("L3-code-sent", 0.2),
    ("L4-code-entered", 0.2),
    ("V1-overview", 1.2),
    ("V2-task", 0.2),
    ("V3-plan", 0.3),
    ("V4-approve", 7.4),
    ("V5a-work-live", 0.4),
    ("V5c-timelapse", 0.3),
    ("V6-result", 0.3),
    ("V7-table", 0.4),
    ("V8-files", 0.2),
    ("V9-deployments", 0.2),
    ("V10-terminal", 0.2),
    ("V11-environment", 0.2),
    ("V12-integrations", 0.4),
    ("V13-live-site", 0.3),
    ("V14-outro", 0.3),
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


timeline = json.load(open(os.path.join(WORK, "timeline2.json")))
starts = {row["name"]: row["start"] for row in timeline}
video_duration = timeline[-1]["end"]

placed = []
cursor = 0.0
for index, text in enumerate(TEXTS):
    name = f"{VOICE_DIR}/h{index + 1:02d}.mp3"
    dur = duration(os.path.join(AUDIO, name))
    clip_name, offset = PLACEMENTS[index]
    desired = starts.get(clip_name, cursor) + offset
    start = min(max(desired, cursor + 0.15), max(0.0, video_duration - dur - 0.2))
    placed.append((name, start, dur, text))
    cursor = start + dur

print("placements:")
for name, start, dur, text in placed:
    print(f"  {start:6.2f} -> {start+dur:6.2f}  {text}")
print("last line ends", round(placed[-1][1] + placed[-1][2], 2), "video", round(video_duration, 2))

inputs = []
chain = []
labels = []
for index, (name, start, dur, _text) in enumerate(placed):
    inputs += ["-i", os.path.join(AUDIO, name)]
    chain.append(f"[{index}:a]adelay={int(round(start*1000))}|{int(round(start*1000))}[a{index}]")
    labels.append(f"[a{index}]")
chain.append("".join(labels) + f"amix=inputs={len(placed)}:duration=longest:normalize=0[out]")
chain.append(f"[out]apad=whole_dur={round(video_duration + 6, 1)}[padded]")

narration = os.path.join(WORK, "narration2.m4a")
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
cap_end = video_duration - 0.6
events = [
    f"Dialogue: 0,{stamp(start)},{stamp(min(start + dur + 0.15, cap_end))},Default,,0,0,0,,{text}"
    for _name, start, dur, text in placed
]
with open(os.path.join(WORK, "subtitles2.ass"), "w") as handle:
    handle.write(header + "\n".join(events) + "\n")
print("wrote narration2.m4a and subtitles2.ass")
