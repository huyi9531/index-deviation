/**
 * 路由冒烟检查：确认每个页面真的渲染出了它该有的内容。
 * 只依赖 dev server，不需要浏览器。
 *
 *   node .smoke/check.mjs
 *   BASE=http://localhost:4173 node .smoke/check.mjs
 */
const B = process.env.BASE ?? 'http://localhost:3000'

/** [路径, 期望出现, 期望不出现, 期望状态码] */
const checks = [
  [
    '/',
    [
      '标普500',
      '纳斯达克100',
      '沪深300',
      '中证A500',
      '中证500',
      '创业板指',
      '科创50',
      '恒生指数',
      '恒生科技',
      '日经225',
      '近一年 200 日偏离度',
      '同类位置 20 日超额',
      'A 股',
      '美股',
      '港股',
      '日本',
      '¥',
      // 日元与人民币同为 ¥，所以日元刻意用 JP¥ 消歧；港币用 HK$
      'HK$',
      'JP¥',
      // 每个指数都要有「走势 ↗」外链（桌面表格 + 移动卡片各一处 = 每行 2 个）
      'https://finance.baidu.com/index/ab-000510',
      'https://finance.baidu.com/index/us-NDX',
      'https://finance.baidu.com/index/hk-HSI',
      'https://finance.baidu.com/index/hk-HZ2083',
      'https://finance.baidu.com/index/jp-NK225',
      // 页脚的数据来源覆盖说明是从注册表推导的。这里把「源 → 市场」的对应关系钉住：
      // 它曾经沉默过时过一次（加了日经225 与港股后仍写「Yahoo Finance（美股）·
      // 东方财富（A 股）」），而这类文案没有断言就没人会发现。
      'Yahoo Finance（美股 / 日本）',
      '东方财富（A 股 / 港股）',
    ],
    ['道琼斯工业', '罗素2000'],
    200,
  ],
  [
    '/i/sp500',
    [
      '对数偏离度',
      '底纹为历史级抄底 / 过热区间',
      '概率速查',
      '时代差异',
      '到 -10% 水位',
      '常态（不设条件）',
      '1970 年后',
      '2000 年后',
      // 详情页头部也要有外部走势入口（新标签）
      'https://finance.baidu.com/index/us-SPX',
      'target="_blank"',
    ],
    // 美股不该出现 A 股口径的分段；教学文案已下沉方法页
    ['2016 年后', '2019 年后', '价格围绕均线的弹簧', '数据自 1948'],
    200,
  ],
  [
    '/i/nasdaq',
    // 2026-09 变化：NDX 的 dev60 补了 -10%（按「当前时代」复核），dev200 仍为空。
    // 所以详情页现在应当同时出现「到 -10% 水位」（SummaryStrip 回落到 60 日口径）
    // 与 200 日那份的「没有标定出可用的行动水位」说明。
    [
      '到 -10% 水位',
      '60 日口径（200 日口径未标定）',
      '没有标定出可用的行动水位',
      '常态（不设条件）',
    ],
    ['到 -8% 水位', '无水位', '历史各档位均无超额'],
    200,
  ],
  [
    '/i/hs300',
    [
      'A 股',
      '东方财富',
      '¥',
      '2016 年后',
      '2019 年后',
      '常态（不设条件）',
    ],
    // A 股不该出现美股口径的分段
    ['1970 年后', '2000 年后'],
    200,
  ],
  // 中证A500 / 中证500 的数据起点早于指数发布日 → 必须标注回溯段
  ['/i/a500', ['中证A500', '含回溯段', '并非真实可交易历史', '2024'], [], 200],
  ['/i/csi500', ['中证500', '含回溯段', '2016 年后'], [], 200],
  // 创业板指发布日（2010-06-01）即数据起点 → 不标回溯段；
  // 且「2010 年后」与全部历史几乎重合，会被 activeErasFor 自动隐藏
  [
    '/i/chinext',
    ['创业板指', '东方财富', '¥', '2016 年后', '2019 年后'],
    ['含回溯段', '2010 年后'],
    200,
  ],
  // 统计页已收敛为「历史证据」页：概览数字 + 复归特性 + 时代矩阵 + 历史极值，
  // 阈值全表与 EraSummaryTable（与详情页重复）已删
  [
    '/stats/sp500',
    ['历史证据', '复归特性', '历史极端低点', '复归耗时中位数', '常态'],
    ['上涨算赢', '下跌算赢', '常态（不设条件）'],
    200,
  ],
  ['/stats/hs300', ['历史证据', '常态', '2016 年后', '2019 年后'], ['1970 年后'], 200],
  // 无标定水位的口径要如实说明（该文案由详情页的行动水位时期表承载）
  ['/stats/nasdaq', ['历史证据', '历史极端低点'], [], 200],
  // 科创50：数据起点 2020-01-02，晚于全部 A 股时代分段的起点，
  // 所以 since2010/2016/2019 都会被 activeErasFor 自动隐藏（只剩「全部历史」）。
  // 统计窗口起自 2020-11-02，已晚于发布日 2020-07-23 → 回溯段进不了统计，不标回溯。
  [
    '/i/star50',
    ['科创50', '东方财富', '¥', '到 -16% 水位', '常态（不设条件）'],
    ['含回溯段', '2010 年后', '2016 年后', '2019 年后'],
    200,
  ],
  ['/stats/star50', ['历史证据', '历史极端低点'], ['1970 年后'], 200],
  // ── 港股 / 日本（2026-09 新增）─────────────────────────────────────
  // 恒生指数：数据自 1990 年，三个港股分段（1997/2014/2018）全都晚于数据起点，都该出现；
  // 它没有回溯段（数据起点晚于指数发布），所以不能出现「含回溯段」。
  [
    '/i/hsi',
    ['恒生指数', '港股', 'HK$', '东方财富', '1997 年后', '2014 年后', '2018 年后', '常态（不设条件）'],
    ['含回溯段', '1970 年后', '2016 年后', '2019 年后'],
    200,
  ],
  // 日经225：日股只有 1990/2013 两个分段，且有 1965 年以来的 15170 根样本。
  // 它也不能出现港股 / A 股 / 美股的分段。
  [
    '/i/n225',
    ['日经225', '日本', 'JP¥', 'Yahoo Finance', '1990 年后', '2013 年后', '常态（不设条件）'],
    ['含回溯段', '1970 年后', '2014 年后', '2016 年后'],
    200,
  ],
  // 恒生科技：数据源自官方基日 2014-12-31（基点 3000）开始，前 1370 根是官方标注的
  // back-tested 假设历史 —— 必须显示「含回溯段」。且数据起点 2014-12-31 晚于
  // since1997 / since2014 的起点，这两段会被 activeErasFor 自动隐藏。
  [
    '/i/hstech',
    ['恒生科技', '港股', 'HK$', '含回溯段', '2018 年后', '并非真实可交易历史'],
    ['1997 年后', '2014 年后', '1970 年后', '2016 年后'],
    200,
  ],
  ['/stats/hsi', ['历史证据', '历史极端低点', '2018 年后'], ['1970 年后', '2016 年后'], 200],
  [
    '/method',
    ['统计方法', '为什么逃顶天然更难', 'GET /api/{indexId}', '回溯段（重要）', '百度股市通', '恒生科技'],
    [],
    200,
  ],
  // 非法指数：详情页 404（不是回落到默认指数）
  ['/i/nope', ['这里没有页面'], [], 404],
]

