"""Extra walkthrough takes: linger on Settings > Environment / Automations /
API keys, and a slow scroll through the API docs page."""
import json
import os
import time

from playwright.sync_api import sync_playwright

BASE = "https://nova-cloud-computer.vercel.app"
WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"

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
        open_dialogs = pg.locator('[role="dialog"][data-state="open"]')
        if open_dialogs.count() == 0:
            return
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(700)


def ctx(browser, take):
    return browser.new_context(
        viewport={"width": 1280, "height": 720},
        locale="en-US",
        storage_state=os.path.join(WORK, "session.json"),
        record_video_dir=os.path.join(WORK, take),
        record_video_size={"width": 1280, "height": 720},
    )


def ctx_seeded(browser, take):
    c = ctx(browser, take)
    c.add_init_script("try{localStorage.setItem('nova.onboardingFlow.v1','1');}catch(e){}")
    return c


with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path="/usr/bin/google-chrome",
        headless=True,
        args=["--no-sandbox", "--disable-dev-shm-usage"],
    )

    # --- X1: settings tour, lingering on the three elaborated tabs --------
    c = ctx_seeded(browser, "x_takes_env")
    pg = c.new_page()
    pg.goto(BASE + "/app/settings", wait_until="domcontentloaded", timeout=90000)
    pg.wait_for_timeout(3500)
    dismiss_dialogs(pg)
    start_take()

    def click_tab(name):
        tab = pg.get_by_role("tab", name=name)
        if tab.count():
            tab.first.click()
        else:
            pg.get_by_text(name, exact=True).first.click()
        pg.wait_for_timeout(1800)
        dismiss_dialogs(pg)

    click_tab("Environment")
    mark("x1", "env_in")
    for i in range(8):          # ~16s hold, tiny scrolls keep it alive
        pg.mouse.wheel(0, 120)
        pg.wait_for_timeout(2000)
    mark("x1", "env_out")

    click_tab("Automations")
    mark("x1", "auto_in")
    for i in range(9):          # ~18s hold
        pg.mouse.wheel(0, 120)
        pg.wait_for_timeout(2000)
    mark("x1", "auto_out")

    click_tab("API keys")
    mark("x1", "api_in")
    pg.wait_for_timeout(8000)
    mark("x1", "api_out")
    c.close()

    # --- X2: docs page, slow scroll ---------------------------------------
    c = ctx_seeded(browser, "x_takes_docs")
    pg = c.new_page()
    pg.goto(BASE + "/docs", wait_until="domcontentloaded", timeout=90000)
    pg.wait_for_timeout(4000)
    dismiss_dialogs(pg)
    start_take()
    mark("x2", "top")
    for i in range(28):         # ~42s slow scroll
        pg.mouse.wheel(0, 260)
        pg.wait_for_timeout(1500)
        if i % 5 == 4:
            mark("x2", f"s{i+1}")
            pg.screenshot(path=os.path.join(WORK, f"x-docs-{i+1}.png"))
    mark("x2", "end")
    c.close()

    browser.close()

json.dump(marks, open(os.path.join(WORK, "x-marks.json"), "w"), indent=2)
print("marks:", marks)
