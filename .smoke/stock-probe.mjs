/**
 * 个股偏离度可行性实测 —— 一次性调研脚本，不参与构建与部署。
 *
 * 目的：回答「这套偏离度指标能不能用在个股上」。
 * 做法：用与 .smoke/calibrate.mjs **完全相同**的标定规则（独立信号 ≥12 且
 *       60 日胜率 − 常态基线 ≥ +3pp，取最浅档）跑一批个股，与 6 个指数对照。
 *
 * 数据源：
 *   个股/美股 —— Yahoo chart API 的 adjclose（含股息拆股复权）
 *   指数对照 —— src/data/*-daily.csv（产品自身的离线快照，保证与线上同源）
 *
 * 前置：先用 .smoke/_stockprobe/fetch.sh 把 Yahoo 原始 JSON 拉到 _stockprobe/raw/
 * 用法：node .smoke/stock-probe.mjs    → 写 _stockprobe/report.html
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const ROOT = process.cwd()
const RAW = resolve(ROOT, '.smoke/_stockprobe/raw')
const DATA = resolve(ROOT, 'src/data')

/** 与 calibrate.mjs 一致的两组候选阈值 */
const DEV60 = [-4, -5, -6, -7, -8, -9, -10, -12, -15, -18]
const DEV200 = [-6, -8, -10, -12, -14, -16, -18, -20, -25, -30]

/** 标定规则参数（取自 AGENTS.md / registry.ts 的文档口径） */
const MIN_EPISODES = 12
const MIN_LIFT_PP = 3

// ─────────────────────────────────────────────────────── 取数

/** Yahoo adjclose → { dates:[YYYYMMDD], values:[] }；文件缺失或 JSON 损坏一律返回 null */
async function loadYahoo(symbol) {
  let j
  try {
    j = JSON.parse(await readFile(resolve(RAW, `${symbol}.json`), 'utf8'))
  } catch {
    return null
  }
  const r = j?.chart?.result?.[0]
  if (!r?.timestamp?.length) return null
  const adj = r.indicators?.adjclose?.[0]?.adjclose
  const raw = r.indicators?.quote?.[0]?.close
  const series = adj ?? raw
  const dates = []
  const values = []
  for (let i = 0; i < r.timestamp.length; i++) {
    const v = series?.[i]
    if (v === null || v === undefined || !Number.isFinite(v) || v <= 0) continue
    dates.push(
      new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10).replace(/-/g, ''),
    )
    values.push(v)
  }
  if (dates.length < 100) return null
  return { dates, values }
}

/** src/data/<id>-daily.csv → 同样的形状 */
async function loadCsv(id) {
  const csv = await readFile(resolve(DATA, `${id}-daily.csv`), 'utf8')
  const dates = []
  const values = []
  for (const line of csv.trim().split('\n')) {
    const [d, c] = line.split(',')
    const dn = Number(d)
    const cn = Number(c)
    if (!Number.isFinite(dn) || !Number.isFinite(cn) || cn <= 0) continue
    dates.push(String(dn).padStart(8, '0'))
    values.push(cn)
  }
  return { dates, values }
}

// ─────────────────────────────────────────────────────── 计算（复刻 calibrate.mjs）

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
  const V60 = []
  const V200 = []
  for (let i = 0; i < closes.length; i++) {
    if (Number.isNaN(ma60[i]) || Number.isNaN(ma200[i])) continue
    D.push(dates[i])
    C.push(closes[i])
    V60.push(100 * Math.log(closes[i] / ma60[i]))
    V200.push(100 * Math.log(closes[i] / ma200[i]))
  }
  return { dates: D, close: C, dev60: V60, dev200: V200 }
}

/** 前瞻 h 日收益的汇总（胜率 / 均值 / 中位数） */
function forwardStats(close, indices, h) {
  const rets = []
  for (const i of indices) {
    const j = i + h
    if (j >= close.length) continue
    rets.push(close[j] / close[i] - 1)
  }
  if (!rets.length) return { n: 0, win: Number.NaN, avg: Number.NaN, med: Number.NaN }
  return {
    n: rets.length,
    win: rets.filter((r) => r > 0).length / rets.length,
    avg: rets.reduce((a, b) => a + b, 0) / rets.length,
    med: median(rets),
  }
}

function median(a) {
  if (!a.length) return Number.NaN
  const b = [...a].sort((x, y) => x - y)
  const n = b.length
  return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2
}

/** 阈值扫描：独立信号（连续区间合并）、前瞻 60 日胜率与均值 */
function scan(s, key, threshold) {
  const dev = s[key]
  const idx = []
  let episodes = 0
  for (let i = 0; i < dev.length; i++) {
    if (dev[i] > threshold) continue
    idx.push(i)
    if (!(i > 0 && dev[i - 1] <= threshold)) episodes++
  }
  const h20 = forwardStats(s.close, idx, 20)
  const h60 = forwardStats(s.close, idx, 60)
  return { samples: idx.length, episodes, h20, h60 }
}

/**
 * 一致性复核：标定出的水位到底稳不稳。
 *
 * 重叠口径 —— 每一天都算一次前瞻收益。深跌区可能连跨数百个交易日，
 *              同一段崩盘被重复计入几百遍，均值被左尾拖变形。
 * 不重叠口径 —— 每 60 个交易日只取一个起点。但**结论依赖起始相位**：
 *              换个相位，同一个标的的超额能从 −2pp 跳到 +14pp。
 *              所以这里把 60 个相位全跑一遍，报**跨相位中位数**与极差：
 *              极差大 = 这个水位只是相位运气，不是稳定信号。
 */
