/**
 * 沪深300 成分股的「总览表」—— 复用产品真实代码（buildOverviewRow）出的快照表。
 *
 * 为什么不用重写的逻辑：src/lib/indices/{series,stats,queries}.ts 都是同构纯函数，
 * 直接用 esbuild 打包（见 bundle.mjs / entry.ts）导入，保证与线上逐字段一致。
 *
 * 前置：fetch-stocks.sh 已把 Yahoo 复权日线抓到 _stockprobe/stocks/
 * 用法：node .smoke/_stockprobe/render-stocks.mjs
 */
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSeries, buildOverviewRow, fmtPoint, fmtPct, fmtExcess } from './lib.mjs'

const ROOT = process.cwd()
const P = resolve(ROOT, '.smoke/_stockprobe')

// ── 产品设计令牌（src/styles/app.css 的 @theme，逐值抄来保证配色一致）
const C = {
  canvas: '#f2f3f1', surface: '#fdfdfc', surface2: '#f6f7f5',
  line: '#e2e4df', lineStrong: '#c9ccc5',
  ink: '#15171a', ink2: '#43464c', muted: '#6b6e75', faint: '#999da3',
  amber: '#a85e06', steel: '#1f5096', up: '#c0392b', down: '#0e7a52',
  coldBand: '#e9f0f9', hotBand: '#fbeae4',
  cnBg: '#fbeeea', cnFg: '#a23222', cnLine: '#f0d3cc',
}

/** 与 src/routes/index.tsx 同名同值 */
const SPARK_COLOR = {
  cold: { line: '#1f5096', fill: 'rgba(31,80,150,0.12)' },
  cool: { line: '#1f5096', fill: 'rgba(31,80,150,0.08)' },
  neutral: { line: '#9ba0a6', fill: 'rgba(153,160,166,0.08)' },
  warm: { line: '#c0392b', fill: 'rgba(192,57,43,0.08)' },
  hot: { line: '#c0392b', fill: 'rgba(192,57,43,0.13)' },
}
const TONE_DOT = {
  cold: C.steel, cool: 'rgba(31,80,150,0.6)', neutral: C.faint,
  warm: 'rgba(192,57,43,0.6)', hot: C.up,
}
const TONE_PILL = {
  cold: [`background:${C.coldBand}`, `color:${C.steel}`, `border-color:#d0dcee`],
  cool: ['background:rgba(228,237,248,0.7)', `color:${C.steel}`, 'border-color:#dbe4f1'],
  neutral: [`background:${C.surface2}`, `color:${C.muted}`, `border-color:${C.line}`],
  warm: [`background:${C.hotBand}`, `color:${C.up}`, 'border-color:#f0d2ca'],
  hot: [`background:${C.hotBand}`, `color:${C.up}`, 'border-color:#ecc3ba'],
}
const TONE_RANK = { cold: 0, cool: 1, neutral: 2, warm: 3, hot: 4 }

/** 超额的色阶：±3pp（噪声内）→ 灰；正 → 红（涨优势）、负 → 绿（跌优势） */
function excessColor(v) {
  if (v === null || !Number.isFinite(v) || Math.abs(v) < 3) return C.faint
  return v > 0 ? C.up : C.down
}

/** 逐字节对应 src/components/Sparkline.tsx */
function sparkline(values, { line, fill, height = 32 }) {
  const pts = values.filter((v) => Number.isFinite(v))
  if (pts.length < 2) return `<div style="height:${height}px;background:${C.surface2};border-radius:3px"></div>`
  const VB_W = 100
  const VB_H = 28
  const min = Math.min(0, ...pts)
  const max = Math.max(0, ...pts)
  const span = max - min || 1
  const x = (i) => (i / (pts.length - 1)) * VB_W
  const y = (v) => VB_H - ((v - min) / span) * (VB_H - 4) - 2
  const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const y0 = y(0)
  return `<svg viewBox="0 0 ${VB_W} ${VB_H}" preserveAspectRatio="none" style="height:${height}px;display:block;width:100%;overflow:visible" aria-hidden="true">
    <path d="${d} L${VB_W},${VB_H} L0,${VB_H} Z" fill="${fill}" stroke="none"/>
    <line x1="0" x2="${VB_W}" y1="${y0}" y2="${y0}" stroke="${C.lineStrong}" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>
    <path d="${d}" fill="none" stroke="${line}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
  </svg>`
}

