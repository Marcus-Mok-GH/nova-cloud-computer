"""Extra narration lines for the full-feature cut."""
import asyncio
import os

import edge_tts

OUT_DIR = "/home/marcus/.hermes/cache/audio/human3"
os.makedirs(OUT_DIR, exist_ok=True)

TEXTS = {
    20: "If you want to help fund bigger models, there's a Buy Me a Coffee card right on Chats.",
    21: "Your profile sits at the bottom of the menu - everything stays tied to your account.",
    22: "Billing lives here too, with the same plans and the same card if you'd like to chip in.",
    23: "Environment variables save to your account only. Encrypted, and nobody else can touch them.",
}


async def main():
    for index, text in TEXTS.items():
        out = os.path.join(OUT_DIR, f"h{index:02d}.mp3")
        await edge_tts.Communicate(text, voice="en-US-BrianNeural", rate="-3%").save(out)
        print("wrote", out, flush=True)


asyncio.run(main())
