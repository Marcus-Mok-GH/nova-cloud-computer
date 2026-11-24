"""Rehearsal/probe pass over the live Nova site.

Records nothing; screenshots every surface and pauses for a human-supplied
one-time code so we can learn the real selectors and routes before filming.
"""
import json
import os
import time

from playwright.sync_api import sync_playwright

BASE = "https://nova-cloud-computer.vercel.app"
WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
OTP_FILE = os.path.join(WORK, "otp.txt")
EMAIL = "mokmarcus068@gmail.com"

os.makedirs(WORK, exist_ok=True)


def log(*parts):
    print(*parts, flush=True)


def shot(page, name):
    page.screenshot(path=os.path.join(WORK, f"{name}.png"))
    log(f"[shot] {name}")


def dump(page, label, limit=1800):
    try:
        text = page.evaluate("document.body.innerText")
    except Exception as exc:  # noqa: BLE001
        log(f"[text@{label}] unavailable: {exc}")
        return
    log(f"--- text @{label} ({page.url}) ---")
    log(text[:limit])


def wait_otp(timeout_s=420):
    log("[otp] waiting for otp.txt ...")
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if os.path.exists(OTP_FILE):
            with open(OTP_FILE) as handle:
                code = handle.read().strip()
            if code:
                os.remove(OTP_FILE)
                log(f"[otp] got code ({len(code)} chars)")
                return code
        time.sleep(3)
    raise TimeoutError("no OTP arrived")


with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path="/usr/bin/google-chrome",
        headless=True,
        args=["--no-sandbox", "--disable-dev-shm-usage"],
    )
    context = browser.new_context(viewport={"width": 1280, "height": 720}, locale="en-US")
    page = context.new_page()
    page.set_default_timeout(20000)

    page.goto(BASE, wait_until="domcontentloaded")
    page.get_by_role("link", name="Sign in").first.wait_for(timeout=45000)
    page.wait_for_timeout(2500)
    shot(page, "01-landing")
    dump(page, "landing")

    # into sign-in
    page.get_by_role("link", name="Sign in").first.click()
    page.wait_for_timeout(1500)
    shot(page, "02-signin")
    dump(page, "signin", 900)
    log("[inputs]", page.evaluate(
        "Array.from(document.querySelectorAll('input')).map(i => ({type:i.type,name:i.name,inputmode:i.inputMode,placeholder:i.placeholder}))"
    ))

    page.locator('input[type="email"]').fill(EMAIL)
    page.get_by_role("button", name="Create my account").click()
    page.wait_for_timeout(2500)
    shot(page, "03-code-sent")
    dump(page, "code-sent", 900)

    code = wait_otp()
    otp = page.locator('[data-slot="input-otp"]')
    otp.click()
    page.wait_for_timeout(300)
    page.keyboard.type(code, delay=140)
    page.wait_for_timeout(400)
    shot(page, "04-code-entered")
    page.get_by_role("button", name="Sign in").click()

    try:
        page.wait_for_url("**/app**", timeout=45000)
    except Exception as exc:  # noqa: BLE001
        log("[warn] did not reach /app:", exc)
    page.wait_for_timeout(4000)
    shot(page, "05-after-login")
    dump(page, "after-login", 2500)

    with open(os.path.join(WORK, "session.json"), "w") as handle:
        json.dump(context.storage_state(), handle)

    nav = [
        ("Overview", "/app"),
        ("Files", "/app/files"),
        ("Chats", "/app/chats"),
        ("Agents", "/app/agents"),
        ("Skills", "/app/skills"),
        ("Deployments", "/app/deployments"),
        ("Terminal", "/app/terminal"),
        ("Settings", "/app/settings"),
        ("Billing", "/app/billing"),
    ]
    for label, path in nav:
        try:
            page.get_by_role("button", name=label, exact=True).first.click()
            page.wait_for_timeout(3000)
            shot(page, "nav-" + label.lower())
            dump(page, "nav-" + label.lower(), 1200)
        except Exception as exc:  # noqa: BLE001
            log(f"[warn] nav {label} failed: {exc}")

    log("[done] final url:", page.url)
    context.close()
    browser.close()
