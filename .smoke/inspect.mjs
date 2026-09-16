/**
 * 通过 CDP 直接把页面里的图表 DOM 抓出来，用于排查刻度是否真的渲染了。
 * 用法: node .smoke/inspect.mjs
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9335
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
    pending.get(m.id)(m)
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
await send('Page.navigate', { url: 'http://localhost:3210/?era=all&range=10y' })
await sleep(4000)

const { result } = await send('Runtime.evaluate', {
  expression: `(() => {
    const svgs = [...document.querySelectorAll('svg')].filter(s => {
      const r = s.getBoundingClientRect();
      return r.width > 400 && r.height > 150;
    });
    const s = svgs[0];
    if (!s) return { err: 'no chart svg' };
    const sr = s.getBoundingClientRect();
    return {
      svg: { x: sr.x, y: sr.y, w: sr.width, h: sr.height },
      viewBox: s.getAttribute('viewBox'),
      texts: [...s.querySelectorAll('text')].map(t => {
        const r = t.getBoundingClientRect();
        const cs = getComputedStyle(t);
        return {
          content: t.textContent,
          rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
          fill: cs.fill,
          display: cs.display,
          visibility: cs.visibility,
          opacity: cs.opacity,
          fontSize: cs.fontSize,
        };
      }),
    };
  })()`,
  returnByValue: true,
})
console.log(JSON.stringify(result.result.value, null, 2))
ws.close()
chrome.kill()
