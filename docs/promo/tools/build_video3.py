"""Assemble the full-feature demo cut.

Reuses the calibrated core scenes from the previous cut and splices in the
freshly recorded support-card / profile / billing / environment scenes.
"""
import json
import os
import re
import subprocess

WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
CLIPS2 = os.path.join(WORK, "clips2")
CLIPS = os.path.join(WORK, "clips3")
os.makedirs(CLIPS, exist_ok=True)
FFMPEG = "/home/marcus/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"


def run(args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def duration_of(path):
    err = subprocess.run([FFMPEG, "-i", path], capture_output=True, text=True).stderr
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def to_mp4(name, take_dir):
    out = os.path.join(CLIPS, name + ".mp4")
    if os.path.exists(out):
        return out
    webms = sorted(n for n in os.listdir(take_dir) if n.endswith(".webm"))
    run([FFMPEG, "-y", "-i", os.path.join(take_dir, webms[0]),
         "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
         "-r", "25", "-an", "-movflags", "+faststart", out])
    return out


def best_match(video, ref, lo, hi):
    import numpy as np
    from PIL import Image

    cache_path = os.path.join(
        WORK, f"match3-{os.path.basename(video)}-{os.path.basename(ref)}.json"
    )
    if os.path.exists(cache_path):
        return json.load(open(cache_path))["t"]
    ref_img = np.asarray(Image.open(ref).convert("L").resize((160, 90)), dtype=float)
    tmp = os.path.join(WORK, "calib", "m3.png")
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


def clip(name, src, start, end, speed=1.0):
    out = os.path.join(CLIPS, name + ".mp4")
    start = max(0.0, min(start, duration_of(src) - 0.6))
    end = max(start + 0.6, min(end, duration_of(src)))
    vf = f"setpts=PTS/{speed}" if speed != 1.0 else None
    cmd = [FFMPEG, "-y", "-ss", f"{start:.2f}", "-to", f"{end:.2f}", "-i", src]
    if vf:
        cmd += ["-vf", vf]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
            "-r", "25", "-an", out]
    run(cmd)
    return out


segA = to_mp4("segA", os.path.join(WORK, "takesA"))
segB = to_mp4("segB", os.path.join(WORK, "takesB"))
segC = to_mp4("segC", os.path.join(WORK, "takesC"))
segD = to_mp4("segD", os.path.join(WORK, "takesD"))
print("seg durations", [round(duration_of(p), 2) for p in (segA, segB, segC, segD)])

raw_marks = json.load(open(os.path.join(WORK, "new-marks.json")))


def M(take, name):
    """Mark time within a take (supports nested or flat JSON)."""
    if take in raw_marks:
        return raw_marks[take][name]
    return raw_marks[name]


print("marks:", raw_marks)

# --- calibrated new scenes ------------------------------------------------
T_A_CARD = best_match(segA, os.path.join(WORK, "new-a-card.png"),
                      max(0.0, M("takesA", "a-card") - 8), M("takesA", "a-card") + 3)
n_chats = clip("N-chats", segA, max(0.0, T_A_CARD - 1.0),
               min(duration_of(segA), T_A_CARD + 4.5))
print("chats", round(T_A_CARD, 2))

T_B_BEFORE = best_match(segB, os.path.join(WORK, "new-b-before.png"),
                        max(0.0, M("takesB", "b-before-click") - 8), M("takesB", "b-before-click") + 3)
T_B_PROFILE = best_match(segB, os.path.join(WORK, "new-b-profile.png"),
                         max(0.0, M("takesB", "b-profile") - 8), M("takesB", "b-profile") + 3)
n_profile = clip("N-profile", segB, max(0.0, T_B_BEFORE - 0.6),
                 min(duration_of(segB), T_B_PROFILE + 2.8))
print("profile", round(T_B_BEFORE, 2), round(T_B_PROFILE, 2))

T_C = best_match(segC, os.path.join(WORK, "new-c-card.png"),
                 max(0.0, M("takesC", "c-card") - 8), M("takesC", "c-card") + 3)
n_billing = clip("N-billing", segC, max(0.0, T_C - 0.6),
                 min(duration_of(segC), T_C + 4.0))
print("billing", round(T_C, 2))

