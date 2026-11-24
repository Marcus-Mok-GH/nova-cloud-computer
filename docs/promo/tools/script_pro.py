"""Professional rewrite of the walkthrough narration.

Generates every line of audio referenced by make_narration_walk.py with
polished, product-grade copy, then that script's LINES table is updated to
match (captions must equal what is spoken).
"""
import asyncio
import os

import edge_tts

A2 = "/home/marcus/.hermes/cache/audio/human2"
A3 = "/home/marcus/.hermes/cache/audio/human3"
A4 = "/home/marcus/.hermes/cache/audio/human4"

LINES = [
    (f"{A2}/h01.mp3", "This is Nova — an AI agent working inside its own cloud computer."),
    (f"{A2}/h02.mp3", "Enter your email address to begin."),
    (f"{A2}/h03.mp3", "Nova sends a one-time code."),
    (f"{A2}/h04.mp3", "Enter the code to continue."),
    (f"{A4}/w01b.mp3", "On your first visit, Nova introduces the essentials: files, a terminal, memory, and an agent that puts them to work."),
    (f"{A2}/h05.mp3", "It begins with a single question: what needs doing?"),
    (f"{A4}/w03.mp3", "Describe the outcome in plain language, exactly as you would to a colleague."),
    (f"{A4}/w22g.mp3", "Nova Lite is included at no cost. Paid plans unlock more capable models — Nova Ultra, DeepSeek, Gemini, and GPT-6.1."),
    (f"{A4}/w23c.mp3", "Slash commands add precision: one plans a complex task before any work begins, another keeps working until the goal is met."),
    (f"{A2}/h06.mp3", "For a demonstration, I asked Nova to build and publish a one-page site for Ember Roast."),
    (f"{A2}/h07.mp3", "For work of this size, it presents its approach first and waits for approval."),
    (f"{A2}/h08.mp3", "I approve the plan, and Nova begins."),
    (f"{A2}/h09.mp3", "This is real execution."),
    (f"{A4}/w04.mp3", "It writes files, runs commands, and checks its work."),
    (f"{A2}/h10.mp3", "It builds the page, writes the copy, and publishes a working site."),
    (f"{A4}/w21.mp3", "It previews its own output, identifies problems, and corrects them before handing the result back."),
    (f"{A2}/h11.mp3", "Minutes later, the result is live: a real page, not a mockup."),
    (f"{A2}/h18.mp3", "Here is the deployed site Nova just published."),
    (f"{A2}/h19.mp3", "And back to Nova — ask, review, approve, ship."),
    (f"{A2}/h12.mp3", "When an answer calls for structure, Nova formats it clearly."),
    (f"{A4}/w05b.mp3", "Files is the single source of truth: uploads, folders, and everything the agent creates stay together."),
    (f"{A4}/w07d.mp3", "Chats preserve your work history, so you can revisit any decision later."),
    (f"{A3}/h21.mp3", "Your profile ties the workspace, conversations, and settings to a single account."),
    (f"{A4}/w08b.mp3", "You can create specialist agents for different kinds of work. Each holds its own instructions and memory, while sensitive actions still return to you for approval."),
    (f"{A4}/w10b.mp3", "Skills are reusable instructions: teach Nova a report format or review checklist once, and it applies them whenever that context is relevant."),
    (f"{A2}/h14.mp3", "Every deployment is recorded for review."),
    (f"{A4}/w12b.mp3", "The terminal opens the same environment the agent works in, giving you a direct way to inspect or change anything."),
    (f"{A4}/w13b.mp3", "Personalisation lets you define the tone and standing preferences Nova follows every day."),
    (f"{A4}/w15.mp3", "Prefer another provider? Bring your own compatible model connection."),
    (f"{A4}/w16a.mp3", "Connect Telegram, Gmail and more services."),
    (f"{A3}/h23.mp3", "Environment variables stay encrypted with your account — never exposed to the browser or the agent."),
    (f"{A4}/w-env2.mp3", "Add the names your deployment requires; the values stay private."),
    (f"{A4}/w-env3.mp3", "At deploy time the server supplies those values privately, so they never reach the agent."),
    (f"{A4}/w17b.mp3", "Automations convert a plain-English instruction into a recurring job."),
    (f"{A4}/w17c.mp3", "Describe what should happen — for example, reviewing unfinished files every weekday morning."),
    (f"{A4}/w17d.mp3", "Nova defines the schedule and boundaries, then runs it without further prompting."),
    (f"{A4}/w18.mp3", "API keys let your own tools and scripts call Nova directly."),
    (f"{A4}/w24b.mp3", "The API follows the familiar OpenAI format, so most existing tools connect without changes to your workflow."),
    (f"{A4}/w25.mp3", "Create a key in Settings and use it from the tool you already have."),
    (f"{A4}/w26b.mp3", "Your client handles the conversation; Nova keeps busy requests queued rather than dropped."),
    (f"{A4}/w27b.mp3", "The documentation covers the essential endpoints and limits, so integration requires no guesswork."),
    (f"{A4}/w27c.mp3", "It also explains streaming and the response formats you can expect."),
    (f"{A4}/w22b.mp3", "Billing keeps plans, usage, and account details in one place."),
    (f"{A4}/w19.mp3", "The status page provides a real-time view of service health."),
    (f"{A2}/h17.mp3", "The integrations page brings GitHub, Gmail, Vercel, and Telegram together."),
    (f"{A4}/w20.mp3", "That is Nova — a workspace that remembers."),
    (f"{A4}/w28.mp3", "Claude Desktop, Grok, and Hermes each do real work — with their own strengths."),
    (f"{A4}/w29.mp3", "Nova's difference is the computer: a cloud workspace with files, a terminal, and one-click deploys."),
    (f"{A4}/w30.mp3", "It keeps running while your laptop sleeps — and it never touches your own machine."),
]

VOICE = "en-US-BrianNeural"
RATE = "-3%"


async def main():
    for path, text in LINES:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        await edge_tts.Communicate(text, voice=VOICE, rate=RATE).save(path)
        print("wrote", os.path.basename(path), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
