"""Record the ember close-up with the zoom applied live to the real page.

While Nova works, smoothly scale the app toward the activity-card blob and
back, so the zoom is captured in sync with the work instead of cropped from
an unrelated moment.
"""
import json
import os
import time

from playwright.sync_api import sync_playwright

BASE = "https://nova-cloud-computer.vercel.app"
WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
VIDEO_DIR = os.path.join(WORK, "takes5")
os.makedirs(VIDEO_DIR, exist_ok=True)
START = time.monotonic()
MARKS = {}


def log(*parts):
    print(*parts, flush=True)


def mark(name):
    stamp = round(time.monotonic() - START, 2)
    MARKS[name] = stamp
    log(f"MARK {name} {stamp}")
    with open(os.path.join(WORK, "seg5-marks.json"), "w") as handle:
        json.dump(MARKS, handle, indent=2)


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
            page.wait_for_timeout(700)

    page.goto(BASE + "/app/chats", wait_until="domcontentloaded")
    page.wait_for_timeout(5000)
    clear()
    page.locator('button:has-text("specialty coffee")').first.click()
    page.wait_for_timeout(4000)
    clear()
    mark("chat-open")

    composer = page.locator("textarea").first
    composer.click()
    page.keyboard.type(
        "Create a new file called notes.txt with today's date inside, then list every file in the workspace.",
        delay=8,
    )
    page.wait_for_timeout(400)
    page.keyboard.press("Enter")
    page.wait_for_timeout(1500)
    mark("sent")

    # wait for a visible running indicator: the tool-group headline pill, or
    # failing that the live activity card
    card = None
    deadline = time.time() + 300
    stable = 0
    last_y = None
    while time.time() < deadline:
        info = page.evaluate(
            """() => {
              const pick = (sel) => {
                const el = document.querySelector(sel);
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
                         w: Math.round(r.width), h: Math.round(r.height), sel };
              };
              // The ember itself, wherever it is mounted (typing row, thinking
              // line, live activity card, tool-group headline).
              const blob = pick('canvas[data-testid=working-animation]');
              return { blob, group: pick('[data-testid=tool-run-group] > button'),
                       card: pick('[data-testid=live-activity-card]') };
            }"""
        )
        in_view = lambda b: bool(b) and 0 < b["y"] < 700 - 10
        chosen = info["group"] if in_view(info["group"]) else (
            info["card"] if in_view(info["card"]) else (
                info["blob"] if in_view(info["blob"]) else None))
        if chosen and 0 < chosen["y"] < 700 - 10:
            if last_y is not None and abs(chosen["y"] - last_y) <= 12:
                stable += 1
            else:
                stable = 0
            last_y = chosen["y"]
            card = chosen
            if stable >= 2:
                break
        else:
            stable = 0
            last_y = None
        page.wait_for_timeout(0.3)
    log("[indicator]", card)

    if card:
        cx = min(max(card["x"], 320), 960)
        cy = min(max(card["y"], 200), 520)
        with open(os.path.join(WORK, "seg5-anchor.json"), "w") as handle:
            json.dump({"cx": cx, "cy": cy}, handle)
        # settle a beat, then push in toward the ember and back out
        page.wait_for_timeout(400)
        mark("zoom-start")
        page.evaluate(
            """([cx, cy]) => {
              document.body.style.transformOrigin = `${cx}px ${cy}px`;
              document.body.style.transition = 'transform 1.1s ease-in-out';
              document.body.style.transform = 'scale(2.0)';
            }""",
            [cx, cy],
        )
        page.wait_for_timeout(1500)
        mark("zoom-peak")
        page.screenshot(path=os.path.join(WORK, "zoom-live-peak.png"))
        page.evaluate(
            """() => {
              document.body.style.transition = 'transform 1.1s ease-in-out';
              document.body.style.transform = 'scale(1)';
            }"""
        )
        page.wait_for_timeout(1500)
        mark("zoom-end")
        # settle the page back to normal
        page.evaluate(
            """() => { document.body.style.transition = 'none'; document.body.style.transform = ''; }"""
        )
    else:
        log("[card] never appeared")

    page.wait_for_timeout(2000)
    mark("done")
    context.close()
    browser.close()

log("[marks]", json.dumps(MARKS))
