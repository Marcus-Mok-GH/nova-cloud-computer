"""Record the remaining fresh scenes: profile page, billing, environment."""
import json
import os
import time

from playwright.sync_api import sync_playwright

BASE = "https://nova-cloud-computer.vercel.app"
WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"

TAKES = {"takesB": 1, "takesC": 1, "takesD": 1}
for d in TAKES:
    os.makedirs(os.path.join(WORK, d), exist_ok=True)

marks_path = os.path.join(WORK, "new-marks.json")
marks = json.load(open(marks_path)) if os.path.exists(marks_path) else {}
started = time.time()


def mark(name):
    marks[name] = round(time.time() - started, 2)
    print(f"MARK {name} {marks[name]}", flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path="/usr/bin/google-chrome",
        headless=True,
        args=["--no-sandbox", "--disable-dev-shm-usage"],
    )

    # --- B: profile entry -> profile page ---------------------------------
    ctx = browser.new_context(
        viewport={"width": 1280, "height": 720},
        locale="en-US",
        storage_state=os.path.join(WORK, "session.json"),
        record_video_dir=os.path.join(WORK, "takesB"),
        record_video_size={"width": 1280, "height": 720},
    )
    pg = ctx.new_page()
    pg.goto(BASE + "/app/chats", wait_until="domcontentloaded", timeout=90000)
    pg.wait_for_timeout(3500)
    mark("b-before-click")
    pg.screenshot(path=os.path.join(WORK, "new-b-before.png"))
    rail_profile = pg.locator('aside').last.locator('[aria-label="Profile"]')
    rail_profile.click()
    pg.wait_for_url("**/app/profile", timeout=60000)
    pg.wait_for_timeout(2500)
    mark("b-profile")
    pg.screenshot(path=os.path.join(WORK, "new-b-profile.png"))
    pg.wait_for_timeout(2000)
    ctx.close()

    # --- C: Billing page with the support card ----------------------------
    ctx = browser.new_context(
        viewport={"width": 1280, "height": 720},
        locale="en-US",
        storage_state=os.path.join(WORK, "session.json"),
        record_video_dir=os.path.join(WORK, "takesC"),
        record_video_size={"width": 1280, "height": 720},
    )
    pg = ctx.new_page()
    pg.goto(BASE + "/app/billing", wait_until="domcontentloaded", timeout=90000)
    pg.wait_for_selector('[data-testid="support-card"]', timeout=60000)
    pg.wait_for_timeout(2500)
    mark("c-card")
    pg.screenshot(path=os.path.join(WORK, "new-c-card.png"))
    pg.wait_for_timeout(2000)
    ctx.close()

    # --- D: Settings > Environment (per-account secrets) ------------------
    ctx = browser.new_context(
        viewport={"width": 1280, "height": 720},
        locale="en-US",
        storage_state=os.path.join(WORK, "session.json"),
        record_video_dir=os.path.join(WORK, "takesD"),
        record_video_size={"width": 1280, "height": 720},
    )
    pg = ctx.new_page()
    pg.goto(BASE + "/app/settings", wait_until="domcontentloaded", timeout=90000)
    pg.wait_for_timeout(3500)
    mark("d-settings")
    pg.screenshot(path=os.path.join(WORK, "new-d-settings.png"))
    try:
        tab = pg.get_by_role("tab", name="Environment")
        if tab.count():
            tab.first.click()
        else:
            pg.get_by_text("Environment", exact=True).first.click()
        pg.wait_for_timeout(2500)
        mark("d-environment")
        pg.screenshot(path=os.path.join(WORK, "new-d-environment.png"))
        print("environment tab ok", flush=True)
    except Exception as exc:  # noqa: BLE001
        print("environment tab failed:", exc, flush=True)
    pg.wait_for_timeout(2000)
    ctx.close()

    browser.close()

json.dump(marks, open(marks_path, "w"), indent=2)
print("marks:", marks)
