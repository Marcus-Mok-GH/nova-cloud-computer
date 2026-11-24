"""Second probe: reuse the saved session to explore the authenticated app.

No login needed - loads the storage state captured by probe.py, clears the
first-run modals, then walks every nav route and screenshots it.
"""
import json
import os

from playwright.sync_api import sync_playwright

BASE = "https://nova-cloud-computer.vercel.app"
WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"


def log(*parts):
    print(*parts, flush=True)


def shot(page, name):
    page.screenshot(path=os.path.join(WORK, f"{name}.png"))
    log(f"[shot] {name}")


def dump(page, label, limit=1400):
    try:
        text = page.evaluate("document.body.innerText")
    except Exception as exc:  # noqa: BLE001
        log(f"[text@{label}] unavailable: {exc}")
        return
    log(f"--- text @{label} ({page.url}) ---")
    log(text[:limit])


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

    page.goto(BASE + "/app", wait_until="domcontentloaded")
    page.wait_for_timeout(4000)
    shot(page, "p2-01-app-loaded")
    dump(page, "app-loaded")

    # clear first-run overlays
    for step in range(8):
        clicked = None
        for name in ["Skip for now", "Skip", "Close", "Not now", "Maybe later", "Dismiss"]:
            try:
                loc = page.get_by_role("button", name=name, exact=False)
                if loc.count() > 0 and loc.first.is_visible():
                    loc.first.click()
                    clicked = name
                    break
            except Exception:  # noqa: BLE001
                continue
        log(f"[modal] step {step}: clicked={clicked}")
        if not clicked:
            break
        page.wait_for_timeout(1500)

    page.wait_for_timeout(1500)
    shot(page, "p2-02-overview")
    dump(page, "overview", 2500)

    nav = [
        ("Files", "/app/files"),
        ("Chats", "/app/chats"),
        ("Agents", "/app/agents"),
        ("Skills", "/app/skills"),
        ("Deployments", "/app/deployments"),
        ("Terminal", "/app/terminal"),
        ("Settings", "/app/settings"),
        ("Billing", "/app/billing"),
        ("Status", "/app/status"),
    ]
    for label, path in nav:
        try:
            page.get_by_role("button", name=label, exact=True).first.click()
            page.wait_for_timeout(2500)
            shot(page, "p2-nav-" + label.lower())
            dump(page, "nav-" + label.lower(), 1000)
        except Exception as exc:  # noqa: BLE001
            log(f"[warn] nav {label} failed: {type(exc).__name__}")

    log("[done]", page.url)
    context.close()
    browser.close()
