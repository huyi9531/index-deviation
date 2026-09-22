import { createFileRoute, Link } from '@tanstack/react-router'
import { Sparkline } from '~/components/Sparkline'
import { Card, ChartLink, Tag } from '~/components/ui'
import { fmtDate, fmtExcess, fmtPct, fmtPoint, excessToneOf, type ExcessTone } from '~/lib/format'
import { MARKET_LABEL, TRIGGER_LABEL, currencySymbol, evidenceOf } from '~/lib/indices/registry'
import type { EvidenceGrade } from '~/lib/indices/registry'
import { getOverview } from '~/lib/indices/service'
import { bindingLevel } from '~/lib/indices/stats'
import type { OverviewRow, SignalTone } from '~/lib/indices/types'

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: '指数偏离度监控 · 多指数总览' },
      {
        name: 'description',
        content:
          '用 60 日 / 200 日均线的对数偏离度，量化各主要指数的超买超卖位置与历史概率。',
      },
    ],
  }),
  loader: () => getOverview(),
  component: OverviewPage,
})

const SPARK_COLOR: Record<SignalTone, { line: string; fill: string }> = {
  cold: { line: '#1f5096', fill: 'rgba(31,80,150,0.12)' },
  cool: { line: '#1f5096', fill: 'rgba(31,80,150,0.08)' },
  neutral: { line: '#9ba0a6', fill: 'rgba(153,160,166,0.08)' },
  warm: { line: '#c0392b', fill: 'rgba(192,57,43,0.08)' },
  hot: { line: '#c0392b', fill: 'rgba(192,57,43,0.13)' },
}

const TONE_DOT: Record<SignalTone, string> = {
  cold: 'bg-steel',
  cool: 'bg-steel/60',
  neutral: 'bg-faint',
  warm: 'bg-up/60',
  hot: 'bg-up',
}

const TONE_PILL: Record<SignalTone, string> = {
  cold: 'bg-steel-soft text-steel border-[#d0dcee]',
  cool: 'bg-steel-soft/70 text-steel border-[#dbe4f1]',
  neutral: 'bg-surface-2 text-muted border-line',
  warm: 'bg-hot-band text-up border-[#f0d2ca]',
  hot: 'bg-hot-band text-up border-[#ecc3ba]',
}

/** 排序用：越冷（超卖、越接近历史机会区）越靠前 */
const TONE_RANK: Record<SignalTone, number> = { cold: 0, cool: 1, neutral: 2, warm: 3, hot: 4 }

/**
 * 同温内的排序键：离最近一条行动水位还有多远（越小越靠前）。
 *
 *   已触发任一水位        → 0（它已经在机会区里，没有「还需跌」可言）
 *   否则取两条水位里近的那条 → min(|to60|, |to200|)，单位是价格变动 %
 *   两条水位都没标定      → Infinity（垫底）
 *
 * 选哪一条的规则**不在这里**，在 `stats.ts` 的 `bindingLevel()` —— 详情页水位格
 * 调的是同一个函数。曾经这里与 SummaryStrip 各写一份，于是已经跌破 dev60 水位的指数
 * 会被按 dev200 的距离排到第 8 位（等于把那次触发当成不存在），而详情页会同时显示
 * 「值得关注」和「到 -16% 水位还需跌 17%」。
 * 注意判定用的是**阈值口径**的 waterTriggered，不是 signal.tone 的分位口径。
 */
function distanceToAction(row: OverviewRow): number {
  const bind = bindingLevel(row.to60, row.to200)
  return bind === null ? Number.POSITIVE_INFINITY : Math.abs(bind.move)
}

/**
 * 触发标记的证据级别：取 **binding 那一侧**的级别。
 * binding 的判定与排序、详情页水位格同源（stats.ts 的 `bindingLevel`），
 * 所以「触发标记说的是哪条水位」与「页面显示的是哪条水位」永远一致。
 */
function triggerGrade(row: OverviewRow): EvidenceGrade {
  const bind = bindingLevel(row.to60, row.to200)
  return bind === null ? 'none' : evidenceOf(row.id, bind.side)
}

/**
 * 非实时数据源的可视标记。live 不标；cached = 实时源不可达、用 KV 里上次成功抓取
 * 的数据（较新）；snapshot = 连 KV 也没有，退到构建时内置的离线快照（只在重新部署时
 * 更新）。两种都要显式标出 —— 兜底数据冒充实时是诚实性问题。
 */
const SOURCE_BADGE: Record<'cached' | 'snapshot', { label: string; tone: 'steel' | 'warn' }> =
  {
    cached: { label: '缓存', tone: 'steel' },
    snapshot: { label: '快照', tone: 'warn' },
  }

