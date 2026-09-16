import { fmtDate, fmtExcess, fmtInt, fmtPct, fmtPoint, fmtProb } from '~/lib/format'
import { currencySymbol } from '~/lib/indices/registry'
import type {
  AnalogAnswer,
  BaselineStat,
  CurrentStatus,
  DataMeta,
  ExtremePoint,
  SignalTone,
} from '~/lib/indices/types'
import { Card, Metric, Tag } from './ui'

const TONE_DOT: Record<SignalTone, string> = {
  cold: 'bg-steel',
  cool: 'bg-steel/60',
  neutral: 'bg-faint',
  warm: 'bg-up/60',
  hot: 'bg-up',
}

const TONE_TEXT: Record<SignalTone, string> = {
  cold: 'text-steel',
  cool: 'text-steel',
  neutral: 'text-ink-2',
  warm: 'text-up',
  hot: 'text-up',
}

const TONE_BAR: Record<SignalTone, string> = {
  cold: 'bg-steel',
  cool: 'bg-steel/60',
  neutral: 'bg-faint',
  warm: 'bg-up/60',
  hot: 'bg-up',
}

const TONE_BG: Record<SignalTone, string> = {
  cold: 'bg-cold-band border-[#ccdbef]',
  cool: 'bg-cold-band border-[#dbe4f1]',
  neutral: 'bg-surface-2 border-line',
  warm: 'bg-hot-band border-[#f0d2ca]',
  hot: 'bg-hot-band border-[#ecc3ba]',
}

/** 分位 → 刻度尺游标 tone：便宜端偏冷、昂贵端偏热，中间保持中性 */
function pctTone(pct: number): SignalTone {
  if (!Number.isFinite(pct)) return 'neutral'
  if (pct < 1 / 3) return 'cool'
  if (pct > 2 / 3) return 'warm'
  return 'neutral'
}

/**
 * 详情页唯一的「当前状态」区块。
 *
 * 刻意把原来的「信号横幅 + 6 格指标卡 + 行动水位面板」三块压成一块：
 * 同一个数字只在这里出现一次，图表与表格不再重复展示当前值。
 * 信号解释放进 title（悬停可见），完整说明在方法页。
 */
