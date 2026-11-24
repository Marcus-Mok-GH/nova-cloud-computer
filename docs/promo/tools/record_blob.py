"""Dedicated take for the working-blob close-up: a quick file-listing run."""
import json
import os
import time

from playwright.sync_api import sync_playwright

BASE = "https://nova-cloud-computer.vercel.app"
WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
VIDEO_DIR = os.path.join(WORK, "takes4")
os.makedirs(VIDEO_DIR, exist_ok=True)
START = time.monotonic()
MARKS = {}


def log(*parts):
    print(*parts, flush=True)


def mark(name):
    stamp = round(time.monotonic() - START, 2)
    MARKS[name] = stamp
    log(f"MARK {name} {stamp}")
    with open(os.path.join(WORK, "seg4-marks.json"), "w") as handle:
        json.dump(MARKS, handle, indent=2)


def body_text(page):
    try:
        return page.evaluate("document.body.innerText") or ""
    except Exception:  # noqa: BLE001
        return ""


with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path="/usr/bin/google-chrome",
        headless=True,
        args=["--no-sandbox", "--disable-dev-shm-usage"],
    )
    context = browser.new_context(
        viewport={"width": 1280, "height": 720},
        locale="en-US",
        storage_state=os.path.join(WORK, "session.json"),
        record_video_dir=VIDEO_DIR,
        record_video_size={"width": 1280, "height": 720},
    )
    page = context.new_page()
    page.set_default_timeout(20000)
    mark("start")

    def clear():
        for _ in range(8):
            hit = None
            for name in ["Save & continue", "Skip for now", "Skip", "Close", "Not now"]:
                try:
                    loc = page.get_by_role("button", name=name, exact=False)
                    if loc.count() > 0 and loc.first.is_visible():
                        loc.first.click()
                        hit = name
                        break
                except Exception:  # noqa: BLE001
                    continue
            if not hit:
                break
            page.wait_for_timeout(800)

    page.goto(BASE + "/app/chats", wait_until="domcontentloaded")
    page.wait_for_timeout(5000)
    clear()
    page.locator('button:has-text("specialty coffee")').first.click()
    page.wait_for_timeout(4000)
    clear()
    mark("chat-open")

    composer = page.locator("textarea").first
    composer.click()
    page.keyboard.type("List every file currently in the workspace, then stop.", delay=8)
    page.wait_for_timeout(400)
    page.keyboard.press("Enter")
    page.wait_for_timeout(1500)
    mark("sent")

    shots = []
    deadline = time.time() + 240
    while time.time() < deadline:
        try:
            info = page.evaluate(
                """() => Array.from(document.querySelectorAll('canvas[data-testid=working-animation]')).map(c => {
                     const r = c.getBoundingClientRect();
                     let tid = 'none', n = c.parentElement;
                     for (let i = 0; i < 6 && n; i++) {
                       if (n.getAttribute && n.getAttribute('data-testid')) { tid = n.getAttribute('data-testid'); break; }
                       n = n.parentElement;
                     }
                     return { x: Math.round(r.x), y: Math.round(r.y),
                              w: Math.round(r.width), h: Math.round(r.height), tid };
                   })"""
            )
        except Exception:  # noqa: BLE001
            info = []
        if info:
            t = round(time.monotonic() - START, 2)
            shots.append({"t": t, "canvases": info})
            try:
                page.screenshot(path=os.path.join(WORK, f"blobshot-{t}.png"))
            except Exception:  # noqa: BLE001
                pass
            with open(os.path.join(WORK, "seg4-blobs.json"), "w") as handle:
                json.dump(shots, handle, indent=2)
        low = body_text(page).lower()
        if "finished" in low and "steps" in low and not info:
            # give it a few extra seconds before concluding
            page.wait_for_timeout(2000)
            break
        page.wait_for_timeout(0.4)

    mark("done")
    log("[shots]", len(shots))
    context.close()
    browser.close()

log("[marks]", json.dumps(MARKS))
