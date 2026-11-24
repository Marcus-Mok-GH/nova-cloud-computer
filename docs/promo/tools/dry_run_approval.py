"""Dry-run the chat -> plan -> approve -> deploy flow to learn reliable signals."""
import os
import re
import time

from playwright.sync_api import sync_playwright

BASE = "https://nova-cloud-computer.vercel.app"
WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"


def log(*parts):
    print(*parts, flush=True)


def clear(page, rounds=3):
    for _ in range(rounds):
        hit = None
        for name in ["Skip for now", "Close", "Not now"]:
            try:
                loc = page.get_by_role("button", name=name, exact=False)
                if loc.count() > 0 and loc.first.is_visible():
                    loc.first.click()
                    hit = name
                    break
            except Exception:  # noqa: BLE001
                pass
        if not hit:
            return
        page.wait_for_timeout(700)


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
    clear(page)

    composer = page.locator("textarea").first
    composer.click()
    page.keyboard.type("Create a simple one-page goodbye website and publish it.", delay=15)
    page.wait_for_timeout(500)
    page.keyboard.press("Enter")
    log("[sent] task at", time.strftime("%H:%M:%S"))

    def snapshot(tag):
        text = page.evaluate("document.body.innerText") or ""
        low = text.lower()
        return {
            "tag": tag,
            "plan": "approve, adjust, or cancel" in low,
            "finished": "finished" in low,
            "working": "working now" in low or "working..." in low,
            "toast_blocked": "wasn't been sent" in low or "wasn't sent" in low or "still working" in low,
            "live_site": "live site:" in low,
            "tools": re.search(r"Tool runs\s*\n?\s*(\d+)", text).group(1) if re.search(r"Tool runs\s*\n?\s*(\d+)", text) else "?",
            "url": page.url,
        }

    approved = False
    deadline = time.time() + 900
    last = None
    while time.time() < deadline:
        page.wait_for_timeout(12000)
        state = snapshot("poll")
        if state != last:
            log(state)
            last = state
        if approved and state["live_site"]:
            log("[done] live site reported")
            break
        if not approved and state["plan"] and state["finished"] and not state["working"]:
            log("[approve] conditions met - sending approval")
            try:
                composer = page.locator("textarea").first
                composer.click()
                page.wait_for_timeout(400)
                page.keyboard.type("Approve the plan. Build and publish it.", delay=15)
                page.wait_for_timeout(400)
                page.keyboard.press("Enter")
                page.wait_for_timeout(2500)
                value = page.locator("textarea").first.input_value()
                log("[approve] composer now:", repr(value))
                approved = True
            except Exception as exc:  # noqa: BLE001
                log("[warn] approve failed:", type(exc).__name__, exc)

    text = page.evaluate("document.body.innerText") or ""
    log("[final tail]")
    log(text[-2500:])
    page.screenshot(path=os.path.join(WORK, "dry-approval-final.png"))
    context.close()
    browser.close()
