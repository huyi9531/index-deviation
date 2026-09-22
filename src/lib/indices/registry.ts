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
  | 'hsi'
  | 'hstech'
  | 'n225'

/** 市场。决定历史分段口径（见 types.ts 的 ERAS_BY_MARKET）与货币符号 */
export type MarketId = 'us' | 'cn' | 'hk' | 'jp'

/**
 * 数据源。
 *   yahoo     —— 美股指数与日经225（^GSPC 自 1950 年、^N225 自 1965 年）
 *   eastmoney —— A 股与港股指数（东方财富 push2his），全历史可得且无需密钥
 *
 * 注 1：Yahoo 对 A 股指数是「有代码无历史」（000300.SS 仅 2021 年起，创业板指无数据），
 *       所以 A 股必须走东方财富，不能共用同一个源。
 * 注 2：港股也走东方财富，因为 Yahoo 对恒生科技指数只有 1 根 K 线
 *       （HSTECH.HK 与 ^HSTECH 都没有历史），拿不到统计样本；
 *       恒生指数两边都有，但同市场用同一个源便于对照。
 * 注 3：日经225 反过来 —— 东方财富没有这只指数（100.N225 / 100.NIKKEI 在三个
 *       push2his host 上均返回空），而 Yahoo 有 15170 根且自 1965 年起。
 */
export type ProviderId = 'yahoo' | 'eastmoney'

/**
 * 行动水位：偏离度跌破这里之后，**60 日胜率相对「不设条件的常态胜率」有明显超额**。
 *
 * `null` 表示该指数在该口径下历史上**没有可用的超额**——不是数据缺失，
 * 而是一个真实结论。页面会如实显示为「无统计优势」，而不是硬凑一个看起来能用的水位。
 *
 * ⚠️ **2026-09 重标过一轮，规则与数值都变了。** 现在同时要求：
 *   ① 全样本：60 日超额点估计 ≥ +3pp，且独立信号 ≥ 12 段（取达标的**最浅**一档）
 *   ② 样本外：按交易日对半切，**前后两半段都要有 ≥ +3pp 的超额**
 * ② 不过就不算 robust（四档分级见 `EvidenceGrade`，每格的具体级别见 `EVIDENCE`）。
 *
 * 为什么改成「两半段都要」：旧规则只看全样本点估计，于是 22/26 个候选指数都能标出水位
 * （一个放过 85% 的筛子不叫筛子），而且样本外一测就翻负。重标实测：20 格里只有 4 格
 * 能同时满足两半段，12 格样本外已翻负 —— 那些格子仍然保留（作为「历史参考线」有意义），
 * 但 UI 上必须标成「证据薄弱」，不得用暗示行动的措辞。
 *
 * ⚠️ 还试过更严的口径：「置信下界 ≥ +3pp」（要求统计显著）。**它会把 20 格全部清零**，
 * 而且有个反直觉的后果 —— 12~30 段独立信号时区间半宽就有 ±20~30pp，要求下界 ≥ +3pp
 * 等于要求超额 ≥ 25pp，于是它系统性地**选中最深的那一档**，与「取最浅档」的意图相反，
 * 水位会深到几乎永不触发。所以最终没采用显著性门槛。
 *
 * ⚠️ 另一个已经踩过的坑：**点估计不能用「每段独立信号只取首次触达日」**。
 * 首次触达日永远是那一段里最浅的一天（刚跨过阈值），而段内更深的日子历史上反弹更好 ——
 * 那个口径系统性低估「处于该位置时任意一天买入」的平均体验，实测能翻转 10 格里
 * 5~6 格的样本外结论。点估计按交易日加权，段数只用于门槛与**置信区间的样本量**。
 *
 * 为什么必须逐指数标定：A 股的偏离度摆幅远大于美股，-8% / -10% 这类统一值
 * 对创业板指太浅（几乎每年触发），对纳指又毫无信息量。
 *
 * 标定命令：`node .smoke/calibrate.mjs`（只读报告）、`--check`（与本表对拍）、
 * `--grade-current`（给现有值定级）、`--scenarios`（换门槛看剩多少格）。
 */