// ── 读成分表 + 已抓到的日线
const tsv = await readFile(resolve(P, 'hs300.tsv'), 'utf8')
const roster = tsv.trim().split('\n').map((l) => l.split('\t')).filter((r) => r[1])
const files = new Set(await readdir(resolve(P, 'stocks')))

const rows = []
const missing = []
for (const [mkt, code, name] of roster) {
  const sym = `${code}.${mkt === '1' ? 'SS' : 'SZ'}`
  if (!files.has(`${sym}.json`)) {
    missing.push({ code, name, why: '未抓取' })
    continue
  }
  let j
  try {
    j = JSON.parse(await readFile(resolve(P, 'stocks', `${sym}.json`), 'utf8'))
  } catch {
    missing.push({ code, name, why: 'JSON 损坏' })
    continue
  }
  const r = j?.chart?.result?.[0]
  if (!r?.timestamp?.length) {
    missing.push({ code, name, why: '数据源无此标的' })
    continue
  }
  const adj = r.indicators?.adjclose?.[0]?.adjclose
  const raw = r.indicators?.quote?.[0]?.close
  const src = adj ?? raw
  const dates = []
  const closes = []
  for (let i = 0; i < r.timestamp.length; i++) {
    const v = src?.[i]
    if (v === null || v === undefined || !Number.isFinite(v) || v <= 0) continue
    dates.push(Number(new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10).replace(/-/g, '')))
    closes.push(v)
  }
  if (dates.length < 260) {
    missing.push({ code, name, why: `历史不足（${dates.length} 根 < 200 日均线所需）` })
    continue
  }
  const s = buildSeries(dates, closes)
  // 真实产品逻辑：总览行。个股没有标定水位（见实测报告），action 如实给 null
  const row = buildOverviewRow(
    s,
    { market: 'cn', source: 'live' },
    {
      id: code, name, enName: name, ticker: code,
      symbol: sym, market: 'cn', currency: 'CNY', provider: 'yahoo', liveSince: 0,
      action: { dev60: null, dev200: null },
    },
    { dev60: null, dev200: null },
  )
  rows.push({ ...row, bars: dates.length, firstDate: s.dates[0], sym })
}

// 排序：产品总览的「离值得动手的距离」——① 温度 cold→hot；② 同温内最超卖在前
rows.sort((a, b) => {
  const t = TONE_RANK[a.signal.tone] - TONE_RANK[b.signal.tone]
  if (t !== 0) return t
  return a.dev200 - b.dev200
})

// ── 渲染
const toneCount = rows.reduce((m, r) => ((m[r.signal.tone] = (m[r.signal.tone] ?? 0) + 1), m), {})
const nExcess = rows.filter((r) => r.analogExcess !== null).length
const nBeating = rows.filter((r) => r.analogExcess !== null && r.analogExcess >= 3).length
const nThin = rows.filter((r) => r.analogSamples < 60).length
const missByWhy = missing.reduce((m, x) => ((m[x.why] = (m[x.why] ?? 0) + 1), m), {})

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>沪深300 成分股 · 偏离度总览</title>
<style>
:root{--canvas:${C.canvas};--surface:${C.surface};--surface2:${C.surface2};--line:${C.line};
--ink:${C.ink};--ink2:${C.ink2};--muted:${C.muted};--faint:${C.faint};--amber:${C.amber};--steel:${C.steel}}
*{box-sizing:border-box}
body{margin:0;background:var(--canvas);color:var(--ink);
 font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;
 -webkit-font-smoothing:antialiased}
.num{font-family:ui-monospace,'SF Mono','Cascadia Mono',Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.wrap{max-width:1280px;margin:0 auto;padding:44px 28px 80px}
h1{margin:0 0 8px;font-size:30px;font-weight:650;letter-spacing:-.01em}
.sub{color:var(--muted);font-size:13.5px;margin:0 0 4px}
.sub2{color:var(--faint);font-size:12.5px;margin:10px 0 0}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden;
 margin-top:26px;box-shadow:0 1px 2px rgba(21,23,26,.04)}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:11.5px;font-weight:500;color:var(--faint);
 padding:16px 16px 14px 0;border-bottom:1px solid var(--line);white-space:nowrap}
