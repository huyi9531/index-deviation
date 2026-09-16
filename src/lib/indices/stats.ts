import { indexOfDate, logDeviation, median, percentileRank, sortedCopy } from './series'
import type {
  BaselineStat,
  ComputedSeries,
  CurrentStatus,
  Era,
  ExtremePoint,
  HorizonStat,
  MaKey,
  ThresholdRow,
} from './types'

/** 前瞻观察窗口（交易日） */
export const HORIZONS = [5, 10, 20, 60] as const

/** 抄底扫描阈值（偏离度 ≤ 阈值） */
export const DIP_THRESHOLDS = [-2, -4, -6, -8, -10, -12, -15] as const
/** 逃顶扫描阈值（偏离度 ≥ 阈值） */
export const TOP_THRESHOLDS = [2, 4, 6, 8, 10, 12] as const

/** 缺省水位（仅在调用方没传 index 定义时兜底；正事请用 registry 里实测标定的值） */
export const ACTION_LEVEL: { dev60: number | null; dev200: number | null } = {
  dev60: -8,
  dev200: -10,
}

export interface Window {
  from: number
  to: number
}

/**
 * 不设任何条件时的基准表现：窗口内每一天都持有 N 日的胜率与均值。
 *
 * 这是判断某个阈值胜率是否真有超额的唯一参照。没有它的话，
 * 标普 200 日偏离度 ≤ −10% 的「20 日胜率 62.4%」看起来很好，
 * 而实际上无条件持有的胜率就有 61.8%。
 */
export function baselineRates(s: ComputedSeries, w: Window): BaselineStat[] {
  return HORIZONS.map((days) => {
    const rets: number[] = []
    for (let i = w.from; i < w.to; i++) {
      const r = forwardReturn(s.close, i, days)
      if (r === null) continue
      rets.push(r)
    }
    if (rets.length === 0) return { days, winRate: Number.NaN, avg: 0 }
    let sum = 0
    let wins = 0
    for (const r of rets) {
      sum += r
      if (r > 0) wins += 1
    }
    return { days, winRate: wins / rets.length, avg: sum / rets.length }
  })
}

/** 取某段历史的索引窗口（左闭右开） */
export function eraWindow(s: ComputedSeries, era: Era): Window {
  return { from: indexOfDate(s.dates, era.start), to: s.dates.length }
}

export function clampWindow(w: Window, n: number): Window {
  return {
    from: Math.max(0, Math.min(w.from, n)),
    to: Math.max(0, Math.min(w.to, n)),
  }
}

/**
 * 单点前瞻收益：收益 = 收盘[i+h] / 收盘[i] - 1
 */
function forwardReturn(close: number[], i: number, h: number): number | null {
  const j = i + h
  if (j >= close.length) return null
  return close[j] / close[i] - 1
}

function summarize(
  s: ComputedSeries,
  indices: number[],
  direction: 'below' | 'above',
): HorizonStat[] {
  return HORIZONS.map((days) => {
    const rets: number[] = []
    for (const i of indices) {
      const r = forwardReturn(s.close, i, days)
      if (r === null) continue
      rets.push(r)
    }
    if (rets.length === 0) {
      return {
        days,
        winRate: Number.NaN,
        avg: 0,
        median: 0,
        worst: 0,
        best: 0,
      }
    }
    let sum = 0
    let worst = Number.POSITIVE_INFINITY
    let best = Number.NEGATIVE_INFINITY
    let wins = 0
    for (const r of rets) {
      sum += r
      if (r < worst) worst = r
      if (r > best) best = r
      const isWin = direction === 'below' ? r > 0 : r < 0
      if (isWin) wins += 1
    }
    return {
      days,
      winRate: wins / rets.length,
      avg: sum / rets.length,
      median: median(rets),
      worst,
      best,
    }
  })
}

/**
 * 扫描某个阈值。
 * - sampleDays：所有满足条件的交易日数量（与视频口径一致）
 * - episodes：把连续满足的区间合并后剩下的「独立信号」次数
 *   （同一次下跌里连续 30 天低于阈值，只算 1 次机会）
 */
export function thresholdRow(
  s: ComputedSeries,
  key: MaKey,
  w: Window,
  threshold: number,
  direction: 'below' | 'above',
): ThresholdRow {
  const dev = s[key]
  const hit = (i: number) => (direction === 'below' ? dev[i] <= threshold : dev[i] >= threshold)

  const indices: number[] = []
  let episodes = 0
  for (let i = w.from; i < w.to; i++) {
    if (!hit(i)) continue
    indices.push(i)
    const prevHit = i > 0 && hit(i - 1)
    if (!prevHit) episodes += 1
  }

  return {
    threshold,
    direction,
    sampleDays: indices.length,
    episodes,
    triggeredNow: dev.length > 0 && hit(dev.length - 1),
    horizons: summarize(s, indices, direction),
  }
}

