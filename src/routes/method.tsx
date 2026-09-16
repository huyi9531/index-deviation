import { createFileRoute } from '@tanstack/react-router'
import { Card, Divider, SectionHead, Tag } from '~/components/ui'

export const Route = createFileRoute('/method')({
  head: () => ({
    meta: [
      { title: '方法与数据说明 · 多指数偏离度监控' },
      {
        name: 'description',
        content:
          '偏离度（乖离率）的定义、对数口径的理由、统计方法、数据来源与已知局限。',
      },
    ],
  }),
  component: MethodPage,
})

function MethodPage() {
  return (
    <div className="space-y-12">
      <div className="max-w-[62ch]">
        <p className="label-xs">Method &amp; Data</p>
        <h1 className="mt-2 text-[32px] font-semibold leading-tight tracking-tight text-ink">
          方法与数据说明
        </h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
          这个看板只做一件事：把「某个指数现在离它的中长期均线有多远」量化出来，
          然后用尽可能长的历史告诉你，处在这个距离上之后通常会发生什么。
          同一套逻辑服务每一个指数，页面结构与数字口径完全一致。
        </p>
      </div>

      {/* 1 */}
      <Card className="p-6 sm:p-7">
        <SectionHead label="01 定义" title="偏离度（乖离率）到底在量什么" />
        <div className="mt-5 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <div className="space-y-4 text-[13px] leading-relaxed text-ink-2">
            <p>
              均线是过去 N 天收盘价的平均值，可以理解成「市场最近 N 天的平均持仓成本」。
              价格像一个被弹簧拴在均线上的球：涨得太远会被拉回来，跌得太深也会弹回去。
            </p>
            <p>
              「偏离度」量化的就是这根弹簧被拉长了多少 —— 学术上叫乖离率（BIAS）。
              本看板采用<strong className="font-medium text-ink">对数口径</strong>：
            </p>
            <div className="num thin-scroll overflow-x-auto rounded-lg border border-line bg-surface-2 px-4 py-3 text-[13.5px] whitespace-nowrap text-ink">
              <span className="font-semibold">偏离度</span> = 100 × ln( 收盘价 ÷ N 日均线 )
            </div>
            <p>
              为什么不用常见的 <span className="num">(收盘 ÷ 均线 − 1)</span>？
              算术口径下 +10% 和 −10% 的幅度并不对称（−10% 后要涨 11.1% 才回本），
              75 年跨度的价格又翻了几十倍。取对数之后，正负两侧幅度可直接比较，
              长周期上的极端值也不会被复合效应放大。
            </p>
          </div>
          <div className="rounded-lg border border-line bg-surface-2 p-5">
            <p className="label-xs">为什么是 60 日 / 200 日</p>
            <ul className="mt-3 space-y-3 text-[12.5px] leading-relaxed text-muted">
              <li>
                <span className="font-medium text-ink-2">60 日 ≈ 一个季度</span>
                —— 反映中期情绪偏离，波动快，给的信号多但噪音也大。
              </li>
              <li>
                <span className="font-medium text-ink-2">200 日 ≈ 一年交易日</span>
                —— 机构最常用来划分牛熊的均线，反映长期估值偏离，信号少但更重。
              </li>
              <li>
                两条一起看：60 日告诉你「现在情绪多躁」，200 日告诉你「现在离长期中枢多远」。
                两者同时落到极端位置，才是历史级别的机会或风险。
              </li>
            </ul>
          </div>
        </div>
      </Card>

      {/* 2 */}
      <Card className="p-6 sm:p-7">
        <SectionHead
          label="02 统计方法"
          title="页面里的每个数字是怎么算出来的"
          hint="全部指标都基于同一份日线收盘价序列，不使用任何拟合、模型或预测。"
        />
        <div className="mt-5 overflow-hidden rounded-lg border border-line">
          <table className="w-full border-collapse text-[12.5px]">
            <tbody>
              {[
                [
                  '样本天数',
                  '历史上偏离度满足该阈值的所有交易日数量。与视频里的口径一致，直观但会因一次暴跌持续数周而重复计数。',
                ],
                [
                  '独立信号',
                  '把连续满足条件的区间合并为一次机会后的次数。判断「真正出现了多少次机会」应该看这个数字。',
                ],
                [
                  '胜率（抄底）',
                  '在这些日子买入并持有 N 个交易日后，收益 > 0 的比例。',
                ],
                [
                  '胜率（逃顶）',
                  '在这些日子离场，其后 N 个交易日内收益 < 0 的比例。',
                ],
                [
                  '均值 / 中位数',
                  '前瞻收益的平均值与中位数。均值容易被极端值拉动，中位数更抗噪。',
                ],
                [
                  '复归',
                  '偏离度回到 ±1% 以内视为「被拉回均线」。之所以用 ±1% 而不是 0，是为了避免长期小幅震荡导致永不判定复归。',
                ],
                [
                  '同类位置超额',
                  '历史上偏离度落在当前值 ±1% 内的所有交易日，其后 20 日上涨率减去常态上涨率（百分点）。这是总览与详情页展示的口径 —— 刻意不直接展示裸胜率：胜率的大头是常态漂移（美股无条件 20 日上涨率就有六成），单看「63%」会误读成机会。只有相对常态的超额才回答「这个位置有没有优势」。|超额| 在 3pp 内视为与常态无异（与行动水位的标定阈值一致），显示为灰色。恒为「上涨」口径，与当前偏离度正负无关；样本少于 30 天时不给数。',
                ],
                [
                  '距离行动水位',
                  '按价格口径折算：偏离度从当前值走到水位，需要指数变动 e^(Δ/100) − 1（假设均线短期不动）。',
                ],
                [
                  '触发关注（即 JSON 接口的 actionable）',
                  '判定只有一条：当前偏离度是否已**跌破该指数标定的行动水位**（60 日或 200 日任一）。它与状态标签（极值区 / 偏低区 / 中性区…）是**两件不同的事**：状态标签只看当前值在该时期分布里的**相对分位**，不含统计优势；水位则是逐指数标定、有实测超额支撑的门槛。两者可以不一致 —— 科创50 在 2026-09-16 处于「中性区」（200 日偏离度 +2.71%，接近该时期中位），但 60 日偏离度 −9.08% 已跌破它 −4% 的水位，所以它会被计入触发。反过来，纳斯达克100 两个口径都没有标定出水位（实测无优势），因此**永远不会触发** —— 这正是「没有统计优势就不诱导操作」的落实：若改用分位判定，它就会重新被算成「值得关注」。',
                ],
                [
                  '为什么逃顶天然更难',
                  '价格在均线上方偏离得再远，也不必然靠下跌来消化 —— 横盘不动、均线继续上移，同样能让偏离度回落。这是「抄底比逃顶容易」的根本原因，也是同类位置一律用上涨口径的原因。',
                ],
                [
                  '常态（不设条件）',
                  '不设任何条件、任意一天买入并持有 N 日的胜率与均值。**这是判断某个阈值胜率算不算高的唯一参照**。标普 1950 年以来无条件持有的 20 日上涨率是 61.8%、60 日是 66.7% —— 所以「≤ −10% 时胜率 62.4%」其实几乎没有超额，而「62.4%」单看却很像机会。概率表首行与热力底色的中性点都以此为准，而非 50%。',
                ],
                [
                  '历史时期切分',
                  '分段按**市场各自定义**，因为分段的意义来自该市场自身的制度变迁：美股是 1950 / 1970 / 2000 / 2010（战后重建、布雷顿森林体系解体、互联网泡沫、QE 常态化）；A 股是 全历史 / 2010 / 2016 / 2019（四万亿与创业板开板、供给侧改革与沪深港通、科创板与注册制）。拿「1970 年后」去套沪深300（2005 年才有数据）没有意义。当某个分段的起点早于数据起点时，它会与「全部历史」完全重合，页面会自动隐藏该分段。',
                ],
              ].map(([k, v]) => (
                <tr key={k} className="border-b border-line/70 last:border-0">
                  <td className="w-[120px] bg-surface-2 px-4 py-3 align-top font-medium text-ink">
                    {k}
                  </td>
                  <td className="px-4 py-3 leading-relaxed text-muted">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 3 */}
      <Card className="p-6 sm:p-7">
        <SectionHead
          label="03 关键结论"
          title="「抄底容易、逃顶难」要加上一个前提"
          hint="这不是主观判断，而是同一套数据算出来的不对称 —— 但也比通常说的更微妙。"
        />
        <div className="mt-5 grid gap-5 sm:grid-cols-3">
          {[
            {
              tone: 'steel' as const,
              tag: '必须比常态',
              title: '胜率要跟常态比，不是跟 50% 比',
              body: '指数长期是上涨的，无条件持有本来就有胜率。标普 20 日上涨率 61.8%、60 日 66.7%；A 股宽基也有 53~56%。只有明显高于这个「常态」的阈值才算真有超额。',
            },
            {
              tone: 'amber' as const,
              tag: '向上无限',
              title: '超涨后可以不跌',
              body: '价格在均线上方偏离得再远，也不必然回撤 —— 横盘不动、均线继续上移，同样能让偏离度回落。所以逃顶的超额天然更薄，这也是「同类位置」一律用上涨口径的原因。',
            },
            {
              tone: 'neutral' as const,
              tag: '分指数',
              title: '不是每个指数都适用',
              body: '实测下来：创业板指、中证500 的深跌信号很有效；沪深300、中证A500 只有 200 日口径有效、60 日口径跑不赢常态；纳斯达克100 两个口径都没有优势。所以水位按指数逐个标定，没有超额的就不给。',
            },
          ].map((c) => (
            <div key={c.title} className="rounded-lg border border-line bg-surface-2 p-5">
              <Tag tone={c.tone}>{c.tag}</Tag>
              <h3 className="mt-3 text-[13px] font-semibold text-ink">{c.title}</h3>
              <p className="mt-2 text-[12px] leading-relaxed text-muted">{c.body}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* 4 */}
      <Card className="p-6 sm:p-7">
        <SectionHead label="04 数据" title="数据来源与更新机制" />
        <dl className="mt-5 grid gap-x-10 gap-y-4 text-[12.5px] sm:grid-cols-2">
          {[
            [
              '数据源',
              '按市场分两个源，都是免费、无需密钥的公开接口：美股走 Yahoo Finance chart API；A 股走东方财富 push2his 日线接口（klt=101 日线、fqt=1 前复权）。之所以不能共用一个源：Yahoo 对 A 股指数基本是「有代码无历史」—— 沪深300 只从 2021 年起、创业板指完全没有数据、科创50（000688.SS）只返回 1 根 K 线。',
            ],
            [
              '走势外链',
              '每个指数的「走势 ↗」按钮在新标签页打开百度股市通对应指数的行情页，只用来查看该指数更长时间的 K 线与分时。那是站外页面，数据不参与本站任何计算 —— 本站的点位与偏离度仍然只来自上面两个源。',
            ],
            [
              '覆盖标的',
              '7 个指数。美股 2 个：标普500（^GSPC，数据自 1950 年）、纳斯达克100（^NDX，自 1985 年）；A 股 5 个：沪深300（000300）、中证A500（000510）、中证500（000905）、创业板指（399006）、科创50（000688）。沪、深宽基（沪深300 / 中证A500 / 中证500）数据可回溯到 2005 年前后；创业板指自发布日 2010-06-01 起；科创50 自基日 2019-12-31 起（发布日 2020-07-23，是最年轻的一个，统计窗口自 2020-11 开始）。',
            ],
            [
              '回溯段（重要）',
              '有些指数的历史早于它自己的发布日 —— 中证A500 于 2024-09-23 才发布，但数据源按基日回溯算到了 2005 年；中证500 发布日为 2007-01-15，数据同样回溯到 2005 年。这些交易日并非真实可交易历史，页面会标注「含回溯段」并给出天数。为判断这段是否可用，我们把回溯段与真实段分别对沪深300 计算日收益相关性：中证A500 回溯段 0.9914 / 真实段 0.9886，中证500 回溯段 0.9153 / 真实段 0.9222 —— 两段没有明显断点，说明回溯路径与真实市场结构一致（中证500 相关性整体偏低是因为它是中小盘、与大盘股沪深300 本就不同步）。但它终究是事后构造的路径，严谨的结论仍应以真实段为准。',
            ],
            [
              '缓存',
              '实时数据缓存 20 分钟（内存 + Cloudflare Cache API 两级），同一指数的不同页面与不同参数共用同一份计算结果。',
            ],
            [
              '离线兜底',
              '项目内置了每个指数的全量离线快照（随构建打包）。当实时接口不可达时自动回落，页面不会空白，但会标记为「离线快照」。A 股快照在交易时段刷新时，最后一根 K 线是盘中价，会随行情变动。',
            ],
            [
              '运行环境',
              'TanStack Start + Cloudflare Workers。页面服务端渲染，全部计算在 Worker 内完成，浏览器只拿到结果。',
            ],
            [
              '刷新快照',
              'npm run seed（可加指数 id 只刷新某一个，如 npm run seed nasdaq）。',
            ],
            [
              'JSON 接口',
              'GET /api/{indexId} —— 返回当前点位、两条偏离度与行动水位触发状态；GET /api/all 一次返回全部指数，适合「任意一个触发就报警」。',
            ],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="label-xs">{k}</dt>
              <dd className="mt-1.5 leading-relaxed text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* 5 */}
      <Card className="p-6 sm:p-7">
        <SectionHead label="05 局限" title="这个看板不能做什么" />
        <ul className="mt-5 space-y-3 text-[12.5px] leading-relaxed text-muted">
          {[
            '只统计历史频率，不做预测。历史胜率高不等于这一次也会赢，统计上的 70% 意味着 10 次里仍有 3 次是亏的。',
            '偏离度不识别基本面变化。2000 年与 2008 年的深度偏离，最终是靠长达数年的下跌与横盘才收敛，过程中「历史胜率」会持续给错信号。',
            '样本不足的阈值不可信。页面在样本少于 30 天时会直接标注，请以「独立信号」次数而非天数衡量。',
            '被广泛使用本身会削弱有效性。当所有人都用同一条均线做同样的判断时，策略会向自我实现或自我消解的方向漂移。',
          ].map((t) => (
            <li key={t} className="flex gap-2.5">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-line-strong" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
        <Divider className="my-5" />
        <p className="text-[12px] text-faint">
          本看板为研究与教学用途，所有内容不构成任何投资建议。
        </p>
      </Card>
    </div>
  )
}
