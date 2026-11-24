"""Record the post-login half of the demo using the saved session (no sign-in).

Overview -> ask Nova to build a site -> approve when idle -> timelapse-worthy
build -> live URL -> deployments card -> tour -> live site -> outro.
"""
import json
import os
import re
import time

from playwright.sync_api import sync_playwright

BASE = "https://nova-cloud-computer.vercel.app"
WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
VIDEO_DIR = os.path.join(WORK, "takes")
os.makedirs(VIDEO_DIR, exist_ok=True)
START = time.monotonic()
MARKS = {}


def mark(name):
    stamp = round(time.monotonic() - START, 2)
    MARKS[name] = stamp
    log(f"MARK {name} {stamp}")
    try:
        with open(os.path.join(WORK, "seg-marks.json"), "w") as handle:
            json.dump(MARKS, handle, indent=2)
    except Exception:  # noqa: BLE001
        pass


def log(*parts):
    print(*parts, flush=True)


def shot(page, name):
    try:
        page.screenshot(path=os.path.join(WORK, f"seg-{name}.png"))
    except Exception:  # noqa: BLE001
        pass


def body_text(page):
    try:
        return page.evaluate("document.body.innerText") or ""
    except Exception:  # noqa: BLE001
        return ""


def wait_for(page, predicate, timeout_s, interval=2.0):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            if predicate(page):
                return True
        except Exception:  # noqa: BLE001
            pass
        page.wait_for_timeout(int(interval * 1000))
    return False


def clear(page, rounds=8):
    for _ in range(rounds):
        try:
            if page.locator('[role="dialog"][data-state="open"]').count() == 0:
                return True
        except Exception:  # noqa: BLE001
            return False
        hit = None
        for name in ["Save & continue", "Skip for now", "Skip", "Close", "Not now"]:
            try:
                loc = page.get_by_role("button", name=name, exact=False)
                if loc.count() > 0 and loc.first.is_visible():
                    loc.first.click()
                    hit = name
                    break
            except Exception:  # noqa: BLE001
                continue
        if not hit:
            try:
                page.keyboard.press("Escape")
            except Exception:  # noqa: BLE001
                pass
        page.wait_for_timeout(900)
    return False


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
        record_video_dir=VIDEO_DIR,
        record_video_size={"width": 1280, "height": 720},
    )
    page = context.new_page()
    page.set_default_timeout(20000)
    mark("seg-start")

    page.goto(BASE + "/app", wait_until="domcontentloaded")
    page.wait_for_timeout(4000)
    clear(page)
    page.wait_for_timeout(1500)
    mark("seg-overview")
    shot(page, "overview")

    # ---- ask the agent ----------------------------------------------------
    try:
        composer = page.locator("textarea").first
        composer.click()
        page.keyboard.type("Create a simple one-page sunrise website and publish it.", delay=18)
        page.wait_for_timeout(700)
        page.keyboard.press("Enter")
        page.wait_for_timeout(4000)
        mark("seg-task-sent")
        shot(page, "task-sent")
    except Exception as exc:  # noqa: BLE001
        log("[warn] task send:", type(exc).__name__, exc)

    plan_ready = wait_for(
        page,
        lambda pg: "approve, adjust, or cancel" in body_text(pg).lower(),
        300,
    )
    log("[plan] ready:", plan_ready)
    page.wait_for_timeout(1500)
    mark("seg-plan-ready")
    shot(page, "plan")

    def approval_state(pg):
        low = body_text(pg).lower()
        busy = ("working now" in low) or ("preparing next turn" in low)
        return ("approve, adjust, or cancel" in low) and ("finished" in low) and not busy

    ready = wait_for(page, approval_state, 360, interval=6)
    log("[approve] idle:", ready)
    known_urls = set(re.findall(r"https://[\w.-]+\.netlify\.app", body_text(page)))

    try:
        clear(page)
        composer = page.locator("textarea").first
        composer.click()
        page.keyboard.type("Approve the plan. Build and publish it.", delay=18)
        page.wait_for_timeout(500)
        page.keyboard.press("Enter")
        page.wait_for_timeout(2500)
        leftover = page.locator("textarea").first.input_value()
        if leftover.strip():
            log("[approve] message stuck, retrying send")
            page.keyboard.press("Enter")
            page.wait_for_timeout(2500)
        mark("seg-approved")
        shot(page, "approved")
    except Exception as exc:  # noqa: BLE001
        log("[warn] approve:", type(exc).__name__, exc)

    def fresh_url(pg):
        urls = set(re.findall(r"https://[\w.-]+\.netlify\.app", body_text(pg)))
        diff = urls - known_urls
        return diff.pop() if diff else None

    done = wait_for(page, lambda pg: fresh_url(pg) is not None, 1080, interval=15)
    final_url = fresh_url(page)
    log("[build] finished:", done, "url:", final_url)
    page.wait_for_timeout(3000)
    mark("seg-build-done")
    shot(page, "build-done")

    # ---- tour -------------------------------------------------------------
    for label in ["Files", "Deployments", "Terminal", "Settings", "Agents", "Skills", "Status"]:
        clear(page)
        try:
            page.get_by_role("button", name=label, exact=True).first.click()
            page.wait_for_timeout(3000)
            clear(page)
            page.wait_for_timeout(600)
            mark("seg-tour-" + label.lower())
            shot(page, "tour-" + label.lower())
        except Exception as exc:  # noqa: BLE001
            log(f"[warn] {label}: {type(exc).__name__}")

    try:
        clear(page)
        page.get_by_role("button", name="Settings", exact=True).first.click()
        page.wait_for_timeout(2200)
        env_tab = page.get_by_role("tab", name="Environment", exact=True)
        if env_tab.count() > 0:
            env_tab.first.click()
            page.wait_for_timeout(1800)
            mark("seg-environment")
            shot(page, "environment")
    except Exception as exc:  # noqa: BLE001
        log("[warn] environment tab:", type(exc).__name__)

    # ---- live site --------------------------------------------------------
    url_match = final_url
    try:
        clear(page)
        page.get_by_role("button", name="Deployments", exact=True).first.click()
        page.wait_for_timeout(3000)
        text = body_text(page)
        if not url_match:
            match = re.search(r"https://[\w.-]+\.netlify\.app", text)
            url_match = match.group(0) if match else None
        mark("seg-deployments")
        shot(page, "deployments")
        if url_match:
            log("[live] opening", url_match)
            page.goto(url_match, wait_until="domcontentloaded")
            page.wait_for_timeout(5000)
            mark("seg-live-site")
            shot(page, "live-site")
    except Exception as exc:  # noqa: BLE001
        log("[warn] live site:", type(exc).__name__)

    # ---- outro ------------------------------------------------------------
    try:
        page.goto(BASE, wait_until="domcontentloaded")
        page.wait_for_timeout(2800)
        mark("seg-outro")
        shot(page, "outro")
    except Exception as exc:  # noqa: BLE001
        log("[warn] outro:", type(exc).__name__)

    log("[done] url:", url_match)
    context.close()
    browser.close()

log("[marks]", json.dumps(MARKS))
