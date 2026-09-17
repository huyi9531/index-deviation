/**
 * 行动水位标定：为每个指数单独选出「偏离度跌破这里之后，20 日胜率明显高于基线」的阈值。
 *
 * 之所以必须分指数标定：A 股的偏离度摆幅远大于美股，-8% / -10% 对创业板指太浅
 * （几乎每年都触发），对沪深300 又偏深。用同一组数字是错的。
 *
 * ⚠️⚠️ 本脚本的选档规则与 registry.ts 已发布的水位**不是同一个口径**：
 *   本脚本：20 日**绝对**胜率 ≥ [0.60, 0.58, 0.56]，取最浅档。
 *   registry：60 日胜率相对常态基线的**超额** ≥ +3pp，取最浅档（见 AGENTS.md）。
 *   两套规则给出的值不一样（实测：中证A500 dev60 本脚本给 -5、registry 写 null；
 *   创业板指 dev60 本脚本给 -10、registry 写 -8）。
 *   **本脚本的 JSON 输出不得直接抄进 registry.ts。**
 *   这个不统一已在 .agents/plans/2026-09-16T03-06-14-995Z-plan.md 第 8 条立项，
 *   待单独一轮把本脚本改成超额口径后再用。
 *
 * ⚠️ 2026-09 新增恒生指数 / 恒生科技 / 日经225 时，本脚本的 LIST 已同步补上这三个，
 *   否则「只是列表没跟上」会造成静默不覆盖。它们的水位是在本脚本的旧口径之外
 *   另行用 registry 口径标定的（标定过程与样本外检验结果写在 registry.ts 的注释里）。
 *
 * 只读 src/data/*.csv，不写文件。
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const DATA = resolve(process.cwd(), 'src/data')

const LIST = [
  ['sp500', '标普500'],
  ['nasdaq', '纳斯达克100'],
  ['hs300', '沪深300'],
  ['a500', '中证A500'],
  ['csi500', '中证500'],
  ['chinext', '创业板指'],
  ['star50', '科创50'],
  ['hsi', '恒生指数'],
  ['hstech', '恒生科技'],
  ['n225', '日经225'],
]

const DEV60 = [-4, -5, -6, -7, -8, -9, -10, -12, -15, -18]
const DEV200 = [-6, -8, -10, -12, -14, -16, -18, -20, -25, -30]

function sma(v, w) {
  const out = new Array(v.length).fill(NaN)
  let sum = 0
  for (let i = 0; i < v.length; i++) {
    sum += v[i]
    if (i >= w) sum -= v[i - w]
    if (i >= w - 1) out[i] = sum / w
  }
  return out
}

function buildSeries(dates, closes) {
  const ma60 = sma(closes, 60)
  const ma200 = sma(closes, 200)
  const D = []
  const C = []
  const M60 = []
  const M200 = []
  const V60 = []
  const V200 = []
  for (let i = 0; i < closes.length; i++) {
    if (Number.isNaN(ma60[i]) || Number.isNaN(ma200[i])) continue
    D.push(dates[i])
    C.push(closes[i])
    M60.push(ma60[i])
    M200.push(ma200[i])
    V60.push(100 * Math.log(closes[i] / ma60[i]))
    V200.push(100 * Math.log(closes[i] / ma200[i]))
  }
  return { dates: D, close: C, dev60: V60, dev200: V200 }
}

function scan(s, key, from, to, threshold) {
  const dev = s[key]
  let samples = 0
  let episodes = 0
  const idx = []
  for (let i = from; i < to; i++) {
    if (dev[i] > threshold) continue
    samples++
    idx.push(i)
    if (!(i > 0 && dev[i - 1] <= threshold)) episodes++
  }
  const win = (h) => {
    let n = 0
    let w = 0
    let sum = 0
    for (const i of idx) {
      const j = i + h
      if (j >= s.close.length) continue
      const r = s.close[j] / s.close[i] - 1
      n++
      sum += r
      if (r > 0) w++
    }
    return { n, win: n ? w / n : NaN, avg: n ? sum / n : NaN }
  }
  return { samples, episodes, h20: win(20), h60: win(60) }
}

function baseline(s, from, to) {
  const win = (h) => {
    let n = 0
    let w = 0
    for (let i = from; i + h < to; i++) {
      n++
      if (s.close[i + h] / s.close[i] - 1 > 0) w++
    }
    return n ? w / n : NaN
  }
  return { h20: win(20), h60: win(60) }
}

const out = {}

for (const [id, cn] of LIST) {
  const csv = await readFile(resolve(DATA, `${id}-daily.csv`), 'utf8')
  const dates = []
  const closes = []
  for (const line of csv.trim().split('\n')) {
    const [d, c] = line.split(',')
    dates.push(Number(d))
    closes.push(Number(c))
  }
  const s = buildSeries(dates, closes)
  const to = s.dates.length
  const base = baseline(s, 0, to)

  console.log(`\n${'═'.repeat(74)}`)
  console.log(
    `${cn} (${id})   有效样本 ${to} 个交易日   ${s.dates[0]} → ${s.dates[to - 1]}`,
  )
  console.log(`基线（无条件持有）：20 日上涨率 ${(base.h20 * 100).toFixed(1)}%   60 日 ${(base.h60 * 100).toFixed(1)}%`)
  console.log(
    '  阈值      独立信号   20日胜率   60日胜率    20日均值   超越基线',
  )

  const rows = []
  for (const key of ['dev60', 'dev200']) {
    const list = key === 'dev60' ? DEV60 : DEV200
    console.log(`  ── ${key === 'dev60' ? '60 日线' : '200 日线'} ──`)
    for (const t of list) {
      const r = scan(s, key, 0, to, t)
      const lift = r.h20.win - base.h20
      console.log(
        `  ${String(t).padStart(4)}%  ${String(r.episodes).padStart(7)}  ` +
          `${Number.isFinite(r.h20.win) ? (r.h20.win * 100).toFixed(1).padStart(8) + '%' : '       —'}` +
          `  ${Number.isFinite(r.h60.win) ? (r.h60.win * 100).toFixed(1).padStart(8) + '%' : '       —'}` +
          `  ${Number.isFinite(r.h20.avg) ? (r.h20.avg * 100).toFixed(2).padStart(8) + '%' : '       —'}` +
          `  ${(lift * 100).toFixed(1).padStart(7)}pp`,
      )
      rows.push({ key, t, ...r, lift })
    }
  }

  // 选水位。不能用「提升最大」——那会选出 -30% 这种深度阈值，
  // 独立信号只剩 9 次、胜率 100%，是小样本假象（一次十年一遇的机会）。
  // 规则：在独立信号 ≥ 12 次的候选里，取**最浅**（最容易真正触发）且
  // 20 日胜率达标的那一档；逐级放宽目标胜率，都不达标时退回胜率最高者。
  const minEpisodes = 12
  for (const key of ['dev60', 'dev200']) {
    const cand = rows
      .filter((r) => r.key === key && r.episodes >= minEpisodes && Number.isFinite(r.h20.win))
      .sort((a, b) => b.t - a.t) // 由浅到深
    let chosen = null
    let rule = ''
    for (const target of [0.6, 0.58, 0.56]) {
      const hit = cand.find((r) => r.h20.win >= target)
      if (hit) {
        chosen = hit
        rule = `胜率 ≥ ${(target * 100).toFixed(0)}% 的最浅档`
        break
      }
    }
    if (!chosen) {
      chosen = [...cand].sort((a, b) => b.h20.win - a.h20.win)[0] ?? null
      rule = '胜率最高档（未达目标）'
    }
    out[id] = out[id] ?? {}
    out[id][key] = chosen ? { ...chosen, rule } : null
  }
}

console.log(`\n${'═'.repeat(74)}`)
console.log('建议行动水位（规则：独立信号 ≥ 12 次，取 20 日胜率达标中「最浅」的一档）')
console.log('  指数            dev60                              dev200')
for (const [id, cn] of LIST) {
  const a = out[id]?.dev60
  const b = out[id]?.dev200
  const f = (r) =>
    r
      ? `${String(r.t).padStart(4)}%  20日 ${(r.h20.win * 100).toFixed(1)}% (${r.episodes} 次)`
      : '样本不足，不设水位'
  console.log(`  ${cn.padEnd(12)} ${f(a).padEnd(34)} ${f(b)}`)
}
console.log('\n⚠️  注意：以上为「20 日绝对胜率」口径，与 registry.ts 的「60 日超额≥+3pp」口径不同，')
console.log('    输出不得直接抄进 registry.ts。详见本文件顶部注释。')
console.log('\nJSON:')
console.log(
  JSON.stringify(
    Object.fromEntries(
      LIST.map(([id]) => [
        id,
        {
          dev60: out[id]?.dev60?.t ?? null,
          dev200: out[id]?.dev200?.t ?? null,
        },
      ]),
    ),
    null,
    2,
  ),
)