export function thresholdTable(
  s: ComputedSeries,
  key: MaKey,
  era: Era,
  direction: 'below' | 'above',
): ThresholdRow[] {
  const w = eraWindow(s, era)
  const list = direction === 'below' ? DIP_THRESHOLDS : TOP_THRESHOLDS
  return list.map((t) => thresholdRow(s, key, w, t, direction))
}

/**
 * 「同类位置」统计：历史上偏离度落在当前值 ±width 之内的那些日子，
 * 之后的表现如何。这是对「现在能不能动手」最直接的回答。
 *
 * 注意：这里固定用 'below' 口径，也就是胜率恒为「上涨的比例」。
 * 不管当前偏离度是正还是负，卡片上的「上涨概率」都指同一件事，
 * 不会因为符号而悄悄变成「下跌概率」。
 */
export function neighborhoodStats(
  s: ComputedSeries,
  key: MaKey,
  era: Era,
  center: number,
  width = 1,
): { row: ThresholdRow; indices: number[] } {
  const w = eraWindow(s, era)
  const dev = s[key]
  const indices: number[] = []
  for (let i = w.from; i < w.to; i++) {
    if (Math.abs(dev[i] - center) <= width) indices.push(i)
  }
  return {
    indices,
    row: {
      threshold: center,
      direction: 'below',
      sampleDays: indices.length,
      episodes: countEpisodes(indices),
      triggeredNow: true,
      horizons: summarize(s, indices, 'below'),
    },
  }
}

function countEpisodes(indices: number[]): number {
  let count = 0
  let prev = Number.NaN
  for (const i of indices) {
    if (i !== prev + 1) count += 1
    prev = i
  }
  return count
}

/** 历史极值 + 之后的复归速度 */
export function extremePoints(
  s: ComputedSeries,
  key: MaKey,
  era: Era,
  count = 12,
): { lows: ExtremePoint[]; highs: ExtremePoint[] } {
  const w = eraWindow(s, era)
  const dev = s[key]
  const REVERT_LOOKAHEAD = 250

  const build = (i: number): ExtremePoint => {
    const fwd20 = forwardReturn(s.close, i, 20)
    const fwd60 = forwardReturn(s.close, i, 60)
    return {
      date: s.dates[i],
      close: s.close[i],
      dev60: s.dev60[i],
      dev200: s.dev200[i],
      fwd20: fwd20 ?? 0,
      fwd60: fwd60 ?? 0,
      daysToRevert: daysToRevert(s, key, i, REVERT_LOOKAHEAD),
    }
  }

  // 去重叠：极值点之间至少间隔 60 个交易日，避免同一次暴跌被重复计入
  const pick = (dir: 'low' | 'high') => {
    const order: number[] = []
    for (let i = w.from; i < w.to; i++) order.push(i)
    order.sort((a, b) => (dir === 'low' ? dev[a] - dev[b] : dev[b] - dev[a]))
    const chosen: number[] = []
    for (const i of order) {
      if (chosen.length >= count) break
      if (chosen.some((c) => Math.abs(c - i) < 60)) continue
      chosen.push(i)
    }
    chosen.sort((a, b) => a - b)
    return chosen.map(build)
  }

  return { lows: pick('low'), highs: pick('high') }
}

/**
 * 从第 i 天算起，偏离度回到 ±1% 以内需要多少个交易日。
 * 最多向后看 limit 天；找不到返回 -1（表示「长期没有复归」）。
 */
function daysToRevert(s: ComputedSeries, key: MaKey, i: number, limit: number): number {
  const dev = s[key]
  const end = Math.min(s.dates.length, i + limit + 1)
  for (let j = i + 1; j < end; j++) {
    if (Math.abs(dev[j]) <= 1) return j - i
  }
  return -1
}

