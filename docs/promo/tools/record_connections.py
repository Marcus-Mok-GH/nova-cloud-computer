"""Record a slow scroll through Settings > Connections (session replay)."""
import json
import os
import time

from playwright.sync_api import sync_playwright

BASE = "https://nova-cloud-computer.vercel.app"
WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
OUT = os.path.join(WORK, "conn-takes")
os.makedirs(OUT, exist_ok=True)
START = time.monotonic()
MARKS = {}


def log(*parts):
    print(*parts, flush=True)


def mark(name):
    stamp = round(time.monotonic() - START, 2)
    MARKS[name] = stamp
    log(f"MARK {name} {stamp}")
    with open(os.path.join(WORK, "conn-marks.json"), "w") as handle:
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
        record_video_dir=OUT,
        record_video_size={"width": 1280, "height": 720},
    )
    page = context.new_page()
    page.set_default_timeout(20000)

    def clear():
        for _ in range(6):
            hit = None
            for name in ["Skip for now", "Close", "Not now", "Save & continue"]:
                try:
                    loc = page.get_by_role("button", name=name, exact=False)
                    if loc.count() > 0 and loc.first.is_visible():
                        loc.first.click()
                        hit = name
                        break
                except Exception:  # noqa: BLE001
                    continue
            if not hit:
                return
            page.wait_for_timeout(800)

    page.goto(BASE + "/app/settings", wait_until="domcontentloaded")
    page.wait_for_timeout(4000)
    clear()
    page.get_by_role("tab", name="Connections", exact=True).first.click()
    page.wait_for_timeout(2500)
    clear()
    page.wait_for_timeout(1200)
    mark("conn-start")

    # smooth, human-paced scroll through the connector cards
    page.evaluate("""() => { const el = Array.from(document.querySelectorAll('*'))
        .filter(e => e.scrollHeight > e.clientHeight + 60 && e.clientHeight > 200)
        .sort((a,b)=>b.scrollHeight-a.scrollHeight)[0]; window.__scroller = el; }""")
    mark("scroll-begin")
    for step in range(14):
        page.evaluate("() => { window.__scroller.scrollTop += 90; }")
        page.wait_for_timeout(420)
    mark("scroll-end")
    page.wait_for_timeout(600)
    page.screenshot(path=os.path.join(WORK, "conn-final.png"))
    context.close()
    browser.close()

log("[marks]", json.dumps(MARKS))
