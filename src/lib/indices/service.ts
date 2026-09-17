/**
 * 服务端接口层（TanStack Start server functions）。
 *
 * 客户端只能拿到 RPC 桩；真正的取数 + 计算全在这里。
 * `./source.server` 用动态 import 引入，确保客户端产物里绝不会出现它。
 *
 * 所有接口都接收 indexId，实现「一套逻辑服务 N 个指数」。
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { INDICES, actionOf, indexById } from './registry'
import { buildDashboard, buildOverviewRow, buildStats, extremesFor } from './queries'
import { buildSeries } from './series'
import { waterTriggered } from './stats'
import type { ComputedSeries, DataMeta, EraId, MaKey, OverviewPayload, RangeId } from './types'

const INDEX = z.string().min(1).max(32)
const RANGE = z.enum(['5y', '10y', '20y', 'max'])
/**
 * era 的取值必须覆盖全部市场（美股 1970/2000/2010 + A 股 2016/2019 +
 * 港股 1997/2014/2018 + 日股 1990/2013）。
 * 具体某个指数支持哪几段由 activeErasFor 在渲染层决定，这里只做「不是脏值」的校验。
 */
const ERA = z.enum([
  'all',
  'since1970',
  'since2000',
  'since2010',
  'since2016',
  'since2019',
  'since1997',
  'since2014',
  'since2018',
  'since1990',
  'since2013',
])
const MA = z.enum(['dev60', 'dev200'])

interface Bundle {
  series: ComputedSeries
  meta: DataMeta
  /** 数据版本号（指数 + 数据最后一天 + 数据来源），作为缓存 key 的一部分 */
  version: string
}

/**
 * 载荷缓存版本。
 * 只要改了统计口径、阈值集合或载荷结构，就把这个数字 +1，
 * 否则旧的缓存结果会在 TTL 内继续被返回，看起来像「改了没生效」。
 */
// v5: nasdaq 从纳斯达克综合（^IXIC）换为纳斯达克100（^NDX），历史序列整体更换
// v7: 新增 star50；SignalLevel 去掉 tone 口径的 actionable、
//     CurrentStatus/OverviewRow 改拎 waterTriggered（阈值口径唯一判定）
// v8: 兜底链加 KV 层，DataMeta.source 多出 'cached' 状态
// v9: 新增港股（恒生指数 / 恒生科技）与日经225，指数集合由 7 个变 10 个
const CACHE_VERSION = 9
/** 载荷缓存时长（秒）。日线一天更新一次，20 分钟足够 */
const TTL = 60 * 20

const bundles = new Map<string, Bundle>()

async function loadBundle(indexId: string): Promise<Bundle> {
  const def = indexById(indexId)
  if (!def) throw new Error(`未知指数：${indexId}`)

  const { loadDaily } = await import('./source.server')
  const daily = await loadDaily(def.id)
  const version = `v${CACHE_VERSION}-${def.id}-${daily.dates[daily.dates.length - 1]}-${daily.source}`

  const hit = bundles.get(def.id)
  if (hit && hit.version === version) return hit

  const series = buildSeries(daily.dates, daily.closes)
  if (series.dates.length < 300) {
    throw new Error(`${def.name} 的历史数据不足（${series.dates.length} 个交易日），无法统计`)
  }

  // 回溯段 = 数据源给出的、早于指数正式发布日的交易日。
  // liveSince 为 0 表示该指数不标注回溯段（美股），直接记 0。
  const rawFirstDate = daily.dates[0]
  const backfillDays = def.liveSince > 0 ? daily.dates.filter((d) => d < def.liveSince).length : 0

  const meta: DataMeta = {
    source: daily.source,
    indexId: def.id,
    name: def.name,
    symbol: def.symbol,
    provider: daily.provider,
    market: def.market,
    currency: def.currency,
    fetchedAt: daily.fetchedAt,
    firstDate: series.dates[0],
    rawFirstDate,
    lastDate: series.dates[series.dates.length - 1],
    tradingDays: series.dates.length,
    liveSince: def.liveSince,
    backfillDays,
  }
  const bundle = { series, meta, version }
  bundles.set(def.id, bundle)
  return bundle
}

