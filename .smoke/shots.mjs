/**
 * 通过 CDP 对页面做分区截图 + 收集控制台错误。
 * 仅用于本地验证，不属于应用代码。
 *
 * 用法: node .smoke/shots.mjs
 */
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME =
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9333
const BASE = process.env.BASE ?? 'http://localhost:3000'
const OUT = 'D:/Development/index-deviation/.smoke/shots'

mkdirSync(OUT, { recursive: true })

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  '--window-size=1440,1000',
  'about:blank',
])
chrome.on('error', (e) => {
  console.error('chrome spawn failed', e)
  process.exit(1)
})

async function cdpTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await r.json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      /* 还没起来 */
    }
    await sleep(400)
  }
  throw new Error('找不到 CDP target')
}

const wsUrl = await cdpTarget()
const ws = new WebSocket(wsUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})

let id = 0
const pending = new Map()
const problems = []

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    return
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    problems.push('EXCEPTION: ' + msg.params.exceptionDetails.text +
      ' ' + (msg.params.exceptionDetails.exception?.description ?? ''))
  }
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    problems.push(
      msg.params.type.toUpperCase() + ': ' +
      msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '),
    )
  }
}

function send(method, params = {}) {
  const msgId = ++id
  return new Promise((resolve, reject) => {
    pending.set(msgId, { resolve, reject })
    ws.send(JSON.stringify({ id: msgId, method, params }))
  })
}

await send('Page.enable')
await send('Runtime.enable')

async function goto(url) {
  await send('Page.navigate', { url })
  await sleep(3500)
}

async function shot(name, selector = null, pad = 8) {
  let clip
  if (selector) {
    const { result } = await send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height };
      })()`,
      returnByValue: true,
    })
    if (!result.value) {
      console.log(`  ! 找不到 ${selector}`)
      return
    }
    const v = result.value
    clip = {
      x: Math.max(0, v.x - pad),
      y: Math.max(0, v.y - pad),
      width: v.w + pad * 2,
      height: v.h + pad * 2,
      scale: 1,
    }
  } else {
    const { result } = await send('Runtime.evaluate', {
      expression: '({w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight})',
      returnByValue: true,
    })
    clip = { x: 0, y: 0, width: result.value.w, height: Math.min(result.value.h, 6000), scale: 1 }
  }
  const res = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip,
  })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(res.data, 'base64'))
  console.log(`  ✓ ${name}.png  ${Math.round(clip.width)}x${Math.round(clip.height)}`)
}

/** 把整页按纵向切成若干片，逐片截图 */
async function slice(name, sliceH = 860, maxSlices = 14) {
  const { result } = await send('Runtime.evaluate', {
    expression:
      '({w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight})',
    returnByValue: true,
  })
  const total = result.value.h
  const width = Math.min(result.value.w, 1400)
  const count = Math.min(maxSlices, Math.ceil(total / sliceH))
  for (let i = 0; i < count; i++) {
    const y = i * sliceH
    if (y >= total) break
    const res = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y, width, height: Math.min(sliceH, total - y), scale: 1 },
    })
    writeFileSync(`${OUT}/${name}-${String(i).padStart(2, '0')}.png`, Buffer.from(res.data, 'base64'))
  }
  console.log(`  ✓ ${name}: ${count} 片，整页高 ${total}px`)
}

/** 横向溢出检查：窄屏下 scrollWidth 是否被撑破 */
async function overflow(tag) {
  const { result } = await send('Runtime.evaluate', {
    expression:
      '({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, h: document.documentElement.scrollHeight})',
    returnByValue: true,
  })
  const { sw, cw, h } = result.value
  console.log(
    `  ${sw > cw ? '✗ 溢出' : '✓ 无溢出'}  ${tag}  scrollWidth=${sw} clientWidth=${cw} 页高=${h}`,
  )
  if (sw > cw) problems.push(`OVERFLOW ${tag}: ${sw} > ${cw}`)
}

console.log('— 总览 —')
await goto(`${BASE}/`)
await slice('overview', 860, 4)
await overflow('/')

console.log('— 指数详情 —')
await goto(`${BASE}/i/sp500`)
await slice('detail', 900, 6)
await overflow('/i/sp500')

console.log('— 指数详情（创业板指，A 股口径）—')
await goto(`${BASE}/i/chinext`)
await slice('detail-chinext', 900, 3)

console.log('— 完整统计 —')
await goto(`${BASE}/stats/sp500?era=all&ma=dev200&horizon=20`)
await slice('stats', 900, 8)

console.log('— 方法 —')
await goto(`${BASE}/method`)
await slice('method', 860, 6)

console.log('— 移动端 390px —')
await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
})
await goto(`${BASE}/`)
await slice('mobile-overview', 800, 3)
await overflow('mobile /')
await goto(`${BASE}/i/sp500`)
await slice('mobile-detail', 800, 6)
await overflow('mobile /i/sp500')
await goto(`${BASE}/stats/sp500`)
await slice('mobile-stats', 800, 6)
await overflow('mobile /stats/sp500')
await goto(`${BASE}/method`)
await slice('mobile-method', 800, 4)
await overflow('mobile /method')
await send('Emulation.clearDeviceMetricsOverride')

console.log('\n— 控制台问题 —')
if (problems.length === 0) console.log('  无')
else for (const p of [...new Set(problems)].slice(0, 25)) console.log('  ' + p)

ws.close()
chrome.kill()
