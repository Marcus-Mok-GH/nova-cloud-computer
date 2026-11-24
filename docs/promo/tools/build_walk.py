"""Assemble the full walkthrough cut.

Mixes the previously verified core scenes with the freshly recorded
walkthrough takes (onboarding, composer, files, agents, skills, terminal,
settings tour, status).
"""
import json
import os
import re
import subprocess

WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
CLIPS2 = os.path.join(WORK, "clips2")
CLIPS3 = os.path.join(WORK, "clips3")
CLIPS = os.path.join(WORK, "clipsW")
os.makedirs(CLIPS, exist_ok=True)
FFMPEG = "/home/marcus/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"

# marks for the first recorder run were printed to walk1.log (walk2 overwrote
# walk-marks.json); they are stable because each take has fixed waits.
MARKS_W1 = {
    "W1": {"step1": 0.0, "step2": 2.56, "typed": 5.19},
    "W2": {"home": 0.0, "typed": 3.54, "model-menu": 5.14},
    "W3": {"files": 0.0, "folder": 2.84},
    "W4": {"agents": 0.0, "modal": 2.45},
    "W5": {"skills": 0.0, "modal": 2.49},
}
MARKS_W2 = json.load(open(os.path.join(WORK, "walk-marks.json")))
MARKS = {**MARKS_W1, **MARKS_W2}

RAIL_BOX = (44, 608, 200, 68, None)


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
        WORK, f"matchW-{os.path.basename(video)}-{os.path.basename(ref)}.json"
    )
    if os.path.exists(cache_path):
        return json.load(open(cache_path))["t"]
    ref_img = np.asarray(Image.open(ref).convert("L").resize((160, 90)), dtype=float)
    tmp = os.path.join(WORK, "calib", "mW.png")
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


def clip(name, src, start, end, blur=None):
    out = os.path.join(CLIPS, name + ".mp4")
    start = max(0.0, min(start, duration_of(src) - 0.6))
    end = max(start + 0.6, min(end, duration_of(src)))
    vf = []
    cmd = [FFMPEG, "-y", "-ss", f"{start:.2f}", "-to", f"{end:.2f}", "-i", src]
    if blur:
        chains = []
        overlays = []
        for index, (x, y, w, h, enable) in enumerate(blur):
            chains.append(f"[0:v]crop={w}:{h}:{x}:{y},boxblur=9[b{index}]")
            cond = f":enable='{enable}'" if enable else ""
            prev = "[0:v]" if index == 0 else f"[t{index - 1}]"
            tail = f"[t{index}]" if index < len(blur) - 1 else "[bv]"
            overlays.append(f"{prev}[b{index}]overlay={x}:{y}{cond}{tail}")
        chains.extend(overlays)
        cmd += ["-filter_complex", ";".join(chains), "-map", "[bv]"]
    else:
        cmd += ["-map", "0:v"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
            "-r", "25", "-an", out]
    run(cmd)
    return out


XMARKs = json.load(open(os.path.join(WORK, "x-marks.json")))
xm = XMARKs["x1"]
xm2 = XMARKs["x2"]

seg = {}
for key, take in [("w1", "w_takes1"), ("w2", "w_takes2"), ("w3", "w_takes3"),
                  ("w4", "w_takes4"), ("w5", "w_takes5"), ("w6", "w_takes6"),
                  ("w7", "w_takes7"), ("w8", "w_takes8"), ("w10", "w_takes10"),
                  ("w12", "w_takes12"), ("w13", "w_takes13"),
                  ("x1", "x_takes_env"), ("x2", "x_takes_docs")]:
    seg[key] = to_mp4(key, os.path.join(WORK, take))

