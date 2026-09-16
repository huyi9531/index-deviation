/**
 * 探针 3：用户点名的中证A500，以及几个「有 ETF 可投」的补充候选。
 * 重点看两件事：数据从哪天起、真实发布日是哪天（差距 = 回溯段长度）。
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// [secid, 名称, 真实发布日期(查询结果填入), 备注]
const LIST = [
  ['1.000510', '中证A500'],
  ['1.930050', '中证A50'],
  ['2.930050', '中证A50'],
  ['1.000922', '中证红利'],
  ['2.000922', '中证红利'],
  ['1.000015', '上证红利'],
  ['1.000300', '沪深300'],
  ['1.000905', '中证500'],
  ['1.000852', '中证1000'],
  ['1.000688', '科创50'],
  ['0.399006', '创业板指'],
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function probe(secid) {
  const url =
    'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + secid +
    '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61' +
    '&klt=101&fqt=1&beg=0&end=20500101&lmt=1000000'
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' },
    })
    if (!res.ok) return { err: 'HTTP ' + res.status }
    const j = await res.json()
    const d = j?.data
    if (!d?.klines?.length) return { err: 'no klines' }
    const k = d.klines
    return {
      code: d.code,
      name: d.name,
      n: k.length,
      first: k[0].split(',')[0],
      last: k[k.length - 1].split(',')[0],
      close: k[k.length - 1].split(',')[2],
    }
  } catch (e) {
    return { err: e.message }
  }
}

console.log('secid'.padEnd(11) + '查询名'.padEnd(11) + '接口名'.padEnd(11) + '交易日'.padStart(7) + '  起止')
console.log('-'.repeat(80))
for (const [secid, cn] of LIST) {
  const r = await probe(secid)
  if (r.err) {
    console.log(secid.padEnd(11) + cn.padEnd(11) + '—'.padEnd(11) + '   ✗ ' + r.err)
  } else {
    console.log(
      secid.padEnd(11) +
        cn.padEnd(11) +
        String(r.name).padEnd(11) +
        String(r.n).padStart(7) +
        '  ' + r.first + ' → ' + r.last + '   最新 ' + r.close,
    )
  }
  await sleep(150)
}
