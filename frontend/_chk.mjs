import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 412, height: 900 }, deviceScaleFactor: 2 })
let panda=0, wsrv=0, imgOk=0, imgFail=0
p.on('response', r => { const u=r.url(); if(u.includes('pandascore'))panda++; if(u.includes('wsrv'))wsrv++ })
await p.goto('http://localhost:4788/', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(7000)
const res = await p.evaluate(() => {
  const imgs=[...document.querySelectorAll('img')].filter(i=>(i.getAttribute('alt')||'')&&i.width<=48)
  let loaded=0,broken=0,sample=''
  for(const i of imgs){ if(i.naturalWidth>0)loaded++; else broken++; if(!sample&&i.src.includes('pandascore'))sample=i.src.slice(0,70) }
  return {total:imgs.length,loaded,broken,sample}
})
console.log('logo imgs:', res.total, '| loaded:', res.loaded, '| broken:', res.broken)
console.log('pandascore reqs:', panda, '| wsrv reqs:', wsrv)
console.log('sample src:', res.sample)
await p.screenshot({ path:'_logos2.png' })
await b.close()
