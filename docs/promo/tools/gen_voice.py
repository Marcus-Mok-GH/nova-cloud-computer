"""Regenerate the narration with a warmer, more human neural voice."""
import asyncio
import os

import edge_tts

OUT_DIR = "/home/marcus/.hermes/cache/audio/human"
os.makedirs(OUT_DIR, exist_ok=True)

TEXTS = [
    "This is Nova — an AI agent with its own computer.",
    "Getting in is simple. You put in your email address.",
    "They send you a six digit code. No passwords, nothing else.",
    "And that’s it — you’re straight into your workspace.",
    "Your workspace starts with one question: what needs doing?",
    "I asked it to build me a one-page website, and publish it for real.",
    "It plans the work first, then waits for me to say go.",
    "So I just approve it. And off it goes.",
    "It scaffolds, writes the code, and publishes to a real URL.",
    "Minutes later, the site is live — a real page, not a mockup.",
    "Files, deployments, settings — it’s all in one place.",
    "Every publish keeps a history.",
    "There’s a real terminal into the agent’s sandbox.",
    "Env vars stay encrypted; the browser only sees their names.",
    "You can hook up GitHub, Gmail, Vercel and Telegram right here.",
    "The finished site — one click away.",
    "That’s Nova — go give it a try.",
]


async def main():
    for index, text in enumerate(TEXTS, start=1):
        out = os.path.join(OUT_DIR, f"h{index:02d}.mp3")
        await edge_tts.Communicate(text, voice="en-US-BrianNeural", rate="-3%").save(out)
        print("wrote", out)


asyncio.run(main())
