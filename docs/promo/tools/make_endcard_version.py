"""Render the walkthrough end card with a beta -> 1.0 version animation."""
import os
import subprocess

FF = "/home/marcus/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
OUT = "/home/marcus/.hermes/cache/scratch/nova-demo/clipsW/V15x-endcard.mp4"

# First hold the existing product card, then beta drops out while 1.0 slides
# into its place. The final frame holds the stable 1.0 identity and URL.
filters = (
    f"drawtext=fontfile={FONT}:text='NOVA':fontcolor=0xf26b38:fontsize=54:"
    "x=(w-text_w)/2:y=215:enable='between(t,0,9.5)',"
    f"drawtext=fontfile={FONT}:text='beta':fontcolor=0xf26b38:fontsize=34:"
    "x=770:y='255+55*min(max((t-2.0)/1.7,0),1)':"
    "alpha='if(lt(t,2.0),1,if(lt(t,3.7),1-(t-2.0)/1.7,0))':"
    "enable='between(t,0,9.5)',"
    f"drawtext=fontfile={FONT}:text='1.0':fontcolor=0xf26b38:fontsize=34:"
    "x=770:y='310-55*min(max((t-2.0)/1.7,0),1)':"
    "alpha='if(lt(t,2.0),0,min((t-2.0)/1.7,1))':"
    "enable='between(t,0,9.5)',"
    f"drawtext=fontfile={FONT}:text='nova-cloud-computer.vercel.app':fontcolor=0x171717:fontsize=42:"
    "x=(w-text_w)/2:y=350:enable='between(t,0,9.5)',"
    f"drawtext=fontfile={REG}:text='your cloud workspace, with an AI agent':fontcolor=0x777777:fontsize=25:"
    "x=(w-text_w)/2:y=420:enable='between(t,0,9.5)'"
)
subprocess.run([
    FF, "-y", "-f", "lavfi", "-i", "color=c=0xf7f2ea:s=1280x720:r=25:d=9.5",
    "-vf", filters, "-an", "-c:v", "libx264", "-preset", "veryfast",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT,
], check=True)
print(OUT)
