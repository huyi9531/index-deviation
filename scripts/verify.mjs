/**
 * 独立复算脚本：用与前端**相同公式、但完全独立的实现**，从原始 CSV 重算关键统计量，
 * 再跟正在运行的 dev/preview 服务的 /api/:indexId 对拍。
 *
 * 目的：确认看板上的数字不是「自己算完自己信」，而是可被第三方脚本复现的。
 *
 * 用法：
 *   node scripts/verify.mjs                 # 默认对拍 http://localhost:3000
 *   node scripts/verify.mjs --base=http://localhost:4173
 *   node scripts/verify.mjs --offline       # 服务没起时只做本地复算
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = resolve(HERE, '../src/data')

const argv = process.argv.slice(2)
const OFFLINE = argv.includes('--offline')
const BASE = (argv.find((a) => a.startsWith('--base=')) ?? '--base=http://localhost:3000').slice(7)

/** 与 src/lib/indices/registry.ts 保持一致的元数据（故意手抄一份，避免「引用被测代码」） */
const INDICES = [
  { id: 'sp500', market: 'us', action: { dev60: -7, dev200: -10 } },
  { id: 'nasdaq', market: 'us', action: { dev60: null, dev200: null } },
  { id: 'hs300', market: 'cn', action: { dev60: null, dev200: -12 } },
  { id: 'a500', market: 'cn', action: { dev60: null, dev200: -12 } },
  { id: 'csi500', market: 'cn', action: { dev60: -8, dev200: -20 } },
  { id: 'chinext', market: 'cn', action: { dev60: -8, dev200: -14 } },
  { id: 'star50', market: 'cn', action: { dev60: -4, dev200: -16 } },
]

/** 与 src/lib/indices/types.ts 的 ERAS_US / ERAS_CN 一致 */
const ERAS = {
  us: [
    { id: 'all', start: 0 },
    { id: 'since1970', start: 19700101 },
    { id: 'since2000', start: 20000101 },
    { id: 'since2010', start: 20100101 },
  ],
  cn: [
    { id: 'all', start: 0 },
    { id: 'since2010', start: 20100101 },
    { id: 'since2016', start: 20160101 },
    { id: 'since2019', start: 20190101 },
  ],
}

const SERIES_START = 19500103
const HORIZONS = [5, 10, 20, 60]

function parseCsv(text) {
  const dates = []
  const closes = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    // 只取前两列（日期 / 收盘价），多余列一律忽略
    const parts = line.split(',')
    if (parts.length < 2) continue
    const date = Number(parts[0])
    const close = Number(parts[1])
    if (!Number.isInteger(date) || date < 10000101) continue
    if (!Number.isFinite(close) || close <= 0) continue
    dates.push(date)
    closes.push(close)
  }
  return { dates, closes }
}

function sma(values, period) {
  const out = new Array(values.length).fill(NaN)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

function buildSeries(rawDates, rawCloses) {
  const ma60r = sma(rawCloses, 60)
  const ma200r = sma(rawCloses, 200)
  const s = {
    dates: [],
    close: [],
    ma60: [],
    ma200: [],
    dev60: [],
    dev200: [],
  }
  for (let i = 0; i < rawDates.length; i++) {
    if (rawDates[i] < SERIES_START) continue
    const m60 = ma60r[i]
    const m200 = ma200r[i]
    if (!Number.isFinite(m60) || !Number.isFinite(m200)) continue
    s.dates.push(rawDates[i])
    s.close.push(rawCloses[i])
    s.ma60.push(m60)
    s.ma200.push(m200)
    s.dev60.push(100 * Math.log(rawCloses[i] / m60))
    s.dev200.push(100 * Math.log(rawCloses[i] / m200))
  }
  return s
}

function indexOfDate(dates, ymd) {
  let lo = 0
  let hi = dates.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (dates[mid] < ymd) lo = mid + 1
    else hi = mid
  }
  return lo
}