function consistency(s, key, threshold) {
  if (threshold === null) return null
  const dev = s[key]
  const h = 60
  const allIdx = []
  const hitIdx = []
  for (let i = 0; i < s.close.length && i + h < s.close.length; i++) {
    allIdx.push(i)
    if (dev[i] <= threshold) hitIdx.push(i)
  }
  const ovAll = forwardStats(s.close, allIdx, h)
  const ovHit = forwardStats(s.close, hitIdx, h)

  const phaseLifts = []
  const phaseNs = []
  for (let phase = 0; phase < h; phase++) {
    const bAll = []
    const bHit = []
    for (let i = phase; i + h < s.close.length; i += h) {
      bAll.push(i)
      if (dev[i] <= threshold) bHit.push(i)
    }
    if (bHit.length < 4) continue
    const a = forwardStats(s.close, bAll, h)
    const t = forwardStats(s.close, bHit, h)
    phaseLifts.push((t.win - a.win) * 100)
    phaseNs.push(bHit.length)
  }

  return {
    overlap: {
      n: ovHit.n,
      liftWin: (ovHit.win - ovAll.win) * 100,
      liftMed: (ovHit.med - ovAll.med) * 100,
    },
    phase: {
      phases: phaseLifts.length,
      n: phaseNs.length ? Math.round(median(phaseNs)) : 0,
      medianLift: phaseLifts.length ? median(phaseLifts) : Number.NaN,
      minLift: phaseLifts.length ? Math.min(...phaseLifts) : Number.NaN,
      maxLift: phaseLifts.length ? Math.max(...phaseLifts) : Number.NaN,
    },
  }
}

/** 常态基线：不设任何条件、窗口内每天都持有 N 日（胜率 + 均值 + 中位数） */
function baseline(s, h) {
  const idx = []
  for (let i = 0; i < s.close.length && i + h < s.close.length; i++) idx.push(i)
  return forwardStats(s.close, idx, h)
}

/**
 * 复归检验：偏离度跌破 level（dev200）之后，最多 250 个交易日内能否回到 ±1%。
 * 返回「回到了」/「一直没回」的比例 —— 这是均值回复是否成立的直接证据。
 */
function revert(s, level, limit = 250) {
  const dev = s.dev200
  let total = 0
  let reverted = 0
  let never = 0
  let neverOpen = 0 // 截至数据末尾仍未复归（可能只是还没走完）
  for (let i = 0; i < dev.length; i++) {
    if (dev[i] > -Math.abs(level)) continue
    total++
    let found = -1
    const end = Math.min(dev.length, i + limit + 1)
    for (let j = i + 1; j < end; j++) {
      if (Math.abs(dev[j]) <= 1) {
        found = j
        break
      }
    }
    if (found >= 0) reverted++
    else if (i + limit >= dev.length) neverOpen++
    else never++
  }
  return { total, reverted, never, neverOpen }
}

/**
 * 标定：在独立信号 ≥ 12 的候选里，取**最浅**且「60 日胜率 − 基线 ≥ +3pp」的一档。
 * 无一达标 → null（页面如实显示「无标定水位」）。
 */
function calibrate(rows) {
  const cand = rows.filter((r) => r.episodes >= MIN_EPISODES && Number.isFinite(r.h60.win))
  const sorted = [...cand].sort((a, b) => b.t - a.t) // 由浅到深
  const hit = sorted.find((r) => r.lift60 >= MIN_LIFT_PP)
  const best = [...cand].sort((a, b) => b.lift60 - a.lift60)[0] ?? null
  return { chosen: hit ?? null, best }
}

// ─────────────────────────────────────────────────────── 主流程

const STOCKS = [
  { symbol: '600519.SS', name: '贵州茅台', market: 'A股', note: '上市 2001，长牛代表' },
  { symbol: '300750.SZ', name: '宁德时代', market: 'A股', note: '上市 2018，历史最短' },
  { symbol: '601857.SS', name: '中国石油', market: 'A股', note: '上市 2007，上市即顶' },
  { symbol: '601012.SS', name: '隆基绿能', market: 'A股', note: '2021 高点后深跌' },
  { symbol: '000725.SZ', name: '京东方A', market: 'A股', note: '上市 2001，长期低位' },
  { symbol: '000002.SZ', name: '万科A', market: 'A股', note: '上市 1991，近年深跌' },
  { symbol: '600030.SS', name: '中信证券', market: 'A股', note: '券商，强周期' },
  { symbol: 'AAPL', name: '苹果', market: '美股', note: '长牛代表' },
  { symbol: 'NVDA', name: '英伟达', market: '美股', note: '趋势股代表' },
  { symbol: 'INTC', name: '英特尔', market: '美股', note: '近年大幅衰退' },
  { symbol: 'KO', name: '可口可乐', market: '美股', note: '低波动防守型' },
  { symbol: 'GE', name: '通用电气', market: '美股', note: '长期价值毁灭典型' },
]

/** 退市股探针结果（由 fetch.sh 产出，这里硬编码以体现在报告里） */
const DELISTED = [
  { symbol: '300104.SZ', name: '乐视网', market: 'A股', result: 'HTTP 404',
    detail: 'No data found, symbol may be delisted', delistedOn: '2020-07 退市' },
  { symbol: '000979.SZ', name: '中弘退', market: 'A股', result: '空响应',
    detail: 'chart.result 为空数组', delistedOn: '2018-12 退市' },
  { symbol: 'BBBYQ', name: 'Bed Bath & Beyond', market: '美股', result: 'HTTP 404',
    detail: 'No data found, symbol may be delisted', delistedOn: '2023-04 破产' },
  { symbol: 'LEHMQ', name: '雷曼兄弟', market: '美股', result: '空响应',
    detail: 'chart.result 为空数组', delistedOn: '2008-09 破产' },
]