function OverviewPage() {
  const data = Route.useLoaderData()

  // 排序 = 「离值得动手的距离」：
  //   ① 按信号温度冷 → 热：cold（历史级超卖）最前，hot（过热警戒）垫底 ——
  //      过热是逃顶侧的警示，不是买入机会，靠红色 pill 提示而不浮顶；
  //   ② 同温内按「离最近一条行动水位的距离」升序，见 distanceToAction()。
  // Array.prototype.sort 是稳定的，同键内保持注册表原序。
  const rows = [...data.rows].sort((a, b) => {
    const byTone = TONE_RANK[a.signal.tone] - TONE_RANK[b.signal.tone]
    if (byTone !== 0) return byTone
    return distanceToAction(a) - distanceToAction(b)
  })
  // 「触发关注」= 跌破该指数**标定水位**的个数，与 /api 的 actionable 同源
  // （曾经这里用的是 signal.tone 口径，与 API 同名不同义，2026-09 科创50 的
  //  浅水位让两者公开分歧 —— API true、页面 0 个 —— 现已统一到阈值口径）
  const actionable = rows.filter((r) => r.waterTriggered).length
  const lastDate = rows[0]?.date ?? 0

  return (
    <div className="space-y-9">
      {/* ─────── Hero：标题 + 一句话定义 + 唯一的大数字 —— 触发关注 ─────── */}
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
        <div className="min-w-0">
          <h1 className="text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink">
            指数偏离度监控
          </h1>
          <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted">
            60 / 200 日均线对数偏离度
            <span className="mx-2 text-line-strong">—</span>
            十个主要指数
            <span className="mx-2 text-line-strong">—</span>
            全历史胜率统计
          </p>
        </div>
        <div className="flex items-end gap-7">
          <HeroStat
            label="触发关注"
            value={String(actionable)}
            unit="个"
            tone={actionable > 0 ? 'steel' : 'neutral'}
          />
        </div>
      </div>

      {/* 移动端：一行一张卡，避免宽表格要横向拖动才看得到关键列 */}
      <div className="space-y-3 sm:hidden">
        {rows.map((row) => (
          <MobileRow key={row.id} row={row} />
        ))}
      </div>

      <Card className="hidden overflow-hidden sm:block">
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line-strong text-left">
                <th className="px-6 py-3.5 text-[11.5px] font-medium text-faint">指数</th>
                <th className="py-3.5 pr-4 text-[11.5px] font-medium text-faint">
                  最新点位
                </th>
                <th className="py-3.5 pr-4 text-[11.5px] font-medium text-faint">
                  60 日偏离
                </th>
                <th className="py-3.5 pr-4 text-[11.5px] font-medium text-faint">
                  200 日偏离
                </th>
                <th className="py-3.5 pr-4 text-[11.5px] font-medium text-faint">
                  近一年 200 日偏离度
                </th>
                <th className="py-3.5 pr-4 text-[11.5px] font-medium text-faint">
                  同类位置 20 日超额
                </th>
                <th className="py-3.5 pr-6 text-[11.5px] font-medium text-faint">状态</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Row key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-[12px] leading-relaxed text-faint">
        数据截至 <span className="num">{fmtDate(lastDate)}</span>
        。「同类位置 20 日超额」为历史同类位置的上涨率减去常态上涨率（百分点），
        ±3pp 内视为与常态无异，定义见
        <Link to="/method" className="mx-0.5 text-muted underline decoration-line hover:text-ink">
          方法与数据
        </Link>
        ；不构成投资建议。
      </p>
    </div>
  )
}

/**
 * 语义色档 → 文本色类。**判定不在本地** —— 在 `lib/format.ts` 的 `excessToneOf()`，
 * 详情页水位卡调的是同一个函数。这里只管把档位翻译成 class。
 * A 股惯例：正超额 → 红（涨优势）、负超额 → 绿（跌优势）、与常态无异 → 灰。
 */
const EXCESS_CLASS: Record<ExcessTone, string> = {
  up: 'text-up',
  down: 'text-down',
  neutral: 'text-faint',
}

/** 哨兵用的机器可读属性：让 .smoke/check.mjs 能断言「颜色 == 规则」而不必解析样式 */
function excessAttrs(v: number | null, ci: [number, number] | null) {
  return {
    'data-excess': v === null ? 'none' : String(v),
    'data-excess-ci': ci ? `${ci[0]} ${ci[1]}` : 'none',
    'data-excess-tone': excessToneOf(v, ci),
  }
}

