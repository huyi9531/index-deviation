/**
 * 偏离度监控 —— 领域类型定义（与具体指数无关）
 */
import type { IndexId, MarketId } from './registry'

/** 历史分段：用来观察不同市场阶段下偏离度的统计特征 */
export type EraId =
  | 'all'
  // 美股口径
  | 'since1970'
  | 'since2000'
  | 'since2010'
  // A 股口径
  | 'since2016'
  | 'since2019'

export interface Era {
  id: EraId
  label: string
  /** YYYYMMDD，含当日。0 表示「从序列起点开始」（各指数起点不同） */
  start: number
  note: string
}

/**
 * 历史分段必须**按市场分别定义** —— 分段的意义来自该市场自身的制度变迁，
 * 而不是某个统一的时间轴：
 *   · 美股：战后重建 / 布雷顿森林体系解体 / 互联网泡沫 / QE 常态化
 *   · A 股：四万亿与创业板开板 / 供给侧改革与沪深港通 / 科创板与注册制
 * 拿「1970 年后」这种分段去套沪深300（2005 年才有数据）是没有意义的。
 */
export const ERAS_US: readonly Era[] = [
  {
    id: 'all',
    label: '全部历史',
    start: 0,
    note: '该指数全部可得历史，含战后重建、布雷顿森林体系、滞胀与全球化',
  },
  {
    id: 'since1970',
    label: '1970 年后',
    start: 19700101,
    note: '美元与黄金脱钩之后的浮动汇率时代',
  },
  {
    id: 'since2000',
    label: '2000 年后',
    start: 20000101,
    note: '互联网泡沫破裂为起点的低利率时代',
  },
  {
    id: 'since2010',
    label: '2010 年后',
    start: 20100101,
    note: '量化宽松（QE）常态化时代，均值回归特性最强',
  },
] as const

export const ERAS_CN: readonly Era[] = [
  {
    id: 'all',
    label: '全部历史',
    start: 0,
    note: '该指数全部可得历史',
  },
  {
    id: 'since2010',
    label: '2010 年后',
    start: 20100101,
    note: '四万亿刺激之后、创业板开板，小盘成长风格成型',
  },
  {
    id: 'since2016',
    label: '2016 年后',
    start: 20160101,
    note: '供给侧改革 + 沪深港通开通，外资持续流入改变了定价结构',
  },
  {
    id: 'since2019',
    label: '2019 年后',
    start: 20190101,
    note: '科创板与注册制落地，机构化提速、波动结构改变',
  },
] as const

export const ERAS_BY_MARKET: Record<MarketId, readonly Era[]> = {
  us: ERAS_US,
  cn: ERAS_CN,
}

export function erasForMarket(market: MarketId): readonly Era[] {
  return ERAS_BY_MARKET[market] ?? ERAS_US
}

/** 全部合法的 era 取值（用于搜索参数校验） */
export const ALL_ERA_IDS = [
  'all',
  'since1970',
  'since2000',
  'since2010',
  'since2016',
  'since2019',
] as const

/**
 * 已计算好指标的序列。
 * 所有数组等长且一一对齐，起点为「200 日均线可用」的第一天（约 1950-10），
 * 因此内部不含 null，可以直接索引。
 */
export interface ComputedSeries {
  /** YYYYMMDD */
  dates: number[]
  close: number[]
  ma60: number[]
  ma200: number[]
  /** 对数偏离度（%）：100 × ln(收盘 / 均线) */
  dev60: number[]
  dev200: number[]
}

export type MaKey = 'dev60' | 'dev200'

/** 单条前瞻统计：在给定阈值下，未来 N 个交易日的表现 */
export interface HorizonStat {
  /** 持有 / 观察天数（交易日） */
  days: number
  /** 胜率 0~1。抄底 = 收益>0 的比例；逃顶 = 收益<0 的比例 */
  winRate: number
  avg: number
  median: number
  /** 最差 / 最好单次收益 */
  worst: number
  best: number
}

