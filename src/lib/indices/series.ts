import type { ComputedSeries, RangeId } from './types'

/** 指标起点：至少要有 200 个交易日预热，才能算出 200 日均线 */
export const SERIES_START = 19500103

/**
 * 解析 CSV 快照文本 —— 每行 "YYYYMMDD,close"。
 * 容错：跳过表头、空行、非数值行。
 */
export function parseCsv(text: string): { dates: number[]; closes: number[] } {
  const dates: number[] = []
  const closes: number[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const parts = line.split(',')
    if (parts.length < 2) continue
    const date = Number(parts[0])
    const close = Number(parts[1])
    if (!Number.isInteger(date) || date < 10000101) continue
    if (!Number.isFinite(close) || close <= 0) continue
    dates.push(date)
    closes.push(close)
  }
  return { dates, closes }
}

/** 简单移动平均，前 period-1 项为 NaN */
function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

/** 对数偏离度（%）：100 × ln(收盘 / 均线)
 * 相对「收盘/均线 - 1」的算术口径，对数口径在长周期上更线性，
 * 也让正负两侧对称（+10% 与 -10% 幅度可比）。
 */
export function logDeviation(close: number, ma: number): number {
  return 100 * Math.log(close / ma)
}

/**
 * 允许缺口的移动平均：非有限值当作缺失跳过，只有窗口内有效值满 period 个才给值。
 * 价格序列不会有缺口（parseCsv 已过滤），但成交额与两融可能缺失。
 */
/**
 * 由「日期 + 收盘价」构建完整指标序列。
 * 计算完成后统一裁剪到 SERIES_START 之后、且 60/200 日均线均可用，
 * 于是返回的数组不含 null，可以直接下标访问。
 */
export function buildSeries(rawDates: number[], rawCloses: number[]): ComputedSeries {
  const ma60Raw = sma(rawCloses, 60)
  const ma200Raw = sma(rawCloses, 200)

  const dates: number[] = []
  const close: number[] = []
  const ma60: number[] = []
  const ma200: number[] = []
  const dev60: number[] = []
  const dev200: number[] = []

  for (let i = 0; i < rawDates.length; i++) {
    if (rawDates[i] < SERIES_START) continue
    const m60 = ma60Raw[i]
    const m200 = ma200Raw[i]
    if (!Number.isFinite(m60) || !Number.isFinite(m200)) continue
    dates.push(rawDates[i])
    close.push(rawCloses[i])
    ma60.push(m60)
    ma200.push(m200)
    dev60.push(logDeviation(rawCloses[i], m60))
    dev200.push(logDeviation(rawCloses[i], m200))
  }

  return { dates, close, ma60, ma200, dev60, dev200 }
}

/** 从日期数组里找到某个 YYYYMMDD 之后（含）的第一个下标 */
export function indexOfDate(dates: number[], ymd: number): number {
  let lo = 0
  let hi = dates.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (dates[mid] < ymd) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** 按 RangeId 取起始下标 */
export function rangeStartIndex(s: ComputedSeries, range: RangeId): number {
  if (range === 'max') return 0
  let years = 20
  if (range === '5y') years = 5
  else if (range === '10y') years = 10
  const last = s.dates[s.dates.length - 1]
  const y = Math.floor(last / 10000) - years
  return indexOfDate(s.dates, y * 10000 + 101)
}

/**
 * 抽样下标（跨多条序列共用，保证对齐）。
 * 使用等步长抽样，首尾必取；目标约 target 个点。
 */
export function sampleIndices(from: number, to: number, target: number): number[] {
  const n = to - from
  if (n <= 0) return []
  if (n <= target) {
    const all = new Array<number>(n)
    for (let i = 0; i < n; i++) all[i] = from + i
    return all
  }
  const step = n / target
  const out: number[] = []
  for (let k = 0; k < target; k++) out.push(from + Math.floor(k * step))
  if (out[out.length - 1] !== to - 1) out.push(to - 1)
  return out
}

/** 在升序数组中取分位（0~1），返回该值在样本中的百分位 */
export function percentileRank(sorted: number[], value: number): number {
  if (sorted.length === 0) return 0.5
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] <= value) lo = mid + 1
    else hi = mid
  }
  return lo / sorted.length
}

export function sortedCopy(values: number[]): number[] {
  return [...values].sort((a, b) => a - b)
}

/** 构建直方图 */
export function histogram(
  a: number[],
  b: number[],
  binCount: number,
): {
  edges: number[]
  counts60: number[]
  counts200: number[]
  min: number
  max: number
} {
  const all = [...a, ...b]
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const v of all) {
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { edges: [], counts60: [], counts200: [], min: 0, max: 0 }
  }
  // 让边界对齐到整数百分比，视觉上更易读
  min = Math.floor(min) - 1
  max = Math.ceil(max) + 1
  const width = (max - min) / binCount
  const edges = new Array<number>(binCount)
  const counts60 = new Array<number>(binCount).fill(0)
  const counts200 = new Array<number>(binCount).fill(0)
  for (let i = 0; i < binCount; i++) edges[i] = min + i * width

  const bump = (arr: number[], counts: number[]) => {
    for (const v of arr) {
      let idx = Math.floor((v - min) / width)
      if (idx < 0) idx = 0
      if (idx >= binCount) idx = binCount - 1
      counts[idx] += 1
    }
  }
  bump(a, counts60)
  bump(b, counts200)
  return { edges, counts60, counts200, min, max }
}

/** 数字 → "YYYY-MM-DD" */
export function ymdToIso(ymd: number): string {
  const s = String(ymd)
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

/** 中位数 */
export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN
  const s = sortedCopy(values)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
