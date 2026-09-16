/**
 * 校验东方财富解析：用「盘中最高 / 最低」交叉核对，确认锚点口径。
 * 同时给失败的两个指数做重试。
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
    m.set(p[0].replace(/-/g, ''), { open: +p[1], close: +p[2], high: +p[3], low: +p[4] })
  }
  return { name: j.data.name, m }
}

const CASES = [
  ['1.000300', '沪深300', [
    ['20050104', '首日'],
    ['20071016', '2007 峰值日'],
    ['20150612', '2015 峰值日'],
    ['20240202', '2024 低位'],
  ]],
  ['0.399006', '创业板指', [
    ['20100601', '发布首日'],
    ['20150605', '2015 峰值日'],
    ['20181019', '2018 低点日'],
  ]],
  ['1.000905', '中证500', [
    ['20071016', '2007 峰值日'],
    ['20150612', '2015 峰值日'],
  ]],
  ['1.000510', '中证A500', [
    ['20050104', '数据首日'],
    ['20240923', '发布日'],
    ['20260407', '近期'],
  ]],
]

for (const [secid, label, dates] of CASES) {
  try {
    const { name, m } = await kline(secid)
    console.log('\n=== ' + label + ' (' + secid + ') 接口名: ' + name + ' ===')
    for (const [d, note] of dates) {
      const r = m.get(d)
      if (!r) {
        console.log('  ' + d + ' ' + note.padEnd(10) + ' —— 该日无数据')
        continue
      }
      console.log(
        '  ' + d + ' ' + note.padEnd(10) +
          ' 开 ' + r.open.toFixed(2).padStart(9) +
          ' 收 ' + r.close.toFixed(2).padStart(9) +
          ' 高 ' + r.high.toFixed(2).padStart(9) +
          ' 低 ' + r.low.toFixed(2).padStart(9),
      )
    }
  } catch (e) {
    console.log('\n=== ' + label + ' (' + secid + ') 失败: ' + e.message + ' ===')
  }
  await new Promise((r) => setTimeout(r, 400))
}
