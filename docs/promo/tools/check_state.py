import os, re, time
from playwright.sync_api import sync_playwright
BASE="https://nova-cloud-computer.vercel.app"; WORK="/home/marcus/.hermes/cache/scratch/nova-demo"
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,args=["--no-sandbox","--disable-dev-shm-usage"])
    c=b.new_context(viewport={"width":1280,"height":720},storage_state=os.path.join(WORK,"session.json"))
    pg=c.new_page(); pg.set_default_timeout(20000)
    def clear():
        for _ in range(3):
            hit=None
            for n in ["Skip for now","Close","Not now"]:
                try:
                    l=pg.get_by_role("button",name=n,exact=False)
                    if l.count() and l.first.is_visible(): l.first.click(); hit=n; break
                except Exception: pass
            if not hit: return
            pg.wait_for_timeout(800)
    pg.goto(BASE+"/app/deployments", wait_until="domcontentloaded"); pg.wait_for_timeout(3500); clear()
    t=pg.evaluate("document.body.innerText")
    print(t[:1800])
    print("URLS:", re.findall(r"https://[\w.-]+\.netlify\.app", t))
    pg.screenshot(path=os.path.join(WORK,"state-deployments.png"))
    c.close(); b.close()
