"""Final assembly: captions + voiceover + calming music bed (ducked under speech)."""
import os
import subprocess

WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
FFMPEG = "/home/marcus/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"

VIDEO_ONLY = os.path.join(WORK, "video-only.mp4")
ASS = os.path.join(WORK, "subtitles.ass")
NARRATION = os.path.join(WORK, "narration.m4a")
MUSIC = os.path.join(WORK, "music.wav")

CAPTIONED = os.path.join(WORK, "captioned-silent.mp4")
AUDIO_MIX = os.path.join(WORK, "audio-final.m4a")
OUT_SUB = os.path.join(WORK, "nova-demo-subtitled.mp4")
OUT_PLAIN = os.path.join(WORK, "nova-demo.mp4")


def run(args):
    subprocess.run(args, check=True)


if not os.path.exists(CAPTIONED):
    run([FFMPEG, "-y", "-i", VIDEO_ONLY, "-vf", f"ass={ASS}",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "25", "-an",
         "-movflags", "+faststart", CAPTIONED])

graph = (
    "[1:a]volume=0.55[mu];"
    "[mu][0:a]sidechaincompress=threshold=0.03:ratio=12:attack=0.02:release=1.2:makeup=1.0[duck];"
    "[0:a][duck]amix=inputs=2:duration=first:normalize=0[mix];"
    "[mix]alimiter=limit=0.92:attack=2:release=10[level]"
)
run([FFMPEG, "-y", "-i", NARRATION, "-i", MUSIC, "-filter_complex", graph,
     "-map", "[level]", "-c:a", "aac", "-b:a", "192k", "-ar", "44100", AUDIO_MIX])

for video, out in ((CAPTIONED, OUT_SUB), (VIDEO_ONLY, OUT_PLAIN)):
    run([FFMPEG, "-y", "-i", video, "-i", AUDIO_MIX,
         "-c:v", "copy", "-c:a", "copy", "-shortest", "-movflags", "+faststart", out])

for path in (OUT_SUB, OUT_PLAIN):
    info = subprocess.run([FFMPEG, "-i", path], capture_output=True, text=True).stderr
    duration = [line for line in info.splitlines() if "Duration" in line][0]
    size = os.path.getsize(path)
    print(path.split("/")[-1], duration.split("Duration:")[1].split(",")[0].strip(), f"{size/1e6:.2f} MB")

stats = subprocess.run([FFMPEG, "-i", AUDIO_MIX, "-af", "astats=metadata=1:reset=0,ametadata=print:key=lavfi.astats.Overall.RMS_level", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
print([line for line in stats.splitlines() if "RMS_level" in line][-1])