T = {}
T["onboard1"] = best_match(seg["w1"], os.path.join(WORK, "walk-w1-step1.png"), 0, 8)
T["onboard2"] = best_match(seg["w1"], os.path.join(WORK, "walk-w1-typed.png"), 2, 9)
T["home"] = best_match(seg["w2"], os.path.join(WORK, "walk-w2-home.png"), 0, 8)
T["model"] = best_match(seg["w2"], os.path.join(WORK, "walk-w2-model.png"), 2, 9)
T["files"] = best_match(seg["w3"], os.path.join(WORK, "walk-w3-files.png"), 0, 8)
T["folder"] = best_match(seg["w3"], os.path.join(WORK, "walk-w3-folder.png"), 1, 9)
T["agents"] = best_match(seg["w4"], os.path.join(WORK, "walk-w4-modal.png"), 1, 8)
T["skills"] = best_match(seg["w5"], os.path.join(WORK, "walk-w5-modal.png"), 1, 8)
T["terminal"] = best_match(seg["w6"], os.path.join(WORK, "walk-w6-idle.png"), 0, 8)
T["status"] = best_match(seg["w8"], os.path.join(WORK, "walk-w8-status.png"), 0, 9)
T["conn"] = best_match(seg["w10"], os.path.join(WORK, "walk-w10-connections.png"), 0, 8)
# The two model-menu screenshots are pixel-identical (static menu), so frame
# matching cannot order them. Use the recorder's mark times plus the offset
# calibrated from the distinct "inserted" frame (mark 39.26 -> match 40.0).
W12_OFFSET = 0.74
T["models"] = 10.45 + W12_OFFSET
T["models_hold"] = 19.68 + W12_OFFSET
T["slash"] = 31.30 + W12_OFFSET
T["inserted"] = 39.26 + W12_OFFSET
# Docs take: marks are distinct page positions, frame matching works here.
T["docs_top"] = best_match(seg["w13"], os.path.join(WORK, "walk-w13-top.png"), 0, 12)
T["docs_quickstart"] = best_match(seg["w13"], os.path.join(WORK, "walk-w13-quickstart.png"), 8, 24)
T["docs_endpoints"] = best_match(seg["w13"], os.path.join(WORK, "walk-w13-endpoints.png"), 16, 32)
T["docs_limits"] = best_match(seg["w13"], os.path.join(WORK, "walk-w13-limits.png"), 24, 40)
print("matches:", {k: round(v, 2) for k, v in T.items()})

SEGS = [
    ("S-onboard", clip("S-onboard", seg["w1"], T["onboard1"] - 1.0, min(duration_of(seg["w1"]), T["onboard2"] + 4.5), [RAIL_BOX])),
    ("S-home", clip("S-home", seg["w2"], T["home"] - 0.8, T["model"] + 1.2, [RAIL_BOX])),
    ("S-files", clip("S-files", seg["w3"], T["files"] - 0.6, T["folder"] + 2.0, [RAIL_BOX])),
    ("S-agents", clip("S-agents", seg["w4"], T["agents"] - 0.6, min(duration_of(seg["w4"]), T["agents"] + 9.0), [RAIL_BOX])),
    ("S-skills", clip("S-skills", seg["w5"], T["skills"] - 0.6, min(duration_of(seg["w5"]), T["skills"] + 9.0), [RAIL_BOX])),
    ("S-terminal", clip("S-terminal", seg["w6"], T["terminal"] - 0.6,
                        min(duration_of(seg["w6"]), T["terminal"] + 6.5), [RAIL_BOX])),
    ("S-status", clip("S-status", seg["w8"], T["status"] - 0.6,
                      min(duration_of(seg["w8"]), T["status"] + 4.5), [RAIL_BOX])),
    ("S-connections", clip("S-connections", seg["w10"], T["conn"] - 0.6,
                           T["conn"] + 2.5, [RAIL_BOX])),
    ("S-docs", clip("S-docs", seg["x2"], 0.0, xm2["end"])),
    ("S-models", clip("S-models", seg["w12"], T["models"] - 1.5,
                      min(duration_of(seg["w12"]), T["models_hold"] + 1.0), [RAIL_BOX])),
    ("S-slash", clip("S-slash", seg["w12"], T["slash"] - 1.5,
                     min(duration_of(seg["w12"]), T["inserted"] + 1.5), [RAIL_BOX])),
]

