const { chromium } = require('playwright')
;(async () => {
  const b = await chromium.launch()
  for (const [name, vp] of [['desk',{width:1280,height:1400}],['mob',{width:390,height:1400}]]) {
    const p = await b.newPage({ viewport: vp, deviceScaleFactor: 2 })
    await p.goto('http://localhost:4788/', { waitUntil: 'networkidle', timeout: 60000 })
    await p.waitForTimeout(4000)
    await p.screenshot({ path: `${name}.png`, fullPage: true })
    await p.close()
  }
  await b.close()
})()
