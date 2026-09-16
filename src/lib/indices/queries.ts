/**
 * 载荷构建（同构纯函数，不碰任何服务端 API）。
 * 只在 server function 的 handler 里被调用。
 */
import {
  histogram,
  indexOfDate,
  rangeStartIndex,
  sampleIndices,
  ymdToIso,
} from './series'
import {
  baselineRates,
  currentStatus,
  eraWindow,
  extremePoints,
  neighborhoodStats,
  revertStats,
  thresholdRow,
  thresholdTable,
} from './stats'
import {
  erasForMarket,
  RANGES,
  type AnalogAnswer,
  type ChartMarks,
  type ChartPayload,
  type ComputedSeries,
  type DashboardPayload,
  type DataMeta,
  type Era,
  type EraId,
  type EraSummaryRow,
  type MaKey,
  type OverviewRow,
  type RangeId,
  type StatsPayload,
  type ThresholdRow,
} from './types'
import type { ActionLevels, IndexDef, MarketId } from './registry'

/**
 * 取某个市场下的某个历史分段。
 * 必须带 market —— 美股的「1970 年后」在 A 股不存在，反之亦然；
 * 如果只按 id 查，`?era=since1970` 落在沪深300 上会静默取到错误的一段。
 */
export function eraById(market: MarketId, id: EraId): Era {
  const list = erasForMarket(market)
  return list.find((e) => e.id === id) ?? list[0]
}

/**
 * 该指数真正有效的历史分段。
 *
 * 分段的意义来自该市场自身的制度变迁，所以先按市场取全集，
 * 再剔除「起点早于数据起点」的段 —— 对 2005 年才有数据的沪深300 来说，
 * 「1970 年后」和「全部历史」会是同一段数据，这种分段没有信息量，
 * 直接隐藏，避免表格里出现两行一模一样的数字。
 */
export function activeErasFor(market: MarketId, firstDate: number): Era[] {
  return erasForMarket(market).filter((e) => e.start === 0 || e.start > firstDate)
}

/** 复归统计使用的越界水位（正负各一次） */
export const REVERT_LEVEL = 6

export function rangeYearsLabel(s: ComputedSeries, w: { from: number; to: number }): string {
  if (w.to - w.from < 2) return '—'
  const a = String(s.dates[w.from])
  const b = String(s.dates[w.to - 1])
  return `${a.slice(0, 4)}–${b.slice(0, 4)}`
}

/**
 * 抽样出图表用的序列。
 * 抽样下标对所有序列共用，保证同一天在图上是同一个 x 坐标。
 */