tab_order = ["General", "Personalisation", "AI provider (BYOK)", "Connections",
             "Environment", "Automations", "API keys"]
refs = {
    "General": "walk-w7-General.png",
    "Personalisation": "walk-w7-Personalisation.png",
    "AI provider (BYOK)": "walk-w7-AI_provider_BYOK.png",
    "Connections": "walk-w7-Connections.png",
    "Environment": "walk-w7-Environment.png",
    "Automations": "walk-w7-Automations.png",
    "API keys": "walk-w7-API_keys.png",
}
tab_times = {}
for name in tab_order:
    tab_times[name] = best_match(seg["w7"], os.path.join(WORK, refs[name]), 0, 24)
print("tab times:", {k: round(v, 2) for k, v in tab_times.items()})

# Dedicated takes give the three elaborated settings sections and the docs
# page enough room for their narration; drop the short tour versions.
SEGS = [entry for entry in SEGS if entry[0] not in
        ("S-set-Environment", "S-set-Automations", "S-set-API")]
SEGS.append(("S-set-Environment",
             clip("S-set-Environment", seg["x1"], xm["env_in"], xm["env_out"], [RAIL_BOX])))
SEGS.append(("S-set-Automations",
             clip("S-set-Automations", seg["x1"], xm["auto_in"], xm["auto_out"], [RAIL_BOX])))
SEGS.append(("S-set-API",
             clip("S-set-API", seg["x1"], xm["api_in"], xm["api_out"], [RAIL_BOX])))


for index, name in enumerate(tab_order):
    if name in ("Environment", "Automations", "API keys"):
        continue  # replaced by the dedicated takes below
    start = tab_times[name] - 1.3
    end = (tab_times[tab_order[index + 1]] - 0.7) if index + 1 < len(tab_order) \
        else tab_times[name] + 2.8
    # Give Automations enough screen time for the natural-language builder,
    # schedule, constraints, and recurring-job explanation.
    if name == "Environment":
        end = min(duration_of(seg["w7"]), start + 11.0)
    if name == "Automations":
        end = min(duration_of(seg["w7"]), start + 12.0)
    SEGS.append((f"S-set-{name.split(' ')[0]}",
                 clip(f"S-set-{name.split(' ')[0]}", seg["w7"], start, end, [RAIL_BOX])))


def old(folder, name):
    return os.path.join(folder, name + ".mp4")


parts = [
    ("L1-landing", old(CLIPS2, "L1-landing")),
    ("L2-signin", old(CLIPS2, "L2-signin")),
    ("L3-code-sent", old(CLIPS2, "L3-code-sent")),
    ("L4-code-entered", old(CLIPS2, "L4-code-entered")),
    ("L5-logged-in", old(CLIPS2, "L5-logged-in")),
    ("S-onboard", dict(SEGS)["S-onboard"]),
    ("V1-overview", old(CLIPS2, "V1-overview")),
    ("S-home", dict(SEGS)["S-home"]),
    ("S-models", dict(SEGS)["S-models"]),
    ("S-slash", dict(SEGS)["S-slash"]),
    ("V2-task", old(CLIPS2, "V2-task")),
    ("V3-plan", old(CLIPS2, "V3-plan")),
    ("V4-approve", old(CLIPS2, "V4-approve")),
    ("V5a-work-live", old(CLIPS2, "V5a-work-live")),
    ("V5b-zoom", old(CLIPS2, "V5b-zoom")),
    ("V5c-timelapse", old(CLIPS2, "V5c-timelapse")),
    ("V6-result", old(CLIPS2, "V6-result")),
    ("V13-live-site", old(CLIPS2, "V13-live-site")),
    ("V14-outro", old(CLIPS2, "V14-outro")),
    ("V7-table", old(CLIPS2, "V7-table")),
    ("S-files", dict(SEGS)["S-files"]),
    ("N-chats", old(CLIPS3, "N-chats-blur")),
    ("N-profile", old(CLIPS3, "N-profile-blur")),
    ("S-agents", dict(SEGS)["S-agents"]),
    ("S-skills", dict(SEGS)["S-skills"]),
    ("V9-deployments", old(CLIPS2, "V9-deployments")),
    ("S-terminal", dict(SEGS)["S-terminal"]),
    ("S-set-General", dict(SEGS)["S-set-General"]),
    ("S-set-Personalisation", dict(SEGS)["S-set-Personalisation"]),
    ("S-set-AI", dict(SEGS)["S-set-AI"]),
    ("S-connections", dict(SEGS)["S-connections"]),
    ("S-set-Environment", dict(SEGS)["S-set-Environment"]),
    ("N-env", old(CLIPS3, "N-env-blur")),
    ("S-set-Automations", dict(SEGS)["S-set-Automations"]),
    ("S-set-API", dict(SEGS)["S-set-API"]),
    ("S-docs", dict(SEGS)["S-docs"]),
    ("N-billing", old(CLIPS3, "N-billing-blur")),
    ("S-status", dict(SEGS)["S-status"]),
    ("V12-integrations", old(CLIPS2, "V12-integrations")),
    ("V14b-outro", os.path.join(CLIPS, "V14c-fadeout.mp4")),
    ("V15-endcard", os.path.join(CLIPS, "V15x-endcard.mp4")),
]

