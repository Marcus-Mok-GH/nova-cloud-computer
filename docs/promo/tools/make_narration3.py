"""Narration + captions for the full-feature cut, placed on the assembled timeline."""
import json
import os
import re
import subprocess

WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
AUDIO2 = "/home/marcus/.hermes/cache/audio/human2"
AUDIO3 = "/home/marcus/.hermes/cache/audio/human3"
FFMPEG = "/home/marcus/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"

# (audio path, spoken line)
LINES = [
    (f"{AUDIO2}/h01.mp3", "This is Nova — an AI agent with its own computer."),
    (f"{AUDIO2}/h02.mp3", "Getting in is simple. You put in your email address."),
    (f"{AUDIO2}/h03.mp3", "They send you a six digit code. No passwords, nothing else."),
    (f"{AUDIO2}/h04.mp3", "And that’s it — you’re straight into your workspace."),
    (f"{AUDIO2}/h05.mp3", "Your workspace starts with one question: what needs doing?"),
    (f"{AUDIO3}/h20.mp3", "If you want to help fund bigger models, there’s a Buy Me a Coffee card right on Chats."),
    (f"{AUDIO3}/h21.mp3", "Your profile sits at the bottom of the menu — everything stays tied to your account."),
    (f"{AUDIO2}/h06.mp3", "So I asked it to build a one-page site for a coffee brand, Ember Roast, and publish it."),
    (f"{AUDIO2}/h07.mp3", "It plans the work first, then waits for my go-ahead."),
    (f"{AUDIO2}/h08.mp3", "I approve it — and off it goes."),
    (f"{AUDIO2}/h09.mp3", "See that amber blob? That means it’s really working."),
    (f"{AUDIO2}/h10.mp3", "It scaffolds, writes the copy, and publishes to a real URL."),
    (f"{AUDIO2}/h11.mp3", "Minutes later, the site is live — a real page, not a mockup."),
    (f"{AUDIO2}/h12.mp3", "And when an answer calls for a table, it renders as one."),
    (f"{AUDIO2}/h13.mp3", "Files, deployments, settings — it’s all in one place."),
    (f"{AUDIO2}/h14.mp3", "Every publish stays in your account and keeps its history."),
    (f"{AUDIO3}/h22.mp3", "Billing lives here too, with the same plans and the same card if you’d like to chip in."),
    (f"{AUDIO2}/h15.mp3", "There’s a real terminal into the agent’s sandbox."),
    (f"{AUDIO3}/h23.mp3", "Environment variables save to your account only. Encrypted, and nobody else can touch them."),
    (f"{AUDIO2}/h17.mp3", "You can hook up GitHub, Gmail, Vercel and Telegram right here."),
    (f"{AUDIO2}/h18.mp3", "Now we’re switching to the live deployed site — this is the real page Nova just published."),
    (f"{AUDIO2}/h19.mp3", "And now we’re back in Nova. That’s the whole loop."),
]

PLACEMENTS = [
    ("L1-landing", 0.2),
    ("L2-signin", 0.2),
    ("L3-code-sent", 0.2),
    ("L4-code-entered", 0.2),
    ("V1-overview", 1.2),
    ("N-chats", 0.4),
    ("N-profile", 1.8),
    ("V2-task", 0.2),
    ("V3-plan", 0.3),
    ("V4-approve", 7.4),
    ("V5a-work-live", 0.4),
    ("V5c-timelapse", 0.3),
    ("V6-result", 0.3),
    ("V7-table", 0.4),
    ("V8-files", 0.2),
    ("V9-deployments", 0.2),
    ("N-billing", 0.3),
    ("V10-terminal", 0.2),
    ("N-env", 1.2),
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


timeline = json.load(open(os.path.join(WORK, "timeline3.json")))
starts = {row["name"]: row["start"] for row in timeline}
ends = {row["name"]: row["end"] for row in timeline}
video_duration = timeline[-1]["end"]

placed = []
cursor = 0.0
for index, ((audio, text), (clip_name, offset)) in enumerate(zip(LINES, PLACEMENTS)):
    dur = duration(audio)
    desired = starts.get(clip_name, cursor) + offset
    # keep the line inside its scene where possible
    clip_end = ends.get(clip_name, video_duration)
    start = min(max(desired, cursor + 0.15), max(cursor + 0.15, clip_end - dur - 0.05))
    start = min(start, max(0.0, video_duration - dur - 0.2))
    placed.append((audio, start, dur, text))
    cursor = start + dur

print("placements:")
for _a, start, dur, text in placed:
    print(f"  {start:6.2f} -> {start+dur:6.2f}  {text}")
print("last line ends", round(placed[-1][1] + placed[-1][2], 2), "video", round(video_duration, 2))

inputs = []
chain = []
labels = []
for index, (audio, start, dur, _text) in enumerate(placed):
    inputs += ["-i", audio]
    chain.append(f"[{index}:a]adelay={int(round(start*1000))}|{int(round(start*1000))}[a{index}]")
    labels.append(f"[a{index}]")
chain.append("".join(labels) + f"amix=inputs={len(placed)}:duration=longest:normalize=0[out]")
chain.append(f"[out]apad=whole_dur={round(video_duration + 8, 1)}[padded]")

narration = os.path.join(WORK, "narration3.m4a")
subprocess.run([FFMPEG, "-y", *inputs, "-filter_complex", ";".join(chain),
                "-map", "[padded]", "-c:a", "aac", "-b:a", "192k", "-ar", "44100", narration],
               check=True)

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
    for _a, start, dur, text in placed
]
with open(os.path.join(WORK, "subtitles3.ass"), "w") as handle:
    handle.write(header + "\n".join(events) + "\n")
print("wrote narration3.m4a and subtitles3.ass")
