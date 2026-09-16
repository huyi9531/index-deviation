/**
 * 服务端数据源（server-only，禁止被客户端代码导入）。
 *
 * 策略：
 *   1. 内存缓存（同一 isolate 复用，TTL 内直接命中）
 *   2. Cloudflare Cache API（跨 isolate 共享，TTL 内直接命中）
 *   3. 实时拉取 Yahoo Finance chart API（按指数注册表里的 symbol）
 *   4. 全部失败 → 回落到打包进 bundle 的离线快照，看板永不空白
 *
 * 之所以要「打包快照」兜底：Cloudflare Worker 出口是机房 IP，
 * Yahoo 对机房 IP 有限流/风控的可能。只要快照在，页面就永远有数据，
 * 只是会标记为「离线快照」。
 *
 * 新增指数时，除了在 registry.ts 加一行，还要在这里补一条 ?raw 导入
 * 并跑一次 `npm run seed` 生成对应的 CSV 快照。
 */
import a500Seed from '~/data/a500-daily.csv?raw'
import chinextSeed from '~/data/chinext-daily.csv?raw'
import star50Seed from '~/data/star50-daily.csv?raw'
import csi500Seed from '~/data/csi500-daily.csv?raw'
import hs300Seed from '~/data/hs300-daily.csv?raw'
import nasdaqSeed from '~/data/nasdaq-daily.csv?raw'
import sp500Seed from '~/data/sp500-daily.csv?raw'
import { PROVIDER_LABEL, indexByIdOrDefault, type IndexDef, type IndexId } from './registry'
import { parseCsv } from './series'

export interface DailyData {
  dates: number[]
  closes: number[]
  source: 'live' | 'snapshot'
  provider: string
  fetchedAt: string
}

/** 每个指数一份离线快照。key 必须与 registry 里的 id 一致 */
const SEEDS: Record<string, string> = {
  sp500: sp500Seed,
  nasdaq: nasdaqSeed,
  hs300: hs300Seed,
  a500: a500Seed,
  csi500: csi500Seed,
  chinext: chinextSeed,
  star50: star50Seed,
}

/** 统一从 1948 年拉起，保证 200 日均线有足够预热期 */
const HISTORY_START_UNIX = Math.floor(Date.UTC(1948, 0, 1) / 1000)

/** 实时数据缓存时长：20 分钟。日线在美东收盘后更新一次，够用 */
const LIVE_TTL_SECONDS = 20 * 60
/** 兜底快照缓存时长：5 分钟，好让实时源恢复后尽快切回去 */
const SNAPSHOT_TTL_SECONDS = 5 * 60

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

interface MemoryEntry {
  at: number
  data: DailyData
}
const memory = new Map<string, MemoryEntry>()
const seedMemo = new Map<string, { dates: number[]; closes: number[] }>()

function cfCache(): Cache | null {
  try {
    const c = (globalThis as unknown as { caches?: { default?: Cache } }).caches
    return c?.default ?? null
  } catch {
    return null
  }
}

function isFresh(entry: MemoryEntry): boolean {
  const ttl = entry.data.source === 'live' ? LIVE_TTL_SECONDS : SNAPSHOT_TTL_SECONDS
  return Date.now() - entry.at < ttl * 1000
}

function cacheUrl(id: string): string {
  // v3: DailyData 增加成交额（amounts）字段；v2 是 nasdaq 从综合指数换为 NDX
  return `https://deviation-monitor.internal/daily-v2/${id}`
}

async function readPlatformCache(id: string): Promise<DailyData | null> {
  const cache = cfCache()
  if (!cache) return null
  try {
    const hit = await cache.match(cacheUrl(id))
    if (!hit) return null
    const payload = (await hit.json()) as DailyData
    if (!payload?.dates?.length) return null
    const ttl = payload.source === 'live' ? LIVE_TTL_SECONDS : SNAPSHOT_TTL_SECONDS
    const age = Date.now() - Date.parse(payload.fetchedAt)
    if (!Number.isFinite(age) || age > ttl * 1000) return null
    return payload
  } catch {
    return null
  }
}

