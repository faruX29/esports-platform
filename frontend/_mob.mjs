import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 375, height: 1200 }, deviceScaleFactor: 2 })
await p.goto('http://localhost:4788/', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(8000)
await p.screenshot({ path: '_mob_full.png', fullPage: true })
await b.close()
