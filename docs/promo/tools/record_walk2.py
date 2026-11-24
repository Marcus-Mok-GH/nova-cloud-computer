"""Walkthrough takes, part 2: terminal, settings tour, status, notifications."""
import json
import os
import time

from playwright.sync_api import sync_playwright

BASE = "https://nova-cloud-computer.vercel.app"
WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"

TABS = ["General", "Personalisation", "AI provider (BYOK)", "Connections",
        "Environment", "Automations", "API keys", "Account"]

marks = {}
started = 0.0


def start_take():
    global started
    started = time.time()


def mark(take, name):
    marks.setdefault(take, {})[name] = round(time.time() - started, 2)
    print(f"MARK {take}:{name} {marks[take][name]}", flush=True)


def dismiss_dialogs(pg):
    for _ in range(6):
        if pg.locator('[role="dialog"][data-state="open"]').count() == 0:
            return
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(700)


def ctx(browser, take):
    c = browser.new_context(
        viewport={"width": 1280, "height": 720},
        locale="en-US",
        storage_state=os.path.join(WORK, "session.json"),
        record_video_dir=os.path.join(WORK, take),
        record_video_size={"width": 1280, "height": 720},
    )
    c.add_init_script("try{localStorage.setItem('nova.onboardingFlow.v1','1');}catch(e){}")
    return c


with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path="/usr/bin/google-chrome",
        headless=True,
        args=["--no-sandbox", "--disable-dev-shm-usage"],
    )

    # --- W6: terminal -----------------------------------------------------
    c = ctx(browser, "w_takes6")
    pg = c.new_page()
    pg.goto(BASE + "/app/terminal", wait_until="domcontentloaded", timeout=90000)
    dismiss_dialogs(pg)
    pg.wait_for_timeout(3500)
    start_take()
    mark("W6", "terminal-idle")
    pg.screenshot(path=os.path.join(WORK, "walk-w6-idle.png"))
    try:
        pg.get_by_role("button", name="Connect to agent VM").first.click(timeout=6000)
    except Exception as exc:  # noqa: BLE001
        print("connect failed:", exc, flush=True)
    pg.wait_for_timeout(6000)
    mark("W6", "connected")
    pg.screenshot(path=os.path.join(WORK, "walk-w6-connected.png"))
    term = pg.locator(".xterm-screen, .xterm, body").last
    try:
        term.click(timeout=4000)
    except Exception:  # noqa: BLE001
        pass
    pg.keyboard.type("pwd\n", delay=30)
    pg.wait_for_timeout(1800)
    pg.keyboard.type("ls\n", delay=30)
    pg.wait_for_timeout(2200)
    mark("W6", "commands")
    pg.screenshot(path=os.path.join(WORK, "walk-w6-commands.png"))
    pg.keyboard.type("cat AGENTS.md\n", delay=30)
    pg.wait_for_timeout(2500)
    mark("W6", "cat")
    pg.screenshot(path=os.path.join(WORK, "walk-w6-cat.png"))
    c.close()

    # --- W7: settings tour ------------------------------------------------
    c = ctx(browser, "w_takes7")
    pg = c.new_page()
    pg.goto(BASE + "/app/settings", wait_until="domcontentloaded", timeout=90000)
    dismiss_dialogs(pg)
    pg.wait_for_timeout(3500)
    start_take()
    tabs = pg.locator('[role="tab"]')
    for index, name in enumerate(TABS):
        try:
            tabs.nth(index).click(timeout=6000)
            pg.wait_for_timeout(2600)
            mark("W7", name)
            safe = name.replace(" ", "_").replace("(", "").replace(")", "")
            pg.screenshot(path=os.path.join(WORK, f"walk-w7-{safe}.png"))
        except Exception as exc:  # noqa: BLE001
            print("tab failed:", name, exc, flush=True)
    c.close()

    # --- W8: status -------------------------------------------------------
    c = ctx(browser, "w_takes8")
    pg = c.new_page()
    pg.goto(BASE + "/app/status", wait_until="domcontentloaded", timeout=90000)
    dismiss_dialogs(pg)
    pg.wait_for_timeout(4500)
    start_take()
    mark("W8", "status")
    pg.screenshot(path=os.path.join(WORK, "walk-w8-status.png"))
    pg.wait_for_timeout(2000)
    c.close()

    # --- W9: notifications panel -----------------------------------------
    c = ctx(browser, "w_takes9")
    pg = c.new_page()
    pg.goto(BASE + "/app", wait_until="domcontentloaded", timeout=90000)
    dismiss_dialogs(pg)
    pg.wait_for_timeout(3000)
    start_take()
    try:
        bell = pg.locator('button[aria-label="Notifications"], button[title="Notifications"]').first
        bell.click(timeout=5000)
        pg.wait_for_timeout(2200)
        mark("W9", "bell")
        pg.screenshot(path=os.path.join(WORK, "walk-w9-bell.png"))
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(800)
    except Exception as exc:  # noqa: BLE001
        print("notifications failed:", exc, flush=True)
        pg.screenshot(path=os.path.join(WORK, "walk-w9-fail.png"))
    c.close()

    # --- W10: connections detail -----------------------------------------
    c = ctx(browser, "w_takes10")
    pg = c.new_page()
    pg.goto(BASE + "/app/settings", wait_until="domcontentloaded", timeout=90000)
    dismiss_dialogs(pg)
    pg.wait_for_timeout(3500)
    tabs = pg.locator('[role="tab"]')
    try:
        tabs.nth(3).click(timeout=6000)  # Connections
        pg.wait_for_timeout(3000)
        start_take()
        mark("W10", "connections")
        pg.screenshot(path=os.path.join(WORK, "walk-w10-connections.png"))
        pg.mouse.wheel(0, 400)
        pg.wait_for_timeout(1500)
        mark("W10", "connections-scroll")
        pg.screenshot(path=os.path.join(WORK, "walk-w10-scroll.png"))
    except Exception as exc:  # noqa: BLE001
        print("connections failed:", exc, flush=True)
    c.close()

    browser.close()

json.dump(marks, open(os.path.join(WORK, "walk-marks.json"), "w"), indent=2)
print("marks:", marks)