# Composite the animated explainer cards over their matching segments.
OVERLAYS = {
    "S-set-Environment": "ov_env.mov",
    "S-set-Automations": "ov_auto.mov",
    "S-docs": "ov_api.mov",
    "S-models": "ov_models.mov",
}


def decorated(name, path):
    ov = OVERLAYS.get(name)
    if not ov or not os.path.exists(os.path.join(CLIPS, ov)):
        return path
    out = os.path.join(CLIPS, name + "_dec.mp4")
    run([FFMPEG, "-y", "-i", path, "-i", os.path.join(CLIPS, ov),
         "-filter_complex", "[0:v][1:v]overlay=24:334", "-c:v", "libx264",
         "-preset", "veryfast", "-pix_fmt", "yuv420p", "-r", "25", "-an",
         "-movflags", "+faststart", out])
    return out


parts = [(name, decorated(name, path)) for name, path in parts]

list_path = os.path.join(CLIPS, "list.txt")
with open(list_path, "w") as handle:
    for _name, path in parts:
        handle.write(f"file '{path}'\n")

# Crossfade every scene boundary - the smooth, continuous feel of modern
# product videos rather than a stack of hard cuts.
FADE = 0.35
video_only = os.path.join(WORK, "video-only-walk.mp4")
inputs = []
for _name, path in parts:
    inputs += ["-i", path]
durs = [duration_of(path) for _n, path in parts]
chain = []
label = "0"
cursor = 0.0
offsets = []
for k, d in enumerate(durs[:-1]):
    offsets.append(cursor + d - FADE * (k + 1))
    chain.append(f"[{label}][{k+1}:v]xfade=transition=fade:duration={FADE}"
                 f":offset={offsets[-1]:.2f}[x{k}]")
    label = f"x{k}"
    cursor += d
graph = ";".join(chain)
run([FFMPEG, "-y", *inputs, "-filter_complex", graph, "-map", f"[{label}]",
     "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-r", "25",
     "-an", "-movflags", "+faststart", video_only])

timeline = []
shift = 0.0
for k, (name, _path) in enumerate(parts):
    start = sum(durs[:k]) - shift
    end = sum(durs[:k + 1]) - shift - (FADE if k < len(parts) - 1 else 0.0)
    timeline.append({"name": name, "start": round(start, 2), "end": round(end, 2)})
    if k < len(parts) - 1:
        shift += FADE
json.dump(timeline, open(os.path.join(WORK, "timeline-walk.json"), "w"), indent=2)

print("video-only-walk:", round(cursor, 2), "s")
for row in timeline:
    print(f"  {row['start']:7.2f} -> {row['end']:7.2f}  {row['name']}")
