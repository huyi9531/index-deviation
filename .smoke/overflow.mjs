/**
 * 找出窄屏下超出视口的元素。
 *   node .smoke/overflow.mjs /i/sp500
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9334
const BASE = process.env.BASE ?? 'http://localhost:3000'
const path = process.argv[2] ?? '/i/sp500'
const WIDTH = Number(process.argv[3] ?? 390)

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  'about:blank',
])

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      /* 等 */
    }
    await sleep(400)
  }
  throw new Error('no target')
}

const ws = new WebSocket(await target())
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})

let id = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id
    pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: WIDTH,
  height: 900,
  deviceScaleFactor: 1,
  mobile: true,
})
await send('Page.navigate', { url: BASE + path })
await sleep(4000)

const { result } = await send('Runtime.evaluate', {
  expression: `(() => {
    const cw = document.documentElement.clientWidth;
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right > cw + 1 || r.left < -1) {
        const cls = (el.getAttribute('class') || '').slice(0, 90);
        out.push({
          tag: el.tagName.toLowerCase(),
          cls,
          left: Math.round(r.left),
          right: Math.round(r.right),
          w: Math.round(r.width),
        });
      }
    }
    return { cw, sw: document.documentElement.scrollWidth, out: out.slice(0, 40) };
  })()`,
  returnByValue: true,
})

const v = result.value
console.log(`clientWidth=${v.cw} scrollWidth=${v.sw}`)
for (const o of v.out) {
  console.log(
    `${String(o.left).padStart(5)} → ${String(o.right).padStart(5)}  w=${String(o.w).padStart(4)}  <${o.tag}> ${o.cls}`,
  )
}

ws.close()
chrome.kill()
