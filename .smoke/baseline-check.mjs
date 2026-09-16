/**
 * 直接对拍：无条件 20 日 / 60 日上涨率到底是多少。
 * 用最朴素的写法，绕开所有封装。
 */
import { readFileSync } from 'node:fs'

const csv = readFileSync('src/data/sp500-daily.csv', 'utf8').trim().split('\n')
const dates = csv.map((l) => Number(l.split(',')[0]))
const close = csv.map((l) => Number(l.split(',')[1]))

console.log('CSV 行数', csv.length, ' 首', dates[0], ' 末', dates[dates.length - 1])

// 原始全序列
for (const h of [1, 5, 20, 60, 244]) {
  let n = 0
  let w = 0
  for (let i = 0; i + h < close.length; i++) {
    n++
    if (close[i + h] > close[i]) w++
  }
  console.log(
    `  全序列 ${String(h).padStart(3)} 日：n=${n}  上涨率 ${((w / n) * 100).toFixed(2)}%`,
  )
}

// 只统计 1950 年后（与页面一致）
const start = dates.findIndex((d) => d >= 19500103)
console.log('\n1950 年后起点索引', start, '日期', dates[start])
for (const h of [20, 60]) {
  let n = 0
  let w = 0
  for (let i = start; i + h < close.length; i++) {
    n++
    if (close[i + h] > close[i]) w++
  }
  console.log(`  ${String(h).padStart(3)} 日：n=${n}  上涨率 ${((w / n) * 100).toFixed(2)}%`)
}

// 分段看：是不是某个年代拉高了整体
console.log('\n分年代（20 日上涨率）')
for (const [a, b] of [[1950, 1969], [1970, 1989], [1990, 2009], [2010, 2026]]) {
  let n = 0
  let w = 0
  for (let i = 0; i + 20 < close.length; i++) {
    const y = Math.floor(dates[i] / 10000)
    if (y < a || y > b) continue
    n++
    if (close[i + 20] > close[i]) w++
  }
  console.log(`  ${a}-${b}: n=${n}  上涨率 ${((w / n) * 100).toFixed(2)}%`)
}

// 检查是否有异常数据：非单调日期、重复日期
let dup = 0
let nonMono = 0
for (let i = 1; i < dates.length; i++) {
  if (dates[i] === dates[i - 1]) dup++
  if (dates[i] < dates[i - 1]) nonMono++
}
console.log('\n重复日期', dup, '  非递增', nonMono)

// 年化漂移与波动率
const rets = []
for (let i = 1; i < close.length; i++) rets.push(Math.log(close[i] / close[i - 1]))
const mean = rets.reduce((a, b) => a + b, 0) / rets.length
const sd = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length)
console.log(
  `\n日对数收益 均值 ${(mean * 100).toFixed(4)}%  标准差 ${(sd * 100).toFixed(3)}%`,
)
console.log(`年化漂移 ${(mean * 244 * 100).toFixed(2)}%   年化波动 ${(sd * Math.sqrt(244) * 100).toFixed(1)}%`)
const drift20 = mean * 20
const vol20 = sd * Math.sqrt(20)
console.log(
  `理论 20 日上涨率（正态近似）Φ(${(drift20 / vol20).toFixed(3)}) = ${(normCdf(drift20 / vol20) * 100).toFixed(2)}%`,
)

function normCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2))
}
function erf(x) {
  const s = Math.sign(x)
  x = Math.abs(x)
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
  const t = 1 / (1 + p * x)
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)
  return s * y
}
