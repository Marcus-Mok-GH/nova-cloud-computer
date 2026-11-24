"""Walkthrough takes, part 1: onboarding, composer, files, agents, skills."""
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


def ctx(browser, take, seed_onboarding=False):
    c = browser.new_context(
        viewport={"width": 1280, "height": 720},
        locale="en-US",
        storage_state=os.path.join(WORK, "session.json"),
        record_video_dir=os.path.join(WORK, take),
        record_video_size={"width": 1280, "height": 720},
    )
    if seed_onboarding:
        c.add_init_script("try{localStorage.setItem('nova.onboardingFlow.v1','1');}catch(e){}")
    return c


with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path="/usr/bin/google-chrome",
        headless=True,
        args=["--no-sandbox", "--disable-dev-shm-usage"],
    )

    # --- W1: onboarding, three steps -------------------------------------
    c = ctx(browser, "w_takes1", seed_onboarding=False)
    pg = c.new_page()
    pg.goto(BASE + "/app", wait_until="domcontentloaded", timeout=90000)
    pg.wait_for_selector('[role="dialog"][data-state="open"]', timeout=60000)
    pg.wait_for_timeout(2500)
    start_take()
    mark("W1", "step1")
    pg.screenshot(path=os.path.join(WORK, "walk-w1-step1.png"))
    # advance to step 2, but never press Continue - that would create real work
    pg.get_by_role("button", name="Give it a job").first.click(timeout=8000)
    pg.wait_for_timeout(2200)
    mark("W1", "step2")
    pg.screenshot(path=os.path.join(WORK, "walk-w1-step2.png"))
    field = pg.locator("[role=\"dialog\"][data-state=\"open\"] textarea").first
    field.click()
    pg.keyboard.type("Draft a launch plan for my app", delay=20)
    pg.wait_for_timeout(1200)
    mark("W1", "typed")
    pg.screenshot(path=os.path.join(WORK, "walk-w1-typed.png"))
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(900)
    c.close()

    # --- W2: home composer + model picker --------------------------------
    c = ctx(browser, "w_takes2", seed_onboarding=True)
    pg = c.new_page()
    pg.goto(BASE + "/app", wait_until="domcontentloaded", timeout=90000)
    dismiss_dialogs(pg)
    pg.wait_for_timeout(3000)
    start_take()
    mark("W2", "home")
    pg.screenshot(path=os.path.join(WORK, "walk-w2-home.png"))
    composer = pg.locator("textarea, [contenteditable='true']").first
    composer.click()
    pg.keyboard.type("Summarize my workspace files into a short report", delay=18)
    pg.wait_for_timeout(1200)
    mark("W2", "typed")
    pg.screenshot(path=os.path.join(WORK, "walk-w2-typed.png"))
    # model picker
    try:
        pg.get_by_text("Nova Lite", exact=False).first.click(timeout=4000)
        pg.wait_for_timeout(1200)
        mark("W2", "model-menu")
        pg.screenshot(path=os.path.join(WORK, "walk-w2-model.png"))
        pg.keyboard.press("Escape")
    except Exception as exc:  # noqa: BLE001
        print("model menu failed:", exc, flush=True)
    pg.wait_for_timeout(800)
    c.close()

    # --- W3: files explorer ----------------------------------------------
    c = ctx(browser, "w_takes3", seed_onboarding=True)
    pg = c.new_page()
    pg.goto(BASE + "/app/files", wait_until="domcontentloaded", timeout=90000)
    dismiss_dialogs(pg)
    pg.wait_for_timeout(3500)
    start_take()
    mark("W3", "files")
    pg.screenshot(path=os.path.join(WORK, "walk-w3-files.png"))
    try:
        pg.get_by_text("ember-roast", exact=False).first.click(timeout=5000)
        pg.wait_for_timeout(2500)
        mark("W3", "folder")
        pg.screenshot(path=os.path.join(WORK, "walk-w3-folder.png"))
    except Exception as exc:  # noqa: BLE001
        print("folder click failed:", exc, flush=True)
    pg.wait_for_timeout(1500)
    c.close()

    # --- W4: agents -------------------------------------------------------
    c = ctx(browser, "w_takes4", seed_onboarding=True)
    pg = c.new_page()
    pg.goto(BASE + "/app/agents", wait_until="domcontentloaded", timeout=90000)
    dismiss_dialogs(pg)
    pg.wait_for_timeout(3500)
    start_take()
    mark("W4", "agents")
    pg.screenshot(path=os.path.join(WORK, "walk-w4-agents.png"))
    try:
        pg.get_by_role("button", name="New agent").first.click(timeout=5000)
        pg.wait_for_timeout(2200)
        mark("W4", "modal")
        pg.screenshot(path=os.path.join(WORK, "walk-w4-modal.png"))
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(900)
    except Exception as exc:  # noqa: BLE001
        print("agent modal failed:", exc, flush=True)
    c.close()

    # --- W5: skills -------------------------------------------------------
    c = ctx(browser, "w_takes5", seed_onboarding=True)
    pg = c.new_page()
    pg.goto(BASE + "/app/skills", wait_until="domcontentloaded", timeout=90000)
    dismiss_dialogs(pg)
    pg.wait_for_timeout(3500)
    start_take()
    mark("W5", "skills")
    pg.screenshot(path=os.path.join(WORK, "walk-w5-skills.png"))
    try:
        pg.get_by_role("button", name="New skill").first.click(timeout=5000)
        pg.wait_for_timeout(2200)
        mark("W5", "modal")
        pg.screenshot(path=os.path.join(WORK, "walk-w5-modal.png"))
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(900)
    except Exception as exc:  # noqa: BLE001
        print("skill modal failed:", exc, flush=True)
    c.close()

    browser.close()

json.dump(marks, open(os.path.join(WORK, "walk-marks.json"), "w"), indent=2)
print("marks:", marks)
