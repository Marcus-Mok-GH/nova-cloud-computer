import os
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
            pg.wait_for_timeout(700)
    pg.goto(BASE+"/app/chats", wait_until="domcontentloaded"); pg.wait_for_timeout(3500); clear()
    print((pg.evaluate("document.body.innerText") or "")[:1200])
    print("links:", pg.evaluate("Array.from(document.querySelectorAll('a')).map(a=>a.getAttribute('href')).filter(h=>h&&h.includes('chatId')).slice(0,5)"))
    print("buttons:", pg.evaluate("Array.from(document.querySelectorAll('button')).map(b=>b.innerText.trim()).filter(Boolean).slice(0,25)"))
    c.close(); b.close()