n_env = None
if "d-environment" in raw_marks.get("takesD", {}):
    T_D_SET = best_match(segD, os.path.join(WORK, "new-d-settings.png"),
                         max(0.0, M("takesD", "d-settings") - 8), M("takesD", "d-settings") + 3)
    T_D_ENV = best_match(segD, os.path.join(WORK, "new-d-environment.png"),
                         max(0.0, M("takesD", "d-environment") - 8), M("takesD", "d-environment") + 3)
    n_env = clip("N-env", segD, max(0.0, T_D_SET - 0.8),
                 min(duration_of(segD), T_D_ENV + 2.8))
    print("env", round(T_D_SET, 2), round(T_D_ENV, 2))



def blurred(name, src, boxes):
    """Pixel-blur privacy regions: (x, y, w, h, enable-expression-or-None)."""
    out = os.path.join(CLIPS, name + "-blur.mp4")
    if os.path.exists(out):
        return out
    chains = []
    overlays = []
    for index, (x, y, w, h, enable) in enumerate(boxes):
        chains.append(f"[0:v]crop={w}:{h}:{x}:{y},boxblur=9[b{index}]")
        cond = f":enable='{enable}'" if enable else ""
        prev = "[0:v]" if index == 0 else f"[t{index - 1}]"
        tail = f"[t{index}]" if index < len(boxes) - 1 else "[out]"
        overlays.append(f"{prev}[b{index}]overlay={x}:{y}{cond}{tail}")
    chains.extend(overlays)
    cmd = [FFMPEG, "-y", "-i", src, "-filter_complex", ";".join(chains),
           "-map", "[out]", "-c:v", "libx264", "-preset", "veryfast",
           "-pix_fmt", "yuv420p", "-r", "25", "-an", out]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out


def old(name):
    return os.path.join(CLIPS2, name + ".mp4")


RAIL_BOX = (44, 608, 200, 68, None)
PROFILE_MAIN_BOX = (478, 320, 254, 142, "between(t,2.2,99)")

n_chats_b = blurred("N-chats", n_chats, [RAIL_BOX])
n_profile_b = blurred("N-profile", n_profile, [RAIL_BOX, PROFILE_MAIN_BOX])
n_billing_b = blurred("N-billing", n_billing, [RAIL_BOX])
n_env_b = blurred("N-env", n_env, [RAIL_BOX]) if n_env else None

parts = [
    ("L1-landing", old("L1-landing")),
    ("L2-signin", old("L2-signin")),
    ("L3-code-sent", old("L3-code-sent")),
    ("L4-code-entered", old("L4-code-entered")),
    ("L5-logged-in", old("L5-logged-in")),
    ("V1-overview", old("V1-overview")),
    ("N-chats", n_chats_b),
    ("N-profile", n_profile_b),
    ("V2-task", old("V2-task")),
    ("V3-plan", old("V3-plan")),
    ("V4-approve", old("V4-approve")),
    ("V5a-work-live", old("V5a-work-live")),
    ("V5b-zoom", old("V5b-zoom")),
    ("V5c-timelapse", old("V5c-timelapse")),
    ("V6-result", old("V6-result")),
    ("V7-table", old("V7-table")),
    ("V8-files", old("V8-files")),
    ("V9-deployments", old("V9-deployments")),
    ("N-billing", n_billing_b),
    ("V10-terminal", old("V10-terminal")),
]
if n_env:
    parts.append(("N-env", n_env_b))
else:
    parts.append(("V11-environment", old("V11-environment")))

parts += [
    ("V12-integrations", old("V12-integrations")),
    ("V13-live-site", old("V13-live-site")),
    ("V14-outro", old("V14-outro")),
    ("V15-endcard", old("V15-endcard")),
]

list_path = os.path.join(CLIPS, "list.txt")
with open(list_path, "w") as handle:
    for _name, path in parts:
        handle.write(f"file '{path}'\n")

video_only = os.path.join(WORK, "video-only3.mp4")
run([FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", list_path,
     "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-r", "25",
     "-an", "-movflags", "+faststart", video_only])

timeline = []
cursor = 0.0
for name, path in parts:
    d = duration_of(path)
    timeline.append({"name": name, "start": round(cursor, 2), "end": round(cursor + d, 2)})
    cursor += d
json.dump(timeline, open(os.path.join(WORK, "timeline3.json"), "w"), indent=2)

print("video-only3:", round(cursor, 2), "s")
for row in timeline:
    print(f"  {row['start']:7.2f} -> {row['end']:7.2f}  {row['name']}")