/** Hero 区域的一个大数字 */
function HeroStat({
  label,
  value,
  unit,
  tone = 'neutral',
}: {
  label: string
  value: string
  unit?: string
  tone?: 'neutral' | 'steel'
}) {
  return (
    <div className="shrink-0">
      <p className="label-xs">{label}</p>
      <p
        className={`num mt-1.5 text-[30px] font-semibold leading-none tracking-[-0.015em] ${
          tone === 'steel' ? 'text-steel' : 'text-ink'
        }`}
      >
        {value}
        {unit ? (
          <span className="ml-1 text-[0.5em] font-medium text-faint">{unit}</span>
        ) : null}
      </p>
    </div>
  )
}

/**
 * 「值得关注」标记 —— 阈值口径（`row.waterTriggered`）在列表里的唯一可视化。
 *
 * 它必须与 Hero 的计数、详情页的同名标签、`/api` 的 `actionable` 同源
 * （全由 stats.ts 的 `waterTriggered` 判定）。
 *
 * 2026-09 用户反馈：「Hero 说触发 1 个，但我看不出是哪一个」——当时这个标记
 * 只存在于详情页，总览的行里根本没有，`waterTriggered` 在总览页仅被用来数了个总数。
 *
 * 它与旁边的状态标签是**两件不同的事**，同现一行并不矛盾：
 *   · 状态标签 = 当前偏离度在**该时期分布里的相对分位**（不含统计优势）
 *   · 值得关注 = 是否跌破该指数**标定水位**（有实测统计优势的门槛）
 * 所以科创50 可以既是「中性区」（整体位置居中）又「值得关注」（60 日偏离已破 −4% 水位）。
 * title 里写明这点，因为两套口径的分歧是最容易被误读成 bug 的地方。
 *
 * 位置固定在状态标签**之后**（用户 2026-09 明确要求），不要挪到前面。
 *
 * ⚠️ **2026-09 重标后，「值得关注」这个措辞只在证据站得住时才能用。**
 * 20 格里只有 4 格 robust（全样本与前后两半段都成立）、3 格 eraOnly，其余 12 格
 * 样本外已经翻负 —— 那些格子照旧参与触发（判定逻辑不变），但标签必须写成
 * 「已进入水位 · 证据薄弱」，不能拿暗示行动的措辞蒙过去。
 * 文案取自 registry 的 TRIGGER_LABEL，**不在这里手写** —— 措辞与证据级别的对应关系
 * 是产品立场的一部分，散在各页面里就又会分叉。
 */
function WaterMark({ grade }: { grade: EvidenceGrade }) {
  const label = TRIGGER_LABEL[grade]
  if (label === null) return null
  const weak = grade === 'fragile'
  return (
    <span
      // 哨兵用：.smoke/check.mjs 靠它数触发标记，不靠文案（文案会随证据级别变）
      data-water-trigger={grade}
      title={
        weak
          ? '已跌破该指数标定的行动水位，但该水位的证据薄弱：样本外（后半段）的 60 日超额已翻负。保留为历史参考线，不构成统计上站得住的优势。'
          : '已跌破该指数标定的行动水位（阈值口径）。与左侧的状态标签不是一套判定：状态只看偏离度在该时期分布里的相对分位，不含统计优势。'
      }
    >
      <Tag tone={weak ? 'warn' : 'steel'}>{label}</Tag>
    </span>
  )
}

