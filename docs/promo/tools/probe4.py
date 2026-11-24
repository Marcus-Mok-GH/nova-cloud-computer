"""Fourth probe: drive a real agent turn from the Overview composer."""
import os

from playwright.sync_api import sync_playwright

BASE = "https://nova-cloud-computer.vercel.app"
WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"


def log(*parts):
    print(*parts, flush=True)


def shot(page, name):
    page.screenshot(path=os.path.join(WORK, f"{name}.png"))
    log(f"[shot] {name}")


def clear_overlays(page, rounds=4):
    for _ in range(rounds):
        clicked = None
        for name in ["Skip for now", "Skip", "Close", "Not now", "Maybe later"]:
            try:
                loc = page.get_by_role("button", name=name, exact=False)
                if loc.count() > 0 and loc.first.is_visible():
                    loc.first.click()
                    clicked = name
                    break
            except Exception:  # noqa: BLE001
                continue
        if not clicked:
            return False
        page.wait_for_timeout(800)
    return True


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
    page.set_default_timeout(20000)

    page.goto(BASE + "/app", wait_until="domcontentloaded")
    page.wait_for_timeout(3500)
    clear_overlays(page)
    page.wait_for_timeout(1000)

    log("[composer candidates]", page.evaluate(
        """Array.from(document.querySelectorAll('input,textarea,[contenteditable],[role="textbox"]')).map(e => ({
             tag:e.tagName, type:e.type||'', ce:e.getAttribute('contenteditable'),
             ph:e.placeholder||e.getAttribute('data-placeholder')||e.getAttribute('aria-label')||'',
             cls:(e.className||'').toString().slice(0,60) }))"""
    ))
    shot(page, "p4-overview")

    composer = page.locator("textarea").first
    composer.click()
    page.keyboard.type("Create a simple one-page hello website and publish it.", delay=25)
    page.wait_for_timeout(800)
    shot(page, "p4-composer-filled")
    page.keyboard.press("Enter")

    page.wait_for_timeout(5000)
    shot(page, "p4-after-send")
    log("[url after send]", page.url)
    log("[text after send]", (page.evaluate("document.body.innerText") or "")[:1500])

    for tick in range(1, 8):
        page.wait_for_timeout(15000)
        text = page.evaluate("document.body.innerText") or ""
        log(f"[t+{tick*15}s url={page.url}]")
        log(text[-1800:])
        shot(page, f"p4-wait-{tick}")
        if "hello" in text.lower() and ("published" in text.lower() or "deploy" in text.lower()):
            pass

    shot(page, "p4-final")
    log("[done]", page.url)
    context.close()
    browser.close()