/** 某个阈值的统计行 */
export interface ThresholdRow {
  /** 阈值，单位 %（抄底为负，逃顶为正） */
  threshold: number
  direction: 'below' | 'above'
  /** 满足条件的交易日数量 */
  sampleDays: number
  /** 去重叠后的独立信号次数（连续满足只算 1 次） */
  episodes: number
  /** 当前偏离度是否已经进入该区间 */
  triggeredNow: boolean
  horizons: HorizonStat[]
}

/** 极端偏离度样本（用于「历史极值」表） */
export interface ExtremePoint {
  date: number
  close: number
  dev60: number
  dev200: number
  /** 之后 60 个交易日收益 */
  fwd60: number
  /** 之后 20 个交易日收益 */
  fwd20: number
  /** 偏离度回到 ±1% 以内用了多少个交易日；-1 表示 60 个交易日内未复归 */
  daysToRevert: number
}

/**
 * 基准表现：**不设任何条件**时，持有 N 个交易日的胜率与均值。
 *
 * 这是判断「某个阈值的胜率算不算高」的唯一正确参照。标普 1950 年以来
 * 无条件持有的 20 日上涨率是 61.8%、60 日是 66.7% —— 所以「≤ −10% 时
 * 胜率 62.4%」其实几乎没有超额，而「62.4%」单看却像是很好的机会。
 * 页面把它作为参照行显式列出，并把热力底色以它为中性点。
 */
export interface BaselineStat {
  days: number
  winRate: number
  avg: number
}

/** 当前状态 */
export interface CurrentStatus {
  date: number
  close: number
  ma60: number
  ma200: number
  dev60: number
  dev200: number
  /** 分位数 0~1，在指定 era 的偏离度分布中 */
  pct60: number
  pct200: number
  /**
   * 距离负向阈值还需下跌多少（%，价格口径）。
   * 已进入水位时为 0；该口径没有标定出水位时为 null。
   */
  toThreshold60: number | null
  toThreshold200: number | null
  /**
   * 是否跌破该指数任一标定水位（唯一判定，见 stats.ts 的 waterTriggered）。
   * 与 signal.tone 无关：tone 只看分位，不含统计优势。
   */
  waterTriggered: boolean
  signal: SignalLevel
  /** 当前 200 日偏离度在过去 N 日的排名（越低越少见） */
  rankText60: string
  rankText200: string
}

export type SignalTone = 'cold' | 'cool' | 'neutral' | 'warm' | 'hot'

export interface SignalLevel {
  tone: SignalTone
  title: string
  desc: string
}

/** 分布直方图 */
export interface Histogram {
  /** 每个 bin 的左边界 */
  edges: number[]
  counts60: number[]
  counts200: number[]
  min: number
  max: number
}

/** 图表用的抽样序列 */
export interface ChartPayload {
  dates: number[]
  close: number[]
  ma60: number[]
  ma200: number[]
  dev60: number[]
  dev200: number[]
}

export interface DataMeta {
  source: 'live' | 'snapshot'
  /** 指数标识，见 registry.ts */
  indexId: string
  /** 指数中文名 */
  name: string
  symbol: string
  /** 数据源名字 */
  provider: string
  /** 所属市场。决定历史分段口径与货币符号 */
  market: MarketId
  currency: 'USD' | 'CNY'
  fetchedAt: string
  /** 统计序列起点（已剔除 200 日均线预热期） */
  firstDate: number
  /** 数据源原始起点（含预热期），用于如实展示「数据自哪一天起」 */
  rawFirstDate: number
  lastDate: number
  tradingDays: number
  /** 指数正式发布日（YYYYMMDD）；0 表示该指数无回溯段，不必标注 */
  liveSince: number
  /**
   * 早于发布日、属于事后回溯计算的交易日数。
   * 中证A500 于 2024-09-23 发布但数据回溯到 2005 年，这段约 4900 天
   * 并非真实可交易历史，页面必须如实标注（见 method 页）。
   */
  backfillDays: number
}

export type RangeId = '5y' | '10y' | '20y' | 'max'

export const RANGES: readonly {
  id: RangeId
  label: string
  years: number | null
}[] = [
  { id: '5y', label: '近 5 年', years: 5 },
  { id: '10y', label: '近 10 年', years: 10 },
  { id: '20y', label: '近 20 年', years: 20 },
  { id: 'max', label: '全部历史', years: null },
] as const

