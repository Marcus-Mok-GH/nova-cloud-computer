"""Walkthrough-only narration lines."""
import asyncio
import os

import edge_tts

OUT_DIR = "/home/marcus/.hermes/cache/audio/human4"
os.makedirs(OUT_DIR, exist_ok=True)

TEXTS = {
    "w01": "The first time you open it, Nova walks you through what it actually is - not a chat box, but an agent with files, a terminal and memory.",
    "w02": "Then it asks for your first job, in your own words. That becomes your first conversation.",
    "w03": "You just type, like you'd ask a person. If you care which model answers, there's a picker right here.",
    "w04": "It's in there writing files, running commands and checking its own work.",
    "w05": "Everything it touches lands in Files - folders, uploads, whatever the agent wrote.",
    "w06": "You can open anything here, and the agent sees the same tree.",
    "w07": "Every conversation stays in the archive, attached to this workspace.",
    "w08": "Agents are your personal team - each one has its own identity, wallet, memory and chat.",
    "w09": "Give one a role, and anything sensitive comes back to you for approval.",
    "w10": "Skills are instructions you teach once - a report format, a review checklist.",
    "w11": "Nova loads them only when they're relevant.",
    "w12": "Anything you change here stays in the live workspace.",
    "w13": "Settings start with standing rules - how Nova should help, day to day.",
    "w14": "Personalities save a whole set of preferences that Nova follows in every reply.",
    "w15": "Prefer your own model? Bring your own OpenAI-compatible key.",
    "w16": "Connections hook up Telegram, Gmail and more - the agent can act there for you.",
    "w17": "Automations turn a plain-language job into something that repeats.",
    "w18": "API keys let your own scripts call Nova's AI directly.",
    "w19": "And there's a live status page - Nova checks itself every minute.",
    "w20": "That's Nova - an agent with a computer, and a workspace that remembers.",
}


async def main():
    for name, text in TEXTS.items():
        out = os.path.join(OUT_DIR, f"{name}.mp3")
        await edge_tts.Communicate(text, voice="en-US-BrianNeural", rate="-3%").save(out)
        print("wrote", out, flush=True)


asyncio.run(main())
