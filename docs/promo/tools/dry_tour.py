"""Dry-run the post-login tour against the saved session (no recording)."""
import os
import re

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

    def clear():
        for _ in range(3):
            hit = None
            for name in ["Skip for now", "Skip", "Close", "Not now"]:
                try:
                    loc = page.get_by_role("button", name=name, exact=False)
                    if loc.count() and loc.first.is_visible():
                        loc.first.click()
                        hit = name
                        break
                except Exception:  # noqa: BLE001
                    pass
            if not hit:
                return
            page.wait_for_timeout(800)

    page.goto(BASE + "/app", wait_until="domcontentloaded")
    page.wait_for_timeout(3500)
    clear()

    for label in ["Files", "Deployments", "Terminal", "Settings", "Agents", "Skills", "Status"]:
        clear()
        try:
            page.get_by_role("button", name=label, exact=True).first.click()
            page.wait_for_timeout(2600)
            clear()
            log(f"[ok] {label} -> {page.url}")
        except Exception as exc:  # noqa: BLE001
            log(f"[FAIL] {label}: {type(exc).__name__}")

    # environment tab
    try:
        page.get_by_role("button", name="Settings", exact=True).first.click()
        page.wait_for_timeout(2000)
        tab = page.get_by_role("tab", name="Environment", exact=True)
        log("[env tab count]", tab.count())
        tab.first.click()
        page.wait_for_timeout(1800)
        log("[ok] environment tab")
    except Exception as exc:  # noqa: BLE001
        log("[FAIL] environment:", type(exc).__name__)

    # deployments: open-website control + url
    page.get_by_role("button", name="Deployments", exact=True).first.click()
    page.wait_for_timeout(2600)
    text = page.evaluate("document.body.innerText") or ""
    m = re.search(r"https://[\w.-]+\.netlify\.app", text)
    log("[netlify url]", m.group(0) if m else None)
    log("[open website role]", page.evaluate(
        "Array.from(document.querySelectorAll('a,button')).filter(e => e.innerText.trim() === 'Open website').map(e => e.tagName)"
    ))
    if m:
        page.goto(m.group(0), wait_until="domcontentloaded")
        page.wait_for_timeout(4000)
        log("[live page title]", page.title())
        page.screenshot(path=os.path.join(WORK, "dry-live-site.png"))

    log("[done]")
    context.close()
    browser.close()
