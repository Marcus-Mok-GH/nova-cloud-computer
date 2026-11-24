"""Assemble the demo video (no narration yet) from screenshots + session capture."""
import json
import os
import subprocess

WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
CLIPS = os.path.join(WORK, "clips")
os.makedirs(CLIPS, exist_ok=True)
FFMPEG = "/home/marcus/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"

WEBM = None
for name in os.listdir(os.path.join(WORK, "takes")):
    if name.endswith(".webm"):
        WEBM = os.path.join(WORK, "takes", name)
if not WEBM:
    raise SystemExit("no captured webm found")

MARKS = json.load(open(os.path.join(WORK, "seg-marks.json")))


def run(args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def to_mp4(src, dst, extra=None):
    run([FFMPEG, "-y", "-i", src] + (extra or []) + [dst])


# 1. captured session -> editable mp4
SEG = os.path.join(CLIPS, "seg.mp4")
CONN = os.path.join(WORK, "conn.mp4")
if not os.path.exists(SEG):
    run([FFMPEG, "-y", "-i", WEBM, "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-r", "25", "-an", "-movflags", "+faststart", SEG])

probe = subprocess.run([FFMPEG, "-i", SEG], capture_output=True, text=True).stderr
seg_duration = float([line for line in probe.splitlines() if "Duration" in line][0].split("Duration:")[1].split(",")[0].strip().split(":")[0]) * 3600 + \
    float([line for line in probe.splitlines() if "Duration" in line][0].split("Duration:")[1].split(",")[0].strip().split(":")[1]) * 60 + \
    float([line for line in probe.splitlines() if "Duration" in line][0].split("Duration:")[1].split(",")[0].strip().split(":")[2])
print("session duration", round(seg_duration, 2))


def clip(name, src, start, end, speed=1.0, extra_vf=None):
    out = os.path.join(CLIPS, name + ".mp4")
    if os.path.exists(out):
        return out
    filters = []
    if speed != 1.0:
        filters.append(f"setpts=PTS/{speed}")
    if extra_vf:
        filters.extend(extra_vf)
    cmd = [FFMPEG, "-y", "-ss", f"{start:.2f}", "-to", f"{end:.2f}", "-i", src]
    if filters:
        cmd += ["-vf", ",".join(filters)]
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "25", "-an", out]
    run(cmd)
    return out


def still(name, image, seconds):
    out = os.path.join(CLIPS, name + ".mp4")
    if os.path.exists(out):
        return out
    run([FFMPEG, "-y", "-loop", "1", "-i", image, "-t", str(seconds),
         "-vf", "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "25", "-an", out])
    return out


def endcard(name, seconds):
    """Clean brand end card with the site URL (no overlap with page content)."""
    out = os.path.join(CLIPS, name + ".mp4")
    if os.path.exists(out):
        return out
    bold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    regular = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    url = os.path.join(WORK, "url.txt")
    vf = (
        f"drawtext=fontfile={bold}:text='NOVA':fontsize=24:fontcolor=0xC2410C"
        f":x=(w-text_w)/2:y=h/2-96,"
        f"drawtext=fontfile={bold}:textfile={url}:fontsize=40:fontcolor=0x1F1A14"
        f":x=(w-text_w)/2:y=h/2-44,"
        f"drawtext=fontfile={regular}:text='your cloud workspace, with an AI agent'"
        f":fontsize=20:fontcolor=0x6B6259:x=(w-text_w)/2:y=h/2+26"
    )
    run([FFMPEG, "-y", "-f", "lavfi", "-i", "color=c=0xF7F1E8:s=1280x720:r=25:d=" + str(seconds),
         "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "25", "-an", out])
    return out


m = MARKS
OFF = 4.5                    # measured: video timeline trails the wall-clock marks


def T(mark):
    return max(0.0, mark - OFF)


parts = [
    still("L1-landing", os.path.join(WORK, "01-landing.png"), 4.0),
    still("L2-signin", os.path.join(WORK, "02-signin.png"), 3.0),
    still("L3-code-sent", os.path.join(WORK, "03-code-sent-redacted.png"), 3.0),
    still("L4-code-entered", os.path.join(WORK, "04-code-entered-redacted.png"), 2.5),
    still("L5-logged-in", os.path.join(WORK, "rec-logged-in.png"), 2.5),
    clip("V1-overview", SEG, T(m["seg-overview"]), T(m["seg-overview"]) + 3.6),
    clip("V2-task", SEG, T(m["seg-task-sent"]) - 3.9, T(m["seg-task-sent"]) + 1.6),
    clip("V3-plan", SEG, T(m["seg-plan-ready"]), T(m["seg-plan-ready"]) + 7.8),
    clip("V4-approve", SEG, T(m["seg-approved"]) - 6.0, T(m["seg-approved"]) + 1.0),
    clip("V5-timelapse", SEG, T(m["seg-approved"]) + 1.0, T(m["seg-build-done"]) - 3.0, speed=12.0),
    clip("V6-result", SEG, T(m["seg-build-done"]), T(m["seg-build-done"]) + 7.0),
    clip("V7-files", SEG, T(m["seg-tour-files"]), T(m["seg-tour-files"]) + 3.5),
    clip("V8-deployments", SEG, T(m["seg-tour-deployments"]), T(m["seg-tour-deployments"]) + 3.5),
    clip("V9-terminal", SEG, T(m["seg-tour-terminal"]), T(m["seg-tour-terminal"]) + 3.9),
    clip("V10-environment", SEG, T(m["seg-environment"]), T(m["seg-environment"]) + 4.9),
    clip("V11-integrations", CONN, 9.64, 15.60),
    clip("V12-live-site", SEG, T(m["seg-live-site"]), T(m["seg-live-site"]) + 3.9),
    clip("V13a-outro", SEG, seg_duration - 3.4, seg_duration - 0.4),
    endcard("V13b-endcard", 2.0),
]

list_path = os.path.join(CLIPS, "list.txt")
with open(list_path, "w") as handle:
    for part in parts:
        handle.write(f"file '{part}'\n")

VIDEO_ONLY = os.path.join(WORK, "video-only.mp4")
run([FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", list_path,
     "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "25", "-an", "-movflags", "+faststart", VIDEO_ONLY])

info = subprocess.run([FFMPEG, "-i", VIDEO_ONLY], capture_output=True, text=True).stderr
line = [l for l in info.splitlines() if "Duration" in l][0]
hms = line.split("Duration:")[1].split(",")[0].strip()
print("video-only:", hms)
