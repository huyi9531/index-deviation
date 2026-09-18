/**
 * 服务端数据源（server-only，禁止被客户端代码导入）。
 *
 * 策略：
 *   1. 内存缓存（同一 isolate 复用，TTL 内直接命中）
 *   2. Cloudflare Cache API（跨 isolate 共享，TTL 内直接命中）
 *   3. 实时拉取实时源：美股 / 日经225 走 Yahoo Finance chart API，
 *      A 股 / 港股走东方财富 push2his（按指数注册表里的 provider 派发）
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
import hsiSeed from '~/data/hsi-daily.csv?raw'
import hstechSeed from '~/data/hstech-daily.csv?raw'
import n225Seed from '~/data/n225-daily.csv?raw'
import nasdaqSeed from '~/data/nasdaq-daily.csv?raw'
import sp500Seed from '~/data/sp500-daily.csv?raw'
import { PROVIDER_LABEL, indexByIdOrDefault, type IndexDef, type IndexId } from './registry'
import { parseCsv } from './series'

export interface DailyData {
  dates: number[]
  closes: number[]
  /**
   * live     —— 本次请求从实时源抓到
   * cached   —— 实时源不可达，取自 KV 里的「上次成功抓取」
   * snapshot —— KV 也没有，退到构建时内置的离线快照
   */
  source: 'live' | 'cached' | 'snapshot'
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
  hsi: hsiSeed,
  hstech: hstechSeed,
  n225: n225Seed,
}

/** 统一从 1948 年拉起，保证 200 日均线有足够预热期 */
const HISTORY_START_UNIX = Math.floor(Date.UTC(1948, 0, 1) / 1000)

/** 实时数据缓存时长：20 分钟。日线在美东收盘后更新一次，够用 */
const LIVE_TTL_SECONDS = 20 * 60
/** 非实时兜底源（KV 缓存 / 内置快照）的内存缓存时长：5 分钟，好让实时源恢复后尽快切回去 */
const FALLBACK_TTL_SECONDS = 5 * 60

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
  const ttl = entry.data.source === 'live' ? LIVE_TTL_SECONDS : FALLBACK_TTL_SECONDS
  return Date.now() - entry.at < ttl * 1000
}

function cacheUrl(id: string): string {
  // v3: DailyData 增加成交额（amounts）字段；v2 是 nasdaq 从综合指数换为 NDX
  return `https://deviation-monitor.internal/daily-v3/${id}`
}