export function SummaryStrip({
  meta,
  status,
  actionLevel,
  analog,
  baseline,
}: {
  meta: DataMeta
  status: CurrentStatus
  actionLevel: { dev60: number | null; dev200: number | null }
  analog: AnalogAnswer
  baseline: BaselineStat[]
}) {
  const { signal } = status
  const level = actionLevel.dev200
  const world = baseline.find((b) => b.days === 20)?.winRate ?? Number.NaN
  const noLevel = level === null
  const inLevel = status.toThreshold200 === 0

  const moveText = noLevel
    ? '无水位'
    : inLevel
      ? '已进入'
      : `还需跌 ${Math.abs(status.toThreshold200 ?? 0).toFixed(1)}%`

  // 数字保持中性色：红色的话语权只属于信号横幅（警示色常态化 = 没有警示）

  return (
    <Card className="overflow-hidden">
      {/* 信号横幅：左侧色条 + 背景色 */}
      <div
        className={`relative border-b px-6 py-4 sm:px-7 ${TONE_BG[signal.tone]}`}
        title={signal.desc}
      >
        <span className={`absolute inset-y-0 left-0 w-1 ${TONE_BAR[signal.tone]}`} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[signal.tone]}`} />
          <span className={`text-[15px] font-semibold ${TONE_TEXT[signal.tone]}`}>
            {signal.title}
          </span>
          {signal.actionable ? <Tag tone="steel">值得关注</Tag> : null}
          {meta.backfillDays > 250 ? (
            <Tag tone="warn">含回溯段</Tag>
          ) : null}
          <span className="ml-auto text-[11.5px] text-faint">
            数据截至 <span className="num">{fmtDate(meta.lastDate)}</span>
            {meta.source === 'live' ? ' · 实时' : ' · 离线快照'}
          </span>
        </div>
      </div>

      {/* 5 格核心数字 */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-7 p-6 sm:grid-cols-3 sm:p-7 lg:grid-cols-5">
        <Metric
          label="最新点位"
          value={
            <>
              <span className="mr-0.5 text-[0.5em] font-medium text-faint">
                {currencySymbol(meta.currency)}
              </span>
              {fmtPoint(status.close, status.close < 100 ? 2 : 0)}
            </>
          }
          size="lg"
        />
        <Metric
          label="60 日偏离度"
          value={fmtPct(status.dev60)}
          size="xl"
          gauge={{ pct: status.pct60, tone: pctTone(status.pct60) }}
          sub={`该时期分位 ${(status.pct60 * 100).toFixed(1)}%`}
        />
        <Metric
          label="200 日偏离度"
          value={fmtPct(status.dev200)}
          size="xl"
          gauge={{ pct: status.pct200, tone: pctTone(status.pct200) }}
          sub={`该时期分位 ${(status.pct200 * 100).toFixed(1)}%`}
        />
        <Metric
          label={noLevel ? '200 日行动水位' : `到 ${level}% 水位`}
          value={moveText}
          tone={noLevel ? 'neutral' : inLevel ? 'down' : 'neutral'}
          size="md"
          hint={
            noLevel
              ? '该指数 200 日偏离度跌破任何一档时，60 日胜率都不优于「不设条件」的常态值，因此不给水位。'
              : `行动水位是实测标定值：该指数 200 日偏离度跌破 ${level}% 之后，60 日胜率相对「常态」有明显超额。`
          }
          sub={
            noLevel
              ? '历史各档位均无超额'
              : inLevel
                ? '已进入水位区间'
                : '按价格口径折算，假设均线短期不动'
          }
        />
        <Metric
          label="同类位置 20 日超额"
          value={fmtExcess(analog.excess20)}
          tone={
            analog.excess20 === null || Math.abs(analog.excess20) < 3
              ? 'neutral'
              : analog.excess20 > 0
                ? 'up'
                : 'down'
          }
          size="md"
          hint={`历史上 200 日偏离度落在当前值 ±1% 内的所有交易日，其后 20 日上涨率减去「不设条件」的常态上涨率（${fmtProb(world)}）。同类胜率本身为 ${fmtProb(analog.win20)}——裸胜率的大头是常态漂移，只有超额才有参考价值；|超额| 在 3pp 内视为与常态无异（与水位标定规则一致）。恒为「上涨」口径。`}
          sub={
            <>
              同类样本 {fmtInt(analog.sampleDays)} 天
              <span className="mx-1 text-line-strong">·</span>
              {fmtInt(analog.episodes)} 段独立信号
            </>
          }
        />
      </div>

      {meta.backfillDays > 250 ? (
        <p className="border-t border-line px-6 py-3.5 text-[12px] leading-relaxed text-muted sm:px-7">
          <span className="font-medium text-[#a35a1c]">含回溯段：</span>
          该指数于 <span className="num">{fmtDate(meta.liveSince)}</span> 才正式发布，
          但数据源按基日回溯算到了 <span className="num">{fmtDate(meta.rawFirstDate)}</span>，
          即约 <span className="num">{fmtInt(meta.backfillDays)}</span> 个交易日
          （≈ {(meta.backfillDays / 244).toFixed(1)} 年）并非真实可交易历史。
          这段路径经过「与真实段的收益同步性是否有断点」的检验
          （把回溯段与真实段分别对沪深300 算日收益相关性，两段基本一致，详见方法页），
          但它终究是事后构造出来的路径，统计结论请以真实段为准。
        </p>
      ) : null}
    </Card>
  )
}

/** 历史极值样本 */
export function ExtremesTable({
  title,
  hint,
  points,
  mode,
}: {
  title: string
  hint: string
  points: ExtremePoint[]
  mode: 'low' | 'high'
}) {
  return (
    <Card className="p-6">
      <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{hint}</p>
      <div className="thin-scroll mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="py-2.5 pr-3 font-medium text-faint">日期</th>
              <th className="py-2.5 pr-3 text-right font-medium text-faint">点位</th>
              <th className="py-2.5 pr-3 text-right font-medium text-faint">200 日偏离</th>
              <th className="py-2.5 pr-3 text-right font-medium text-faint">之后 20 日</th>
              <th className="py-2.5 pr-3 text-right font-medium text-faint">之后 60 日</th>
              <th className="py-2.5 text-right font-medium text-faint">回到均线</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.date} className="border-b border-line/70 last:border-0">
                <td className="num py-2.5 pr-3 whitespace-nowrap text-ink-2">
                  {fmtDate(p.date)}
                </td>
                <td className="num py-2.5 pr-3 text-right font-medium text-ink">{fmtPoint(p.close)}</td>
                <td className="num py-2.5 pr-3 text-right font-medium text-ink-2">
                  {p.dev200 > 0 ? '+' : ''}
                  {p.dev200.toFixed(2)}%
                </td>
                <td className="py-2.5 pr-3 text-right">
                  <Fwd v={p.fwd20} />
                </td>
                <td className="py-2.5 pr-3 text-right">
                  <Fwd v={p.fwd60} />
                </td>
                <td className="num py-2.5 text-right text-muted">
                  {p.daysToRevert < 0 ? '—' : `${p.daysToRevert} 日`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-[11.5px] leading-relaxed text-faint">
        {mode === 'low'
          ? '极值之间至少间隔 60 个交易日，避免同一次下跌被重复计入。「回到均线」指偏离度回到 ±1% 以内所需交易日。'
          : '「回到均线」指偏离度回到 ±1% 以内所需交易日。长期向上的指数，横盘等均线追上来也算复归。'}
      </p>
    </Card>
  )
}

function Fwd({ v }: { v: number }) {
  const cls = v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-muted'
  return <span className={`num ${cls}`}>{fmtPct(v * 100)}</span>
}
