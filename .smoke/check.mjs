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
      '近一年 200 日偏离度',
      '同类位置 20 日超额',
      'A 股',
      '美股',
      '¥',
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
    ],
    // 美股不该出现 A 股口径的分段；教学文案已下沉方法页
    ['2016 年后', '2019 年后', '价格围绕均线的弹簧', '数据自 1948'],
    200,
  ],
  [
    '/i/nasdaq',
    ['无水位', '历史各档位均无超额', '常态（不设条件）', '没有标定出可用的行动水位'],
    ['到 -8% 水位', '到 -10% 水位'],
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
  ['/method', ['统计方法', '为什么逃顶天然更难', 'GET /api/{indexId}', '回溯段（重要）'], [], 200],
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
  '/api/all',
  '/api/nope',
]
for (const path of apiPaths) {
  const res = await fetch(B + path)
  const json = await res.json()
  let summary
  if (path === '/api/all') {
    summary = `count=${json.count} actionable=${json.actionable}`
    if (json.count !== 7) bad++
  } else if (json.ok) {
    if (json.market !== 'us' && json.market !== 'cn') bad++
    // 回归护栏：纳斯达克100 两个口径都无标定水位（实测无优势，registry 写明是
    // 「结论」不是「缺失」），因此它永远不该被算作 actionable。若有人把判定改回
    // tone / 分位口径，这一条就会响 —— 2026-09 科创50 的浅水位曾让页面与 API
    // 用两套判定而公开分歧，这里就是那个 bug 的哨兵。
    if (path === '/api/nasdaq' && json.actionable !== false) bad++
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
      ' actionable=' +
      json.actionable
  } else {
    summary = `error=${json.error}`
    if (res.status !== 404) bad++
  }
  console.log(`${res.status}  ${path.padEnd(14)} ${summary}`)
}

console.log(bad === 0 ? '\n全部通过 ✓' : `\n有 ${bad} 项未通过 ✗`)
process.exit(bad === 0 ? 0 : 1)
