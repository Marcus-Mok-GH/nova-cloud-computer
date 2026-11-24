import os
from playwright.sync_api import sync_playwright
BASE="https://nova-cloud-computer.vercel.app"; WORK="/home/marcus/.hermes/cache/scratch/nova-demo"
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,args=["--no-sandbox","--disable-dev-shm-usage"])
    c=b.new_context(viewport={"width":1280,"height":720},locale="en-US",storage_state=os.path.join(WORK,"session.json"))
    pg=c.new_page(); pg.set_default_timeout(20000)
    def clear():
        for _ in range(5):
            hit=None
            for n in ["Skip for now","Close","Not now","Save & continue"]:
                try:
                    l=pg.get_by_role("button",name=n,exact=False)
                    if l.count() and l.first.is_visible(): l.first.click(); hit=n; break
                except Exception: pass
            if not hit: return
            pg.wait_for_timeout(800)
    pg.goto(BASE+"/app/settings", wait_until="domcontentloaded"); pg.wait_for_timeout(4000); clear()
    tab=pg.get_by_role("tab", name="Connections", exact=True)
    print("connections tab count:", tab.count())
    tab.first.click(); pg.wait_for_timeout(3000); clear(); pg.wait_for_timeout(600)
    pg.screenshot(path=os.path.join(WORK,"seg-connections.png"))
    txt=pg.evaluate("document.body.innerText") or ""
    print(txt[:1200])
    # scroll once to catch any lower cards
    pg.mouse.wheel(0, 700); pg.wait_for_timeout(1500)
    pg.screenshot(path=os.path.join(WORK,"seg-connections-2.png"))
    print("---- after scroll ----")
    print((pg.evaluate("document.body.innerText") or "")[:900])
    c.close(); b.close()
