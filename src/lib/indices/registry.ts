/**
 * 指数注册表 —— 全站唯一的「有哪些指数」的真相来源。
 *
 * 设计要点（为了后续加指数时零成本）：
 *   1. 这里是**纯元数据**，不含任何数据导入，所以客户端可以安全引用
 *      （离线快照的 ?raw 导入只允许出现在 *.server.ts 里）。
 *   2. 新增一个指数 = 这里加一行 + 跑一次 `npm run seed`。
 *      路由、页面、接口、组件全部自动适配，不需要新写页面。
 *   3. `action` 是「行动水位」参考值，按指数各自的波动性实测设定 ——
 *      A 股的波动远大于美股，不能套用同一组 -8 / -10。
 *   4. `market` 决定历史分段（时代）口径与货币符号；
 *      `provider` 决定实时数据的取数与解析方式。
 */

export type IndexId =
  | 'sp500'
  | 'nasdaq'
  | 'hs300'
  | 'a500'
  | 'csi500'
  | 'chinext'
  | 'star50'

/** 市场。决定历史分段口径（见 types.ts 的 ERAS_BY_MARKET）与货币符号 */
export type MarketId = 'us' | 'cn'

/**
 * 数据源。
 *   yahoo     —— 美股指数，全历史可得（^GSPC 自 1950 年）
 *   eastmoney —— A 股指数，东方财富 push2his 接口，全历史可得且无需密钥
 *
 * 注：Yahoo 对 A 股指数是「有代码无历史」（000300.SS 仅 2021 年起，创业板指无数据），
 * 所以 A 股必须走东方财富，不能共用同一个源。
 */
export type ProviderId = 'yahoo' | 'eastmoney'

/**
 * 行动水位：偏离度跌破这里之后，**60 日胜率相对「不设条件的常态胜率」有明显超额**。
 *
 * `null` 表示该指数在该口径下历史上**没有可用的超额**——不是数据缺失，
 * 而是一个真实结论（例如纳指两个口径都无优势、沪深300 的 60 日口径无优势）。
 * 页面会如实显示为「无统计优势」，而不是硬凑一个看起来能用的水位。
 *
 * 标定方法（见 .smoke/calibrate.mjs）：在独立信号 ≥ 12 次的候选阈值中，
 * 取「60 日胜率超额 ≥ +3pp」的最浅一档；无一达标则为 null。
 * 之所以分级标定：A 股的偏离度摆幅远大于美股，-8% / -10% 这类统一值
 * 对创业板指太浅（几乎每年触发），对纳指又毫无信息量。
 */
export interface ActionLevels {
  dev60: number | null
  dev200: number | null
}

export interface IndexDef {
  id: IndexId
  market: MarketId
  provider: ProviderId
  /** yahoo: '^GSPC'；eastmoney: '1.000300'（市场.代码，1=沪 0=深） */
  symbol: string
  /** 中文名 */
  name: string
  /** 英文名 */
  enName: string
  /** 展示用代码 */
  ticker: string
  currency: 'USD' | 'CNY'
  /**
   * 指数**真实发布 / 开始交易**的日期（YYYYMMDD）。
   *
   * 用来识别「回溯段」：中证A500 于 2024-09-23 发布，但数据源把它按基日
   * 回溯算到了 2005 年。当数据起始日明显早于这个日期时，说明那段历史是
   * 事后模拟的，页面会标注出来（详见 method 页）。
   *
   * 填 0 表示**不标注回溯段** —— 用于美股指数：Yahoo 的 ^GSPC / ^NDX
   * 历史本身就是行业公认口径，没有「先有指数后来才回溯」这回事，
   * 强行套一个发布日只会制造假告警。
   */
  liveSince: number
  /**
   * 外部行情走势页（站内「走势 ↗」按钮的目标，一律新标签打开）。
   *
   * 选百度股市通的理由：它一个站点同时覆盖 A 股与美股，且两边的代码体系
   * 都能用 —— A 股用交易所代码（ab-000510），美股用它自己的代码（us-SPX / us-NDX，
   * 注意不是 Yahoo 的 ^GSPC / ^NDX），所以两条链路都不需要额外拼接，逐个手写即可。
   *
   * 它**不参与本站任何取数与计算**，只是「想看一眼更大的 K 线/分时」的出口；
   * 本站所有数字仍只来自 provider 指定的数据源。
   */
  chartUrl: string
  action: ActionLevels
}

/** 外部走势页所在站点。UI 文案统一引用这里，改站点只改一处 */
export const CHART_SITE = '百度股市通'

