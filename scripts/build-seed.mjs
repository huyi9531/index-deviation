/**
 * 生成离线兜底数据快照：各指数日线收盘价。
 *
 * 数据来源按指数注册表里的 provider 分派：
 *   yahoo     —— 美股指数（^GSPC / ^NDX），统一从 1948 年拉起
 *   eastmoney —— A 股指数（东方财富 push2his），全历史可得
 *
 * 之所以 A 股不能用 Yahoo：它对 A 股指数基本没有历史数据
 * （000300.SS 仅 2021 年起、399006.SZ 无数据、000688.SS 只有 1 根 K 线）。
 *
 * 东财限流兜底：连续请求下东财会整段拒连（表现为 fetch failed / HTTP 000，
 * 与本机网络无关，实测整个 IP 被封一段时间）。全败后降级到新浪 getKLineData，
 * 并在 meta.json 的 source 字段如实记录本次实际用了哪个源。
 * 实测新浪与东财逐日对拍：中位相对差 0.0001%、最大 0.03%（小数位取整量级）。
 * ⚠️ 新浪上限 4000 根，触顶一律拒绝写入 —— 静默截断历史会默默改变全部统计口径。
 *
 * 输出：src/data/<id>-daily.csv   —— 纯 CSV 文本 "YYYYMMDD,close"，供 ?raw 导入
 *       src/data/<id>-meta.json  —— 快照元信息（仅备查，运行时不读）
 *
 * 运行时（Cloudflare Worker）会优先拉取最新数据；拉取失败时回落到本快照，
 * 保证看板永远可用。
 *
 * ⚠️ 这里的 TARGETS 必须与 src/lib/indices/registry.ts 的 INDICES 保持一致，
 *    并且每新增一个指数，还要在 src/lib/indices/source.server.ts 的 SEEDS
 *    里补一条 ?raw 导入。
 *
 * 用法: node scripts/build-seed.mjs            # 全部指数
 *       node scripts/build-seed.mjs hs300      # 只拉指定指数
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(HERE, '../src/data')

/**
 * probes 是已知的历史锚点（**收盘价**），用来在写入前做一次人工可核对的抽查。
 * 数值取自公开历史记录，对不上说明取数或解析出了问题。
 *
 * A 股指数不放锚点：公开资料里广为流传的「历史最高/最低点」多为**盘中极值**，
 * 而这里存的是收盘价，两者口径不同容易误判。A 股改由下面的
 * 「单日涨跌幅 sanity check」+ .smoke/ 里的 ETF 相关性交叉验证来把关。
 */
const TARGETS = [
  {
    id: 'sp500',
    provider: 'yahoo',
    symbol: '^GSPC',
    name: 'S&P 500',
    probes: {
      19500103: 16.66,
      19871019: 224.84,
      20090309: 676.53,
      20200323: 2237.4,
    },
  },
  {
    id: 'nasdaq',
    provider: 'yahoo',
    symbol: '^NDX',
    name: 'NASDAQ-100',
    probes: { 20000324: 4704.73 },
  },
  {
    id: 'hs300',
    provider: 'eastmoney',
    symbol: '1.000300',
    name: '沪深300',
    probes: {},
  },
  {
    id: 'a500',
    provider: 'eastmoney',
    symbol: '1.000510',
    name: '中证A500',
    probes: {},
  },
  {
    id: 'csi500',
    provider: 'eastmoney',
    symbol: '1.000905',
    name: '中证500',
    probes: {},
  },
  {
    id: 'chinext',
    provider: 'eastmoney',
    symbol: '0.399006',
    name: '创业板指',
    probes: {},
  },
  {
    id: 'star50',
    provider: 'eastmoney',
    symbol: '1.000688',
    name: '科创50',
    probes: {},
  },
]

const START = Math.floor(Date.UTC(1948, 0, 1) / 1000) // 美股：留出 200 日均线预热期
const NOW = Math.floor(Date.now() / 1000)

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const YAHOO_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']

