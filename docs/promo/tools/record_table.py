"""Second take: ask the settled coffee thread for a table and catch it rendering."""
import json
import os
import time

from playwright.sync_api import sync_playwright

BASE = "https://nova-cloud-computer.vercel.app"
WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
VIDEO_DIR = os.path.join(WORK, "takes3")
os.makedirs(VIDEO_DIR, exist_ok=True)
START = time.monotonic()
MARKS = {}


def log(*parts):
    print(*parts, flush=True)


def mark(name):
    stamp = round(time.monotonic() - START, 2)
    MARKS[name] = stamp
    log(f"MARK {name} {stamp}")
    with open(os.path.join(WORK, "seg3-marks.json"), "w") as handle:
        json.dump(MARKS, handle, indent=2)


def shot(page, name):
    try:
        page.screenshot(path=os.path.join(WORK, f"seg3-{name}.png"))
    except Exception:  # noqa: BLE001
        pass


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
    row = page.locator('button:has-text("specialty coffee")').first
    row.click()
    page.wait_for_timeout(5000)
    clear()
    mark("chat-open")
    shot(page, "chat-open")

    # wait until the thread is genuinely idle (no run preparing/working)
    deadline = time.time() + 600
    settled = False
    while time.time() < deadline:
        low = body_text(page).lower()
        busy = ("preparing next turn" in low) or ("working now" in low)
        stop = page.get_by_role("button", name="Stop", exact=False)
        if not busy and stop.count() == 0:
            settled = True
            break
        page.wait_for_timeout(5000)
    log("[idle]", settled)
    mark("idle")
    shot(page, "idle")

    composer = page.locator("textarea").first
    composer.click()
    page.keyboard.type(
        "Thanks! Now reply with a markdown table comparing three coffee drinks "
        "(espresso, latte, cold brew) by caffeine and price.",
        delay=10,
    )
    page.wait_for_timeout(500)
    page.keyboard.press("Enter")
    page.wait_for_timeout(3000)
    mark("table-asked")
    shot(page, "table-asked")

    got = False
    deadline = time.time() + 300
    while time.time() < deadline:
        try:
            if page.locator("table").count() > 0:
                got = True
                break
        except Exception:  # noqa: BLE001
            pass
        page.wait_for_timeout(2000)
    log("[table]", got)
    page.wait_for_timeout(2000)
    mark("table-visible")
    shot(page, "table")
    try:
        box = page.evaluate(
            """() => { const el = document.querySelector('table');
                 if (!el) return null; const r = el.getBoundingClientRect();
                 return { x: Math.round(r.x), y: Math.round(r.y),
                          w: Math.round(r.width), h: Math.round(r.height) }; }"""
        )
        with open(os.path.join(WORK, "seg3-table-box.json"), "w") as handle:
            json.dump(box, handle)
        log("[table] box:", box)
    except Exception:  # noqa: BLE001
        pass

    log("[done]")
    context.close()
    browser.close()

log("[marks]", json.dumps(MARKS))
