/**
 * 检验中证A500 回溯段的质量：与沪深300 对比日收益相关性 + 200 日偏离度差异。
 * 若回溯段与沪深300 高度同步 → 合成的是一条可实现的路径，偏差有限；
 * 若差异大 → 该段是人为构造，统计结论不可信。
 * 只读，不写文件。
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

async function kline(secid) {
  const url =
    'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + secid +
    '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61' +
    '&klt=101&fqt=1&beg=0&end=20500101&lmt=1000000'
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' },
  })
  const j = await res.json()
  const m = new Map()
  for (const row of j.data.klines) {
    const p = row.split(',')
    m.set(p[0], Number(p[2]))
  }
  return m
}

function alignMaps(a, b) {
  const dates = [...a.keys()].filter((d) => b.has(d)).sort()
  return { dates, x: dates.map((d) => a.get(d)), y: dates.map((d) => b.get(d)) }
}

function logReturns(v) {
  const out = []
  for (let i = 1; i < v.length; i++) out.push(Math.log(v[i] / v[i - 1]))
  return out
}

function corr(x, y) {
  const n = x.length
  const mx = x.reduce((s, v) => s + v, 0) / n
  const my = y.reduce((s, v) => s + v, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  return sxy / Math.sqrt(sxx * syy)
}

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

function dev200(v) {
  const ma = sma(v, 200)
  return v.map((c, i) => (Number.isNaN(ma[i]) ? NaN : 100 * Math.log(c / ma[i])))
}

function sliceByYear(dates, values, fromYear, toYear) {
  const idx = dates.map((d, i) => i).filter((i) => {
    const y = Number(d.slice(0, 4))
    return y >= fromYear && y <= toYear
  })
  return { dates: idx.map((i) => dates[i]), values: idx.map((i) => values[i]) }
}

const [a500, hs300, a50] = await Promise.all([
  kline('1.000510'),
  kline('1.000300'),
  kline('2.930050'),
])

function report(label, m1, m2, segments) {
  const { dates, x, y } = alignMaps(m1, m2)
  const rx = logReturns(x)
  const ry = logReturns(y)
  const rdates = dates.slice(1)
  const d1 = dev200(x)
  const d2 = dev200(y)

  console.log('\n########## ' + label + ' ##########')
  console.log('重叠交易日 ' + dates.length + '  (' + dates[0] + ' → ' + dates[dates.length - 1] + ')')

  for (const [from, to, name] of segments) {
    const pick = rdates.map((d, i) => i).filter((i) => {
      const y0 = Number(rdates[i].slice(0, 4))
      return y0 >= from && y0 <= to
    })
    if (pick.length < 30) {
      console.log('  ' + name.padEnd(18) + '样本不足 (' + pick.length + ')')
      continue
    }
    const cx = pick.map((i) => rx[i])
    const cy = pick.map((i) => ry[i])
    const c = corr(cx, cy)

    // 偏离度差异
    const dpick = dates.map((d, i) => i).filter((i) => {
      const y0 = Number(dates[i].slice(0, 4))
      return y0 >= from && y0 <= to && !Number.isNaN(d1[i]) && !Number.isNaN(d2[i])
    })
    let meanAbs = NaN, maxAbs = NaN
    if (dpick.length) {
      const diffs = dpick.map((i) => d1[i] - d2[i])
      meanAbs = diffs.reduce((s, v) => s + Math.abs(v), 0) / diffs.length
      maxAbs = Math.max(...diffs.map(Math.abs))
    }
    console.log(
      '  ' + name.padEnd(18) +
        'n=' + String(pick.length).padStart(5) +
        '  日收益相关 ' + c.toFixed(4) +
        '  偏离度差 均值' + meanAbs.toFixed(2) + 'pp 最大' + maxAbs.toFixed(2) + 'pp',
    )
  }
}

report('中证A500 vs 沪深300', a500, hs300, [
  [2005, 2014, '回溯段 A(2005-14)'],
  [2015, 2019, '回溯段 B(2015-19)'],
  [2020, 2024, '回溯段 C(2020-24)'],
  [2025, 2026, '真实段(2025-26)'],
])

report('中证A50 vs 沪深300', a50, hs300, [
  [2015, 2019, '回溯段(2015-19)'],
  [2020, 2023, '回溯段(2020-23)'],
  [2024, 2026, '真实段(2024-26)'],
])

// 附：真实发布日参考
console.log('\n########## 补充：当前 200 日偏离度快照 ##########')
for (const [name, m] of [['沪深300', hs300], ['中证A500', a500]]) {
  const dates = [...m.keys()].sort()
  const v = dates.map((d) => m.get(d))
  const d = dev200(v)
  const last = d[d.length - 1]
  const p = d.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b)
  const rank = p.filter((x) => x <= last).length / p.length
  console.log(
    name.padEnd(10) + dates[dates.length - 1] + '  收盘 ' + v[v.length - 1].toFixed(2) +
      '  dev200 ' + last.toFixed(2) + '%  历史分位 ' + (rank * 100).toFixed(1) + '%',
  )
}