async function readPlatformCache(id: string): Promise<DailyData | null> {
  const cache = cfCache()
  if (!cache) return null
  try {
    const hit = await cache.match(cacheUrl(id))
    if (!hit) return null
    const payload = (await hit.json()) as DailyData
    if (!payload?.dates?.length) return null
    const ttl = payload.source === 'live' ? LIVE_TTL_SECONDS : FALLBACK_TTL_SECONDS
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

/* ─────────────────── KV：把「上次成功抓取」持久化，当兜底 ─────────────────── */

/**
 * 兜底链里的第 3 层（内存缓存 → 平台缓存 → **KV** → 内置离线快照）。
 *
 * 为什么不能用平台缓存（Cache API）顶替：它是缓存、会被驱逐，而且写进去时带的
 * `cache-control: max-age=3600` 把保留期封到 1 小时。KV 是持久存储，
 * 能把兜底数据的基准从「上次部署」（内置快照是构建产物，只在重新部署时更新）
 * 变成「上次成功抓取」。
 *
 * 类型用最小自声明，刻意不依赖 `wrangler types` 生成的 worker-configuration.d.ts
 * —— 那个文件在 .gitignore 里，新克隆的仓库没有它，直接引用会让 tsc 挂掉。
 * 同理用动态 import：本地无绑定（如纯 Node 环境）时能优雅退回下一层。
 */
interface DailyKv {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
}

/**
 * `cloudflare:workers` 里我们用到的最小面。
 *
 * `waitUntil` 是关键：不把写 promise 挂上去，它会在请求上下文结束时被取消。
 * 实测教训：初版用 `void writeKv(...)`，本地看着一切正常（读路径能拿到注入数据），
 * 但生产 KV 里什么都没写进去（`wrangler kv key get --remote` 返回 404）。
 */
interface CfWorkersBinding {
  env?: { DAILY_DATA?: DailyKv }
  waitUntil?: (promise: Promise<unknown>) => void
}

let cfModule: CfWorkersBinding | null | undefined

/**
 * 取 `cloudflare:workers` 模块（带缓存，首次之后无 I/O）。
 *
 * ⚠️ 这里的 @ts-expect-error 是必要的，不是偷懒：'cloudflare:workers' 的模块声明来自
 * `wrangler types` 生成的 worker-configuration.d.ts，而那个文件在 .gitignore 里 ——
 * 新克隆的仓库没有它，字面量 import 会让 `npm run build`（vite build && tsc --noEmit）
 * 在 tsc 环节直接挂掉。
 * 用它而不是 @ts-expect-error：后者在生成文件**存在**时会报「未使用的指令」，
 * 反而把另一种环境弄坏。
 * 也不能自己写 shim：生成文件用的是 `export =`，会与具名导出声明冲突。
 */
async function cfWorkers(): Promise<CfWorkersBinding | null> {
  if (cfModule !== undefined) return cfModule
  try {
    // biome-ignore lint/suspicious/noTsIgnore: 这里必须是 @ts-ignore，理由见上（biome 的 unsafe fix 会把它改成 @ts-expect-error，反而把另一种环境弄坏）
    // @ts-ignore 模块声明可能不存在于干净仓库
    cfModule = (await import('cloudflare:workers')) as CfWorkersBinding
  } catch {
    cfModule = null
  }
  return cfModule
}

const kvKey = (id: string) => `daily/${id}`

/** 读「上次成功抓取」。读不到（无绑定 / 无记录 / 损坏）一律返回 null，交给下一层 */
async function readKv(id: string): Promise<DailyData | null> {
  const kv = (await cfWorkers())?.env?.DAILY_DATA
  if (!kv) return null
  try {
    const raw = await kv.get(kvKey(id))
    if (!raw) return null
    const data = JSON.parse(raw) as DailyData
    if (!data?.dates?.length || !data?.closes?.length) return null
    // 存进去时它是 live，读回来必须如实改成 cached —— 否则兜底数据会冒充实时
    return { ...data, source: 'cached' }
  } catch {
    return null
  }
}

/**
 * 写「上次成功抓取」。仅在**数据末日推进**时真写。
 *
 * 免费额度是 1000 写/天：不做去重的话，7 个指数 × 每 20 分钟一次实时抓取
 * = 504 写/天，只余一倍余量；按末日去重后降到 ~7 写/天。
 */
async function putKv(kv: DailyKv, id: string, data: DailyData): Promise<void> {
  const key = kvKey(id)
  const prev = await kv.get(key)
  // 读回来的是上次写的 JSON；内容坏了就当「没有上一条」—— 宁可多写一次，
  // 也不能因为一条坏记录把写入卡死（那样就永远停在旧快照上了）
  let prevLast: number | undefined
  if (prev) {
    try {
      prevLast = (JSON.parse(prev) as DailyData)?.dates?.at(-1)
    } catch {
      prevLast = undefined
    }
  }
  if (prevLast === data.dates.at(-1)) return
  await kv.put(key, JSON.stringify(data))
}

/**
 * 把写挂到请求生命周期上异步执行（`waitUntil`），不阻塞响应。
 * 无绑定（纯 Node 环境）直接跳过；`waitUntil` 不可用时退回 `await`（至少不丢写）。
 */
async function scheduleKvWrite(id: string, data: DailyData): Promise<void> {
  const cf = await cfWorkers()
  const kv = cf?.env?.DAILY_DATA
  if (!cf || !kv) return
  const task = putKv(kv, id, data).catch(() => {
    /* 写失败不影响主流程：下一次实时抓取成功还有机会写 */
  })
  try {
    if (cf.waitUntil) {
      cf.waitUntil(task)
      return
    }
  } catch {
    /* waitUntil 在非请求上下文会抛，退回 await */
  }
  await task
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
 * 东方财富 kline 的取数 host，按可用性排序逐个试。
 *
 * ⚠️ 为什么官网那个 `push2his.eastmoney.com` 不在第一位（2026-09-16 实测）：
 * 从 Cloudflare 边缘（colo SJC）打它的 /api/qt/stock/kline/get **100% 返回 520**
 * （`error code: 520`），带不带 UA/Referer、http/https 都一样；同一个 host 的
 * /trends2/get 却是 200 —— 是东财 WAF 按路径拦了机房 IP，不是域名挂了、也不是请求头不对。
 * 直接后果：Worker 里 A 股实时抓取一直失败 → 全走内置快照（KV 里一条 A 股记录都没有，
 * 因为 KV 只在抓取成功时才写）。
 *
 * 编号集群节点（1./2./7.…）是独立的源站集群，实测从同一边缘 5 个 A 股指数全量历史都能拿到，
 * 且与官网域名数据一致（中证A500 末根 2026-09-16 收 5537.96，两边同值）。
 * 官网域名留作最后兵底：万一哪天编号节点也上了同一条规则，而官网那条又放开。
 *
 * 代价：首个 host 不可用时要多等一次往返（实测 0.2~2.6s），但 20 分钟才抓一次且结果进缓存，
 * 对页面无感。注意：`scripts/build-seed.mjs`（本地跑的）仍用官网域名 ——
 * 本地是住宅 IP，没这个限制，两边不必强行统一。
 */
const EASTMONEY_KLINE_HOSTS = [
  'https://1.push2his.eastmoney.com',
  'https://2.push2his.eastmoney.com',
  'https://push2his.eastmoney.com',
]

/**
 * 从东方财富拉某个 A 股指数的全量日线。
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
  const path =
    '/api/qt/stock/kline/get' +
    `?secid=${encodeURIComponent(def.symbol)}` +
    '&fields1=f1,f2,f3,f4,f5,f6' +
    '&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61' +
    '&klt=101&fqt=1&beg=0&end=20500101&lmt=1000000'

  for (const host of EASTMONEY_KLINE_HOSTS) {
    try {
      const res = await fetch(host + path, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          // 东方财富对缺失 Referer 的请求偶发拒绝
          Referer: 'https://quote.eastmoney.com/',
        },
      })
      if (!res.ok) {
        // 保留诊断：这一层静默失败曾经让我们只能靠写探针 worker 才找到 520
        console.error(`[eastmoney] ${host} → HTTP ${res.status}（${def.id}）`)
        continue
      }
      const json = (await res.json()) as EastmoneyKlineResponse
      const klines = json?.data?.klines
      if (!klines?.length) {
        // 有些 host（如 push2 / push2delay）会回 200 但 dktotal=0、不带 klines
        console.error(`[eastmoney] ${host} 返回成功但无 klines（${def.id}）`)
        continue
      }

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
      if (dates.length < 1000) {
        console.error(`[eastmoney] ${host} 历史太短（${def.id}：${dates.length} 根）`)
        continue
      }

      return {
        dates,
        closes: values,
        source: 'live',
        provider: `东方财富（${def.symbol}）`,
        fetchedAt: new Date().toISOString(),
      }
    } catch (e) {
      // 不 rethrow：本循环的语义是「这个 host 不行就换下一个」，
      // 三个都不行时用 return null 告诉上层去走兜底链。
      console.error(
        `[eastmoney] ${host} 取数异常（${def.id}）：${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
  // 三个 host 全不行 —— 交给上层回落下一级兜底（缓存 / KV / 快照）
  return null
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
 * 取某个指数的日线数据，按四级兜底：
 *   ① 内存缓存（实时，≤20min）
 *   ② 平台缓存（实时，≤20min）
 *   ③ KV（上次成功抓取；比构建时内置的快照新）
 *   ④ 内置离线快照（构建产物，只在重新部署时更新）
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
  if (live) {
    memory.set(def.id, { at: Date.now(), data: live })
    await writePlatformCache(def.id, live)
    // 异步写 KV，不阻塞响应；只在末日推进时真写（见 putKv）
    await scheduleKvWrite(def.id, live)
    return live
  }

  // 实时不可用：先试 KV（上次成功抓取），再落内置离线快照
  const kvData = await readKv(def.id)
  const data = kvData ?? snapshot(def)
  memory.set(def.id, { at: Date.now(), data })
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
  // v8: 行动水位补了三格（nasdaq dev60 / hs300 dev60 / a500 dev60），
  //     status 与 eraSummary 里的水位相关字段值变了
  // v7: 指数集合从 7 个变 10 个（新增恒生指数 / 恒生科技 / 日经225），
  //     /api/all 的 count 与总览行数都变了
  // v6: 兜底链加 KV 层，DataMeta.source 多出 'cached' 状态
  // v5: payload 结构变更（SignalLevel 去 actionable、改拎 waterTriggered）
  // v4: 同行位置改展示超额（excess20）而非裸胜率
  const url = `https://deviation-monitor.internal/payload/v8/${key}`
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
