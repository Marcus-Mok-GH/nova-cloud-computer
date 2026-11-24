import os
from playwright.sync_api import sync_playwright
BASE="https://nova-cloud-computer.vercel.app"; WORK="/home/marcus/.hermes/cache/scratch/nova-demo"
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,args=["--no-sandbox","--disable-dev-shm-usage"])
    c=b.new_context(viewport={"width":1280,"height":720},storage_state=os.path.join(WORK,"session.json"))
    pg=c.new_page(); pg.set_default_timeout(20000)
    pg.goto(BASE+"/app?chatId=evcawb7efg", wait_until="domcontentloaded"); pg.wait_for_timeout(4000)
    t=pg.evaluate("document.body.innerText") or ""
    print(t[-2200:])
    pg.screenshot(path=os.path.join(WORK,"peek-thread.png"))
    c.close(); b.close()
