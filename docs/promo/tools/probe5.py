"""Fifth probe: approve the pending plan and see whether the site really deploys."""
import os

from playwright.sync_api import sync_playwright

BASE = "https://nova-cloud-computer.vercel.app"
WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"


def log(*parts):
    print(*parts, flush=True)


def shot(page, name):
    page.screenshot(path=os.path.join(WORK, f"{name}.png"))
    log(f"[shot] {name}")


def clear_overlays(page, rounds=3):
    for _ in range(rounds):
        clicked = None
        for name in ["Skip for now", "Skip", "Close", "Not now"]:
            try:
                loc = page.get_by_role("button", name=name, exact=False)
                if loc.count() > 0 and loc.first.is_visible():
                    loc.first.click()
                    clicked = name
                    break
            except Exception:  # noqa: BLE001
                continue
        if not clicked:
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

    page.goto(BASE + "/app?chatId=2tz90ppyue", wait_until="domcontentloaded")
    page.wait_for_timeout(4000)
    clear_overlays(page)
    shot(page, "p5-thread-start")

    composer = page.locator("textarea").first
    composer.click()
    page.keyboard.type("Approve the plan. Build and publish it.", delay=20)
    page.wait_for_timeout(400)
    page.keyboard.press("Enter")
    log("[approve] sent at", page.url)

    last = ""
    for tick in range(1, 17):
        page.wait_for_timeout(20000)
        text = page.evaluate("document.body.innerText") or ""
        tail = text[-1200:]
        log(f"[t+{tick*20}s url={page.url}]")
        log(tail)
        shot(page, f"p5-{tick}")
        if tail != last and ("deployed" in tail.lower() or "http" in tail.lower()):
            log("[signal] deployment-ish text appeared")
        last = tail

    for label in ["Files", "Deployments"]:
        clear_overlays(page)
        try:
            page.get_by_role("button", name=label, exact=True).first.click()
            page.wait_for_timeout(3000)
            clear_overlays(page)
            shot(page, "p5-" + label.lower())
            log(f"[text @{label}]", (page.evaluate("document.body.innerText") or "")[:1500])
        except Exception as exc:  # noqa: BLE001
            log(f"[warn] {label}: {type(exc).__name__}")

    log("[done]")
    context.close()
    browser.close()
