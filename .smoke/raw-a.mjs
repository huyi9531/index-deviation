const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const START = Math.floor(Date.UTC(1990, 0, 1) / 1000)
const NOW = Math.floor(Date.now() / 1000)

for (const sym of ['000905.SS', '000016.SS', '000300.SS', '399006.SZ']) {
  const url =
    'https://query1.finance.yahoo.com/v8/finance/chart/' +
    encodeURIComponent(sym) +
    '?period1=' + START + '&period2=' + (NOW + 86400) + '&interval=1d'
  const j = await (await fetch(url, { headers: { 'User-Agent': UA } })).json()
  const r = j?.chart?.result?.[0]
  console.log('===', sym, '===')
  console.log('  error:', JSON.stringify(j?.chart?.error))
  console.log('  timestamp len:', r?.timestamp?.length)
  console.log('  meta keys:', Object.keys(r?.meta || {}).join(','))
  const ftd = r?.meta?.firstTradeDate
  console.log('  firstTradeDate:', ftd, ftd ? new Date(ftd * 1000).toISOString().slice(0, 10) : '')
  console.log('  dataGranularity:', r?.meta?.dataGranularity, ' range:', r?.meta?.range)
  const ts = r?.timestamp || []
  console.log(
    '  first ts:',
    ts[0] ? new Date(ts[0] * 1000).toISOString().slice(0, 10) : '—',
    ' last ts:',
    ts.length ? new Date(ts[ts.length - 1] * 1000).toISOString().slice(0, 10) : '—',
  )
  console.log('  hasAdjusted:', !!r?.indicators?.adjclose)
}
