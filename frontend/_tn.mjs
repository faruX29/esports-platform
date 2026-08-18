import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 412, height: 700 }, deviceScaleFactor: 2 })
await p.goto('http://localhost:4788/', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(8000)
const el = await p.evaluateHandle(() => [...document.querySelectorAll('span')].find(s=>s.textContent.trim()==='Aktif Turnuvalar'))
if (el) { await el.scrollIntoViewIfNeeded(); await p.evaluate(()=>window.scrollBy(0,-40)); await p.waitForTimeout(400) }
await p.screenshot({ path: '_tn.png' })
await b.close()