let bad = 0

for (const [path, needles, anti, want] of checks) {
  const res = await fetch(B + path)
  const html = await res.text()
  const miss = needles.filter((n) => !html.includes(n))
  const hit = anti.filter((n) => html.includes(n))
  const sparks = (html.match(/preserveAspectRatio="none"/g) || []).length
  const rows = (html.match(/<tr /g) || []).length
  const ok = res.status === want && miss.length === 0 && hit.length === 0
  if (!ok) bad++
  const problems = []
  if (res.status !== want) problems.push(`状态码 ${res.status}≠${want}`)
  if (miss.length) problems.push(`缺失: ${miss.join(' | ')}`)
  if (hit.length) problems.push(`不应出现: ${hit.join(' | ')}`)
  console.log(
    (ok ? 'OK  ' : 'FAIL') +
      '  ' +
      path.padEnd(16) +
      ' 行 ' +
      String(rows).padStart(3) +
      '  迷你线 ' +
      String(sparks).padStart(2) +
      '  ' +
      (problems.length ? problems.join('；') : '全部命中'),
  )
}

console.log('')
// JSON 接口
const apiPaths = [
  '/api/sp500',
  '/api/nasdaq',
  '/api/hs300',
  '/api/a500',
  '/api/csi500',
  '/api/chinext',
  '/api/star50',
  '/api/hsi',
  '/api/hstech',
  '/api/n225',
  '/api/all',
  '/api/nope',
]
for (const path of apiPaths) {
  const res = await fetch(B + path)
  const json = await res.json()
  let summary
  if (path === '/api/all') {
    summary = `count=${json.count} actionable=${json.actionable}`
    if (json.count !== 10) bad++
  } else if (json.ok) {
    if (!['us', 'cn', 'hk', 'jp'].includes(json.market)) bad++
    // 回归护栏：数据来源只允许这三态，且每一态都必须在 UI 上有对应展示。
    // 若有人加了新来源（如又加一层兜底）却没同步 UI 与文档，这一条就会响。
    if (!['live', 'cached', 'snapshot'].includes(json.meta?.source)) bad++
    // 回归护栏：actionable 必须等于 flags 里那两个阈值的比较本身（状态无关的写法 ——
    // 不依赖今天涨跌，换市况也成立）。若有人把判定改回 tone / 分位口径，这里立刻响：
    // 2026-09 科创50 的浅水位曾让页面与 API 用两套判定而公开分歧，这就是那个 bug 的哨兵。
    if (json.actionable !== json.flags.some((f) => f.triggered)) bad++
    // 回归护栏：纳斯达克100 不再是「两个口径都无水位」。dev60 的 -10% 是 2026-09
    // 按「当前时代」窗口复核补上的（全样本 20 个档位全负，它曾是唯一一格都不给的指数），
    // dev200 仍为空。这一条钉住这两个值，防止有人把 dev60 那格又改回 null。
    if (path === '/api/nasdaq') {
      const lv = (k) => json.flags.find((f) => f.key === k)?.threshold
      if (lv('dev60') !== -10 || lv('dev200') !== null) bad++
    }
    const t = json.flags.map((f) => (f.threshold === null ? 'null' : f.threshold)).join('/')
    summary =
      (json.name ?? '').padEnd(6) +
      ' ' +
      json.market.padEnd(2) +
      ' ' +
      String(json.close).padStart(9) +
      '  dev60=' +
      String(json.dev60).padStart(7) +
      '  dev200=' +
      String(json.dev200).padStart(7) +
      '  水位 ' +
      t.padEnd(9) +
      ' ' +
      String(json.meta?.source ?? '?').padEnd(8) +
      ' actionable=' +
      json.actionable
  } else {
    summary = `error=${json.error}`
    if (res.status !== 404) bad++
  }
  console.log(`${res.status}  ${path.padEnd(14)} ${summary}`)
}