th:first-child,td:first-child{padding-left:22px}
th:last-child,td:last-child{padding-right:22px}
td{padding:15px 16px 15px 0;border-bottom:1px solid rgba(226,228,223,.7);vertical-align:middle}
tr:last-child td{border-bottom:0}
tbody tr:hover{background:rgba(246,247,245,.7)}
.cellname{display:flex;align-items:center;gap:10px}
.nm{font-size:14px;font-weight:600}
.tk{font-size:11px;color:var(--faint)}
.tag{display:inline-block;font-size:10.5px;font-weight:500;padding:2px 7px;border-radius:5px;
 background:${C.cnBg};color:${C.cnFg};border:1px solid ${C.cnLine}}
.pill{display:inline-flex;align-items:center;gap:6px;border:1px solid;border-radius:999px;
 padding:4px 10px;font-size:12px;font-weight:500;white-space:nowrap}
.dot{width:6px;height:6px;border-radius:99px;display:inline-block}
.spark{width:190px;padding:12px 16px 12px 0}
.legend{margin:18px 0 0;font-size:12.5px;color:var(--muted);line-height:1.9}
.legend b{color:var(--ink2)}
.caveat{background:${C.surface};border:1px solid ${C.line};border-left:3px solid ${C.amber};
 border-radius:10px;padding:18px 22px;margin:26px 0 0;font-size:13px;color:var(--ink2);line-height:1.8}
.caveat b{color:var(--ink)}
.kpis{display:flex;gap:26px;flex-wrap:wrap;margin:22px 0 0}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 18px;min-width:132px}
.kpi .v{font-size:23px;font-weight:650;letter-spacing:-.02em}
.kpi .k{font-size:11.5px;color:var(--muted);margin-top:2px}
.miss{margin:26px 0 0;font-size:12.5px;color:var(--muted)}
.miss summary{cursor:pointer;color:var(--ink2);font-weight:500}
.miss div{margin-top:8px;line-height:1.9}
</style></head><body><div class="wrap">

<h1>沪深300 成分股 · 偏离度总览</h1>
<p class="sub">60 / 200 日均线对数偏离度 —— ${rows.length} 只成分股 —— 全历史胜率统计</p>
<p class="sub2">统计口径与 <a href="https://index.aiconductor.top" style="color:var(--steel)">指数偏离度监控</a>
总览页逐字段一致：本页的数字由产品自身的 <code>buildOverviewRow</code> 直接算出，
不是另写的脚本。价格用复权收盘价。</p>

${missing.length ? `<details class="miss"><summary>${missing.length} 只成分股未纳入（点开看原因）</summary>
<div><b>${Object.entries(missByWhy).map(([k, v]) => `${k} ${v} 只`).join(' · ')}</b><br>
${missing.map((m) => `${m.code} ${m.name} — ${m.why}`).join('<br>')}</div></details>` : ''}

<div class="kpis">
  <div class="kpi"><div class="v num">${rows.length}</div><div class="k">纳入成分股</div></div>
  <div class="kpi"><div class="v num">${toneCount.cold ?? 0}</div><div class="k">极值区 · 历史级位置</div></div>
  <div class="kpi"><div class="v num">${toneCount.cool ?? 0}</div><div class="k">偏低区 · 可分批</div></div>
  <div class="kpi"><div class="v num">${nBeating}/${nExcess}</div><div class="k">同类位置超额 ≥ +3pp</div></div>
  <div class="kpi"><div class="v num">${nThin}</div><div class="k">同类位置样本 &lt; 60 天</div></div>
</div>

<div class="caveat">
<b>先说清楚这张表不能干什么。</b>它照搬了指数总览的全部列，但有一列必须打折看：
<b>「同类位置 20 日超额」在个股上没有指数的可信度</b>。
在指数上，六个指数各自独立标定出的同类超额相差不到 1.5pp，互相印证；
个股上这个数只能回答「这只票过去在相似位置表现如何」，
换个标的就从 +9pp 散到 +3pp，且换抽样相位可以再浮动几十 pp（见实测报告）。
<b>它描述历史，不预测未来；也不是买入信号。</b>
另外沪深300 成分股本身就是「活到今天的大盘股」——
退市的、被剔除的都不在这个池子里，这层幸存者偏差洗不掉。
</div>

