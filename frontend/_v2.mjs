import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 375, height: 900 }, deviceScaleFactor: 3 })
await p.goto('http://localhost:4788/', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(8000)
const el = await p.evaluateHandle(() => [...document.querySelectorAll('span')].find(s=>s.textContent.trim()==='Maç Programı'))
if (el) { await el.scrollIntoViewIfNeeded(); await p.waitForTimeout(500) }
await p.screenshot({ path: '_prog2.png' })
// also check horizontal overflow (body should not scroll sideways)
const overflow = await p.evaluate(()=>({docW: document.documentElement.scrollWidth, winW: window.innerWidth}))
console.log('overflow:', JSON.stringify(overflow))
await b.close()
