/**
 * 针对单个区域做 2 倍放大截图，用来看清刻度文字。
 * 用法: node .smoke/zoom.mjs <url> <y> <h> <outName>
 */
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const [, , url, xArg, yArg, wArg, hArg, scaleArg, outName] = process.argv
const PORT = 9334
const OUT = 'C:/Users/18758/WorkBuddy/2026-09-11-08-39-30/sp500-deviation/.smoke/shots'
mkdirSync(OUT, { recursive: true })

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  '--window-size=1440,1000',
  'about:blank',
])

let wsUrl
for (let i = 0; i < 40 && !wsUrl; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl
  } catch {}
  if (!wsUrl) await sleep(400)
}
const ws = new WebSocket(wsUrl)
await new Promise((r, j) => {
  ws.onopen = r
  ws.onerror = j
})
let id = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result)
    pending.delete(m.id)
  }
}
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
  })

await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url })
await sleep(3800)
const res = await send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: true,
  clip: {
    x: Number(xArg),
    y: Number(yArg),
    width: Number(wArg),
    height: Number(hArg),
    scale: Number(scaleArg),
  },
})
writeFileSync(`${OUT}/${outName}.png`, Buffer.from(res.data, 'base64'))
console.log('written', outName)
ws.close()
chrome.kill()
