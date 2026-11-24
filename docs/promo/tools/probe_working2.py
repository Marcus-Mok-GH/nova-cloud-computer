"""Second probe: catch the working blob mid-run with DOM evidence and crops."""
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
      for (let i = 3; i < d.length; i += 4) { tot++; if (d[i] > 8) n++; }
      painted = tot ? +(n / tot).toFixed(3) : 0;
    } catch (e) { painted = -2; }
    // walk up to find a data-testid ancestor
    let tid = null, node = c.parentElement;
    for (let i = 0; i < 6 && node; i++) {
      if (node.getAttribute && node.getAttribute('data-testid')) { tid = node.getAttribute('data-testid'); break; }
      node = node.parentElement;
    }
    return { bw: c.width, bh: c.height, cw: Math.round(r.width), chh: Math.round(r.height),
             x: Math.round(r.x), y: Math.round(r.y), painted, tid,
             parentCls: (c.parentElement?.className || '').slice(0, 80) };
  });
  const text = document.body.innerText;
  return {
    canvases: info,
    workingNow: text.includes("Working now"),
    workingDot: text.includes("Working…"),
    card: !!document.querySelector('[data-testid=live-activity-card]'),
    thinking: !!document.querySelector('[data-testid=thinking-tool-activity]'),
    toolGroups: document.querySelectorAll('[data-testid=tool-run-group]').length,
    textSample: (document.body.innerText.match(/Working now[^\\n]{0,40}/) || [''])[0],
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
    clear()
    page.locator('button:has-text("sunrise")').first.click()
    page.wait_for_timeout(5000)
    print("url:", page.url)

    composer = page.locator("textarea").first
    composer.fill("Build a two-page portfolio site for a photographer and publish it.")
    composer.press("Enter")

    samples = []
    start = time.monotonic()
    saved = {"card": False, "now": False, "multi": False}
    while time.monotonic() - start < 90:
        state = page.evaluate(SAMPLE_JS)
        state["t"] = round(time.monotonic() - start, 1)
        samples.append(state)
        # auto-approve a plan if one appears
        try:
            btn = page.get_by_role("button", name="Approve", exact=False)
            if btn.count() > 0 and btn.first.is_enabled() and btn.first.is_visible():
                btn.first.click()
                print(f"[approve clicked at {state['t']}]")
        except Exception:  # noqa: BLE001
            pass
        if state["card"] and not saved["card"]:
            saved["card"] = True
            page.screenshot(path=os.path.join(WORK, "work2-card.png"))
        if state["workingNow"] and not saved["now"]:
            saved["now"] = True
            page.screenshot(path=os.path.join(WORK, "work2-now.png"))
        if len(state["canvases"]) >= 2 and not saved["multi"]:
            saved["multi"] = True
            page.screenshot(path=os.path.join(WORK, "work2-multi.png"))
        time.sleep(0.3)

    with open(os.path.join(WORK, "work-probe2-samples.json"), "w") as handle:
        json.dump(samples, handle, indent=1)

    prev = None
    for s in samples:
        k = (len(s["canvases"]), s["card"], s["workingNow"], s["thinking"], s["toolGroups"])
        if k != prev:
            print("t=%5.1f canvases=%d card=%s now=%s thinking=%s groups=%d %s"
                  % (s["t"], k[0], k[1], k[2], k[3], k[4], s["textSample"][:40]))
            prev = k
    multi = [s for s in samples if len(s["canvases"]) >= 2]
    print("multi-canvas frames:", len(multi))
    if multi:
        print(json.dumps(multi[0]["canvases"], indent=1))
    context.close()
    browser.close()