export interface ActionLevels {
  dev60: number | null
  dev200: number | null
}

/**
 * 水位的证据级别。**由 `.smoke/calibrate.mjs` 自动判定，人工抄进 `EVIDENCE` 表。**
 *
 *   robust  全样本与前后两半段都成立
 *   eraOnly 全样本不成立，但当前时代窗口内成立（只在当下这个市场阶段有效）
 *   fragile 全样本成立但样本外已翻负
 *   none    无水位（对应 action 为 null）
 */
export type EvidenceGrade = 'robust' | 'eraOnly' | 'fragile' | 'none'

/**
 * 每个指数每个口径的证据级别 —— **UI 读取的唯一处**。
 *
 * 为什么要单独一张表而不是塞进 `ActionLevels`：`waterTriggered()` 的签名与四处调用点
 * 都只关心「有没有水位、有没有跌破」，把分级混进去会连锁改动判定层。
 * 分级是**展示层**的事：它只决定标签怎么写，不决定触不触发。
 */
export const EVIDENCE: Record<IndexId, { dev60: EvidenceGrade; dev200: EvidenceGrade }> = {
  sp500: { dev60: 'fragile', dev200: 'fragile' },
  nasdaq: { dev60: 'eraOnly', dev200: 'none' },
  hs300: { dev60: 'eraOnly', dev200: 'robust' },
  a500: { dev60: 'eraOnly', dev200: 'fragile' },
  csi500: { dev60: 'fragile', dev200: 'fragile' },
  chinext: { dev60: 'robust', dev200: 'robust' },
  star50: { dev60: 'robust', dev200: 'fragile' },
  hsi: { dev60: 'fragile', dev200: 'fragile' },
  hstech: { dev60: 'fragile', dev200: 'fragile' },
  n225: { dev60: 'fragile', dev200: 'fragile' },
}

/**
 * 跌破水位时显示的标签。
 *
 * ⚠️ **只有 robust / eraOnly 才配用「值得关注」这种暗示行动的措辞**。
 * fragile 的格子照旧参与触发（判定逻辑不变），但标签必须说清证据薄弱 ——
 * 「历史频率」和「统计上站得住的优势」是两件事，不能靠同一个词蒙过去。
 */
export const TRIGGER_LABEL: Record<EvidenceGrade, string | null> = {
  robust: '值得关注',
  eraOnly: '值得关注 · 仅当前时代',
  fragile: '已进入水位 · 证据薄弱',
  none: null,
}

/** 证据强度的一句话说明（水位格与 tooltip 用） */
export const EVIDENCE_LABEL: Record<EvidenceGrade, string> = {
  robust: '全样本与前后两半段都成立',
  eraOnly: '仅当前时代成立',
  fragile: '证据薄弱：样本外已翻负',
  none: '无统计优势',
}

/**
 * 取某个指数某个口径的证据级别。
 *
 * 入参是 `string` 而不是 `IndexId`：调用方拿到的是载荷里的 `meta.indexId`（string）。
 * 非法 id 一律回 'none' —— 这比在调用处强转类型安全，也不会因为将来载荷多一个
 * 指数就静默崩掉。
 */
