"""Third probe: navigate with overlay dismissal, and test a live chat turn."""
import os

from playwright.sync_api import sync_playwright

BASE = "https://nova-cloud-computer.vercel.app"
WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"


def log(*parts):
    print(*parts, flush=True)


def shot(page, name):
    page.screenshot(path=os.path.join(WORK, f"{name}.png"))
    log(f"[shot] {name}")


def dump(page, label, limit=1200):
    try:
        text = page.evaluate("document.body.innerText")
    except Exception as exc:  # noqa: BLE001
        log(f"[text@{label}] unavailable: {exc}")
        return
    log(f"--- text @{label} ({page.url}) ---")
    log(text[:limit])


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
        page.wait_for_timeout(900)
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
    page.set_default_timeout(15000)

    page.goto(BASE + "/app", wait_until="domcontentloaded")
    page.wait_for_timeout(3500)
    clear_overlays(page)
    page.wait_for_timeout(1200)
    shot(page, "p3-01-overview")

    for label, path in [
        ("Files", "/app/files"),
        ("Chats", "/app/chats"),
        ("Agents", "/app/agents"),
        ("Skills", "/app/skills"),
        ("Deployments", "/app/deployments"),
        ("Terminal", "/app/terminal"),
        ("Settings", "/app/settings"),
        ("Billing", "/app/billing"),
        ("Status", "/app/status"),
    ]:
        clear_overlays(page)
        try:
            page.get_by_role("button", name=label, exact=True).first.click()
            page.wait_for_timeout(2500)
            clear_overlays(page)
            page.wait_for_timeout(600)
            shot(page, "p3-" + label.lower())
            dump(page, label.lower(), 900)
        except Exception as exc:  # noqa: BLE001
            log(f"[warn] nav {label}: {type(exc).__name__}")

    # --- live chat turn ---
    clear_overlays(page)
    page.get_by_role("button", name="Chats", exact=True).first.click()
    page.wait_for_timeout(2500)
    clear_overlays(page)
    log("[chat] fields:", page.evaluate(
        "Array.from(document.querySelectorAll('input,textarea,[contenteditable=\"true\"]')).map(e => ({tag:e.tagName,type:e.type||'',placeholder:e.placeholder||e.getAttribute('data-placeholder')||'',aria:e.getAttribute('aria-label')||''}))"
    ))
    shot(page, "p3-chat-before")
    try:
        composer = page.locator("textarea").first
        composer.click()
        composer.fill("Reply with exactly: Nova is online.")
        page.wait_for_timeout(400)
        page.keyboard.press("Enter")
        log("[chat] message sent, waiting for a reply ...")
        page.wait_for_timeout(75000)
        shot(page, "p3-chat-after")
        dump(page, "chat-after", 2500)
    except Exception as exc:  # noqa: BLE001
        log(f"[warn] chat send failed: {type(exc).__name__}: {exc}")

    log("[done]", page.url)
    context.close()
    browser.close()