/* ────────────────────────── 服务端 → 客户端 的载荷 ────────────────────────── */

/** 图表上的极值标注（在图示区间内按全量数据精确计算，不受抽样影响） */
export interface ChartMark {
  date: number
  value: number
}

export interface ChartMarks {
  minDev60: ChartMark
  maxDev60: ChartMark
  minDev200: ChartMark
  maxDev200: ChartMark
  lowClose: ChartMark
  highClose: ChartMark
}

/** 「同类位置」答案：历史上偏离度落在当前值 ±1% 内的那些日子，之后表现如何 */
export interface AnalogAnswer {
  center: number
  sampleDays: number
  episodes: number
  win20: number
  /** win20 − 常态 20 日胜率（pp）。样本不足 30 天或无常态参照时为 null，如实不给数 */
  excess20: number | null
  avg20: number
  median20: number
  win60: number
  avg60: number
  worst60: number
}

export interface EraSummaryRow {
  id: EraId
  label: string
  note: string
  years: string
  samples: number
  episodes: number
  win20: number
  avg20: number
  win60: number
  avg60: number
}

/** 复归（偏离度回到均线）统计 */
export interface RevertSummary {
  level: number
  samples: number
  within20: number
  within60: number
  within250: number
  never: number
  medianDays: number
}

export interface DashboardPayload {
  meta: DataMeta
  status: CurrentStatus
  range: RangeId
  era: EraId
  chart: ChartPayload
  chartMarks: ChartMarks
  hist: Histogram
  /** 抄底扫描：60 日均线偏离度 */
  dip60: ThresholdRow[]
  /** 逃顶扫描：60 日均线偏离度 */
  top60: ThresholdRow[]
  dip200: ThresholdRow[]
  top200: ThresholdRow[]
  analogs: { dev60: AnalogAnswer; dev200: AnalogAnswer }
  eraSummary: EraSummaryRow[]
  /** 行动水位；null 表示该口径历史上没有可用的超额 */
  actionLevel: { dev60: number | null; dev200: number | null }
  /** 不设条件的基准表现（当前 era 窗口内） */
  baseline: BaselineStat[]
}

export interface StatsPayload {
  meta: DataMeta
  era: EraId
  ma: MaKey
  horizon: number
  dip: ThresholdRow[]
  top: ThresholdRow[]
  revert: { dip: RevertSummary; top: RevertSummary }
  eraByThreshold: {
    threshold: number
    cells: {
      id: EraId
      label: string
      winRate: number
      samples: number
      avg: number
    }[]
  }[]
  eraSummary: EraSummaryRow[]
  /** 不设条件的基准表现（当前 era 窗口内） */
  baseline: BaselineStat[]
}

/** 总览页一行 = 一个指数的全部摘要 */
export interface OverviewRow {
  id: IndexId
  name: string
  enName: string
  ticker: string
  symbol: string
  market: MarketId
  currency: 'USD' | 'CNY'
  date: number
  close: number
  dev60: number
  dev200: number
  /**
   * 同类位置 20 日超额（pp）= 同类 20 日上涨率 − 常态上涨率。
   * 才是「这个位置有没有优势」的直接回答；|超额| 在 3pp 内视为与常态无异。
   * 样本不足 30 天或无常态参照时为 null，如实不给数。
   */
  analogExcess: number | null
  analogSamples: number
  /** 距离「行动水位」还需下跌多少（%，价格口径）。已进入水位时为 0，无水位时为 null */
  to200: number | null
  /**
   * 是否跌破任一标定水位。与 /api 的 `actionable` 同义、同源（stats.ts 的
   * waterTriggered），总览页「触发关注」计数用它 —— 不再用 signal.tone 判定。
   */
  waterTriggered: boolean
  signal: SignalLevel
  /** 近一年 200 日偏离度（抽样，画迷你线用） */
  spark: number[]
  source: DataMeta['source']
}

export interface OverviewPayload {
  generatedAt: string
  rows: OverviewRow[]
}
