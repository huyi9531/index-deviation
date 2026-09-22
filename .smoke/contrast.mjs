/**
 * 对照实验：**偏离度信号 vs 等频的「纯近期跌幅」信号**，看前者是否真的多知道什么。
 *
 * 为什么值得做：偏离度是过去 N 天收盘价的确定性函数，所以「跌破均线多少」与
 * 「最近跌了多少」高度相关。用户真正想知道的是「这工具是不是玄学」——
 * 那就把 dev60 水位信号与一个**独立信号数完全匹配**的纯动量信号放在一起比：
 * 如果两者超额差不多，说明「乖离率」只是「最近跌了多少」的重包装。
 *
 * 口径与标定工具一致：点估计按**交易日加权**，超额 = 60 日胜率 − 同窗口常态基线，
 * 独立信号数 = 连续命中合并后的段数（用于把两个信号配到同样的机会次数）。
 *
 * 输出 Markdown 表格，供人工贴进 `src/routes/method.tsx`（并标注数据截止日）。
 *
 * 用法：node .smoke/contrast.mjs
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const DATA = resolve(process.cwd(), 'src/data')

/** [id, 中文名, dev60 水位]（水位手抄自 registry.ts 的 action.dev60；null = 无水位） */
const LIST = [
  ['sp500', '标普500', -7],
  ['nasdaq', '纳斯达克100', -10],
  ['hs300', '沪深300', -4],
  ['a500', '中证A500', -4],
  ['csi500', '中证500', -8],
  ['chinext', '创业板指', -4],
  ['star50', '科创50', -4],
  ['hsi', '恒生指数', -7],
  ['hstech', '恒生科技', -8],
  ['n225', '日经225', -10],
]

const H = 60

function sma(v, w) {
  const o = new Array(v.length).fill(NaN)
  let s = 0
  for (let i = 0; i < v.length; i++) {
    s += v[i]
    if (i >= w) s -= v[i - w]
    if (i >= w - 1) o[i] = s / w
  }
  return o
}

async function load(id) {
  const csv = await readFile(resolve(DATA, `${id}-daily.csv`), 'utf8')
  const dates = []
  const closes = []
  for (const raw of csv.split('\n')) {
    const l = raw.trim()
    if (!l) continue
    const p = l.split(',')
    const d = Number(p[0])
    const c = Number(p[1])
    if (!Number.isInteger(d) || !Number.isFinite(c) || c <= 0) continue
    dates.push(d)
    closes.push(c)
  }
  const ma60 = sma(closes, 60)
  const ma200 = sma(closes, 200)
  const C = []
  const DEV = []
  const RET = []
  for (let i = 0; i < closes.length; i++) {
    if (!Number.isFinite(ma60[i]) || !Number.isFinite(ma200[i])) continue
    C.push(closes[i])
    DEV.push(100 * Math.log(closes[i] / ma60[i]))
    RET.push(i >= 60 ? closes[i] / closes[i - 60] - 1 : NaN)
  }
  return { close: C, dev: DEV, ret: RET, first: dates[0], last: dates[dates.length - 1] }
}

function baselineWin(s) {
  let n = 0
  let w = 0
  for (let i = 0; i + H < s.close.length; i++) {
    n++
    if (s.close[i + H] / s.close[i] - 1 > 0) w++
  }
  return n ? w / n : NaN
}

/** 命中判定交给调用方；返回交易日加权胜率 + 独立信号段数 */
function evaluate(s, hit) {
  let episodes = 0
  let days = 0
  let wins = 0
  for (let i = 0; i < s.close.length; i++) {
    if (!hit(i)) continue
    if (!(i > 0 && hit(i - 1))) episodes++
    const j = i + H
    if (j >= s.close.length) continue
    days++
    if (s.close[j] / s.close[i] - 1 > 0) wins++
  }
  return { episodes, days, win: days ? wins / days : NaN }
}

const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—')
const pp = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}` : '—')

console.log('| 指数 | 偏离度水位 | 偏离度信号超额 | 纯跌幅阈值 | 纯跌幅信号超额 | 差值 |')
console.log('| --- | --- | --- | --- | --- | --- |')

const rows = []
for (const [id, cn, level] of LIST) {
  const s = await load(id)
  const base = baselineWin(s)

  const devSig = evaluate(s, (i) => s.dev[i] <= level)
  const devExcess = (devSig.win - base) * 100

  // 找一个「近 60 日跌幅 ≤ t」的信号，让它的独立信号段数尽量接近偏离度信号
  let best = null
  for (let t = -0.35; t <= 0.02; t += 0.0025) {
    const sig = evaluate(s, (i) => Number.isFinite(s.ret[i]) && s.ret[i] <= t)
    if (sig.episodes === 0) continue
    if (!best || Math.abs(sig.episodes - devSig.episodes) < Math.abs(best.sig.episodes - devSig.episodes)) {
      best = { t, sig }
    }
  }
  const momExcess = (best.sig.win - base) * 100
  const diff = devExcess - momExcess

  rows.push({ cn, level, devSig, devExcess, t: best.t, momSig: best.sig, momExcess, diff })
  console.log(
    `| ${cn} | ≤ ${level}% | ${pp(devExcess)}pp（${devSig.episodes} 段） | ≤ ${(best.t * 100).toFixed(1)}% | ${pp(momExcess)}pp（${best.sig.episodes} 段） | ${pp(diff)}pp |`,
  )
}

const mean = (f) => rows.reduce((a, r) => a + f(r), 0) / rows.length
console.log(
  `\n平均：偏离度 ${pp(mean((r) => r.devExcess))}pp vs 纯跌幅 ${pp(mean((r) => r.momExcess))}pp；` +
    `平均差值 ${pp(mean((r) => r.diff))}pp`,
)
const win = rows.filter((r) => r.diff > 0).length
console.log(`偏离度更好的指数：${win}/${rows.length}`)
console.log(`\n数据截止：${(await load(LIST[0][0])).last}`)