function Row({ row }: { row: OverviewRow }) {
  const spark = SPARK_COLOR[row.signal.tone]
  return (
    <tr className="group relative border-b border-line/70 transition-colors last:border-0 hover:bg-surface-2/70">
      <td className="px-6 py-[15px]">
        <div className="flex items-center gap-2.5">
          <Link
            to="/i/$indexId"
            params={{ indexId: row.id }}
            className="flex items-center gap-2.5"
          >
            <span className="text-[14px] font-semibold text-ink transition-colors group-hover:text-steel">
              {row.name}
            </span>
            <span className="num text-[11px] text-faint">{row.ticker}</span>
            <Tag tone={row.market}>{MARKET_LABEL[row.market]}</Tag>
          </Link>
          <ChartLink indexId={row.id} />
        </div>
      </td>
      <td className="num py-[15px] pr-4 font-medium text-ink">
        <span className="mr-0.5 text-[0.75em] font-medium text-faint">
          {currencySymbol(row.currency)}
        </span>
        {fmtPoint(row.close, row.close < 100 ? 2 : 0)}
      </td>
      <td className="num py-[15px] pr-4 font-medium text-amber">
        {fmtPct(row.dev60)}
      </td>
      <td className="num py-[15px] pr-4 font-semibold text-steel">
        {fmtPct(row.dev200)}
      </td>
      <td className="w-[200px] py-3 pr-4">
        <Link to="/i/$indexId" params={{ indexId: row.id }} tabIndex={-1}>
          <Sparkline values={row.spark} color={spark.line} fill={spark.fill} height={32} />
        </Link>
      </td>
      <td
        className={`num py-[15px] pr-4 font-medium ${EXCESS_CLASS[excessToneOf(row.analogExcess, row.analogExcessCi)]}`}
        {...excessAttrs(row.analogExcess, row.analogExcessCi)}
      >
        {fmtExcess(row.analogExcess)}
      </td>
      <td className="py-[15px] pr-6 whitespace-nowrap">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium ${TONE_PILL[row.signal.tone]}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[row.signal.tone]}`} />
          {row.signal.title}
        </span>
        {/* 「值得关注」放在状态标签**之后**：状态是该列的主体，触发标记是追加的
            附注（用户 2026-09 明确要求，不要排在前面）。 */}
        {row.waterTriggered ? (
          <span className="ml-2">
            <WaterMark grade={triggerGrade(row)} />
          </span>
        ) : null}
        {row.source !== 'live' ? (
          <span className="ml-2">
            <Tag tone={SOURCE_BADGE[row.source].tone}>{SOURCE_BADGE[row.source].label}</Tag>
          </span>
        ) : null}
      </td>
    </tr>
  )
}

/** 移动端的一行 = 一张卡。
 *  标题与内容各自是通往详情页的链接，外链按钮是这个卡的第三个独立链接 ——
 *  卡片类样式因此必须留在外层 <div> 上（<a> 套 <a> 是非法 HTML）。 */
function MobileRow({ row }: { row: OverviewRow }) {
  const spark = SPARK_COLOR[row.signal.tone]
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card transition-shadow active:shadow-card-hover">
      <div className="flex items-center justify-between gap-3">
        {/* flex-wrap 不能省：手机（390px）下「名称 + ticker + 市场标签 + 来源标签」
            会超出可用宽度（实测需 202px、只有 183px）。不换行 + Tag 又没 nowrap 时，
            flex 会把标签压成两行竖排的圆形。宁可换行，不可压形。 */}
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            to="/i/$indexId"
            params={{ indexId: row.id }}
            className="shrink-0 whitespace-nowrap text-[14.5px] font-semibold text-ink"
          >
            {row.name}
          </Link>
          <span className="num text-[10.5px] text-faint">{row.ticker}</span>
          <Tag tone={row.market}>{MARKET_LABEL[row.market]}</Tag>
          {row.source !== 'live' ? (
            <Tag tone={SOURCE_BADGE[row.source].tone}>{SOURCE_BADGE[row.source].label}</Tag>
          ) : null}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          {/* 竖排而不横排：左侧已有名称/ticker/市场/来源四个元素，
              390px 下再挤一个标签会撑破卡片（实测过）。
              顺序与桌面一致：状态标签在前、「值得关注」在后（即下方）。 */}
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE_PILL[row.signal.tone]}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[row.signal.tone]}`} />
            {row.signal.title}
          </span>
          {row.waterTriggered ? <WaterMark grade={triggerGrade(row)} /> : null}
        </span>
      </div>

      <Link to="/i/$indexId" params={{ indexId: row.id }} className="mt-4 block">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="label-xs">点位</p>
            <p className="num mt-1.5 text-[19px] font-semibold leading-none text-ink">
              <span className="text-[11px] font-medium text-faint">
                {currencySymbol(row.currency)}
              </span>
              {fmtPoint(row.close, row.close < 100 ? 2 : 0)}
            </p>
          </div>
          <div>
            <p className="label-xs">60 日偏离</p>
            <p className="num mt-1.5 text-[17px] font-semibold leading-none text-amber">
              {fmtPct(row.dev60)}
            </p>
          </div>
          <div>
            <p className="label-xs">200 日偏离</p>
            <p className="num mt-1.5 text-[17px] font-semibold leading-none text-steel">
              {fmtPct(row.dev200)}
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <Sparkline values={row.spark} color={spark.line} fill={spark.fill} height={28} />
            <p className="mt-1 text-[10.5px] text-faint">近一年 200 日偏离度</p>
          </div>
          <div className="shrink-0 text-right">
            <p
              className={`num text-[17px] font-semibold leading-none ${EXCESS_CLASS[excessToneOf(row.analogExcess, row.analogExcessCi)]}`}
              {...excessAttrs(row.analogExcess, row.analogExcessCi)}
            >
              {fmtExcess(row.analogExcess)}
            </p>
            <p className="mt-1 text-[10.5px] text-faint">同类 20 日超额</p>
          </div>
        </div>
      </Link>

      <div className="mt-3.5 flex justify-end border-t border-line/70 pt-2.5">
        <ChartLink indexId={row.id} />
      </div>
    </div>
  )
}