/**
 * 交叉断言：总览页的「值得关注」标记数必须等于 `/api/all` 里 actionable 的个数。
 *
 * 2026-09 用户反馈：「Hero 说触发 1 个，但我看不出是哪一个」—— 原因是
 * `waterTriggered` 在总览页只被用来数了个总数，表格与移动卡片的行里都没有标记，
 * 而同行渲染的状态标签用的是分位口径（于是那行还写着「中性区 · 无极端信号」）。
 * 单看路由断言发现不了这种「两侧各自都能拿出来、但彼此没关系」的问题，
 * 所以这里把「页面标记数」与「接口判定数」钉在一起。
 *
 * 乘 2 是因为桌面表格与移动卡片在 SSR 里都会渲染（用 CSS 切换显隐）。
 */
{
  const allJson = await (await fetch(`${B}/api/all`)).json()
  const expect = allJson.indices.filter((s) => s.actionable).length
  const html = await (await fetch(`${B}/`)).text()
  const marks = (html.match(/值得关注/g) || []).length
  const ok = marks === expect * 2
  if (!ok) bad++
  console.log(
    (ok ? 'OK  ' : 'FAIL') +
      '  ' +
      '触发标记一致性'.padEnd(14) +
      ` 总览页「值得关注」${marks} 处，接口 actionable ${expect} 个（应互为 2 倍）`,
  )
}