/** 总览页：所有指数各一行摘要 */
export const getOverview = createServerFn({ method: 'GET' }).handler(async () => {
  const { cachedJson } = await import('./source.server')
  const rows = await Promise.all(
    INDICES.map(async (def) => {
      const { series, meta, version } = await loadBundle(def.id)
      return cachedJson(`ov:${version}`, TTL, async () =>
        buildOverviewRow(series, meta, def, def.action),
      )
    }),
  )
  const payload: OverviewPayload = {
    generatedAt: new Date().toISOString(),
    rows,
  }
  return payload
})

/** 单指数详情页数据 */
export const getDashboard = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      indexId: INDEX,
      range: RANGE.default('10y'),
      era: ERA.default('all'),
    }),
  )
  .handler(async ({ data }) => {
    const { cachedJson } = await import('./source.server')
    const { series, meta, version } = await loadBundle(data.indexId)
    const range = data.range as RangeId
    const era = data.era as EraId
    return cachedJson(`${version}:${range}:${era}`, TTL, async () =>
      buildDashboard(series, meta, range, era, actionOf(data.indexId)),
    )
  })

/** 单指数完整概率统计 */
export const getStats = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      indexId: INDEX,
      era: ERA.default('all'),
      ma: MA.default('dev200'),
      horizon: z.number().int().min(5).max(60).default(20),
    }),
  )
  .handler(async ({ data }) => {
    const { cachedJson } = await import('./source.server')
    const { series, meta, version } = await loadBundle(data.indexId)
    const era = data.era as EraId
    const ma = data.ma as MaKey
    return cachedJson(`s:${version}:${era}:${ma}:${data.horizon}`, TTL, async () =>
      buildStats(series, meta, era, ma, data.horizon, actionOf(data.indexId)),
    )
  })

/** 历史极值样本 */
export const getExtremes = createServerFn({ method: 'GET' })
  .validator(z.object({ indexId: INDEX, era: ERA.default('all') }))
  .handler(async ({ data }) => {
    const { cachedJson } = await import('./source.server')
    const { series, meta, version } = await loadBundle(data.indexId)
    const era = data.era as EraId
    return cachedJson(`e:${version}:${era}`, TTL, async () => extremesFor(series, meta, era))
  })

/**
 * 单点状态（供 JSON 接口 / 定时告警消费）。
 * 直接导出普通 async 函数，方便路由文件与外部调用复用，不必走 RPC。
 */
export async function alertState(indexId: string) {
  const def = indexById(indexId)
  if (!def) return null

  const { series, meta } = await loadBundle(def.id)
  const action = def.action
  const i = series.dates.length - 1
  const dev60 = series.dev60[i]
  const dev200 = series.dev200[i]

  const flags = [
    {
      key: 'dev60',
      label:
        action.dev60 === null
          ? '60 日偏离度（该口径无标定水位）'
          : `60 日偏离度 ≤ ${action.dev60}%`,
      value: round(dev60),
      threshold: action.dev60,
      triggered: action.dev60 !== null && dev60 <= action.dev60,
    },
    {
      key: 'dev200',
      label:
        action.dev200 === null
          ? '200 日偏离度（该口径无标定水位）'
          : `200 日偏离度 ≤ ${action.dev200}%`,
      value: round(dev200),
      threshold: action.dev200,
      triggered: action.dev200 !== null && dev200 <= action.dev200,
    },
  ]

  return {
    indexId: def.id,
    name: def.name,
    market: def.market,
    currency: def.currency,
    symbol: def.symbol,
    meta,
    date: series.dates[i],
    close: round(series.close[i]),
    ma60: round(series.ma60[i]),
    ma200: round(series.ma200[i]),
    dev60: round(dev60),
    dev200: round(dev200),
    flags,
    // 与页面「触发关注」同源同义（stats.ts 的 waterTriggered），不再是另一套判定
    actionable: waterTriggered(dev60, dev200, action),
  }
}

/** 全部指数的当前状态，供「一次调用看全部」的告警场景 */
export async function alertStateAll() {
  const all = await Promise.all(INDICES.map((def) => alertState(def.id)))
  return all.filter((x) => x !== null)
}

function round(v: number): number {
  return Math.round(v * 100) / 100
}
