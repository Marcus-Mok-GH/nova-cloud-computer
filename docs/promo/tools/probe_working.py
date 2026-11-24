"""Probe whether the working blob actually renders while the agent works."""
import json
import os
import time

from playwright.sync_api import sync_playwright

BASE = "https://nova-cloud-computer.vercel.app"
WORK = "/home/marcus/.hermes/cache/scratch/nova-demo"

SAMPLE_JS = """
() => {
  const canvases = Array.from(document.querySelectorAll('canvas[data-testid=working-animation]'));
  const info = canvases.map(c => {
    const r = c.getBoundingClientRect();
    let painted = -1;
    try {
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0, tot = 0;
      for (let i = 3; i < d.length; i += 40) { tot++; if (d[i] > 8) n++; }
      painted = tot ? n / tot : 0;
    } catch (e) { painted = -2; }
    return {
      bw: c.width, bh: c.height,
      cw: Math.round(r.width), chh: Math.round(r.height),
      x: Math.round(r.x), y: Math.round(r.y),
      visible: !!(r.width && r.height),
      painted,
      parentCls: (c.parentElement?.className || '').slice(0, 90),
    };
  });
  const text = document.body.innerText;
  return {
    canvases: info,
    workingNow: text.includes("Working now"),
    workingDot: text.includes("Working…"),
    liveCard: !!document.querySelector('[data-testid=live-activity-card]'),
    thinkingRow: !!document.querySelector('[data-testid=thinking-tool-activity]'),
  };
}
"""

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
    if "/sign-in" in page.url:
        print("SESSION EXPIRED -> sign-in required")
        raise SystemExit(2)
    clear()

    row = page.locator('button:has-text("sunrise")').first
    print("row:", row.inner_text()[:80].replace("\n", " | "))
    row.click()
    page.wait_for_timeout(5000)
    print("url:", page.url)
    print("baseline:", json.dumps(page.evaluate(SAMPLE_JS), indent=1))

    composer = page.locator("textarea").first
    composer.fill("Build a tiny one-page site about coffee and publish it.")
    composer.press("Enter")

    samples = []
    shots = 0
    start = time.monotonic()
    while time.monotonic() - start < 75:
        state = page.evaluate(SAMPLE_JS)
        state["t"] = round(time.monotonic() - start, 1)
        samples.append(state)
        if state["canvases"] and shots < 6:
            page.screenshot(path=os.path.join(WORK, f"work-probe-{shots}.png"))
            shots += 1
            print(f"[shot {shots}] t={state['t']} canvases={len(state['canvases'])} "
                  f"workingNow={state['workingNow']} card={state['liveCard']}")
        time.sleep(0.5)

    with open(os.path.join(WORK, "work-probe-samples.json"), "w") as handle:
        json.dump(samples, handle, indent=1)

    canvas_frames = [s for s in samples if s["canvases"]]
    painted_frames = [s for s in canvas_frames
                      if any(c["painted"] > 0.01 and c["visible"] for c in s["canvases"])]
    print(f"frames={len(samples)} canvasFrames={len(canvas_frames)} "
          f"paintedFrames={len(painted_frames)}")
    for s in samples[:1] + canvas_frames[:3]:
        print(json.dumps(s, indent=1)[:900])
    context.close()
    browser.close()
