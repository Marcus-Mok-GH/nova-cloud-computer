"""Complete/shelve the first-run sheets once, then verify they stay away."""
import os

from playwright.sync_api import sync_playwright

BASE = "https://nova-cloud-computer.vercel.app"
WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"


def log(*parts):
    print(*parts, flush=True)


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
    )
    page = context.new_page()
    page.set_default_timeout(15000)

    def open_dialogs():
        return page.evaluate(
            "Array.from(document.querySelectorAll('[role=dialog][data-state=open]')).map(e => e.innerText.slice(0,70))"
        )

    page.goto(BASE + "/app", wait_until="domcontentloaded")
    page.wait_for_timeout(3500)
    log("[start] open:", open_dialogs())

    for step in range(12):
        dialogs = open_dialogs()
        if not dialogs:
            log(f"[done] no open dialogs at step {step}")
            break
        clicked = None
        # complete the profile sheet where possible, otherwise skip it
        for name in ["Save & continue", "Skip for now", "Next", "Close", "Skip"]:
            try:
                loc = page.get_by_role("button", name=name, exact=False)
                if loc.count() > 0 and loc.first.is_visible():
                    loc.first.click()
                    clicked = name
                    break
            except Exception:  # noqa: BLE001
                continue
        log(f"[step {step}] dialogs={dialogs} clicked={clicked}")
        page.wait_for_timeout(1500)

    log("[after] open:", open_dialogs())

    for path in ["/app/files", "/app/chats", "/app/settings"]:
        page.goto(BASE + path, wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
        log(f"[check {path}] open:", open_dialogs())

    context.close()
    browser.close()
