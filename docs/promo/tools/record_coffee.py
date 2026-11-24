"""Record the new demo segment: coffee-brand site build + table in an answer.

Session replay only - no sign-in. Saves takes/*.webm, seg2-marks.json,
seg2-blobs.json (running-indicator frames + boxes) and screenshots.
"""
import json
import os
import re
import time

from playwright.sync_api import sync_playwright

BASE = "https://nova-cloud-computer.vercel.app"
WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"
VIDEO_DIR = os.path.join(WORK, "takes2")
os.makedirs(VIDEO_DIR, exist_ok=True)
START = time.monotonic()
MARKS = {}


def log(*parts):
    print(*parts, flush=True)


def mark(name):
    stamp = round(time.monotonic() - START, 2)
    MARKS[name] = stamp
    log(f"MARK {name} {stamp}")
    try:
        with open(os.path.join(WORK, "seg2-marks.json"), "w") as handle:
            json.dump(MARKS, handle, indent=2)
    except Exception:  # noqa: BLE001
        pass


def shot(page, name):
    try:
        page.screenshot(path=os.path.join(WORK, f"seg2-{name}.png"))
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


BLOBS = []


def snapshot_running_indicator(page):
    """Capture a frame + box for the most prominent running indicator."""
    try:
        info = page.evaluate(
            """() => {
              const pick = (sel) => {
                const el = document.querySelector(sel);
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { x: Math.round(r.x), y: Math.round(r.y),
                         w: Math.round(r.width), h: Math.round(r.height) };
              };
              const text = document.body.innerText;
              return {
                t: null,
                workingNow: text.includes('Working now'),
                preparing: text.includes('Preparing Next Turn'),
                group: pick('[data-testid=tool-run-group] > button'),
                card: pick('[data-testid=live-activity-card]'),
              };
            }"""
        )
    except Exception:  # noqa: BLE001
        return
    if info["group"] or info["card"]:
        BLOBS.append({
            "t": round(time.monotonic() - START, 2),
            "workingNow": info["workingNow"],
            "preparing": info["preparing"],
            "group": info["group"],
            "card": info["card"],
        })
        try:
            with open(os.path.join(WORK, "seg2-blobs.json"), "w") as handle:
                json.dump(BLOBS, handle, indent=2)
        except Exception:  # noqa: BLE001
            pass


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
    mark("start")

    page.goto(BASE + "/app", wait_until="domcontentloaded")
    page.wait_for_timeout(4000)
    clear(page)
    page.wait_for_timeout(1500)
    mark("overview")
    shot(page, "overview")

    PROMPT = (
        "Build a one-page website for a specialty coffee brand called Ember Roast: "
        "hero section, menu, about, and a footer. Publish it."
    )
    composer = page.locator("textarea").first
    composer.click()
    page.keyboard.type(PROMPT, delay=10)
    page.wait_for_timeout(700)
    page.keyboard.press("Enter")
    page.wait_for_timeout(4000)
    mark("task-sent")
    shot(page, "task-sent")

    plan_ready = wait_for(
        page, lambda pg: "approve, adjust, or cancel" in body_text(pg).lower(), 300
    )
    log("[plan] ready:", plan_ready)
    page.wait_for_timeout(1500)
    mark("plan-ready")
    shot(page, "plan")

    def approval_state(pg):
        low = body_text(pg).lower()
        busy = ("working now" in low) or ("preparing next turn" in low)
        return ("approve, adjust, or cancel" in low) and ("finished" in low) and not busy

    ready = wait_for(page, approval_state, 360, interval=6)
    log("[approve] idle:", ready)
    known_urls = set(re.findall(r"https://[\w.-]+\.netlify\.app", body_text(page)))

    clear(page)
    composer = page.locator("textarea").first
    composer.click()
    page.keyboard.type("Approve the plan. Build and publish it.", delay=10)
    page.wait_for_timeout(500)
    page.keyboard.press("Enter")
    page.wait_for_timeout(2500)
    leftover = page.locator("textarea").first.input_value()
    if leftover.strip():
        log("[approve] message stuck, retrying send")
        page.keyboard.press("Enter")
        page.wait_for_timeout(2500)
    mark("approved")
    shot(page, "approved")

    # ---- work phase: keep an eye on the running indicator -----------------
    def fresh_url(pg):
        urls = set(re.findall(r"https://[\w.-]+\.netlify\.app", body_text(pg)))
        diff = urls - known_urls
        return diff.pop() if diff else None

    saw_group = False
    deadline = time.time() + 1080
    while time.time() < deadline:
        snapshot_running_indicator(page)
        if not saw_group and any(b["group"] for b in BLOBS):
            saw_group = True
            mark("work-group")
            shot(page, "work-group")
        url = fresh_url(page)
        if url:
            break
        page.wait_for_timeout(1200)

    final_url = fresh_url(page)
    log("[build] url:", final_url, "group seen:", saw_group)
    page.wait_for_timeout(3000)
    mark("build-done")
    shot(page, "build-done")

    # ---- table request ----------------------------------------------------
    clear(page)
    composer = page.locator("textarea").first
    composer.click()
    page.keyboard.type(
        "Thanks! Now reply with a markdown table comparing three coffee drinks "
        "(espresso, latte, cold brew) by caffeine and price.",
        delay=10,
    )
    page.wait_for_timeout(500)
    page.keyboard.press("Enter")
    page.wait_for_timeout(3000)
    mark("table-asked")
    got_table = wait_for(
        page, lambda pg: pg.locator("table").count() > 0, 300, interval=3
    )
    log("[table] rendered:", got_table)
    page.wait_for_timeout(2500)
    mark("table-visible")
    shot(page, "table")
    try:
        box = page.evaluate(
            """() => { const el = document.querySelector('table');
                 if (!el) return null; const r = el.getBoundingClientRect();
                 return { x: Math.round(r.x), y: Math.round(r.y),
                          w: Math.round(r.width), h: Math.round(r.height) }; }"""
        )
        with open(os.path.join(WORK, "seg2-table-box.json"), "w") as handle:
            json.dump(box, handle)
        log("[table] box:", box)
    except Exception:  # noqa: BLE001
        pass

    # ---- live site --------------------------------------------------------
    clear(page)
    try:
        page.get_by_role("button", name="Deployments", exact=True).first.click()
        page.wait_for_timeout(3000)
        mark("deployments")
        shot(page, "deployments")
        if final_url:
            page.goto(final_url, wait_until="domcontentloaded")
            page.wait_for_timeout(5000)
            mark("live-site")
            shot(page, "live-site")
    except Exception as exc:  # noqa: BLE001
        log("[warn] live site:", type(exc).__name__)

    log("[done] url:", final_url)
    context.close()
    browser.close()

log("[marks]", json.dumps(MARKS))