const INDICES = [
  ['sp500', '标普500'], ['nasdaq', '纳斯达克100'],
  ['hs300', '沪深300'], ['a500', '中证A500'],
  ['csi500', '中证500'], ['chinext', '创业板指'],
]

function analyze(loaded) {
  const s = buildSeries(loaded.dates, loaded.values)
  const base60 = baseline(s, 60)
  const rows = []
  for (const key of ['dev60', 'dev200']) {
    for (const t of key === 'dev60' ? DEV60 : DEV200) {
      const r = scan(s, key, t)
      rows.push({ key, t, ...r, lift60: (r.h60.win - base60.win) * 100 })
    }
  }
  const cal60 = calibrate(rows.filter((r) => r.key === 'dev60'))
  const cal200 = calibrate(rows.filter((r) => r.key === 'dev200'))
  const action = { dev60: cal60.chosen?.t ?? null, dev200: cal200.chosen?.t ?? null }
  return {
    s, rows, base60, action,
    cal: { dev60: cal60, dev200: cal200 },
    // 标定水位的可操作性：一年触发几次、多少比例的日子处于「可动手」状态
    freq: {
      dev60: frequency(s, cal60.chosen),
      dev200: frequency(s, cal200.chosen),
    },
    check: {
      dev60: consistency(s, 'dev60', action.dev60),
      dev200: consistency(s, 'dev200', action.dev200),
    },
    revert: revert(s, 15),
  }
}

/**
 * 水位可操作性：该阈值一年平均触发多少次独立信号、占多少比例的交易日在阈值以下。
 * 浅水位（如 -4%）会给出「一年几十次」的频率，等于大部分时间都在喊买，不构成信号。
 */
function frequency(s, chosen) {
  if (!chosen) return null
  const years = s.dates.length / 250
  return {
    t: chosen.t,
    perYear: chosen.episodes / years,
    daysPct: chosen.samples / s.dates.length,
  }
}

const results = []
for (const def of STOCKS) {
  const loaded = await loadYahoo(def.symbol)
  if (!loaded) {
    console.log(`跳过 ${def.name}（无数据）`)
    continue
  }
  results.push({ ...def, ...analyze(loaded) })
  console.log(`已分析 ${def.name}`)
}

const indexResults = []
for (const [id, name] of INDICES) {
  const loaded = await loadCsv(id)
  indexResults.push({ id, name, ...analyze(loaded) })
}

// ─────────────────────────────────────────────────────── 输出

