"""Pad the video tail, lay the voiceover over it, and mux the final demo."""
import os
import subprocess

WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
AUDIO = "/home/marcus/.hermes/cache/audio"
FFMPEG = "/home/marcus/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"

VIDEO_ONLY = os.path.join(WORK, "video-only.mp4")
PADDED = os.path.join(WORK, "video-padded.mp4")
NARRATION = os.path.join(WORK, "narration.m4a")
FINAL = os.path.join(WORK, "nova-demo.mp4")

# (file, start seconds) - computed so lines never overlap and stay near their scenes
LINES = [
    ("tts_20261121_064813_661461.ogg", 0.2),
    ("tts_20261121_064841_419871.ogg", 5.01),
    ("tts_20261121_064842_797489.ogg", 10.88),
    ("tts_20261121_064843_927710.ogg", 14.20),
    ("tts_20261121_064845_282084.ogg", 18.20),
    ("tts_20261121_064846_327835.ogg", 22.60),
    ("tts_20261121_064857_854347.ogg", 28.18),
    ("tts_20261121_064859_050388.ogg", 33.69),
    ("tts_20261121_064900_030199.ogg", 39.20),
    ("tts_20261121_064901_117181.ogg", 51.80),
    ("tts_20261121_064902_495445.ogg", 58.80),
    ("tts_20261121_064903_611449.ogg", 62.72),
    ("tts_20261121_064913_383992.ogg", 65.80),
    ("tts_20261121_064914_528148.ogg", 69.70),
    ("tts_20261121_064915_442988.ogg", 72.90),
    ("tts_20261121_064916_444682.ogg", 76.10),
    ("tts_20261121_064917_645152.ogg", 80.41),
]


def run(args):
    subprocess.run(args, check=True)


if not os.path.exists(PADDED):
    run([FFMPEG, "-y", "-i", VIDEO_ONLY,
         "-vf", "tpad=stop_mode=clone:stop=25",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "25", "-an",
         "-movflags", "+faststart", PADDED])

inputs = []
chain = []
labels = []
for index, (name, start) in enumerate(LINES):
    inputs += ["-i", os.path.join(AUDIO, name)]
    delay_ms = int(round(start * 1000))
    chain.append(f"[{index}:a]adelay={delay_ms}|{delay_ms}[a{index}]")
    labels.append(f"[a{index}]")
chain.append("".join(labels) + f"amix=inputs={len(LINES)}:duration=longest:normalize=0[out]")
chain.append("[out]apad=whole_dur=88[padded]")

run([FFMPEG, "-y", *inputs, "-filter_complex", ";".join(chain),
     "-map", "[padded]", "-c:a", "aac", "-b:a", "192k", "-ar", "44100", NARRATION])

info = subprocess.run([FFMPEG, "-i", PADDED], capture_output=True, text=True).stderr
print([line for line in info.splitlines() if "Duration" in line][0])

run([FFMPEG, "-y", "-i", PADDED, "-i", NARRATION,
     "-vf", "fade=t=in:st=0:d=0.6,fade=t=out:st=86.6:d=0.9",
     "-af", "afade=t=out:st=85.4:d=0.8",
     "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "25",
     "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", FINAL])

print("final:", FINAL, os.path.getsize(FINAL), "bytes")
