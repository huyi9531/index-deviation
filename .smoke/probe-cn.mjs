/**
 * 探针 2：A 股指数数据源可行性对比。
 * 候选：东方财富 push2his、腾讯 ifzq、Yahoo 的 ETF 代理品。
 * 只读，不写文件。
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const A_INDICES = [
  ['1.000001', '上证综指'],
  ['1.000300', '沪深300'],
  ['1.000905', '中证500'],
  ['1.000852', '中证1000'],
  ['1.000016', '上证50'],
  ['1.000688', '科创50'],
  ['1.000985', '中证全指'],
  ['0.399001', '深证成指'],
  ['0.399006', '创业板指'],
  ['1.000903', '中证100'],
  ['0.399005', '中小板指'],
  ['0.399673', '创业板50'],
]

const QQ = [
  ['sh000001', '上证综指'],
  ['sh000300', '沪深300'],
  ['sh000905', '中证500'],
  ['sh000852', '中证1000'],
  ['sh000016', '上证50'],
  ['sh000688', '科创50'],
  ['sz399001', '深证成指'],
  ['sz399006', '创业板指'],
]

const YAHOO_ETF = [
  ['510300.SS', '沪深300ETF'],
  ['510500.SS', '中证500ETF'],
  ['159915.SZ', '创业板ETF'],
  ['588000.SS', '科创50ETF'],
  ['510050.SS', '上证50ETF'],
  ['512100.SS', '中证1000ETF'],
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function tryEastmoney(secid) {
  const url =
    'https://push2his.eastmoney.com/api/qt/stock/kline/get' +
    '?secid=' + secid +
    '&fields1=f1,f2,f3,f4,f5,f6' +
    '&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61' +
    '&klt=101&fqt=1&beg=0&end=20500101&lmt=1000000'
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' },
    })
    if (!res.ok) return { err: 'HTTP ' + res.status }
    const j = await res.json()
    const k = j?.data?.klines
    if (!k?.length) return { err: 'no klines (' + (j?.data?.name ?? 'data null') + ')' }
    return {
      name: j.data.name,
      n: k.length,
      first: k[0].split(',')[0],
      last: k[k.length - 1].split(',')[0],
      close: k[k.length - 1].split(',')[2],
    }
  } catch (e) {
    return { err: e.message }
  }
}

async function tryTencent(code) {
  const url =
    'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' +
    code + ',day,,,10000,qfq'
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) return { err: 'HTTP ' + res.status }
    const j = await res.json()
    const d = j?.data?.[code]
    const k = d?.qfqday ?? d?.day
    if (!k?.length) return { err: 'no klines' }
    return {
      n: k.length,
      first: k[0][0],
      last: k[k.length - 1][0],
      close: k[k.length - 1][2],
    }
  } catch (e) {
    return { err: e.message }
  }
}

async function tryYahoo(symbol) {
  const START = Math.floor(Date.UTC(1990, 0, 1) / 1000)
  const NOW = Math.floor(Date.now() / 1000)
  const url =
    'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) +
    '?period1=' + START + '&period2=' + (NOW + 86400) + '&interval=1d'
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) return { err: 'HTTP ' + res.status }
    const j = await res.json()
    const r = j?.chart?.result?.[0]
    const ts = r?.timestamp ?? []
    const cl = r?.indicators?.quote?.[0]?.close ?? []
    const rows = []
    for (let i = 0; i < ts.length; i++) if (Number.isFinite(cl[i]) && cl[i] > 0) rows.push([ts[i], cl[i]])
    if (!rows.length) return { err: 'empty' }
    const f = (t) => new Date(t * 1000).toISOString().slice(0, 10).replace(/-/g, '')
    return { n: rows.length, first: f(rows[0][0]), last: f(rows[rows.length - 1][0]), close: rows[rows.length - 1][1] }
  } catch (e) {
    return { err: e.message }
  }
}

function fmt(label, r) {
  if (r.err) return label.padEnd(16) + '✗ ' + r.err
  return (
    label.padEnd(16) + String(r.n).padStart(6) + '  ' +
    (r.first + '→' + r.last).padEnd(21) + String(r.close).padStart(10)
  )
}

console.log('########## 东方财富 push2his（klt=101 日线, fqt=1 前复权）##########')
for (const [secid, cn] of A_INDICES) {
  const r = await tryEastmoney(secid)
  console.log(fmt(cn + ' ' + secid, r))
  await sleep(120)
}

console.log('\n########## 腾讯 ifzq（qfq 前复权）##########')
for (const [code, cn] of QQ) {
  const r = await tryTencent(code)
  console.log(fmt(cn + ' ' + code, r))
  await sleep(120)
}

console.log('\n########## Yahoo ETF 代理品 ##########')
for (const [sym, cn] of YAHOO_ETF) {
  const r = await tryYahoo(sym)
  console.log(fmt(cn + ' ' + sym, r))
  await sleep(120)
}