function chartFor(s: ComputedSeries, from: number, extra: number[]): ChartPayload {
  const idx = Array.from(new Set([...sampleIndices(from, s.dates.length, 1300), ...extra]))
    .filter((i) => i >= from && i < s.dates.length)
    .sort((a, b) => a - b)

  const dates: number[] = []
  const close: number[] = []
  const ma60: number[] = []
  const ma200: number[] = []
  const dev60: number[] = []
  const dev200: number[] = []
  for (const i of idx) {
    dates.push(s.dates[i])
    close.push(round2(s.close[i]))
    ma60.push(round2(s.ma60[i]))
    ma200.push(round2(s.ma200[i]))
    dev60.push(round2(s.dev60[i]))
    dev200.push(round2(s.dev200[i]))
  }
  return { dates, close, ma60, ma200, dev60, dev200 }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** 分位（线性插值）。sorted 必须已升序 */
function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return Number.NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function marksFor(s: ComputedSeries, from: number): ChartMarks {
  const at = (i: number, values: number[]) => ({
    date: s.dates[i],
    value: round2(values[i]),
  })
  const argMin = (values: number[]) => {
    let best = from
    for (let i = from; i < values.length; i++) if (values[i] < values[best]) best = i
    return best
  }
  const argMax = (values: number[]) => {
    let best = from
    for (let i = from; i < values.length; i++) if (values[i] > values[best]) best = i
    return best
  }
  return {
    minDev60: at(argMin(s.dev60), s.dev60),
    maxDev60: at(argMax(s.dev60), s.dev60),
    minDev200: at(argMin(s.dev200), s.dev200),
    maxDev200: at(argMax(s.dev200), s.dev200),
    lowClose: at(argMin(s.close), s.close),
    highClose: at(argMax(s.close), s.close),
  }
}

/** 「同类位置」样本下限：低于此数参考价值有限（与方法页口径一致），超额如实给 null */
const ANALOG_MIN_SAMPLES = 30

function analog(s: ComputedSeries, key: MaKey, era: Era): AnalogAnswer {
  const center = s[key][s.dates.length - 1]
  const { row } = neighborhoodStats(s, key, era, center, 1)
  const h20 = row.horizons.find((x) => x.days === 20)
  const h60 = row.horizons.find((x) => x.days === 60)
  const base20 = baselineRates(s, eraWindow(s, era)).find((b) => b.days === 20)?.winRate
  const win20 = h20?.winRate ?? Number.NaN
  const excess20 =
    Number.isFinite(win20) &&
    Number.isFinite(base20 ?? Number.NaN) &&
    row.sampleDays >= ANALOG_MIN_SAMPLES
      ? round2((win20 - (base20 as number)) * 100)
      : null
  return {
    center: round2(center),
    sampleDays: row.sampleDays,
    episodes: row.episodes,
    win20,
    excess20,
    avg20: h20?.avg ?? 0,
    median20: h20?.median ?? 0,
    win60: h60?.winRate ?? Number.NaN,
    avg60: h60?.avg ?? 0,
    worst60: h60?.worst ?? 0,
  }
}

/**
 * 行动水位在各历史时期的表现。
 *
 * level 为 null（该指数此口径无标定水位）时，用一个永不触发的探针值，
 * 让表格如实输出「各时期 0 次信号」，而不是随便挑一档来填格子。
 */
export function eraSummary(
  s: ComputedSeries,
  market: MarketId,
  key: MaKey,
  level: number | null,
): EraSummaryRow[] {
  const probe = level ?? -9999
  return activeErasFor(market, s.dates[0]).map((era) => {
    const w = eraWindow(s, era)
    const row = thresholdRow(s, key, w, probe, 'below')
    return {
      id: era.id,
      label: era.label,
      note: era.note,
      years: rangeYearsLabel(s, w),
      samples: row.sampleDays,
      episodes: row.episodes,
      win20: row.horizons.find((h) => h.days === 20)?.winRate ?? Number.NaN,
      avg20: row.horizons.find((h) => h.days === 20)?.avg ?? 0,
      win60: row.horizons.find((h) => h.days === 60)?.winRate ?? Number.NaN,
      avg60: row.horizons.find((h) => h.days === 60)?.avg ?? 0,
    }
  })
}

export function buildDashboard(
  s: ComputedSeries,
  meta: DataMeta,
  range: RangeId,
  eraId: EraId,
  action: ActionLevels,
): DashboardPayload {
  const era = eraById(meta.market, eraId)
  const w = eraWindow(s, era)
  const from = rangeStartIndex(s, range)
  const marks = marksFor(s, from)

  const chart = chartFor(s, from, [
    indexOfDate(s.dates, marks.minDev60.date),
    indexOfDate(s.dates, marks.maxDev60.date),
    indexOfDate(s.dates, marks.minDev200.date),
    indexOfDate(s.dates, marks.maxDev200.date),
    indexOfDate(s.dates, marks.lowClose.date),
    indexOfDate(s.dates, marks.highClose.date),
  ])

  return {
    meta,
    status: currentStatus(s, era, action),
    range,
    era: eraId,
    chart,
    chartMarks: marks,
    hist: histogram(s.dev60.slice(w.from, w.to), s.dev200.slice(w.from, w.to), 56),
    dip60: thresholdTable(s, 'dev60', era, 'below'),
    top60: thresholdTable(s, 'dev60', era, 'above'),
    dip200: thresholdTable(s, 'dev200', era, 'below'),
    top200: thresholdTable(s, 'dev200', era, 'above'),
    analogs: {
      dev60: analog(s, 'dev60', era),
      dev200: analog(s, 'dev200', era),
    },
    eraSummary: eraSummary(s, meta.market, 'dev200', action.dev200),
    actionLevel: { dev60: action.dev60, dev200: action.dev200 },
    baseline: baselineRates(s, w),
  }
}

export function buildStats(
  s: ComputedSeries,
  meta: DataMeta,
  eraId: EraId,
  ma: MaKey,
  horizon: number,
  action: ActionLevels,
): StatsPayload {
  const era = eraById(meta.market, eraId)
  const w = eraWindow(s, era)

  // 各时期 × 各阈值的胜率矩阵：用来直观看到「QE 时代 / 2016 后胜率抬升」。
  // 阈值档位必须按均线口径区分：60 日偏离度的波动幅度远小于 200 日，
  // 用同一组档位会出现整列空白。
  const levels = ma === 'dev60' ? [-2, -4, -6, -8, -10, -12] : [-4, -6, -8, -10, -12, -15]
  const eraByThreshold = levels.map((threshold) => ({
    threshold,
    cells: activeErasFor(meta.market, s.dates[0]).map((e) => {
      const row = thresholdRow(s, ma, eraWindow(s, e), threshold, 'below')
      const h = row.horizons.find((x) => x.days === horizon) ?? row.horizons[0]
      return {
        id: e.id,
        label: e.label,
        winRate: h.winRate,
        samples: row.sampleDays,
        avg: h.avg,
      }
    }),
  }))

  return {
    meta,
    era: eraId,
    ma,
    horizon,
    dip: thresholdTable(s, ma, era, 'below'),
    top: thresholdTable(s, ma, era, 'above'),
    revert: {
      dip: {
        level: REVERT_LEVEL,
        ...revertStats(s, ma, era, REVERT_LEVEL, 'below'),
      },
      top: {
        level: REVERT_LEVEL,
        ...revertStats(s, ma, era, REVERT_LEVEL, 'above'),
      },
    },
    eraByThreshold,
    eraSummary: eraSummary(s, meta.market, ma, ma === 'dev60' ? action.dev60 : action.dev200),
    baseline: baselineRates(s, w),
  }
}

/**
 * 总览页用的单指数摘要。
 * 只算「一行需要的东西」：当前值、同类位置超额、距水位、迷你线。
 * 刻意不做全量阈值表 —— 那是详情页的活儿。
 */
export function buildOverviewRow(
  s: ComputedSeries,
  meta: DataMeta,
  def: IndexDef,
  action: ActionLevels,
): OverviewRow {
  const era = eraById(meta.market, 'all')
  const status = currentStatus(s, era, action)
  const a = analog(s, 'dev200', era)

  return {
    id: def.id,
    name: def.name,
    enName: def.enName,
    ticker: def.ticker,
    symbol: def.symbol,
    market: def.market,
    currency: def.currency,
    date: status.date,
    close: round2(status.close),
    dev60: round2(status.dev60),
    dev200: round2(status.dev200),
    analogExcess: a.excess20,
    analogSamples: a.sampleDays,
    to200: status.toThreshold200 === null ? null : round2(status.toThreshold200),
    signal: status.signal,
    spark: sparkFor(s, 'dev200', 260, 96),
    source: meta.source,
  }
}

/** 取最近 n 个交易日的某条序列，重采样到约 target 个点（画迷你线用） */
function sparkFor(s: ComputedSeries, key: MaKey, n: number, target: number): number[] {
  const from = Math.max(0, s.dates.length - n)
  const idx = sampleIndices(from, s.dates.length, target)
  return idx.map((i) => round2(s[key][i]))
}

export function extremesFor(s: ComputedSeries, meta: DataMeta, eraId: EraId) {
  const era = eraById(meta.market, eraId)
  return extremePoints(s, 'dev200', era, 10)
}

export function rangeLabelOf(range: RangeId): string {
  return RANGES.find((r) => r.id === range)?.label ?? range
}

export { ymdToIso }
export type { ThresholdRow }
