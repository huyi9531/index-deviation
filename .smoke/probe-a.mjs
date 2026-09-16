/**
 * 探针：检查 Yahoo Finance 对 A 股指数候选标的的数据可得性与历史深度。
 * 只读，不写任何文件。用来决定「哪些 A 股指数可以进」。
 */
const CANDIDATES = [
  ['000001.SS', '上证综指', 'SSE Composite'],
  ['000300.SS', '沪深300', 'CSI 300'],
  ['000905.SS', '中证500', 'CSI 500'],
  ['000852.SS', '中证1000', 'CSI 1000'],
  ['000016.SS', '上证50', 'SSE 50'],
  ['000688.SS', '科创50', 'STAR 50'],
  ['399001.SZ', '深证成指', 'SZSE Component'],
  ['399006.SZ', '创业板指', 'ChiNext'],
  ['399005.SZ', '中小板指', 'SME Board'],
  ['399673.SZ', '创业板50', 'ChiNext 50'],
  ['000985.SS', '中证全指', 'CSI All Share'],
  ['930050.CSI', '中证A50', 'CSI A50'],
]

const START = Math.floor(Date.UTC(1990, 0, 1) / 1000)
const NOW = Math.floor(Date.now() / 1000)
const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

function ymd(unix) {
  const d = new Date(unix * 1000)
  return (
    d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
  )
}

async function probe(symbol) {
  for (const host of HOSTS) {
    const url = `${host}/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${START}&period2=${NOW + 86400}&interval=1d&events=div%2Csplit`
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
      if (!res.ok) return { err: `HTTP ${res.status}` }
      const json = await res.json()
      const r = json?.chart?.result?.[0]
      if (!r) return { err: json?.chart?.error?.description ?? 'no result' }
      const stamps = r.timestamp ?? []
      const closes = r.indicators?.quote?.[0]?.close ?? []
      const rows = []
      for (let i = 0; i < stamps.length; i++) {
        const c = closes[i]
        if (Number.isFinite(c) && c > 0) rows.push([ymd(stamps[i]), c])
      }
      if (!rows.length) return { err: 'empty' }
      const last = rows[rows.length - 1]
      // 数据新鲜度：最后一个交易日的年份
      return {
        n: rows.length,
        first: rows[0][0],
        last: last[0],
        close: last[1],
        currency: r.meta?.currency,
        tz: r.meta?.exchangeTimezoneName,
      }
    } catch (e) {
      if (host === HOSTS[HOSTS.length - 1]) return { err: e.message }
    }
  }
  return { err: 'unreachable' }
}

console.log('标的'.padEnd(13) + '名称'.padEnd(12) + '交易日'.padStart(7) + '  起止                最新收盘')
console.log('-'.repeat(78))
for (const [symbol, cn, en] of CANDIDATES) {
  const r = await probe(symbol)
  if (r.err) {
    console.log(symbol.padEnd(13) + cn.padEnd(12) + '    —    ✗ ' + r.err)
  } else {
    const span = `${r.first}→${r.last}`
    console.log(
      symbol.padEnd(13) +
        cn.padEnd(12) +
        String(r.n).padStart(7) +
        '  ' +
        span.padEnd(21) +
        String(r.close).padStart(8) +
        `  ${r.currency ?? ''}/${(r.tz ?? '').split('/')[1] ?? ''}`,
    )
  }
}
