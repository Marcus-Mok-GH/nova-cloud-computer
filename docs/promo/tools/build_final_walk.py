"""Final assembly for the walkthrough: captions + voiceover + ducked music."""
import os
import re
import subprocess

WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
FFMPEG = "/home/marcus/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"

VIDEO_ONLY = os.path.join(WORK, "video-only-walk.mp4")
ASS = os.path.join(WORK, "subtitles-walk.ass")
NARRATION = os.path.join(WORK, "narration-walk.m4a")
MUSIC_RAW = os.path.join(WORK, "music-jazz-walk.wav")

CAPTIONED = os.path.join(WORK, "captioned-silent-walk.mp4")
AUDIO_MIX = os.path.join(WORK, "audio-final-walk.m4a")
OUT_SUB = os.path.expanduser("~/nova-cloud-computer-walkthrough-subtitled.mp4")
OUT_PLAIN = os.path.expanduser("~/nova-cloud-computer-walkthrough.mp4")


def run(args):
    subprocess.run(args, check=True)


def duration(path):
    err = subprocess.run([FFMPEG, "-i", path], capture_output=True, text=True).stderr
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


vdur = duration(VIDEO_ONLY)
if not os.path.exists(MUSIC_RAW):
    raise SystemExit(f"missing music bed: {MUSIC_RAW}")

if not os.path.exists(CAPTIONED):
    run([FFMPEG, "-y", "-i", VIDEO_ONLY, "-vf", f"ass={ASS}",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "25", "-an",
         "-movflags", "+faststart", CAPTIONED])

graph = (
    "[1:a]volume=0.8[mu];"
    "[mu][0:a]sidechaincompress=threshold=0.03:ratio=12:attack=0.02:release=1.2:makeup=1.0[duck];"
    "[0:a][duck]amix=inputs=2:duration=first:normalize=0[mix];"
    "[mix]afade=t=out:st=" + f"{vdur - 3.0:.2f}" + ":d=3.0[fade];"
    "[fade]alimiter=limit=0.92:attack=2:release=10[level]"
)
# -stream_loop keeps the 4:32 bed playing under a 5:00 video.
run([FFMPEG, "-y", "-i", NARRATION, "-stream_loop", "-1", "-i", MUSIC_RAW,
     "-filter_complex", graph,
     "-map", "[level]", "-c:a", "aac", "-b:a", "192k", "-ar", "44100", AUDIO_MIX])

for video, out in ((CAPTIONED, OUT_SUB), (VIDEO_ONLY, OUT_PLAIN)):
    run([FFMPEG, "-y", "-i", video, "-i", AUDIO_MIX,
         "-c:v", "copy", "-c:a", "copy", "-shortest", "-movflags", "+faststart", out])

for path in (OUT_SUB, OUT_PLAIN):
    d = duration(path)
    print(os.path.basename(path), round(d, 2), "s", f"{os.path.getsize(path)/1e6:.2f} MB")

stats = subprocess.run([FFMPEG, "-i", AUDIO_MIX, "-af",
                        "astats=metadata=1:reset=0,ametadata=print:key=lavfi.astats.Overall.Peak_level",
                        "-f", "null", "-"], capture_output=True, text=True).stderr
print([line for line in stats.splitlines() if "Peak_level" in line][-1])
