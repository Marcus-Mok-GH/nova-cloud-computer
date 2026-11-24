import os, json
from playwright.sync_api import sync_playwright
BASE="https://nova-cloud-computer.vercel.app"
WORK="/home/marcus/.hermes/cache/scratch/nova-demo"
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,args=["--no-sandbox","--disable-dev-shm-usage"])
    c=b.new_context(viewport={"width":1280,"height":720},storage_state=os.path.join(WORK,"session.json"))
    pg=c.new_page(); pg.set_default_timeout(15000)
    pg.goto(BASE+"/app/settings", wait_until="domcontentloaded"); pg.wait_for_timeout(4000)
    print("tabs:", pg.evaluate("Array.from(document.querySelectorAll('[role=tab]')).map(e => ({t:e.innerText.trim(), id:e.id}))"))
    print("buttons:", pg.evaluate("Array.from(document.querySelectorAll('button')).map(e=>e.innerText.trim()).filter(Boolean).slice(0,40)"))
    print("overlays:", pg.evaluate("Array.from(document.querySelectorAll('[role=dialog]')).map(e=>e.innerText.slice(0,60))"))
    c.close(); b.close()