/** 复归统计：在 era 内所有越过 level 的日子，平均多久回到 ±1% */
export function revertStats(
  s: ComputedSeries,
  key: MaKey,
  era: Era,
  level: number,
  direction: 'below' | 'above',
): {
  samples: number
  within20: number
  within60: number
  within250: number
  never: number
  medianDays: number
} {
  const w = eraWindow(s, era)
  const dev = s[key]
  const days: number[] = []
  let within20 = 0
  let within60 = 0
  let within250 = 0
  let never = 0
  for (let i = w.from; i < w.to; i++) {
    const v = dev[i]
    if (direction === 'below' ? v > -level : v < level) continue
    const d = daysToRevert(s, key, i, 250)
    if (d < 0) {
      never += 1
      continue
    }
    days.push(d)
    if (d <= 20) within20 += 1
    if (d <= 60) within60 += 1
    if (d <= 250) within250 += 1
  }
  const total = days.length + never
  if (total === 0) {
    return {
      samples: 0,
      within20: 0,
      within60: 0,
      within250: 0,
      never: 0,
      medianDays: 0,
    }
  }
  return {
    samples: total,
    within20: within20 / total,
    within60: within60 / total,
    within250: within250 / total,
    never: never / total,
    medianDays: days.length ? median(days) : -1,
  }
}

/** 当前状态 + 信号判定。action 为该指数的行动水位（实测标定），可为 null 表示无水位 */
export function currentStatus(
  s: ComputedSeries,
  era: Era,
  action: { dev60: number | null; dev200: number | null } = ACTION_LEVEL,
): CurrentStatus {
  const n = s.dates.length
  const i = n - 1
  const w = eraWindow(s, era)

  const pct60 = percentileRank(sortedCopy(s.dev60.slice(w.from, w.to)), s.dev60[i])
  const pct200 = percentileRank(sortedCopy(s.dev200.slice(w.from, w.to)), s.dev200[i])

  const minPct = Math.min(pct60, pct200)
  const maxPct = Math.max(pct60, pct200)

  let tone: CurrentStatus['signal']['tone'] = 'neutral'
  if (minPct <= 0.02) tone = 'cold'
  else if (minPct <= 0.1) tone = 'cool'
  else if (maxPct >= 0.98) tone = 'hot'
  else if (maxPct >= 0.9) tone = 'warm'

  const SIGNALS = {
    cold: {
      title: '极值区 · 历史级位置',
      desc: '偏离度处于该时期最极端的 2% 区间。历史上这种位置出现后，后续反弹概率明显高于常态。',
      actionable: true,
    },
    cool: {
      title: '偏低区 · 可分批',
      desc: '偏离度低于该时期 90% 的交易日，向下空间通常已被压缩。',
      actionable: true,
    },
    neutral: {
      title: '中性区 · 无极端信号',
      desc: '偏离度在常态范围内波动，不构成逃顶或抄底依据。',
      actionable: false,
    },
    warm: {
      title: '偏热区 · 不宜追高',
      desc: '偏离度高于该时期 90% 的交易日，短期回撤概率抬升；但横盘不动、均线继续上移，同样能让偏离度回落，所以这个信号的可操作性低于抄底。',
      actionable: false,
    },
    hot: {
      title: '极值区 · 过热警戒',
      desc: '偏离度处于该时期最极端的 2% 区间。历史上逃顶胜率低于抄底，更可能是横盘而非急跌。',
      actionable: true,
    },
  } as const

  const signal = { tone, ...SIGNALS[tone] }

  return {
    date: s.dates[i],
    close: s.close[i],
    ma60: s.ma60[i],
    ma200: s.ma200[i],
    dev60: s.dev60[i],
    dev200: s.dev200[i],
    pct60,
    pct200,
    toThreshold60: priceMoveTo(s.dev60[i], action.dev60),
    toThreshold200: priceMoveTo(s.dev200[i], action.dev200),
    signal,
    rankText60: rankText(pct60, '低于'),
    rankText200: rankText(pct200, '低于'),
  }
}

function rankText(pct: number, word: string): string {
  const top = (1 - pct) * 100
  if (top < 0.05) return `历史最低区间（${word} 99.95% 的交易日）`
  return `${word}该时期 ${(pct * 100).toFixed(1)}% 的交易日`
}

/**
 * 若要让偏离度从 cur 走到 target，价格需要变动多少（%）。
 * 由 dev = 100·ln(P/MA) 得 P_needed = P · e^((target-cur)/100)。
 *
 * target 为 null 表示该指数在这个口径上没有标定出行动水位（历史上无超额），
 * 此时返回 null，由渲染层显示「无水位」，而不是编一个数字糊过去。
 */
export function priceMoveTo(cur: number, target: number | null): number | null {
  if (target === null) return null
  if (cur <= target) return 0
  return (Math.exp((target - cur) / 100) - 1) * 100
}

/** 校验用：由收盘价与均线重算偏离度，确保与序列一致 */
export function verifyDeviation(close: number, ma: number): number {
  return logDeviation(close, ma)
}