/**
 * 交叉断言（排序）：总览页的行顺序必须等于「同温度分组内按「离水位的距离」升序」。
 *
 * 这里是**独立第二实现**：从 `/api/all` 的 dev60/dev200 与 each flag 的 threshold
 * 自己算一遍价格距离（e = e^(Δ/100) − 1），不引用页面任何代码。
 *
 * 为什么值得钉：2026-09 排序只认 `to200`，于是**已触发**的指数被按 dev200 的距离
 * 排到了第 2 / 3 / 8 位（科创50 距 dev200 尚有 18.3%），而它们在页面上看不出异常 ——
 * 单看渲染断言也发现不了。
 *
 * 温度分组用页面上五条状态标题识别（顺序即 cold→hot），**不依赖 class 名** ——
 * 改版式不该让断言失效；指数名取行内最早出现的那个。
 */
const TONE_TITLES = [
  '极值区 · 历史级位置',
  '偏低区 · 可分批',
  '中性区 · 无极端信号',
  '偏热区 · 不宜追高',
  '极值区 · 过热警戒',
]
const INDEX_NAMES = [
  '标普500',
  '纳斯达克100',
  '沪深300',
  '中证A500',
  '中证500',
  '创业板指',
  '科创50',
  '恒生指数',
  '恒生科技',
  '日经225',
]
{
  const allJson = await (await fetch(`${B}/api/all`)).json()
  const html = await (await fetch(`${B}/`)).text()

  // 桌面表格的每一行：<tr class="group …">
  const pageRows = html
    .split('<tr class="group')
    .slice(1)
    .map((chunk) => {
      const name = INDEX_NAMES.map((n) => [chunk.indexOf(n), n])
        .filter(([at]) => at >= 0)
        .sort((a, b) => a[0] - b[0])[0]?.[1]
      return { name, tone: TONE_TITLES.findIndex((t) => chunk.includes(t)) }
    })
    .filter((r) => r.name && r.tone >= 0)

  const priceMove = (cur, level) => Math.abs((Math.exp((level - cur) / 100) - 1) * 100)
  const distance = (s) => {
    if (s.actionable) return 0
    const gaps = s.flags
      .filter((f) => f.threshold !== null)
      .map((f) => priceMove(f.key === 'dev60' ? s.dev60 : s.dev200, f.threshold))
    return gaps.length ? Math.min(...gaps) : Number.POSITIVE_INFINITY
  }
  const byName = new Map(allJson.indices.map((s) => [s.name, s]))

  const problems = []
  if (pageRows.length !== 10) problems.push(`只提取到 ${pageRows.length} 行`)

  const groups = new Map()
  for (const r of pageRows) {
    if (!groups.has(r.tone)) groups.set(r.tone, [])
    groups.get(r.tone).push(r.name)
  }
  const toneOrder = [...groups.keys()]
  if (!toneOrder.every((t, i) => i === 0 || toneOrder[i - 1] <= t))
    problems.push(`温度分组未按 cold→hot 排：${toneOrder.join('>')}`)

  for (const [, names] of [...groups].sort((a, b) => a[0] - b[0])) {
    const ds = names.map((n) => distance(byName.get(n)))
    if (!ds.every((v, i) => i === 0 || ds[i - 1] <= v)) {
      problems.push(
        '组内未按距离升序：' +
          names.map((n, i) => `${n}=${Number.isFinite(ds[i]) ? ds[i].toFixed(1) + '%' : '∞'}`).join(' '),
      )
    }
  }

  const ok = problems.length === 0
  if (!ok) bad++
  console.log(
    (ok ? 'OK  ' : 'FAIL') +
      '  ' +
      '排序 = 离水位距离'.padEnd(14) +
      (ok
        ? ` ${pageRows.length} 行、${groups.size} 个温度分组均为「已触发 → 距离升序」`
        : ' ' + problems.join('；')),
  )
}

console.log(bad === 0 ? '\n全部通过 ✓' : `\n有 ${bad} 项未通过 ✗`)
process.exit(bad === 0 ? 0 : 1)
