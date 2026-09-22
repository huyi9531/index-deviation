/**
 * 找出窄屏下超出视口的元素。
 *   node .smoke/overflow.mjs /i/sp500
 *
 * ⚠️ Windows Git Bash 下**必须**加 MSYS_NO_PATHCONV=1：否则参数 `/i/sp500` 会被
 * MSYS 当成 Unix 路径改写成 `I:/sp500`，拼出 `http://localhost:3000I:/sp500`，
 * 报「Cannot navigate to invalid URL」—— 看起来像 Chrome 或脚本坏了，
 * 实际只是参数被改写了（2026-09 实测踩过，白查了半天）。正确用法：
 *   MSYS_NO_PATHCONV=1 BASE=http://localhost:4173 node .smoke/overflow.mjs /i/sp500 390
 *
 * 判读：最后一行会直接给结论（退出码 1 = 页面级横向溢出）。
 * 中途列出的元素若位于 thin-scroll 容器内属预期 —— 那些表格本来就能横滚。
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9334
// 用 || 而不是 ??：空字符串也要回落。环境里可能存在 `BASE=`（空值）这种情形，
// ?? 兜不住它，会拼出非法 URL。
const BASE = process.env.BASE || 'http://localhost:3000'
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

// 失败时也要把 Chrome 带走：否则 9334 上会留一个孤儿实例，下次报错更难判断
// （原脚本只在正常结束时 kill，throw 出去就漏了）
process.on('exit', () => chrome.kill())

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
const overflowed = v.sw > v.cw + 1
console.log(`clientWidth=${v.cw} scrollWidth=${v.sw}`)
for (const o of v.out) {
  console.log(
    `${String(o.left).padStart(5)} → ${String(o.right).padStart(5)}  w=${String(o.w).padStart(4)}  <${o.tag}> ${o.cls}`,
  )
}
console.log(
  overflowed
    ? `✗ 页面横向溢出：scrollWidth ${v.sw} > clientWidth ${v.cw}（${path} @ ${WIDTH}px）`
    : `✓ 无页面级横向溢出：${path} @ ${WIDTH}px（clientWidth = scrollWidth = ${v.cw}）`,
)

ws.close()
chrome.kill()
process.exit(overflowed ? 1 : 0)
