"""Narration + captions for the walkthrough cut."""
import json
import os
import re
import subprocess

WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
A2 = "/home/marcus/.hermes/cache/audio/human2"
A3 = "/home/marcus/.hermes/cache/audio/human3"
A4 = "/home/marcus/.hermes/cache/audio/human4"
FFMPEG = "/home/marcus/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"

LINES = [
    (f"{A2}/h01.mp3", 'This is Nova — an AI agent working inside its own cloud computer.'),
    (f"{A2}/h02.mp3", 'Enter your email address to begin.'),
    (f"{A2}/h03.mp3", 'Nova sends a one-time code.'),
    (f"{A2}/h04.mp3", 'Enter the code to continue.'),
    (f"{A4}/w01b.mp3", 'On your first visit, Nova introduces the essentials: files, a terminal, memory, and an agent that puts them to work.'),
    (f"{A2}/h05.mp3", 'It begins with a single question: what needs doing?'),
    (f"{A4}/w03.mp3", 'Describe the outcome in plain language, exactly as you would to a colleague.'),
    (f"{A4}/w22g.mp3", 'Nova Lite is included at no cost. Paid plans unlock more capable models — Nova Ultra, DeepSeek, Gemini, and GPT-6.1.'),
    (f"{A4}/w23c.mp3", 'Slash commands add precision: one plans a complex task before any work begins, another keeps working until the goal is met.'),
    (f"{A2}/h06.mp3", 'For a demonstration, I asked Nova to build and publish a one-page site for Ember Roast.'),
    (f"{A2}/h07.mp3", 'For work of this size, it presents its approach first and waits for approval.'),
    (f"{A2}/h08.mp3", 'I approve the plan, and Nova begins.'),
    (f"{A2}/h09.mp3", 'This is real execution.'),
    (f"{A4}/w04.mp3", 'It writes files, runs commands, and checks its work.'),
    (f"{A2}/h10.mp3", 'It builds the page, writes the copy, and publishes a working site.'),
    (f"{A4}/w21.mp3", 'It previews its own output, identifies problems, and corrects them before handing the result back.'),
    (f"{A2}/h11.mp3", 'Minutes later, the result is live: a real page, not a mockup.'),
    (f"{A2}/h18.mp3", 'Here is the deployed site Nova just published.'),
    (f"{A2}/h19.mp3", 'And back to Nova — ask, review, approve, ship.'),
    (f"{A2}/h12.mp3", 'When an answer calls for structure, Nova formats it clearly.'),
    (f"{A4}/w05b.mp3", 'Files is the single source of truth: uploads, folders, and everything the agent creates stay together.'),
    (f"{A4}/w07d.mp3", 'Chats preserve your work history, so you can revisit any decision later.'),
    (f"{A3}/h21.mp3", 'Your profile ties the workspace, conversations, and settings to a single account.'),
    (f"{A4}/w08b.mp3", 'You can create specialist agents for different kinds of work. Each holds its own instructions and memory, while sensitive actions still return to you for approval.'),
    (f"{A4}/w10b.mp3", 'Skills are reusable instructions: teach Nova a report format or review checklist once, and it applies them whenever that context is relevant.'),
    (f"{A2}/h14.mp3", 'Every deployment is recorded for review.'),
    (f"{A4}/w12b.mp3", 'The terminal opens the same environment the agent works in, giving you a direct way to inspect or change anything.'),
    (f"{A4}/w13b.mp3", 'Personalisation lets you define the tone and standing preferences Nova follows every day.'),
    (f"{A4}/w15.mp3", 'Prefer another provider? Bring your own compatible model connection.'),
    (f"{A4}/w16a.mp3", 'Connect Telegram, Gmail and more services.'),
    (f"{A3}/h23.mp3", 'Environment variables stay encrypted with your account — never exposed to the browser or the agent.'),
    (f"{A4}/w-env2.mp3", 'Add the names your deployment requires; the values stay private.'),
    (f"{A4}/w-env3.mp3", 'At deploy time the server supplies those values privately, so they never reach the agent.'),
    (f"{A4}/w17b.mp3", 'Automations convert a plain-English instruction into a recurring job.'),
    (f"{A4}/w17c.mp3", 'Describe what should happen — for example, reviewing unfinished files every weekday morning.'),
    (f"{A4}/w17d.mp3", 'Nova defines the schedule and boundaries, then runs it without further prompting.'),
    (f"{A4}/w18.mp3", 'API keys let your own tools and scripts call Nova directly.'),
    (f"{A4}/w24b.mp3", 'The API follows the familiar OpenAI format, so most existing tools connect without changes to your workflow.'),
    (f"{A4}/w25.mp3", 'Create a key in Settings and use it from the tool you already have.'),
    (f"{A4}/w26b.mp3", 'Your client handles the conversation; Nova keeps busy requests queued rather than dropped.'),
    (f"{A4}/w27b.mp3", 'The documentation covers the essential endpoints and limits, so integration requires no guesswork.'),
    (f"{A4}/w27c.mp3", 'It also explains streaming and the response formats you can expect.'),
    (f"{A4}/w22b.mp3", 'Billing keeps plans, usage, and account details in one place.'),
    (f"{A4}/w19.mp3", 'The status page provides a real-time view of service health.'),
    (f"{A2}/h17.mp3", 'The integrations page brings GitHub, Gmail, Vercel, and Telegram together.'),
    (f"{A4}/w20.mp3", 'That is Nova — a workspace that remembers.'),
    (f"{A4}/w28.mp3", 'Claude Desktop, Grok, and Hermes each do real work — with their own strengths.'),
    (f"{A4}/w29.mp3", "Nova's difference is the computer: a cloud workspace with files, a terminal, and one-click deploys."),
    (f"{A4}/w30.mp3", 'It keeps running while your laptop sleeps — and it never touches your own machine.'),
]