async function writePlatformCache(id: string, data: DailyData): Promise<void> {
  const cache = cfCache()
  if (!cache) return
  try {
    await cache.put(
      cacheUrl(id),
      new Response(JSON.stringify(data), {
        headers: {
          'content-type': 'application/json',
          'cache-control': 'max-age=3600',
        },
      }),
    )
  } catch {
    /* 缓存写失败不影响功能 */
  }
}

function snapshot(def: IndexDef): DailyData {
  const raw = SEEDS[def.id]
  if (!raw) throw new Error(`缺少 ${def.id} 的离线快照，请先运行 npm run seed`)

  let memo = seedMemo.get(def.id)
  if (!memo) {
    memo = parseCsv(raw)
    seedMemo.set(def.id, memo)
  }
  return {
    dates: memo.dates,
    closes: memo.closes,
    source: 'snapshot',
    provider: `内置离线快照（${PROVIDER_LABEL[def.provider]} 历史数据 · ${def.symbol}）`,
    fetchedAt: new Date().toISOString(),
  }
}

/** 从 Yahoo chart API 拉某个美股指数的全量日线 */
async function fetchYahoo(def: IndexDef): Promise<DailyData | null> {
  const end = Math.floor(Date.now() / 1000) + 86400
  const hosts = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']

  for (const host of hosts) {
    const url =
      `${host}/v8/finance/chart/${encodeURIComponent(def.symbol)}` +
      `?period1=${HISTORY_START_UNIX}&period2=${end}&interval=1d&events=div%2Csplit`
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      })
      if (!res.ok) continue
      const json = (await res.json()) as YahooChartResponse
      const result = json?.chart?.result?.[0]
      const stamps = result?.timestamp
      const quote = result?.indicators?.quote?.[0]
      const closes = quote?.close
      if (!stamps?.length || !closes?.length) continue

      const dates: number[] = []
      const values: number[] = []
      for (let i = 0; i < stamps.length; i++) {
        const c = closes[i] ?? Number.NaN
        if (!Number.isFinite(c) || c <= 0) continue
        dates.push(toYmd(stamps[i]))
        values.push(c)
      }
      if (dates.length < 1000) continue

      return {
        dates,
        closes: values,
        source: 'live',
        provider: `Yahoo Finance chart API（${def.symbol}）`,
        fetchedAt: new Date().toISOString(),
      }
    } catch {
      /* 换下一个 host */
    }
  }
  return null
}

/**
 * 从东方财富 push2his 拉某个 A 股指数的全量日线。
 *
 * Yahoo 对 A 股指数基本没有历史（000300.SS 仅 2021 年起、399006.SZ 无数据、
 * 其余多数 firstTradeDate 为 null），所以 A 股必须走这个源。
 * 接口免费、无需密钥，`fqt=1` 取前复权，`klt=101` 为日线。
 *
 * klines 每行格式：
 *   日期,开,收,高,低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率
 * 收盘价取第 3 列（索引 2）。
 */
async function fetchEastmoney(def: IndexDef): Promise<DailyData | null> {
  const url =
    'https://push2his.eastmoney.com/api/qt/stock/kline/get' +
    `?secid=${encodeURIComponent(def.symbol)}` +
    '&fields1=f1,f2,f3,f4,f5,f6' +
    '&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61' +
    '&klt=101&fqt=1&beg=0&end=20500101&lmt=1000000'

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        // 东方财富对缺失 Referer 的请求偶发拒绝
        Referer: 'https://quote.eastmoney.com/',
      },
    })
    if (!res.ok) return null
    const json = (await res.json()) as EastmoneyKlineResponse
    const klines = json?.data?.klines
    if (!klines?.length) return null

    const dates: number[] = []
    const values: number[] = []
    for (const row of klines) {
      const parts = row.split(',')
      if (parts.length < 3) continue
      const d = Number(parts[0].replace(/-/g, ''))
      const c = Number(parts[2])
      if (!Number.isFinite(d) || !Number.isFinite(c) || c <= 0) continue
      dates.push(d)
      values.push(c)
    }
    if (dates.length < 1000) return null

    return {
      dates,
      closes: values,
      source: 'live',
      provider: `东方财富（${def.symbol}）`,
      fetchedAt: new Date().toISOString(),
    }
  } catch {
    return null
  }
}