/**
 * 各指数实测标定结果（60 日口径超额胜率，单位为百分点）：
 *
 *   指数          dev60                     dev200
 *   标普500       -7%   (+3.5pp, 134 次)     -10%  (+3.2pp, 96 次)
 *   纳斯达克100    无优势（全档位为负）         无优势（全档位为负）
 *   沪深300       无优势（全档位为负）         -12%  (+5.1pp, 39 次)
 *   中证A500      无优势（全档位为负）         -12%  (+5.1pp, 36 次)
 *   中证500       -8%   (+3.1pp, 82 次)      -20%  (+6.8pp, 24 次)
 *   创业板指       -8%   (+8.5pp, 62 次)      -14%  (+10.4pp, 53 次)
 *   科创50        -4%   (+6.7pp, 50 次)      -16%  (+9.7pp, 19 次)
 *
 * 读法：沪深300 的 60 日深跌买入在 60 日尺度上**跑不赢常态**（大盘股趋势性更强），
 * 但 200 日偏离度跌破 -12% 时胜率明显抬升；创业板指两个口径都很有效。
 *
 * ⚠️ 科创50 的水位需注意两点：
 *   1. 统计窗口自 2020-11-02 起（数据 2020-01-02 起，前 199 根被 200 日均线预热吃掉了）。
 *      指数发布日 2020-07-23，所以**回溯段完全不在统计里**，无需标回溯。
 *   2. 它的常态 60 日胜率只有 42.0%，是五个 A 股指数里最低的（沪深300 53.1%、
 *      创业板指 51.4%）。水位 -4% 对应的绝对胜率仅 48.7% —— 低于一半。
 *      按本产品的口径（只看相对常态的超额，不看裸胜率）这是成立的，
 *      但它和沪深300 那种 -12% 的深度水位不是一个量级，读的时候别横向比。
 */
export const INDICES: readonly IndexDef[] = [
  {
    id: 'sp500',
    market: 'us',
    provider: 'yahoo',
    symbol: '^GSPC',
    name: '标普500',
    enName: 'S&P 500',
    ticker: 'SPX',
    currency: 'USD',
    liveSince: 0,
    chartUrl: 'https://finance.baidu.com/index/us-SPX',
    action: { dev60: -7, dev200: -10 },
  },
  {
    id: 'nasdaq',
    market: 'us',
    provider: 'yahoo',
    symbol: '^NDX',
    name: '纳斯达克100',
    enName: 'NASDAQ-100',
    ticker: 'NDX',
    currency: 'USD',
    liveSince: 0,
    // Baidu 的纳斯达克100 用 NDX（不是 ^NDX，也不是综合指数 IXIC）
    chartUrl: 'https://finance.baidu.com/index/us-NDX',
    action: { dev60: null, dev200: null },
  },
  {
    id: 'hs300',
    market: 'cn',
    provider: 'eastmoney',
    symbol: '1.000300',
    name: '沪深300',
    enName: 'CSI 300',
    ticker: '000300',
    currency: 'CNY',
    liveSince: 20050408,
    chartUrl: 'https://finance.baidu.com/index/ab-000300',
    action: { dev60: null, dev200: -12 },
  },
  {
    id: 'a500',
    market: 'cn',
    provider: 'eastmoney',
    symbol: '1.000510',
    name: '中证A500',
    enName: 'CSI A500',
    ticker: '000510',
    currency: 'CNY',
    liveSince: 20240923,
    chartUrl: 'https://finance.baidu.com/index/ab-000510',
    action: { dev60: null, dev200: -12 },
  },
  {
    id: 'csi500',
    market: 'cn',
    provider: 'eastmoney',
    symbol: '1.000905',
    name: '中证500',
    enName: 'CSI 500',
    ticker: '000905',
    currency: 'CNY',
    liveSince: 20070115,
    chartUrl: 'https://finance.baidu.com/index/ab-000905',
    action: { dev60: -8, dev200: -20 },
  },
  {
    id: 'chinext',
    market: 'cn',
    provider: 'eastmoney',
    symbol: '0.399006',
    name: '创业板指',
    enName: 'ChiNext',
    ticker: '399006',
    currency: 'CNY',
    liveSince: 20100601,
    chartUrl: 'https://finance.baidu.com/index/ab-399006',
    action: { dev60: -8, dev200: -14 },
  },
  {
    id: 'star50',
    market: 'cn',
    provider: 'eastmoney',
    symbol: '1.000688',
    name: '科创50',
    enName: 'STAR 50',
    ticker: '000688',
    currency: 'CNY',
    // 上交所与中证指数官方 factsheet：基日 2019-12-31（基点 1000），发布日 2020-07-23。
    // 数据源自 2020-01-02 起，即从基日开始回溯；但统计窗口起自 2020-11-02，
    // 晚于发布日 —— 回溯段进不了统计，所以页面不会（也不该）标回溯。
    liveSince: 20200723,
    chartUrl: 'https://finance.baidu.com/index/ab-000688',
    action: { dev60: -4, dev200: -16 },
  },
] as const

export const DEFAULT_INDEX_ID: IndexId = 'sp500'

const BY_ID = new Map<string, IndexDef>(INDICES.map((i) => [i.id, i]))

export function isIndexId(value: string): value is IndexId {
  return BY_ID.has(value)
}

/** 取指数定义；非法 id 返回 undefined，由调用方决定 404 还是回落默认值 */
export function indexById(id: string): IndexDef | undefined {
  return BY_ID.get(id)
}

/** 取指数定义，非法 id 回落默认指数（用于总览页、页脚这类容错场景） */
export function indexByIdOrDefault(id: string): IndexDef {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_INDEX_ID)!
}

export function actionOf(id: string): ActionLevels {
  return indexByIdOrDefault(id).action
}

/** 货币符号 */
export function currencySymbol(currency: IndexDef['currency']): string {
  return currency === 'CNY' ? '¥' : '$'
}

/** 数据源展示名 */
export const PROVIDER_LABEL: Record<ProviderId, string> = {
  yahoo: 'Yahoo Finance',
  eastmoney: '东方财富',
}

/** 市场展示名 */
export const MARKET_LABEL: Record<MarketId, string> = {
  us: '美股',
  cn: 'A 股',
}