<div class="panel"><table>
<thead><tr>
  <th>股票</th><th>最新点位</th><th>60 日偏离</th><th>200 日偏离</th>
  <th>近一年 200 日偏离度</th><th>同类位置 20 日超额</th><th>状态</th>
</tr></thead>
<tbody>
${rows.map((r) => {
  const sp = SPARK_COLOR[r.signal.tone]
  const pill = TONE_PILL[r.signal.tone]
  return `<tr>
  <td><span class="cellname"><span class="nm">${r.name}</span>
    <span class="num tk">${r.ticker}</span><span class="tag">A 股</span></span></td>
  <td class="num" style="font-weight:500"><span style="color:var(--faint);font-size:.75em">¥</span>${fmtPoint(r.close, r.close < 100 ? 2 : 0)}</td>
  <td class="num" style="font-weight:500;color:var(--amber)">${fmtPct(r.dev60)}</td>
  <td class="num" style="font-weight:600;color:var(--steel)">${fmtPct(r.dev200)}</td>
  <td class="spark">${sparkline(r.spark, sp)}</td>
  <td class="num" style="font-weight:500;color:${excessColor(r.analogExcess)}">${fmtExcess(r.analogExcess)}<span style="display:block;font-size:10.5px;font-weight:400;color:var(--faint);font-family:inherit">${
    r.analogExcess === null ? `样本仅 ${r.analogSamples} 天` : `n=${r.analogSamples} 天`
  }</span></td>
  <td><span class="pill" style="${pill.join(';')}"><span class="dot" style="background:${TONE_DOT[r.signal.tone]}"></span>${r.signal.title}</span></td>
</tr>`
}).join('\n')}
</tbody></table></div>

<div class="legend">
<b>列口径</b>（与产品一致）：<b>60 日偏离</b> = 100 × ln(收盘 ÷ 60 日均线)；
<b>200 日偏离</b> 同理，是判断中期位置的指标；
<b>同类位置 20 日超额</b> = 历史上偏离度落在当前值 ±1% 之内的那些日子、之后 20 个交易日的上涨率，
减去不设条件的常态上涨率，单位百分点。|超额| &lt; 3pp 显示灰色（与常态无异，3pp 是全站统一的标定阈值）；
下方小字 <b>n</b> 是同类位置的历史样本天数 —— <b>这个数比超额本身重要</b>：
全池中位数约 140 天，但 p10 只有 40 天左右，<b>样本 &lt; 60 天的读数基本是噪声</b>，
样本不足 30 天的产品会如实显示「—」。
<b>状态</b>由 60 日与 200 日偏离度在该标的全历史中的分位决定，
极值区取最极端的 2%、偏低/偏热取 10%。样本不足 30 天的如实显示「—」。
</div>

<p class="sub2" style="margin-top:22px">
排序：先按状态 cold → hot，同状态内 200 日偏离度从深到浅（最超卖的在前）。
生成时间 ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC ·
数据源 Yahoo Finance 复权日线（adjclose）
</p>

</div></body></html>`

await writeFile(resolve(P, 'stocks-overview.html'), html, 'utf8')
console.log(`已写出 .smoke/_stockprobe/stocks-overview.html`)
console.log(`纳入 ${rows.length} 只，未纳入 ${missing.length} 只`)
console.log('温度分布:', JSON.stringify(toneCount))
console.log('\n状态              数量')
for (const t of ['cold', 'cool', 'neutral', 'warm', 'hot']) {
  if (toneCount[t]) console.log(`  ${t.padEnd(9)} ${toneCount[t]}`)
}
console.log('\n最超卖的 12 只（200 日偏离）：')
for (const r of rows.slice(0, 12)) {
  console.log(`  ${r.name.padEnd(8)}${r.ticker}  60日 ${fmtPct(r.dev60).padStart(8)}  200日 ${fmtPct(r.dev200).padStart(8)}  同类超额 ${fmtExcess(r.analogExcess).padStart(8)}  ${r.signal.title}`)
}
