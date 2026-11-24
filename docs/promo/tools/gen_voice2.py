"""Narration for the updated demo (coffee build + table moment)."""
import asyncio
import os

import edge_tts

OUT_DIR = "/home/marcus/.hermes/cache/audio/human2"
os.makedirs(OUT_DIR, exist_ok=True)

TEXTS = [
    "This is Nova — an AI agent with its own computer.",
    "Getting in is simple. You put in your email address.",
    "They send you a six digit code. No passwords, nothing else.",
    "And that’s it — you’re straight into your workspace.",
    "Your workspace starts with one question: what needs doing?",
    "So I asked it to build a one-page site for a coffee brand, Ember Roast, and publish it.",
    "It plans the work first, then waits for my go-ahead.",
    "I approve it — and off it goes.",
    "See that amber blob? That means it’s really working.",
    "It scaffolds, writes the copy, and publishes to a real URL.",
    "Minutes later, the site is live — a real page, not a mockup.",
    "And when an answer calls for a table, it renders as one.",
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
