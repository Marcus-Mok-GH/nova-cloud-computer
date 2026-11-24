"""Pixelate the account email out of the two login screenshots."""
import os

from PIL import Image

WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
BOX = (410, 368, 895, 446)

for name in ["03-code-sent.png", "04-code-entered.png"]:
    src = os.path.join(WORK, name)
    image = Image.open(src).convert("RGB")
    region = image.crop(BOX)
    small = region.resize((region.width // 14, region.height // 14), Image.BILINEAR)
    mosaic = small.resize(region.size, Image.NEAREST)
    image.paste(mosaic, BOX)
    out = src.replace(".png", "-redacted.png")
    image.save(out)
    print("wrote", out)