function summarize(s, indices, horizon) {
  const rets = []
  for (const i of indices) {
    const j = i + horizon
    if (j >= s.close.length) continue
    rets.push(s.close[j] / s.close[i] - 1)
  }
  if (!rets.length) return { n: 0, win: NaN, avg: NaN }
  const win = rets.filter((r) => r > 0).length / rets.length
  const avg = rets.reduce((a, b) => a + b, 0) / rets.length
  return { n: rets.length, win, avg }
}

function hits(s, key, from, to, threshold) {
  const out = []
  for (let i = from; i < to; i++) if (s[key][i] <= threshold) out.push(i)
  return out
}

function episodes(indices) {
  let count = 0
  let prev = NaN
  for (const i of indices) {
    if (i !== prev + 1) count += 1
    prev = i
  }
  return count
}

function baseline(s, w) {
  return HORIZONS.map((h) => {
    const idx = []
    for (let i = w.from; i < w.to; i++) idx.push(i)
    return { days: h, ...summarize(s, idx, h) }
  })
}

const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—')
/** 收益率（小数 → 百分数）,如 0.667 → 66.7% */
const pctS = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%` : '—')
/** 偏离度本身已经是百分数（如 -4.78 表示 -4.78%），不能再乘 100 */
const devS = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—')

const results = []
for (const def of INDICES) {
  const csv = readFileSync(resolve(DATA, `${def.id}-daily.csv`), 'utf8')
  const { dates: rd, closes: rc } = parseCsv(csv)
  const s = buildSeries(rd, rc)
  const w = { from: 0, to: s.dates.length }
  const i = s.dates.length - 1

  const row = {
    id: def.id,
    firstDate: s.dates[0],
    lastDate: s.dates[i],
    tradingDays: s.dates.length,
    close: s.close[i],
    dev60: s.dev60[i],
    dev200: s.dev200[i],
    baseline: baseline(s, w),
    line: '',
  }

  const b20 = row.baseline.find((b) => b.days === 20)
  const b60 = row.baseline.find((b) => b.days === 60)

  const parts = []
  parts.push(
    `\n${'─'.repeat(78)}\n${def.id.toUpperCase()}  （${def.market}）  ` +
      `${s.dates[0]} → ${s.dates[i]}  ${s.dates.length} 个交易日`,
  )
  parts.push(
    `  当前  ${s.dates[i]}  收盘 ${s.close[i].toFixed(2)}  ` +
      `dev60 ${devS(s.dev60[i])}  dev200 ${devS(s.dev200[i])}`,
  )
  parts.push(
    `  常态（不设条件）  20 日 ${pct(b20.win)} / 均值 ${pctS(b20.avg)}   ` +
      `60 日 ${pct(b60.win)} / 均值 ${pctS(b60.avg)}`,
  )

  // 抄底口径：各阈值相对「常态」的超额
  for (const key of ['dev60', 'dev200']) {
    const levels = key === 'dev60' ? [-4, -8, -12] : [-8, -12, -20]
    parts.push(`  ${key} 抄底（相对常态的超额，60 日）`)
    for (const t of levels) {
      const idx = hits(s, key, 0, s.dates.length, t)
      const st = summarize(s, idx, 60)
      if (st.n === 0) {
        parts.push(`    ≤ ${String(t).padStart(4)}%   样本 0 天`)
        continue
      }
      const delta = st.win - b60.win
      parts.push(
        `    ≤ ${String(t).padStart(4)}%   样本 ${String(st.n).padStart(5)} 天  ` +
          `${String(episodes(idx)).padStart(3)} 次独立  60 日胜率 ${pct(st.win)}  ` +
          `超额 ${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}pp`,
      )
    }
  }

  // 行动水位在各时期的表现（与页面「时代差异」表同口径）
  const level = def.action.dev200
  parts.push(
    level === null
      ? '  200 日行动水位：无标定（各档位均无超额）'
      : `  200 日行动水位 ≤ ${level}% 的历史时期表现`,
  )
  if (level !== null) {
    for (const era of ERAS[def.market]) {
      if (era.start !== 0 && era.start <= s.dates[0]) continue
      const from = indexOfDate(s.dates, era.start)
      const idx = hits(s, 'dev200', from, s.dates.length, level)
      const st60 = summarize(s, idx, 60)
      parts.push(
        `    ${era.id.padEnd(10)}  区间 ${String(s.dates[from]).slice(0, 4)}–...  ` +
          `${String(episodes(idx)).padStart(3)} 次独立  60 日胜率 ${pct(st60.win)}`,
      )
    }
  }

  row.line = parts.join('\n')
  results.push(row)
}

console.log('\n================ 独立复算（公式同源、实现独立） ================')
for (const r of results) console.log(r.line)

if (OFFLINE) {
  console.log('\n（--offline：跳过与接口的对拍）\n')
  process.exit(0)
}

/* ─────────────────── 与运行中的服务对拍 ─────────────────── */
console.log(`\n================ 与 ${BASE} 的 /api/:indexId 对拍 ================`)

/**
 * 对拍规则分两档，原因是「最后一根 K 线」的性质不同：
 *   · 已收盘的交易日（美股，或 A 股的非交易时段）→ 严格相等，容差 0.011
 *   · 当天正在交易的 A 股 → 接口取到的是**盘中实时价**，会随行情跳动，
 *     与快照里那一秒的价格天然不同，只能给容差（价格 1.5%、偏离度 1.0pp）
 * 这样既保住了美股那条「逐位精确」的强验证，也不会把盘中行情当成算错。
 */
const today = (() => {
  const d = new Date()
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
})()

let failed = 0
let strict = 0
let loose = 0
for (const r of results) {
  let state
  try {
    const res = await fetch(`${BASE}/api/${r.id}`, {
      headers: { accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    state = await res.json()
  } catch (err) {
    console.log(`  ${r.id.padEnd(9)} 取数失败：${err.message}`)
    failed += 1
    continue
  }

  if (state.date !== r.lastDate) {
    failed += 1
    console.log(`  ${r.id.padEnd(9)} FAIL  日期不一致：本地 ${r.lastDate} ≠ 接口 ${state.date}`)
    continue
  }

  const intraday = r.lastDate >= today
  const closeTol = intraday ? r.close * 0.015 : 0.011
  const devTol = intraday ? 1.0 : 0.011

  const checks = [
    ['close', r.close, state.close, closeTol],
    ['dev60', r.dev60, state.dev60, devTol],
    ['dev200', r.dev200, state.dev200, devTol],
  ]
  const bad = checks.filter(([, mine, theirs, tol]) => Math.abs(mine - theirs) > tol)

  if (bad.length === 0) {
    if (intraday) loose += 1
    else strict += 1
    console.log(
      `  ${r.id.padEnd(9)} PASS${intraday ? '（盘中实时·容差内）' : '（逐位精确）'}   ` +
        `${r.lastDate}  ${r.close.toFixed(2)}  ` +
        `dev60 ${devS(r.dev60)}  dev200 ${devS(r.dev200)}`,
    )
  } else {
    failed += 1
    console.log(`  ${r.id.padEnd(9)} FAIL`)
    for (const [k, mine, theirs, tol] of bad) {
      console.log(`      ${k}: 本地 ${mine}  ≠  接口 ${theirs}   （容差 ${tol}）`)
    }
  }
}

console.log(
  failed === 0
    ? `\n全部 ${INDICES.length} 个指数一致 ✓  逐位精确 ${strict} 个，盘中容差 ${loose} 个\n`
    : `\n${failed} 个指数对拍失败 ✗\n`,
)
// 用 exitCode 而不是 process.exit()：对拍会依次发若干个 fetch，
// undici 的保活连接在 process.exit() 的硬退出路径上会撞到 libuv 的
// `!(handle->flags & UV_HANDLE_CLOSING)` 断言（Windows + Node 25 实测），
// 表现为验证全通过却返回退出码 127。交给事件循环自然收尾即可。
process.exitCode = failed === 0 ? 0 : 1
