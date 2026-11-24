"""Merged / extra walkthrough narration lines."""
import asyncio
import os

import edge_tts

OUT_DIR = "/home/marcus/.hermes/cache/audio/human4"
os.makedirs(OUT_DIR, exist_ok=True)

TEXTS = {
    "w01b": "The first time you open it, Nova walks you through what it is - an agent with files, a terminal and memory - and then asks for your first job.",
    "w05b": "Everything it touches lands in Files - folders, uploads, whatever the agent wrote - and it sees the same tree you do.",
    "w07c": "Every conversation stays in the archive - and if you want to fund bigger models, there's a coffee card right here.",
    "w08b": "Agents are your personal team - each with its own identity, wallet, memory and chat - and anything sensitive comes back to you for approval.",
    "w10b": "Skills are instructions you teach once - a report format, a review checklist - and Nova loads them only when they're relevant.",
    "w12b": "There's a real terminal into the same sandbox the agent works in, and anything you change here stays live.",
    "w21": "It writes the code, previews it, and fixes things itself.",
    "w17b": "Automations turn a plain-English request into a recurring background job.",
    "w-env2": "Add your variable names here - the values stay private to your account.",
    "w-env3": "At deploy time, the server fills in the values privately - the agent never sees them.",
    "w17c": "Describe the job in plain English - like a weekday morning review of unfinished files.",
    "w17d": "Nova schedules it, sets its limits, and repeats it without being asked again.",
}


async def main():
    for name, text in TEXTS.items():
        out = os.path.join(OUT_DIR, f"{name}.mp3")
        await edge_tts.Communicate(text, voice="en-US-BrianNeural", rate="-3%").save(out)
        print("wrote", out, flush=True)


asyncio.run(main())
