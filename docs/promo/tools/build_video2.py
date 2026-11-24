"""Assemble the updated demo video (coffee build + table moment).

Clip times come from best-match frame comparisons against the recorded
screenshots, so wall-clock drift does not shift the edit.
"""
import json
import os
import subprocess

WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
CLIPS = os.path.join(WORK, "clips2")
os.makedirs(CLIPS, exist_ok=True)
FFMPEG = "/home/marcus/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"

SEG1 = os.path.join(WORK, "clips", "seg.mp4")
CONN = os.path.join(WORK, "conn.mp4")
SEG2 = os.path.join(CLIPS, "seg2.mp4")
SEG3 = os.path.join(CLIPS, "seg3.mp4")
SEG4 = os.path.join(CLIPS, "seg4.mp4")

if not os.path.exists(SEG2):
    webms = [n for n in os.listdir(os.path.join(WORK, "takes2")) if n.endswith(".webm")]
    subprocess.run([FFMPEG, "-y", "-i", os.path.join(WORK, "takes2", webms[0]),
                    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
                    "-r", "25", "-an", "-movflags", "+faststart", SEG2], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

if not os.path.exists(SEG3):
    webms3 = [n for n in os.listdir(os.path.join(WORK, "takes3")) if n.endswith(".webm")]
    subprocess.run([FFMPEG, "-y", "-i", os.path.join(WORK, "takes3", webms3[0]),
                    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
                    "-r", "25", "-an", "-movflags", "+faststart", SEG3], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

if not os.path.exists(SEG4):
    webms4 = [n for n in os.listdir(os.path.join(WORK, "takes4")) if n.endswith(".webm")]
    subprocess.run([FFMPEG, "-y", "-i", os.path.join(WORK, "takes4", webms4[0]),
                    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
                    "-r", "25", "-an", "-movflags", "+faststart", SEG4], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

MARKS = json.load(open(os.path.join(WORK, "seg2-marks.json")))
OLD = json.load(open(os.path.join(WORK, "seg-marks.json")))
BLOBS = json.load(open(os.path.join(WORK, "seg2-blobs.json")))
M3 = json.load(open(os.path.join(WORK, "seg3-marks.json"))) if os.path.exists(
    os.path.join(WORK, "seg3-marks.json")) else {}


def run(args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def duration_of(path):
    err = subprocess.run([FFMPEG, "-i", path], capture_output=True, text=True).stderr
    line = [l for l in err.splitlines() if "Duration" in l][0]
    h, m, s = line.split("Duration:")[1].split(",")[0].strip().split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


DUR1 = duration_of(SEG1)
DUR2 = duration_of(SEG2)
DUR3 = duration_of(SEG3)
print("durations", round(DUR1, 1), round(DUR2, 1), round(DUR3, 1))


def best_match(video, ref, lo, hi):
    """Time in `video` whose frame best matches the reference screenshot."""
    import numpy as np
    from PIL import Image

    cache_path = os.path.join(WORK, f"match-{os.path.basename(video)}-{os.path.basename(ref)}.json")
    if os.path.exists(cache_path):
        return json.load(open(cache_path))["t"]
    ref_img = np.asarray(Image.open(ref).convert("L").resize((160, 90)), dtype=float)
    tmp = os.path.join(WORK, "calib", "m.png")
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    results = []
    t = max(0.0, lo)
    while t <= hi:
        if os.path.exists(tmp):
            os.remove(tmp)
        subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-ss", f"{t:.2f}",
                        "-i", video, "-frames:v", "1", tmp],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if os.path.exists(tmp):
            got = np.asarray(Image.open(tmp).convert("L").resize((160, 90)), dtype=float)
            results.append((float(np.abs(ref_img - got).mean()), round(t, 2)))
        t += 0.5
    results.sort()
    best = results[0][1] if results else lo
    with open(cache_path, "w") as handle:
        json.dump({"t": best, "top": results[:3]}, handle)
    return best


A = {}
for key, image, mark_key in [
    ("overview", "seg2-overview.png", "overview"),
    ("task_sent", "seg2-task-sent.png", "task-sent"),
    ("plan", "seg2-plan.png", "plan-ready"),
    ("work", "seg2-work-group.png", "work-group"),
    ("build_done", "seg2-build-done.png", "build-done"),
    ("deployments", "seg2-deployments.png", "deployments"),
    ("live_site", "seg2-live-site.png", "live-site"),
]:
    mark = MARKS[mark_key]
    A[key] = best_match(SEG2, os.path.join(WORK, image), max(0.0, mark - 8.0), mark + 3.0)
    print("match", key, A[key])

TBL = None
if os.path.exists(os.path.join(WORK, "seg3-table.png")):
    TBL = best_match(SEG3, os.path.join(WORK, "seg3-table.png"), 15.0, max(15.5, DUR3 - 0.5))
    print("match table", TBL)

DUR4 = duration_of(SEG4) if os.path.exists(SEG4) else 0.0
BLOBS4 = json.load(open(os.path.join(WORK, "seg4-blobs.json"))) if os.path.exists(
    os.path.join(WORK, "seg4-blobs.json")) else []

SEG5 = os.path.join(CLIPS, "seg5.mp4")
M5 = {}
if not os.path.exists(SEG5):
    webms5 = [n for n in os.listdir(os.path.join(WORK, "takes5")) if n.endswith(".webm")]
    if webms5:
        subprocess.run([FFMPEG, "-y", "-i", os.path.join(WORK, "takes5", webms5[0]),
                        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
                        "-r", "25", "-an", "-movflags", "+faststart", SEG5], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
if os.path.exists(SEG5) and os.path.exists(os.path.join(WORK, "seg5-marks.json")):
    M5 = json.load(open(os.path.join(WORK, "seg5-marks.json")))
print("seg5 marks:", M5)

BLOB4 = None
if DUR4 > 0:
    # Prefer the first stable stretch where the activity card carries the ember.
    for cand in ["blobshot-21.46.png", "blobshot-21.11.png", "blobshot-20.73.png",
                 "blobshot-27.6.png", "blobshot-27.92.png"]:
        if os.path.exists(os.path.join(WORK, cand)):
            BLOB4 = best_match(SEG4, os.path.join(WORK, cand), 12.0, min(DUR4 - 0.5, 34.0))
            print("match blob", BLOB4, "from", cand)
            break

OFF1 = 4.5


def Told(mark):
    return max(0.0, mark - OFF1)


def clip(name, src, start, end, speed=1.0, extra_vf=None):
    out = os.path.join(CLIPS, name + ".mp4")
    filters = []
    if speed != 1.0:
        filters.append(f"setpts=PTS/{speed}")
    if extra_vf:
        filters.extend(extra_vf)
    cmd = [FFMPEG, "-y", "-ss", f"{start:.2f}", "-to", f"{end:.2f}", "-i", src]
    if filters:
        cmd += ["-vf", ",".join(filters)]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
            "-r", "25", "-an", out]
    run(cmd)
    return out


def still(name, image, seconds):
    out = os.path.join(CLIPS, name + ".mp4")
    run([FFMPEG, "-y", "-loop", "1", "-i", image, "-t", str(seconds),
         "-vf", "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720",
         "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
         "-r", "25", "-an", out])
    return out


def endcard(name, seconds):
    out = os.path.join(CLIPS, name + ".mp4")
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
         "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
         "-r", "25", "-an", out])
    return out


# ---- running-indicator anchor --------------------------------------------
def on_screen(box):
    return bool(box) and 0 <= box["y"] <= 700 - box["h"] and box["w"] > 0


zoom = None
work_live = None
timelapse_start = A["work"] + 0.5
candidates = [b for b in BLOBS if on_screen(b.get("card")) or on_screen(b.get("group"))]
if M5.get("zoom-start") and os.path.exists(SEG5):
    # The zoom was applied live while Nova worked, so it is captured in sync.
    peak = M5["zoom-peak"]
    TPK = best_match(SEG5, os.path.join(WORK, "zoom-live-peak.png"),
                     max(0.0, peak - 10.0), peak + 3.0)
    shift = TPK - peak

    def T5(mark):
        return max(0.0, mark + shift)

    work_live = clip("V5a-work-live", SEG5, T5(M5["zoom-start"]) - 2.4, T5(M5["zoom-start"]) + 0.1)
    anchor_path = os.path.join(WORK, "seg5-anchor.json")
    anchor = json.load(open(anchor_path)) if os.path.exists(anchor_path) else {"cx": 640, "cy": 360}
    cw, ch = 640, 360
    ax = max(0, min(1280 - cw, anchor["cx"] - cw // 2))
    ay = max(0, min(720 - ch, anchor["cy"] - ch // 2))
    zoom = clip("V5b-zoom", SEG5, T5(M5["zoom-start"]), T5(M5["zoom-end"]) + 0.5,
                extra_vf=[f"crop={cw}:{ch}:{ax}:{ay}", "scale=1280:720:flags=lanczos"])
    timelapse_start = A["work"] + 0.5
    print("seg5 zoom window", round(T5(M5["zoom-start"]), 2),
          round(T5(M5["zoom-end"]) + 0.5, 2), "crop", ax, ay)
elif BLOB4 is not None:
    # Anchor inside a stable stretch where the activity card carries the ember,
    # and crop around that canvas so the blob stays framed through the pulse.
    entry = None
    if BLOBS4:
        near = [b for b in BLOBS4
                if any(c["tid"] == "live-activity-card" for c in b["canvases"])]
        if near:
            entry = min(near, key=lambda b: abs(b["t"] - (BLOB4 + 4.0)))
    box = None
    if entry:
        box = next(c for c in entry["canvases"] if c["tid"] == "live-activity-card")
    cx = (box["x"] + box["w"] // 2) if box else 560
    cy = (box["y"] + box["h"] // 2) if box else 312
    t_anchor = min(BLOB4, max(0.0, DUR4 - 3.4))
    work_live = clip("V5a-work-live", SEG4, max(0.0, t_anchor - 1.2), t_anchor + 3.0)
    h = 360
    w = 640
    x = max(0, min(1280 - w, cx - w // 2))
    y = max(0, min(720 - h, cy - h // 2))
    zoom = clip("V5b-zoom", SEG4, max(0.0, t_anchor - 0.5), min(DUR4, t_anchor + 2.6),
                extra_vf=[
                    f"crop={w}:{h}:{x}:{y}",
                    "scale=1920:1080",
                    # push in to ~1.8x while Nova works, then settle back out
                    "zoompan=z='1+0.8*sin(2*PI*on/65)':d=1:s=1280x720:fps=25:"
                    "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'",
                ])
    timelapse_start = A["work"] + 0.5
    print("blob4 anchor", round(t_anchor, 2), "box", x, y, w, h)
elif candidates:
    groups = [b for b in candidates if on_screen(b.get("group"))]
    pool = groups or candidates
    anchor = min(pool, key=lambda b: abs((b["t"] - 4.5) - A["work"]))
    box = anchor["group"] if on_screen(anchor.get("group")) else anchor["card"]
    t_anchor = anchor["t"] - 4.5
    work_live = clip("V5a-work-live", SEG2, max(0.0, t_anchor - 1.2), t_anchor + 2.6)
    h = 320
    w = int(round(h * 16 / 9 / 2)) * 2
    cx = box["x"] + box["w"] // 2
    cy = box["y"] + box["h"] // 2
    x = max(0, min(1280 - w, cx - w // 2))
    y = max(0, min(720 - h, cy - h // 2))
    zoom = clip("V5b-zoom", SEG2, max(0.0, t_anchor - 1.2), t_anchor + 1.3,
                extra_vf=[f"crop={w}:{h}:{x}:{y},scale=1280:720:flags=lanczos"])
    timelapse_start = t_anchor + 1.3
    print("anchor", round(t_anchor, 2), "box", x, y, w, h)

parts = [
    ("L1-landing", still("L1-landing", os.path.join(WORK, "01-landing.png"), 4.0)),
    ("L2-signin", still("L2-signin", os.path.join(WORK, "02-signin.png"), 3.0)),
    ("L3-code-sent", still("L3-code-sent", os.path.join(WORK, "03-code-sent-redacted.png"), 3.0)),
    ("L4-code-entered", still("L4-code-entered", os.path.join(WORK, "04-code-entered-redacted.png"), 2.5)),
    ("L5-logged-in", still("L5-logged-in", os.path.join(WORK, "rec-logged-in.png"), 2.5)),
    ("V1-overview", clip("V1-overview", SEG2, A["overview"], A["overview"] + 3.6)),
    ("V2-task", clip("V2-task", SEG2, A["task_sent"] - 3.9, A["task_sent"] + 1.6)),
    ("V3-plan", clip("V3-plan", SEG2, A["plan"], A["plan"] + 7.8)),
    ("V4-approve", clip("V4-approve", SEG2, A["work"] - 8.0, A["work"] + 0.2)),
]

if work_live:
    parts.append(("V5a-work-live", work_live))
if zoom:
    parts.append(("V5b-zoom", zoom))

tl_end = max(timelapse_start + 4.0, A["build_done"] - 2.5)
raw = max(4.0, tl_end - timelapse_start)
speed = max(1.0, min(14.0, raw / 18.0))
parts.append(("V5c-timelapse", clip("V5c-timelapse", SEG2, timelapse_start, tl_end, speed=speed)))

parts.append(("V6-result", clip("V6-result", SEG2, A["build_done"] - 0.5, A["build_done"] + 6.5)))

if TBL is not None:
    parts.append(("V7-table", clip("V7-table", SEG3, max(0.0, TBL - 3.5), min(DUR3, TBL + 1.1))))
else:
    parts.append(("V7-table", clip("V7-table", SEG2, MARKS["table-asked"] - 4.5,
                                   MARKS["table-asked"] + 0.0)))

parts += [
    ("V8-files", clip("V8-files", SEG1, Told(OLD["seg-tour-files"]), Told(OLD["seg-tour-files"]) + 3.5)),
    ("V9-deployments", clip("V9-deployments", SEG2, A["deployments"], A["deployments"] + 3.5)),
    ("V10-terminal", clip("V10-terminal", SEG1, Told(OLD["seg-tour-terminal"]), Told(OLD["seg-tour-terminal"]) + 3.9)),
    ("V11-environment", clip("V11-environment", SEG1, Told(OLD["seg-environment"]), Told(OLD["seg-environment"]) + 4.9)),
    ("V12-integrations", clip("V12-integrations", CONN, 9.64, 15.60)),
    ("V13-live-site", clip("V13-live-site", SEG2, A["live_site"], A["live_site"] + 3.9)),
    ("V14-outro", clip("V14-outro", SEG1, DUR1 - 3.4, DUR1 - 0.4)),
    ("V15-endcard", endcard("V15-endcard", 2.0)),
]

list_path = os.path.join(CLIPS, "list.txt")
with open(list_path, "w") as handle:
    for _name, path in parts:
        handle.write(f"file '{path}'\n")

VIDEO_ONLY = os.path.join(WORK, "video-only2.mp4")
run([FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", list_path,
     "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-r", "25",
     "-an", "-movflags", "+faststart", VIDEO_ONLY])

timeline = []
cursor = 0.0
for name, path in parts:
    d = duration_of(path)
    timeline.append({"name": name, "start": round(cursor, 2), "end": round(cursor + d, 2)})
    cursor += d
with open(os.path.join(WORK, "timeline2.json"), "w") as handle:
    json.dump(timeline, handle, indent=2)

info = subprocess.run([FFMPEG, "-i", VIDEO_ONLY], capture_output=True, text=True).stderr
line = [l for l in info.splitlines() if "Duration" in l][0]
print("video-only2:", line.split("Duration:")[1].split(",")[0].strip())
for row in timeline:
    print(f"  {row['start']:7.2f} -> {row['end']:7.2f}  {row['name']}")