PLACEMENTS = [
    ("L1-landing", 0.2),
    ("L2-signin", 0.2),
    ("L3-code-sent", 0.2),
    ("L4-code-entered", 0.2),
    ("S-onboard", 0.5),
    ("V1-overview", 0.4),
    ("S-home", 0.5),
    ("S-models", 0.3),
    ("S-slash", 0.3),
    ("V2-task", 0.2),
    ("V3-plan", 0.3),
    ("V4-approve", 5.5),
    ("V5a-work-live", 0.4),
    ("V5b-zoom", 0.4),
    ("V5c-timelapse", 0.3),
    ("V5c-timelapse", 9.0),
    ("V6-result", 0.3),
    ("V13-live-site", 0.3),
    ("V14-outro", 0.3),
    ("V7-table", 0.4),
    ("S-files", 0.3),
    ("N-chats", 0.3),
    ("N-profile", 0.3),
    ("S-agents", 0.4),
    ("S-skills", 0.4),
    ("V9-deployments", 0.2),
    ("S-terminal", 0.4),
    ("S-set-General", 0.2),
    ("S-set-AI", 0.2),
    ("S-connections", 0.2),
    ("S-set-Environment", 0.3),
    ("S-set-Environment", 6.2),
    ("S-set-Environment", 11.0),
    ("S-set-Automations", 0.3),
    ("S-set-Automations", 5.2),
    ("S-set-Automations", 10.9),
    ("S-set-API", 1.5),
    ("S-docs", 2.0),
    ("S-docs", 9.0),
    ("S-docs", 16.0),
    ("S-docs", 23.0),
    ("S-docs", 30.0),
    ("N-billing", 0.3),
    ("S-status", 0.3),
    ("V12-integrations", 0.4),
    ("V14b-outro", 0.3),
    ("V15-endcard", 0.6),
    ("V15-endcard", 5.0),
    ("V15-endcard", 11.2),
]


def duration(path):
    """Effective speech duration: edge-tts pads clips with long trailing silence."""
    err = subprocess.run([FFMPEG, "-i", path], capture_output=True, text=True).stderr
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err)
    total = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    det = subprocess.run([FFMPEG, "-i", path, "-af",
                          "silencedetect=noise=-35dB:d=0.25", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", det)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", det)]
    # a trailing silence has a start but no end before EOF
    if starts and (len(ends) < len(starts)):
        return max(0.5, starts[-1] + 0.05)
    for s0, e0 in zip(starts, ends):
        if e0 >= total - 0.2:
            return max(0.5, s0 + 0.05)
    return total


def stamp(seconds):
    seconds = max(0.0, seconds)
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hours}:{minutes:02d}:{secs:05.2f}"


timeline = json.load(open(os.path.join(WORK, "timeline-walk.json")))
starts = {row["name"]: row["start"] for row in timeline}
video_duration = timeline[-1]["end"]

TAIL_RESERVE = 3.0
GAP = 0.15
ends = {row["name"]: row["end"] for row in timeline}
placed = []
overlaps = []
cursor = 0.0
for i, ((audio, text), (clip_name, offset)) in enumerate(zip(LINES, PLACEMENTS)):
    dur = duration(audio)
    clip_start = starts.get(clip_name, cursor)
    clip_end = ends.get(clip_name, video_duration)
    desired = clip_start + offset
    start = max(desired, cursor + GAP)
    # keep the closing card free of speech
    latest = video_duration - TAIL_RESERVE - dur
    if start > latest:
        start = latest
    placed.append((audio, start, dur, text))
    if start < cursor + GAP - 0.01:
        overlaps.append((clip_name, round(cursor + GAP - start, 2)))
    cursor = start + dur
print("speech overlaps:", overlaps)

print("placements:")
cursor = placed[-1][1] + placed[-1][2]
for _a, start, dur, text in placed:
    print(f"  {start:7.2f} -> {start+dur:7.2f}  {text[:60]}")
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

narration = os.path.join(WORK, "narration-walk.m4a")
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
with open(os.path.join(WORK, "subtitles-walk.ass"), "w") as handle:
    handle.write(header + "\n".join(events) + "\n")
print("wrote narration-walk.m4a and subtitles-walk.ass")