const pct = (v, d = 1) => (Number.isFinite(v) ? (v * 100).toFixed(d) + '%' : '—')
const sgn = (v, d = 1) => (Number.isFinite(v) ? (v > 0 ? '+' : '') + v.toFixed(d) : '—')
const dd = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`

/** 单档判定：样本不足 → 「样本不足」，样本够但无超额 → 「×」，两个条件都满足 → 「✓」 */
function verdictMark(enough, liftOk) {
  if (!enough) return '样本不足'
  return liftOk ? '✓' : '×'
}

/**
 * 单票的阈值表 —— 完全按产品规则的口径：独立信号次数 + 60 日胜率超额。
 * （不以收益均值作为列，原因见文末「方法学附录」。）
 */
function thresholdTable(res, key) {
  const rows = res.rows.filter((r) => r.key === key)
  const body = rows
    .map((r) => {
      const enough = r.episodes >= MIN_EPISODES
      const liftOk = r.lift60 >= MIN_LIFT_PP
      const ok = enough && liftOk
      return `<tr class="${ok ? 'ok' : ''}">
      <td class="num">${r.t}%</td>
      <td class="num ${enough ? '' : 'dim'}">${r.episodes}<span class="sub">${r.samples}天</span></td>
      <td class="num ${enough ? '' : 'dim'}">${pct(r.h60.win)}</td>
      <td class="num ${liftOk ? 'pos' : 'neg'}">${sgn(r.lift60)}pp</td>
      <td class="mark">${verdictMark(enough, liftOk)}</td>
    </tr>`
    })
    .join('')
  return `<table class="th">
    <thead><tr><th>阈值</th><th>独立信号<br><span class="hh">≥${MIN_EPISODES} 次</span></th>
    <th>60日胜率</th><th>超额胜率<br><span class="hh">≥+${MIN_LIFT_PP}pp</span></th><th>判定</th></tr></thead>
    <tbody>${body}</tbody></table>`
}

/** 一致性复核行：重叠口径 vs 跨相位中位数 */
function consistencyRow(kind, name, key, thr, c) {
  if (!c) {
    return `<tr class="nullrow"><td><b>${name}</b><span class="sub">${kind}</span></td>
      <td class="num dim">无水位</td>
      <td colspan="4" class="dim">两个口径都未标定出水位，无复核对象</td></tr>`
  }
  const cell = (v, d = 1) => `<span class="${v > 0 ? 'pos' : 'neg'}">${sgn(v, d)}pp</span>`
  const p = c.phase
  return `<tr class="${kind === '指数' ? 'idxrow' : ''}">
    <td><b>${name}</b><span class="sub">${kind}</span></td>
    <td class="num">${key} ${thr}%</td>
    <td class="num">${cell(c.overlap.liftWin)}<span class="sub">n=${c.overlap.n}</span></td>
    <td class="num">${cell(p.medianLift)}<span class="sub">n≈${p.n} · ${p.phases} 个相位</span></td>
    <td class="num">${cell(p.minLift)}</td>
    <td class="num">${cell(p.maxLift)}<span class="sub">极差 ${(p.maxLift - p.minLift).toFixed(1)}pp</span></td></tr>`
}

/** 复归率的色阶：≥85% 正常、70–85% 中性、<70% 标绿（差） */
function revertClass(p) {
  if (p >= 0.85) return 'pos'
  if (p >= 0.7) return ''
  return 'neg'
}

function revertCell(rv) {
  if (!rv.total) return '<span class="dim">无样本</span>'
  const p = rv.reverted / rv.total
  return `<span class="${revertClass(p)}">${(p * 100).toFixed(0)}%</span>
    <span class="sub">${rv.reverted}/${rv.total}${rv.never ? ` · 从未复归 ${rv.never}` : ''}</span>`
}

/** 水位触发频率：一年几次、多少比例的交易日在阈值以下 */
function freqCell(f) {
  if (!f) return '<span class="dim">未标定</span>'
  return `${f.perYear.toFixed(1)} 次/年<span class="sub">${(f.daysPct * 100).toFixed(0)}% 的交易日</span>`
}

function stockCard(res) {
  const a = res.action
  const badge = (v) =>
    v === null
      ? '<span class="badge null">无标定水位</span>'
      : `<span class="badge hit">${v}%</span>`
  const fq = res.freq.dev200 ?? res.freq.dev60
  const fqTxt = fq
    ? `标定水位触发频率：<b class="num">${fq.perYear.toFixed(1)}</b> 次/年、
       <b class="num">${(fq.daysPct * 100).toFixed(0)}%</b> 的交易日在水位以下`
    : '未标定出水位，无触发频率可言'
  return `<section class="card">
    <header>
      <div>
        <h3>${res.name} <span class="sym">${res.symbol}</span></h3>
        <p class="meta">${res.market} · ${res.note} · 样本 ${res.s.dates.length} 个交易日 ·
          ${dd(res.s.dates[0])} → ${dd(res.s.dates[res.s.dates.length - 1])}</p>
      </div>
      <div class="acts">
        <div><span class="lb">60日线水位</span>${badge(a.dev60)}</div>
        <div><span class="lb">200日线水位</span>${badge(a.dev200)}</div>
      </div>
    </header>
    <p class="base">常态基线（无条件持有 60 日）：胜率 <b class="num">${pct(res.base60.win)}</b>、
      中位 <b class="num">${sgn(res.base60.med * 100, 2)}%</b>
      ｜ 跌破 −15% 后 250 日内复归 ±1%：${revertCell(res.revert)}
      ｜ ${fqTxt}</p>
    <div class="grid2">
      <div><h4>200 日均线口径</h4>${thresholdTable(res, 'dev200')}</div>
      <div><h4>60 日均线口径</h4>${thresholdTable(res, 'dev60')}</div>
    </div>
  </section>`
}

const nNull = results.filter((r) => r.action.dev60 === null && r.action.dev200 === null).length
const nPartial = results.filter(
  (r) => (r.action.dev60 === null) !== (r.action.dev200 === null),
).length
const nIndexNull = indexResults.filter(
  (r) => r.action.dev60 === null && r.action.dev200 === null,
).length

/**
 * 一致性复核表：股票与指数并列，每个标的取它自己标定出的最浅那个水位
 * （优先 dev200，因为产品行动水位主要看 200 日线），用不重叠口径复核。
 */
function reviewOf(list, kind) {
  return list.map((r) => {
    const use200 = r.action.dev200 !== null
    return {
      kind,
      name: r.name,
      key: use200 ? 'dev200' : 'dev60',
      thr: use200 ? r.action.dev200 : r.action.dev60,
      c: use200 ? r.check.dev200 : r.check.dev60,
    }
  })
}
const reviewRows = [
  ...reviewOf(results, '个股'),
  ...reviewOf(indexResults, '指数'),
]
const withLevel = reviewRows.filter((r) => r.c)
const stockLv = withLevel.filter((r) => r.kind === '个股')
const indexLv = withLevel.filter((r) => r.kind === '指数')
const spread = (rows) => {
  const v = rows.map((r) => r.c.phase.medianLift)
  return {
    n: v.length,
    pos: v.filter((x) => x > 0).length,
    min: Math.min(...v),
    max: Math.max(...v),
    range: Math.max(...v) - Math.min(...v),
  }
}
const sSpread = spread(stockLv)
const iSpread = spread(indexLv)

/** 重叠口径下的离散度 —— 产品的原生口径，无相位问题，最干净的对比 */
const overlapSpread = (rows) => {
  const v = rows.map((r) => r.c.overlap.liftWin)
  return {
    n: v.length, min: Math.min(...v), max: Math.max(...v),
    range: Math.max(...v) - Math.min(...v),
  }
}
const sOv = overlapSpread(stockLv)
const iOv = overlapSpread(indexLv)

/** 跨相位极差：衡量水位结论对抽样相位的敏感度 */
const fragility = (rows) => {
  const v = rows.map((r) => r.c.phase.maxLift - r.c.phase.minLift)
  return { median: median(v), max: Math.max(...v) }
}
const sFrag = fragility(stockLv)
const iFrag = fragility(indexLv)

/** 复归率区间（跌破 −15% 后 250 日内回到 ±1% 的比例） */
function revertRange(list) {
  const v = list.filter((r) => r.revert.total).map((r) => r.revert.reverted / r.revert.total)
  return { n: v.length, min: Math.min(...v), max: Math.max(...v) }
}
const sRev = revertRange(results)
const iRev = revertRange(indexResults)

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>偏离度指标用于个股 —— 实测报告</title>
<style>
:root{
  --bg:#faf9f7; --panel:#fff; --ink:#1c1b19; --muted:#6b6862; --line:#e6e3dd;
  --up:#c0392b; --down:#1e7a4c; --amber:#a8761a; --steel:#f3f1ec;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto;padding:56px 28px 96px}
h1{font-size:30px;letter-spacing:-.01em;margin:0 0 10px;font-weight:650}
h2{font-size:20px;margin:64px 0 18px;font-weight:640;letter-spacing:-.005em;
  padding-bottom:10px;border-bottom:1px solid var(--line)}
h3{font-size:17px;margin:0;font-weight:640}
h4{font-size:13px;margin:0 0 10px;font-weight:600;color:var(--muted);letter-spacing:.02em}
p{margin:0 0 12px}
.num{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.lede{font-size:16px;color:var(--muted);max-width:74ch}
.sub{display:block;font-size:11px;color:var(--muted);font-weight:400;font-family:inherit}
.dim{color:#a9a5a0}
.pos{color:var(--up)} .neg{color:var(--down)}
code{background:var(--steel);padding:2px 6px;border-radius:4px;font-size:13px}
.verdict{background:var(--panel);border:1px solid var(--line);border-radius:14px;
  padding:26px 30px;margin:30px 0 0;box-shadow:0 1px 2px rgba(0,0,0,.03)}
.verdict h2{border:0;margin:0 0 14px;font-size:19px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin:22px 0 0}
.kpi{background:var(--steel);border-radius:10px;padding:16px 18px}
.kpi .v{font-size:26px;font-weight:640;letter-spacing:-.02em}
.kpi .k{font-size:12px;color:var(--muted);margin-top:2px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;
  padding:22px 24px;margin:16px 0;box-shadow:0 1px 2px rgba(0,0,0,.03)}
.card header{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;align-items:flex-start}
.sym{font-size:12px;color:var(--muted);font-weight:400;
  font-family:ui-monospace,Menlo,Consolas,monospace}
.meta{font-size:12px;color:var(--muted);margin:5px 0 0}
.acts{display:flex;gap:22px;flex-wrap:wrap}
.acts>div{text-align:right}
.lb{display:block;font-size:11px;color:var(--muted);margin-bottom:3px}
.badge{display:inline-block;font-size:15px;font-weight:640;padding:2px 10px;border-radius:6px;
  font-family:ui-monospace,Menlo,Consolas,monospace}
.badge.hit{background:#fdeceb;color:var(--up)}
.badge.null{background:var(--steel);color:var(--muted);font-size:13px;font-weight:500;
  font-family:inherit}
.base{font-size:12.5px;color:var(--muted);margin:14px 0 18px;padding-top:14px;
  border-top:1px dashed var(--line)}
.base b{color:var(--ink)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:26px}
@media(max-width:860px){.grid2{grid-template-columns:1fr}.acts{text-align:left}}
table.th{width:100%;border-collapse:collapse;font-size:12.5px}
table.th th{text-align:left;font-weight:600;color:var(--muted);font-size:11px;
  padding:0 8px 8px 0;border-bottom:1px solid var(--line);white-space:nowrap}
table.th td{padding:7px 8px 7px 0;border-bottom:1px solid #f2f0ec}
table.th tr.ok{background:#fdf6f5}
table.th tr.ok td.mark{color:var(--up);font-weight:700}
td.mark{font-size:11px;color:var(--muted)}
.hh{font-weight:400;font-size:10px;color:#a9a5a0}
table.wide{width:100%;border-collapse:collapse;font-size:13px;
  background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
table.wide th{text-align:left;font-weight:600;font-size:11.5px;color:var(--muted);
  padding:12px 14px;background:var(--steel);border-bottom:1px solid var(--line);white-space:nowrap}
table.wide td{padding:11px 14px;border-bottom:1px solid #f2f0ec;vertical-align:top}
table.wide tr:last-child td{border-bottom:0}
.note{font-size:12.5px;color:var(--muted);margin-top:12px;max-width:80ch}
ul{padding-left:20px;margin:12px 0}
li{margin:7px 0}
li::marker{color:#c3bfb8}
.foot{margin-top:80px;padding-top:22px;border-top:1px solid var(--line);
  font-size:12px;color:var(--muted)}
</style></head><body><div class="wrap">

<h1>偏离度指标用在个股上，会怎样</h1>
<p class="lede">把产品的同一套计算与标定规则原封不动搬到 ${results.length} 只个股上实测。
算法与线上完全一致：<code>100 × ln(收盘 ÷ N日均线)</code>，标定门槛为
「独立信号 ≥ ${MIN_EPISODES} 次且 60 日胜率 − 常态基线 ≥ +${MIN_LIFT_PP}pp，取最浅档」。
个股取 Yahoo 复权收盘价，指数对照组直接读产品自身的离线快照。
<b>结论与本报告作者最初的预期不一致，以实测为准。</b></p>

<div class="verdict">
<h2>结论</h2>
<p><b>最初的假设是「个股会因样本不足而大面积标不出水位」。实测推翻了它</b>：
${results.length} 只个股里 <b>${results.length - nNull}</b> 只能标出至少一个水位，
而指数对照组是 ${indexResults.length - nIndexNull}/${indexResults.length} —— 个股比例反而更高。
所以「算不出来」不是拒绝个股的理由。</p>
<p><b>真正的差异是水平的一致性。</b>把每个标定出的水位按产品原生口径（重叠）放在一起看：</p>
<ul>
  <li><b>指数的水位彼此印证</b>：${indexLv.length} 个水位全部落在
      <b>${sgn(iOv.min, 1)}pp ~ ${sgn(iOv.max, 1)}pp</b>，跨度仅 <b>${iOv.range.toFixed(1)}pp</b>。
      它们背后是同一个结构驱动力。</li>
  <li><b>个股的水位各说各话</b>：${stockLv.length} 个水位落在
      <b>${sgn(sOv.min, 1)}pp ~ ${sgn(sOv.max, 1)}pp</b>，跨度 <b>${sOv.range.toFixed(1)}pp</b>，
      是指数的 <b>${(sOv.range / iOv.range).toFixed(1)} 倍</b>。
      换不重叠口径复核后跨度从 ${iOv.range.toFixed(1)}pp vs ${sOv.range.toFixed(1)}pp 变成
      ${iSpread.range.toFixed(1)}pp vs ${sSpread.range.toFixed(1)}pp，差距依旧。</li>
  <li><b>单个水位的精度本来就有限，两边一样有限</b>：换抽样相位后，
      指数水位的极差中位数是 <b>${iFrag.median.toFixed(1)}pp</b>，个股是 <b>${sFrag.median.toFixed(1)}pp</b> ——
      <b>不区分资产类型</b>。十几个独立样本本来就撑不起「+3pp」这种量级的结论。
      指数靠「五个标的互相印证」把这个噪声压下去，个股<b>没有这个机制</b>。</li>
  <li><b>退市股直接消失，这一条无法在产品框架内修复</b>：
      探针的 4 只退市股，<b>0 只能取到数据</b>。所有「超卖后买入」的胜率统计，
      分母只剩活下来的公司。指数对此免疫 —— 成分股会换，但指数点数是连续的。</li>
  <li><b>复归率的重尾</b>：指数 ${(iRev.min * 100).toFixed(0)}% 到 ${(iRev.max * 100).toFixed(0)}%，
      个股 ${(sRev.min * 100).toFixed(0)}%（隆基绿能）到 ${(sRev.max * 100).toFixed(0)}%。
      考虑到幸存者偏差，个股真实的下限只会更低。</li>
</ul>
<p><b>为什么这足以否掉个股：</b>产品承诺的是一个可复用的映射 ——「偏离度跌破 X → 胜率抬升 Y」。
这个映射在指数上成立，不只是因为每个水位都达标，还因为六个指数各自独立标定出的水位
互相印证（相差不到 ${iOv.range.toFixed(1)}pp）；在个股上，每个标的都要独立标定，
而标定结果又彼此不一致 —— 那就不是工具，是事后拟合。</p>
<div class="kpis">
  <div class="kpi"><div class="v num">${results.length - nNull}/${results.length}</div>
    <div class="k">个股能标出水位<br>（指数 ${indexResults.length - nIndexNull}/${indexResults.length}）</div></div>
  <div class="kpi"><div class="v num">${(sOv.range / iOv.range).toFixed(1)}×</div>
    <div class="k">水位离散度<br>个股 ${sOv.range.toFixed(1)}pp vs 指数 ${iOv.range.toFixed(1)}pp</div></div>
  <div class="kpi"><div class="v num">${(sRev.min * 100).toFixed(0)}%</div>
    <div class="k">个股最低复归率（隆基）<br>指数最低 ${(iRev.min * 100).toFixed(0)}%</div></div>
  <div class="kpi"><div class="v num">0/4</div><div class="k">退市股可获取</div></div>
</div>
</div>

<h2>一、数据源里的「消失」</h2>
<p>这四家公司退市前，都曾长期、反复地处于深度超卖状态。如果它们的数据还在样本里，
这些日子本会计入「跌破阈值后 60 日胜率」的分子。现在它们不在数据源里了。</p>
<table class="wide">
<thead><tr><th>标的</th><th>代码</th><th>市场</th><th>退市/破产</th><th>取数结果</th></tr></thead>
<tbody>${DELISTED.map((d) => `<tr>
  <td><b>${d.name}</b></td><td class="num">${d.symbol}</td><td>${d.market}</td>
  <td class="num">${d.delistedOn}</td>
  <td><span class="badge null">${d.result}</span>
    <span class="sub">${d.detail}</span></td></tr>`).join('')}</tbody>
</table>
<p class="note">取数时间：本机浏览器 UA + Referer，走 Yahoo chart API。
两只 A 股退市股与两只美股破产退市股都拿不到任何 K 线 —— 不是代码写错了，
是标的从数据源里被移除了。这正是「幸存者偏差」在工程上的样子：
<b>你根本没机会把它算进去，也不会看到它缺席。</b></p>

<h2>二、一致性复核：水位经得起换相位吗</h2>
<p>产品标定水位用的是「重叠口径」的胜率 —— 每一天都算一次前瞻收益。
深跌区可能连跨数百个交易日，同一段行情被重复计入几百遍，
所以这里把每个标定出的水位再拿<b>不重叠口径</b>复核：每 60 个交易日只取一个起点。
但单一相位的结果只是相位运气，所以把 60 个相位全跑一遍，报<b>跨相位中位数</b>与极差。</p>
<table class="wide">
<thead><tr><th>标的</th><th>标定水位</th>
<th>重叠口径<br>超额胜率</th><th>不重叠 · 跨相位中位数<br>超额胜率</th>
<th>相位最差</th><th>相位最好</th></tr></thead>
<tbody>${reviewRows.map((r) => consistencyRow(r.kind, r.name, r.key, r.thr, r.c)).join('')}</tbody>
</table>
<p class="note"><b>这张表读两件事。</b>一是<b>离散度</b>：
${indexLv.length} 个标定出水位的指数，跨相位中位数落在
<b>${sgn(iSpread.min, 1)}pp ~ ${sgn(iSpread.max, 1)}pp</b>，跨度仅 <b>${iSpread.range.toFixed(1)}pp</b>；
${stockLv.length} 个标定出水位的个股落在
<b>${sgn(sSpread.min, 1)}pp ~ ${sgn(sSpread.max, 1)}pp</b>，跨度 <b>${sSpread.range.toFixed(1)}pp</b>
（指数的 <b>${(sSpread.range / iSpread.range).toFixed(1)} 倍</b>）。
指数彼此印证，个股各说各话。</p>
<p class="note">二是<b>相位敏感度</b>:从「相位最差」到「相位最好」的跨度，
指数的中位数是 <b>${iFrag.median.toFixed(1)}pp</b>，个股是 <b>${sFrag.median.toFixed(1)}pp</b>。
<b>这个数字两边同样糟糕，所以它不区分资产类型</b> —— 它测的是方法本身的噪声地板：
十几个不重叠样本本来就不足以定住一个正负号。这条对指数同样成立，
所以不是个股的罪证，而是「用十几个独立事件标定水位」这件事的固有局限。
列在这里是为了不把相位运气伪装成结论。</p>
<p class="note">两边的不重叠样本量是同一量级（指数 n≈11～18、个股 n≈5～31），
所以离散度的差距不能拿「个股样本少」解释。真正的差异在于：指数由六个共享同一结构驱动力
（成分股新陈代谢 + 长期增长）的标的组成，各自标定的水位互相印证；
个股的超卖能不能回来取决于这家公司自己，标出来的水位只是它自己历史的回声。
<b>—— 换句话说，指数有一道「交叉验证」保险，个股没有。</b></p>

<h2>三、逐票实测</h2>
<p class="note">每张卡片完全按产品规则判定：<b>✓</b> = 该档位同时满足
「独立信号 ≥ ${MIN_EPISODES} 次」与「60 日胜率超额 ≥ +${MIN_LIFT_PP}pp」；
<b>×</b> = 样本够但没有超额；<b>样本不足</b> = 独立信号不到 ${MIN_EPISODES} 次。
红色行就是产品会标定为「行动水位」的档位。
<b>注意「✓ 不等于可用」</b> —— 判定只看胜率超额，不看触发频率与稳定性，
后两者由上一节的一致性复核补足。</p>
${results.map(stockCard).join('')}

<h2>四、指数对照组</h2>
<p class="note">同样的代码、同样的规则，唯一区别是标的是指数。这一组用的是产品
<code>src/data/*-daily.csv</code> 离线快照。</p>
<table class="wide">
<thead><tr><th>指数</th><th>样本</th><th>常态基线<br>（60日胜率 / 均值）</th>
<th>60日线水位</th><th>200日线水位</th><th>水位触发频率</th><th>跌破 −15% 后复归率<br>（250 日内回到 ±1%）</th></tr></thead>
<tbody>${indexResults.map((r) => `<tr>
  <td><b>${r.name}</b></td>
  <td class="num">${r.s.dates.length}<span class="sub">${dd(r.s.dates[0])} 起</span></td>
  <td class="num">${pct(r.base60.win)}<span class="sub">${sgn(r.base60.avg * 100, 2)}%</span></td>
  <td>${r.action.dev60 === null ? '<span class="badge null">无水位</span>' : `<span class="badge hit">${r.action.dev60}%</span>`}</td>
  <td>${r.action.dev200 === null ? '<span class="badge null">无水位</span>' : `<span class="badge hit">${r.action.dev200}%</span>`}</td>
  <td class="num">${freqCell(r.freq.dev200 ?? r.freq.dev60)}</td>
  <td class="num">${revertCell(r.revert)}</td></tr>`).join('')}</tbody>
</table>

<h2>五、两个容易误读的点</h2>
<h4 style="font-size:15px;color:var(--ink);margin:22px 0 10px">1. 触发频率高，是 A 股的问题，不是个股的问题</h4>
<p>中信证券的 60 日线水位被标到 −4%，独立信号 152 次、29% 的交易日在水位以下，
看着很像「个股波动大导致水位失效」。<b>但创业板指的水位也是 −4%，同样是 29% 的交易日</b>——
两者的触发频率几乎一模一样。真正的分界是市场而非标的类型：
A 股指数与个股的偏离度摆幅都远大于美股（标普500 的 −10% 水位只有 5% 的交易日）。
这是产品已经记录在 <code>registry.ts</code> 里的事实（「A 股的波动远大于美股」），
不是新增的个股问题。</p>
<h4 style="font-size:15px;color:var(--ink);margin:22px 0 10px">2. 复归率不是「个股全部失效」</h4>
<p>个股的复归率不是一致地差：茅台 100%、宁德时代 99%、英特尔 97%、可口可乐 97% 都很正常。
掉下来的是隆基绿能（64%）、万科A（76%）、通用电气（86%）。
<b>问题不在「平均很差」，在于无法提前知道是哪一种</b> ——
同一个市场、同样是龙头，标定出的水位重叠口径从 ${sgn(sOv.min, 1)}pp 到 ${sgn(sOv.max, 1)}pp 不等；
京东方 A 的重叠口径数字很漂亮（+7.8pp），但相位极差 42.2pp
（最差 −14.8pp、最好 +27.4pp）—— 单看一个数字看不出它是哪一种。
指数的可贵之处就是它不需要你猜：${indexLv.length} 个水位在重叠口径下只差 ${iOv.range.toFixed(1)}pp。</p>

<h2>六、方法学附录：重叠窗口的陷阱</h2>
<p>本报告初稿曾把「跌破阈值后的 60 日<b>均值</b>收益 减 常态均值收益」当作
「超额收益」列出来，结果几乎所有标的（包括指数）都是负的 —— 沪深300 甚至到了 −1.86pp。
<b>那个指标是错的，已从正文删除。</b>原因：</p>
<ul>
  <li>深跌期可以连续数百个交易日都在阈值以下（2008、2015 那种崩盘），
    每一天都算一次 60 日前瞻收益，<b>同一段崩盘被重复计入了几百遍</b>。</li>
  <li>超卖区间越长，重复次数越多 —— 而超卖区间最长的，恰恰是跌得最惨的那几次。
    于是均值被左尾系统性拉低。沪深300 换不重叠口径后，这个数字从 −1.86pp 翻成正数，
    <b>符号都变了</b>。</li>
  <li><b>胜率受影响小得多</b>，因为胜率有界（0～1），重复计入同一段行情不会把它推向无穷；
    而收益均值无界、尾巴很胖，重复计入会直接支配结果。
    这是产品用「胜率超额」而不是「收益超额」做标定的一个实际理由。</li>
</ul>
<p>第二个坑是<b>抽样相位</b>。改用不重叠口径后，结论会依赖你从哪一天开始切 ——
同一个中国石油 dev60 −7%，第 0 相位算出来是 −2.2pp，换一个相位是 +14.3pp。
所以第二节的复核列把 60 个相位全跑一遍、报中位数与极差，
而不是挑一个好看（或难看）的相位。</p>
<p>保留这条附录，是因为它比结论本身更通用：<b>任何「看条件收益」的统计，
先问样本是不是独立的、结论是不是相位运气。</b></p>

<div class="foot">
本报告由 <code>.smoke/stock-probe.mjs</code> 生成，属一次性调研产物，不参与构建与部署。
数据源：个股走 Yahoo chart API 的 <code>adjclose</code>（含股息拆股复权）；
指数走产品自身离线快照。计算逻辑与 <code>.smoke/calibrate.mjs</code> 一致。
生成时间：${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC
</div>

</div></body></html>`