function ymdFromUnix(unixSeconds) {
  const d = new Date(unixSeconds * 1000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

/** Yahoo：返回 [{date, close}] */
async function fetchYahoo(symbol) {
  let lastErr
  for (const host of YAHOO_HOSTS) {
    const url =
      `${host}/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?period1=${START}&period2=${NOW + 86400}&interval=1d&events=div%2Csplit`
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'application/json,text/plain,*/*',
        },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const result = json?.chart?.result?.[0]
      if (!result) throw new Error(json?.chart?.error?.description ?? 'chart.result 为空')
      const stamps = result.timestamp ?? []
      const quote = result.indicators?.quote?.[0] ?? {}
      const closes = quote.close ?? []
      const rows = []
      for (let i = 0; i < stamps.length; i++) {
        const c = closes[i]
        if (!Number.isFinite(c) || c <= 0) continue
        rows.push({ date: ymdFromUnix(stamps[i]), close: c })
      }
      return rows
    } catch (err) {
      lastErr = err
      console.warn(`[seed] ${symbol} ${host} 失败: ${err.message}`)
    }
  }
  throw lastErr
}

/**
 * 东方财富：返回 [{date, close}]
 * klines 每行：日期,开,收,高,低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率
 * 收盘价取第 3 列。
 */
async function fetchEastmoney(secid) {
  const url =
    'https://push2his.eastmoney.com/api/qt/stock/kline/get' +
    `?secid=${encodeURIComponent(secid)}` +
    '&fields1=f1,f2,f3,f4,f5,f6' +
    '&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61' +
    '&klt=101&fqt=1&beg=0&end=20500101&lmt=1000000'

  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  const klines = json?.data?.klines
  if (!klines?.length) throw new Error(`klines 为空（${json?.data?.name ?? 'data 为 null'}）`)

  const rows = []
  for (const line of klines) {
    const p = line.split(',')
    if (p.length < 7) continue
    const date = p[0].replace(/-/g, '')
    const close = Number(p[2])
    if (!Number.isFinite(close) || close <= 0) continue
    rows.push({ date, close })
  }
  return rows
}

/** 新浪单次上限，触顶意味着历史被截断，必须拒绝写入 */
const SINA_MAX_BARS = 4000

/** 东财 secid → 新浪 symbol：1.=沪、0.=深 */
function sinaSymbol(secid) {
  const [mkt, code] = secid.split('.')
  return `${mkt === '1' ? 'sh' : 'sz'}${code}`
}

/**
 * 新浪财经：返回 [{date, close}]。仅作东财限流时的兜底源。
 * 指数没有复权问题，所以不复权的前收价在这里是可用的（个股不行）。
 */
async function fetchSina(secid) {
  const code = sinaSymbol(secid)
  const url =
    'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php' +
    `/CN_MarketData.getKLineData?symbol=${code}&scale=240&ma=no&datalen=${SINA_MAX_BARS}`
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://finance.sina.com.cn/' },
  })
  if (!res.ok) throw new Error(`新浪 HTTP ${res.status}`)
  const json = await res.json()
  if (!Array.isArray(json) || !json.length) throw new Error('新浪返回空数组')
  if (json.length >= SINA_MAX_BARS) {
    throw new Error(
      `新浪返回 ${json.length} 根，已触 ${SINA_MAX_BARS} 上限，历史被截断 —— 拒绝写入`,
    )
  }

  const rows = []
  for (const r of json) {
    const date = String(r.day ?? '').replace(/-/g, '')
    const close = Number(r.close)
    if (!/^\d{8}$/.test(date) || !Number.isFinite(close) || close <= 0) continue
    rows.push({ date, close })
  }
  return rows
}

const only = process.argv.slice(2)
const targets = only.length ? TARGETS.filter((t) => only.includes(t.id)) : TARGETS

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 东方财富对连续请求限流较凶，表现为 `fetch failed`，必须带退避重试。
 * 实测 4 次 × 1.2s 递增仍会失败，所以给到 6 次 × 2.5s 递增。
 * 退避尽尽后降级新浪（见 fetchSina）；仍不成则抛错，不写半个快照。
 * 这也是运行时 source.server.ts 必须做「离线快照兜底」的原因。
 */