function fetchLive(def: IndexDef): Promise<DailyData | null> {
  return def.provider === 'eastmoney' ? fetchEastmoney(def) : fetchYahoo(def)
}

function toYmd(unixSeconds: number): number {
  const d = new Date(unixSeconds * 1000)
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
}

/**
 * 东方财富 push2his/kline 的返回结构。
 * klines 每行是逗号分隔的字符串：
 *   日期,开,收,高,低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率
 * 只用到日期（第 0 列）与收盘（第 2 列），其余留给将来扩展。
 */
interface EastmoneyKlineResponse {
  data?: {
    code?: string
    name?: string
    klines?: string[]
  } | null
}

interface YahooChartResponse {
  chart?: {
    result?: {
      timestamp?: number[]
      indicators?: {
        quote?: { close?: (number | null)[]; volume?: (number | null)[] }[]
      }
    }[]
    error?: { description?: string } | null
  }
}

/**
 * 取某个指数的日线数据。优先实时，失败回落快照。
 * 非法 id 回落到默认指数（页面路由会先做 404 校验）。
 */
export async function loadDaily(indexId: string): Promise<DailyData> {
  const def = indexByIdOrDefault(indexId)

  const memo = memory.get(def.id)
  if (memo && isFresh(memo)) return memo.data

  const cached = await readPlatformCache(def.id)
  if (cached) {
    memory.set(def.id, { at: Date.parse(cached.fetchedAt), data: cached })
    return cached
  }

  const live = await fetchLive(def)
  const data = live ?? snapshot(def)

  memory.set(def.id, { at: Date.now(), data })
  // 只缓存实时数据到平台缓存，避免快照把「实时」长期盖住
  if (live) await writePlatformCache(def.id, data)
  return data
}

/** 强制忽略缓存（调试用） */
export async function loadDailyFresh(indexId: string): Promise<DailyData> {
  memory.delete(indexByIdOrDefault(indexId).id)
  return loadDaily(indexId)
}

export type { IndexId }

/* ─────────────────────── 通用 JSON 缓存（内存 + Cache API） ─────────────────── */

const payloadMemo = new Map<string, { at: number; value: unknown }>()

/**
 * 把「算一次很贵」的结果缓存起来。
 * Worker 免费版每个请求 CPU 有上限，命中缓存时几乎不消耗 CPU。
 */
export async function cachedJson<T>(
  key: string,
  ttlSeconds: number,
  produce: () => Promise<T>,
): Promise<T> {
  const memo = payloadMemo.get(key)
  if (memo && Date.now() - memo.at < ttlSeconds * 1000) return memo.value as T

  const cache = cfCache()
  // v5: payload 结构变更（SignalLevel 去 actionable、改拎 waterTriggered）
  // v4: 同行位置改展示超额（excess20）而非裸胜率
  const url = `https://deviation-monitor.internal/payload/v5/${key}`
  if (cache) {
    try {
      const hit = await cache.match(url)
      if (hit) {
        const value = (await hit.json()) as T
        payloadMemo.set(key, { at: Date.now(), value })
        return value
      }
    } catch {
      /* 忽略缓存读失败 */
    }
  }

  const value = await produce()
  payloadMemo.set(key, { at: Date.now(), value })
  if (cache) {
    try {
      await cache.put(
        url,
        new Response(JSON.stringify(value), {
          headers: {
            'content-type': 'application/json',
            'cache-control': `max-age=${ttlSeconds}`,
          },
        }),
      )
    } catch {
      /* 忽略缓存写失败 */
    }
  }
  return value
}
