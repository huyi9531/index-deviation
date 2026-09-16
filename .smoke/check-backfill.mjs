/**
 * 检验各 A 股指数的「回溯段」质量：把它与沪深300 的日收益相关性，
 * 在回溯段与真实段分别算一次。两段接近 → 回溯路径与真实市场结构一致，可用；
 * 明显更差 → 该段是人为构造，不该用于统计。
 * 只读本地快照，不联网、不写文件。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data')

function load(id) {
  const m = new Map()
  for (const line of readFileSync(resolve(DATA, `${id}-daily.csv`), 'utf8').split('\n')) {
    const t = line.trim()
    if (!t) continue
    const i = t.indexOf(',')
    m.set(t.slice(0, i), Number(t.slice(i + 1)))
  }
  return m
}

function corr(x, y) {
  const n = x.length
  const mx = x.reduce((s, v) => s + v, 0) / n
  const my = y.reduce((s, v) => s + v, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx
    const dy = y[i] - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  return sxy / Math.sqrt(sxx * syy)
}

const hs300 = load('hs300')

/** 目标指数 vs 沪深300，按日期区间（YYYYMMDD 字符串比较）算日收益相关性 */
function seg(target, from, to) {
  const dates = [...target.keys()].filter((d) => hs300.has(d) && d >= from && d < to).sort()
  if (dates.length < 40) return null
  const rx = []
  const ry = []
  for (let i = 1; i < dates.length; i++) {
    rx.push(Math.log(target.get(dates[i]) / target.get(dates[i - 1])))
    ry.push(Math.log(hs300.get(dates[i]) / hs300.get(dates[i - 1])))
  }
  return { n: dates.length, c: corr(rx, ry) }
}

/** 指数真实发布日（回溯源） */
const CASES = [
  { id: 'a500', label: '中证A500', liveSince: '20240923' },
  { id: 'csi500', label: '中证500', liveSince: '20070115' },
  { id: 'hs300', label: '沪深300', liveSince: '20050408' },
  { id: 'chinext', label: '创业板指', liveSince: '20100601' },
]

console.log('\n日收益相关性（对照：沪深300），回溯段 vs 真实段\n')
console.log('  指数        段          天数    相关性')
for (const c of CASES) {
  const t = load(c.id)
  const all = [...t.keys()].sort()
  const first = all[0]
  // 回溯段 = 数据起点 → 发布日前；真实段 = 发布日后（只取前 3 年，与回溯段长度可比）
  const bf = first < c.liveSince ? seg(t, first, c.liveSince) : null
  const liveEnd = String(Number(c.liveSince.slice(0, 4)) + 3) + c.liveSince.slice(4)
  const lv = seg(t, c.liveSince, liveEnd)
  // 全局（含两段）
  const gl = seg(t, first, '99999999')

  if (bf) {
    console.log(
      `  ${c.label.padEnd(11)} 回溯段  ${String(bf.n).padStart(5)}    ${bf.c.toFixed(4)}`,
    )
  } else {
    console.log(`  ${c.label.padEnd(11)} 回溯段      无（数据起点即发布日）`)
  }
  if (lv) {
    console.log(
      `  ${c.label.padEnd(11)} 真实段  ${String(lv.n).padStart(5)}    ${lv.c.toFixed(4)}`,
    )
  }
  if (gl) {
    console.log(
      `  ${c.label.padEnd(11)} 全历史  ${String(gl.n).padStart(5)}    ${gl.c.toFixed(4)}`,
    )
  }
  console.log('')
}
