"""Capture element-level screenshots of each working-blob canvas mid-run."""
import os
import time

from playwright.sync_api import sync_playwright

BASE = "https://nova-cloud-computer.vercel.app"
WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"

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

    page.goto(BASE + "/app/chats", wait_until="domcontentloaded")
    page.wait_for_timeout(5000)
    clear()
    page.locator('button:has-text("sunrise")').first.click()
    page.wait_for_timeout(5000)

    composer = page.locator("textarea").first
    composer.fill("Write a short blog post about morning coffee and publish it.")
    composer.press("Enter")

    start = time.monotonic()
    done_card = done_thinking = done_typing = False
    while time.monotonic() - start < 90:
        canvases = page.locator('canvas[data-testid="working-animation"]')
        count = canvases.count()
        if count:
            t = round(time.monotonic() - start, 1)
            for i in range(count):
                el = canvases.nth(i)
                tid = el.evaluate(
                    "e => { let n=e.parentElement; for(let i=0;i<6&&n;i++){ "
                    "if(n.getAttribute && n.getAttribute('data-testid')) "
                    "return n.getAttribute('data-testid'); n=n.parentElement;} return 'none'; }"
                )
                tag = tid.replace("-tool-activity-line", "").replace("live-activity-card", "card")
                if tag == "card" and not done_card:
                    el.screenshot(path=os.path.join(WORK, f"blob-{t}-card.png"))
                    print("saved card blob", t)
                    done_card = True
                elif tag.startswith("thinking") and not done_thinking:
                    el.screenshot(path=os.path.join(WORK, f"blob-{t}-thinking.png"))
                    print("saved thinking blob", t)
                    done_thinking = True
                elif tag == "none" and not done_typing:
                    el.screenshot(path=os.path.join(WORK, f"blob-{t}-typing.png"))
                    print("saved typing blob", t, el.evaluate("e=>{const r=e.getBoundingClientRect();return [r.x,r.y]}"))
                    done_typing = True
        try:
            btn = page.get_by_role("button", name="Approve", exact=False)
            if btn.count() > 0 and btn.first.is_enabled() and btn.first.is_visible():
                btn.first.click()
                print("approved")
        except Exception:  # noqa: BLE001
            pass
        if done_card and done_thinking and done_typing:
            break
        time.sleep(0.3)
    context.close()
    browser.close()