async function fetchWithRetry(target, attempts = 6) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      if (target.provider === 'eastmoney') {
        return {
          rows: await fetchEastmoney(target.symbol),
          via: '东方财富 push2his（klt=101 日线，fqt=1 前复权）',
        }
      }
      return { rows: await fetchYahoo(target.symbol), via: 'Yahoo Finance chart API' }
    } catch (err) {
      lastErr = err
      if (i < attempts) {
        const wait = 2500 * i
        console.warn(`[seed] ${target.id} 第 ${i} 次失败（${err.message}），${wait}ms 后重试`)
        await sleep(wait)
      }
    }
  }
  if (target.provider === 'eastmoney') {
    console.warn(`[seed] ${target.id} 东财 ${attempts} 次均失败（${lastErr.message}），降级新浪兜底源`)
    return {
      rows: await fetchSina(target.symbol),
      via: '新浪财经 getKLineData（东财限流时的兜底源；指数无复权问题）',
    }
  }
  throw lastErr
}

if (targets.length === 0) {
  console.error(`[seed] 没有匹配的目标。可选: ${TARGETS.map((t) => t.id).join(', ')}`)
  process.exit(1)
}

await mkdir(OUT_DIR, { recursive: true })

let failed = 0

for (const target of targets) {
  try {
    const { rows: raw, via } = await fetchWithRetry(target)
    const rows = raw.map((r) => `${r.date},${r.close.toFixed(2)}`).sort()

    if (rows.length < 300) throw new Error(`只拿到 ${rows.length} 行，样本太少，放弃写入`)

    const firstDate = rows[0].split(',')[0]
    const lastDate = rows[rows.length - 1].split(',')[0]

    // sanity check：只用来拦「解析串行」这类灾难性错误，阈值必须放宽 ——
    // 真实历史里存在极端单日波动：标普 1987-10-19 跌 20.5%（黑色星期一）、
    // 创业板指 2024-10-08 涨 17.2%（924 行情）、中证500 2024-09-30 涨 10.4%。
    // 解析错误通常表现为量级错位（几十个百分点到几倍），35% 足以区分。
    //
    const closes = rows.map((r) => Number(r.split(',')[1]))
    let maxMove = 0
    let maxMoveDate = ''
    for (let i = 1; i < closes.length; i++) {
      const mv = Math.abs(closes[i] / closes[i - 1] - 1)
      if (mv > maxMove) {
        maxMove = mv
        maxMoveDate = rows[i].split(',')[0]
      }
    }
    if (maxMove > 0.35) {
      throw new Error(
        `单日最大涨跌 ${(maxMove * 100).toFixed(1)}%（${maxMoveDate}）超出合理范围，疑似解析错误`,
      )
    }

    await writeFile(resolve(OUT_DIR, `${target.id}-daily.csv`), `${rows.join('\n')}\n`, 'utf8')
    await writeFile(
      resolve(OUT_DIR, `${target.id}-meta.json`),
      `${JSON.stringify(
        {
          id: target.id,
          symbol: target.symbol,
          provider: target.provider,
          name: target.name,
          source: via,
          fetchedAt: new Date().toISOString(),
          firstDate,
          lastDate,
          tradingDays: rows.length,
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    console.log(
      `[seed] ${target.id.padEnd(8)} ${String(rows.length).padStart(6)} 个交易日  ${firstDate} → ${lastDate}`,
    )

    // 锚点抽查：打印实测值，方便人工核对
    const map = new Map(rows.map((r) => r.split(',')))
    for (const [date, expect] of Object.entries(target.probes ?? {})) {
      const got = map.get(date)
      const gotNum = got ? Number(got) : NaN
      const ok = Number.isFinite(gotNum) && Math.abs(gotNum - expect) / expect < 0.01
      console.log(`         ${date}: ${got ?? '—'}  期望≈${expect}  ${ok ? '✓' : '⚠ 偏差较大'}`)
    }
    console.log(
      `         单日最大波动 ${(maxMove * 100).toFixed(2)}%（${maxMoveDate}）` +
        `  最新值 ${closes[closes.length - 1]}`,
    )
  } catch (err) {
    failed++
    console.error(`[seed] ${target.id} 失败: ${err.message}`)
  }
  // 东财对连续请求会限流，指数之间留出间隔
  await sleep(700)
}

if (failed > 0) {
  console.error(`[seed] 有 ${failed} 个指数未写入。已有快照不会被破坏。`)
  process.exit(1)
}
console.log('[seed] 完成')