export function evidenceOf(indexId: string, side: 'dev60' | 'dev200'): EvidenceGrade {
  return EVIDENCE[indexId as IndexId]?.[side] ?? 'none'
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
  currency: 'USD' | 'CNY' | 'HKD' | 'JPY'
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
 * 各指数实测标定结果（2026-09 重标；规则见上方 ActionLevels 的注释）。
 *
 *   指数          dev60                        dev200
 *   标普500       -7%   fragile（样本外翻负）     -10%  fragile
 *   纳斯达克100    -10%  eraOnly（仅 2010 年后）   null  无优势
 *   沪深300       -4%   eraOnly                 -8%   robust
 *   中证A500      -4%   eraOnly                 -10%  fragile
 *   中证500       -8%   fragile                 -10%  fragile
 *   创业板指       -4%   robust                  -12%  robust
 *   科创50        -4%   robust                  -16%  fragile
 *   恒生指数       -7%   fragile                 -14%  fragile
 *   恒生科技       -8%   fragile                 -20%  fragile
 *   日经225       -10%  fragile                 -18%  fragile
 *
 * 分级含义（页面按 EVIDENCE_LABEL 展示，`EVIDENCE` 表是 UI 的读取处）：
 *   robust  全样本与前后两半段都成立 —— 20 格里只有 4 格
 *   eraOnly 全样本不成立，但当前时代窗口内成立（只在当下这个市场阶段有效）
 *   fragile 全样本成立但**样本外已翻负** —— 保留为参考线，UI 必须标「证据薄弱」
 *   none    无水位（纳斯达克100 的 dev200 是唯一一格）
 *
 * ⚠️ 只有 4 格 robust，这不是标注失误，是实测结论。整个水位体系处在弱显著水平
 *   （独立信号单侧检验的 p 值多在 0.1~0.35），**任何一格都不该被当成
 *   「统计上已验证的买卖信号」来读**。UI 上的「值得关注」只在 robust / eraOnly
 *   出现，fragile 一律写「已进入水位 · 证据薄弱」。
 *
 * ⚠️ 曾试过更严的口径「置信下界 ≥ +3pp」并要求采纳 —— **它会把 20 格全部清零**，
 *   而且反直觉：12~30 段独立信号时区间半宽就有 ±20~30pp，要求下界 ≥ +3pp
 *   等于要求超额 ≥ 25pp，于是它系统性地选中最深的那一档，与「取最浅档」的意图相反。
 *   所以最终用「两半段都要 ≥ +3pp」这个**稳健性**门槛，而不是显著性门槛。
 *
 * ⚠️ 恒生科技的 -8 / -20 用**含回溯段的全样本**标出（2885 根数据里前 1370 根是官方
 *   factsheet 明确标注为 back-tested 的假设历史），与中证A500 的处理先例一致。
 *   只用真实段（2020-07-27 之后）会得到更浅的值，两套不等价，不要混用。
 *
 * ⚠️ 科创50 的统计窗口自 2020-11-02 起（数据 2020-01-02 起，前 199 根被 200 日均线
 *   预热吃掉）。指数发布日 2020-07-23，所以回溯段完全不在统计里，无需标回溯。
 *   它的常态 60 日胜率只有 42.0%，是五个 A 股指数里最低的，-4% 水位对应的绝对胜率
 *   仅约 49% —— 按本产品口径（只看相对常态的超额）成立，但别和沪深300 那种深度水位
 *   横向比。
 *
 * ⚠️ 中证A500 / 中证500 的数据起点早于发布日（liveSince），前段是回溯构造，
 *   判断依据 `meta.backfillDays > 250`，UI 会标「含回溯段」。
 *
 * 改任何一个水位之前，先跑 `node .smoke/calibrate.mjs --check` 看它是否还与规则一致
 * （`--check` 直接读本文件的 action 值对拍）；要看某格为什么是这个级别，
 * 跑 `node .smoke/calibrate.mjs` 读报告里的「全样本 / 前半段选档 / 后半段复核」三段。
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
    // dev60 -10% 是 eraOnly：全样本 10 档全负（十个指数里唯一 20 格全负的），
    // 但 2010 年后窗口里成立 —— 只在当下这个市场阶段有效，UI 会标「仅当前时代」。
    // dev200 仍为 null（全站唯一一格 none）：全样本与当前时代窗口都为负，如实空着，不硬凑。
    action: { dev60: -10, dev200: null },
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
    // dev60 -4%（eraOnly）：全样本 10 档全负，但 2019 年后窗口里成立。
    // dev200 -8%（robust）：全样本与前后两半段都成立 —— 20 格里 4 格 robust 之一。
    // 旧值是 -12%，重标后按「最浅达标档」收到 -8%。
    action: { dev60: -4, dev200: -8 },
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
    // 同沪深300：dev60 -4%（eraOnly，2019 年后窗口成立）。
    // dev200 -10%（fragile）：全样本成立但样本外已翻负；旧值 -12%，重标后收到 -10%。
    action: { dev60: -4, dev200: -10 },
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
    // 两个口径都是 fragile（全样本成立、样本外已翻负）。dev200 旧值 -20% 是旧规则
    // 「越深越有效」的产物，重标后按最浅达标档收到 -10%。
    action: { dev60: -8, dev200: -10 },
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
    // 两个口径都是 robust（全样本与前后两半段都成立）—— 20 格里 4 格 robust 它占了两格。
    // dev60 旧值 -8% 偏深，重标后收到 -4%。
    action: { dev60: -4, dev200: -12 },
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
  // ── 港股（2026-09 新增）──────────────────────────────────────────────
  {
    id: 'hsi',
    market: 'hk',
    provider: 'eastmoney',
    symbol: '100.HSI',
    name: '恒生指数',
    enName: 'Hang Seng Index',
    ticker: 'HSI',
    currency: 'HKD',
    // 数据源自 1990-05-14 起，晚于该指数公开发布（1969 年），所以没有回溯段。
    liveSince: 0,
    // 百度给港股的代码是它自己的一套（hk-HSI），与东财的 100.HSI 不同。
    chartUrl: 'https://finance.baidu.com/index/hk-HSI',
    action: { dev60: -7, dev200: -14 },
  },
  {
    id: 'hstech',
    market: 'hk',
    provider: 'eastmoney',
    symbol: '124.HSTECH',
    name: '恒生科技',
    enName: 'Hang Seng TECH',
    ticker: 'HSTECH',
    currency: 'HKD',
    // 恒生指数公司 official factsheet：Launch Date 2020-07-27、Base Date 2014-12-31、
    // Base Index 3000，并明确写明「发布日之前的全部信息均为 back-tested，
    // 反映的是假设历史表现」。数据源正好自基日 2014-12-31（收盘 3000.00）开始，
    // 于是前 1370 根都是回溯构造段 —— 占全量数据的 48%，是中证A500 之外最严重的一个，
    // 页面会标「含回溯段」。
    liveSince: 20200727,
    // 百度用的代码是 HZ2083（不是 HSTECH），已用百度 suggest 接口核实。
    chartUrl: 'https://finance.baidu.com/index/hk-HZ2083',
    action: { dev60: -8, dev200: -20 },
  },
  // ── 日本（2026-09 新增）───────────────────────────────────────────────
  {
    id: 'n225',
    market: 'jp',
    provider: 'yahoo',
    symbol: '^N225',
    name: '日经225',
    enName: 'Nikkei 225',
    ticker: 'N225',
    currency: 'JPY',
    // 数据源自 1965-01-05 起，晚于该指数公开发布（1950 年），所以没有回溯段。
    liveSince: 0,
    chartUrl: 'https://finance.baidu.com/index/jp-NK225',
    action: { dev60: -10, dev200: -18 },
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
const CURRENCY_SYMBOL: Record<IndexDef['currency'], string> = {
  USD: '$',
  CNY: '¥',
  HKD: 'HK$',
  // ¥ 有两个所有者（人民币 / 日元），总览页上会同时出现两者的点位，
  // 而数量级差一个量级（沪深300 四千多 vs 日经225 六万多）。
  // 所以日元刻意写成 JP¥ 消歧 —— 不是标准写法，但比让读者猜「这个 ¥ 是哪个」好。
  JPY: 'JP¥',
}

export function currencySymbol(currency: IndexDef['currency']): string {
  return CURRENCY_SYMBOL[currency]
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
  hk: '港股',
  jp: '日本',
}
