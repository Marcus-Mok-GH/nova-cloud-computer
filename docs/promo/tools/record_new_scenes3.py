"""Record fresh scenes for the full-feature demo (with onboarding dismissed)."""
import json
import os
import time

from playwright.sync_api import sync_playwright

BASE = "https://nova-cloud-computer.vercel.app"
WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
TAKES = ["takesA", "takesB", "takesC", "takesD"]
for d in TAKES:
    os.makedirs(os.path.join(WORK, d), exist_ok=True)

marks = {}
started = 0.0


def start_take():
    global started
    started = time.time()


def mark(take, name):
    marks.setdefault(take, {})[name] = round(time.time() - started, 2)
    print(f"MARK {take}:{name} {marks[take][name]}", flush=True)


def dismiss_dialogs(pg):
    """Close any onboarding/dialog sheets; one click can leave a second."""
    for _ in range(6):
        open_dialogs = pg.locator('[role="dialog"][data-state="open"]')
        if open_dialogs.count() == 0:
            return
        close = open_dialogs.first.locator('button[aria-label="Close onboarding"]')
        if close.count():
            try:
                close.first.click(timeout=4000)
            except Exception:  # noqa: BLE001
                pg.keyboard.press("Escape")
        else:
            pg.keyboard.press("Escape")
        pg.wait_for_timeout(700)


def new_ctx(browser, name):
    ctx = browser.new_context(
        viewport={"width": 1280, "height": 720},
        locale="en-US",
        storage_state=os.path.join(WORK, "session.json"),
        record_video_dir=os.path.join(WORK, name),
        record_video_size={"width": 1280, "height": 720},
    )
    # Keep the first-run onboarding sheet out of the shot before app code runs.
    ctx.add_init_script("try { localStorage.setItem('nova.onboardingFlow.v1', '1'); } catch (e) {}")
    return ctx


with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path="/usr/bin/google-chrome",
        headless=True,
        args=["--no-sandbox", "--disable-dev-shm-usage"],
    )

    # --- A: Chats page with the Buy Me a Coffee card -----------------------
    ctx = new_ctx(browser, "takesA")
    start_take()
    pg = ctx.new_page()
    pg.goto(BASE + "/app/chats", wait_until="domcontentloaded", timeout=90000)
    dismiss_dialogs(pg)
    pg.wait_for_selector('[data-testid="support-card"]', timeout=60000)
    pg.wait_for_timeout(2200)
    mark("takesA", "a-card")
    pg.screenshot(path=os.path.join(WORK, "new-a-card.png"))
    pg.wait_for_timeout(2500)
    ctx.close()

    # --- B: profile entry -> profile page ---------------------------------
    ctx = new_ctx(browser, "takesB")
    start_take()
    pg = ctx.new_page()
    pg.goto(BASE + "/app/chats", wait_until="domcontentloaded", timeout=90000)
    dismiss_dialogs(pg)
    pg.wait_for_timeout(2500)
    mark("takesB", "b-before-click")
    pg.screenshot(path=os.path.join(WORK, "new-b-before.png"))
    pg.locator("aside").last.locator('[aria-label="Profile"]').click()
    pg.wait_for_url("**/app/profile", timeout=60000)
    pg.wait_for_timeout(2500)
    mark("takesB", "b-profile")
    pg.screenshot(path=os.path.join(WORK, "new-b-profile.png"))
    pg.wait_for_timeout(2000)
    ctx.close()

    # --- C: Billing page with the support card ----------------------------
    ctx = new_ctx(browser, "takesC")
    start_take()
    pg = ctx.new_page()
    pg.goto(BASE + "/app/billing", wait_until="domcontentloaded", timeout=90000)
    dismiss_dialogs(pg)
    pg.wait_for_selector('[data-testid="support-card"]', timeout=60000)
    pg.wait_for_timeout(2200)
    mark("takesC", "c-card")
    pg.screenshot(path=os.path.join(WORK, "new-c-card.png"))
    pg.wait_for_timeout(2200)
    ctx.close()

    # --- D: Settings > Environment ----------------------------------------
    ctx = new_ctx(browser, "takesD")
    start_take()
    pg = ctx.new_page()
    pg.goto(BASE + "/app/settings", wait_until="domcontentloaded", timeout=90000)
    dismiss_dialogs(pg)
    pg.wait_for_timeout(3000)
    mark("takesD", "d-settings")
    pg.screenshot(path=os.path.join(WORK, "new-d-settings.png"))
    try:
        tab = pg.get_by_role("tab", name="Environment")
        if tab.count():
            tab.first.click()
        else:
            pg.get_by_text("Environment", exact=True).first.click()
        pg.wait_for_timeout(2500)
        dismiss_dialogs(pg)
        mark("takesD", "d-environment")
        pg.screenshot(path=os.path.join(WORK, "new-d-environment.png"))
        print("environment tab ok", flush=True)
    except Exception as exc:  # noqa: BLE001
        print("environment tab failed:", exc, flush=True)
    pg.wait_for_timeout(2000)
    ctx.close()

    browser.close()

json.dump(marks, open(os.path.join(WORK, "new-marks.json"), "w"), indent=2)
print("marks:", marks)