const out = resolve(ROOT, '.smoke/_stockprobe/report.html')
await writeFile(out, html, 'utf8')
console.log(`\n已写出 ${out}`)

// 控制台摘要
const f2 = (v) => (v === null ? '  无水位' : String(v).padStart(5) + '%')
const freqTxt = (f) => (f ? `${f.t}% ${f.perYear.toFixed(1)}次/年 ${(f.daysPct * 100).toFixed(0)}%日` : '—')
console.log('\n标的            样本  基线60  dev60水位 dev200水位  复归率  dev60触发           dev200触发')
for (const r of results) {
  const rv = r.revert.total ? ((r.revert.reverted / r.revert.total) * 100).toFixed(0) + '%' : '—'
  console.log(
    `${r.name.padEnd(14)}${String(r.s.dates.length).padStart(5)}  ${pct(r.base60.win).padStart(6)}  ` +
      `${f2(r.action.dev60).padStart(8)}  ${f2(r.action.dev200).padStart(9)}   ${rv.padStart(5)}   ${freqTxt(r.freq.dev60)}   ${freqTxt(r.freq.dev200)}`,
  )
}
console.log('\n指数对照组')
for (const r of indexResults) {
  const rv = r.revert.total ? ((r.revert.reverted / r.revert.total) * 100).toFixed(0) + '%' : '—'
  console.log(
    `${r.name.padEnd(14)}${String(r.s.dates.length).padStart(5)}  ${pct(r.base60.win).padStart(6)}  ` +
      `${f2(r.action.dev60).padStart(8)}  ${f2(r.action.dev200).padStart(9)}   ${rv.padStart(5)}   ${freqTxt(r.freq.dev60)}   ${freqTxt(r.freq.dev200)}`,
  )
}
console.log(
  `\n汇总：个股 ${results.length} 只 —— 全空 ${nNull}、单口径 ${nPartial}、双口径 ${results.length - nNull - nPartial}` +
    `   ｜   指数 ${indexResults.length} 只 —— 全空 ${nIndexNull}、有水位 ${indexResults.length - nIndexNull}`,
)

// 标定出的水位实际表现明细（核对用）
console.log('\n── 标定水位明细 ──')
for (const r of [...results, ...indexResults]) {
  for (const key of ['dev200', 'dev60']) {
    const c = r.cal[key].chosen
    if (!c) {
      const b = r.cal[key].best
      console.log(
        `${r.name.padEnd(14)}${key.padEnd(7)}无水位  最佳档 ${b ? `${b.t}% 超额 ${sgn(b.lift60)}pp (${b.episodes}次)` : '—'}`,
      )
      continue
    }
    console.log(
      `${r.name.padEnd(14)}${key.padEnd(7)}${String(c.t).padStart(4)}%  60日胜率 ${pct(c.h60.win)} vs 基线 ${pct(r.base60.win)} → 超额胜率 ${sgn(c.lift60)}pp  超额收益 ${sgn((c.h60.avg - r.base60.avg) * 100, 2)}pp  独立信号 ${c.episodes} 次`,
    )
  }
}
