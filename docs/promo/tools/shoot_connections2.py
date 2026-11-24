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
    pg.get_by_role("tab", name="Connections", exact=True).first.click(); pg.wait_for_timeout(3000); clear()
    pg.mouse.move(900, 520)
    for _ in range(3):
        pg.mouse.wheel(0, 700); pg.wait_for_timeout(900)
    pg.screenshot(path=os.path.join(WORK,"seg-connections-low.png"))
    print((pg.evaluate("document.body.innerText") or "")[:1500])
    c.close(); b.close()
