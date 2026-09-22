import { Fragment } from 'react'
import { fmtInt, fmtPct, fmtProb } from '~/lib/format'
import type { BaselineStat, HorizonStat, ThresholdRow } from '~/lib/indices/types'
import { HScroll, ProbBar } from './ui'

function pick(row: ThresholdRow, days: number): HorizonStat | undefined {
  return row.horizons.find((h) => h.days === days)
}

function pickBase(baseline: BaselineStat[] | undefined, days: number): number {
  return baseline?.find((b) => b.days === days)?.winRate ?? Number.NaN
}

/** 收益数值：正值红、负值绿（中文市场习惯） */
export function ReturnText({ v, digits = 2 }: { v: number; digits?: number }) {
  if (!Number.isFinite(v)) return <span className="text-faint">—</span>
  const cls = v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-muted'
  return <span className={`num ${cls}`}>{fmtPct(v * 100, digits)}</span>
}

/* ───────── 紧凑热力表：详情页「概率速查」用，一格一值 ───────── */

const HEAT = {
  dip: '31, 80, 150',
  top: '192, 57, 43',
} as const
/** 低于常态：用中性灰，避免把「没有超额」也染成彩色 */
const BELOW = '153, 160, 166'

/**
 * 只用「胜率」一个数字填满网格，靠背景深浅表达**相对常态的超额**。
 *
 * 关键：中性点不是 50%，而是「不设条件的常态胜率」。
 * 标普 1950 年以来无条件持有的 20 日上涨率就有 61.8%，
 * 若以 50% 为中性点，「≤ −10% 时 62.4%」会被染成深度蓝，看起来像大机会，
 * 实际上几乎没有超额。参照行会显式列出常态值。
 */
export function DenseThresholdTable({
  rows,
  horizons,
  mode,
  baseline,
}: {
  rows: ThresholdRow[]
  horizons: number[]
  mode: 'dip' | 'top'
  baseline?: BaselineStat[]
}) {
  const prefix = mode === 'dip' ? '≤' : '≥'
  const rgb = HEAT[mode]

  // 逃顶口径下「常态」= 无条件下跌的比例 = 1 − 无条件上涨率
  const baseOf = (h: number) => {
    const b = pickBase(baseline, h)
    if (!Number.isFinite(b)) return Number.NaN
    return mode === 'dip' ? b : 1 - b
  }

  return (
    <HScroll>
      <table className="w-full min-w-[400px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="py-2.5 pr-3 whitespace-nowrap font-medium text-faint">触发条件</th>
            <th className="py-2.5 pr-3 text-right whitespace-nowrap font-medium text-faint">
              独立信号
            </th>
            {horizons.map((h) => (
              <th
                key={h}
                className="py-2.5 pr-2 text-right whitespace-nowrap font-medium text-faint sm:pl-3"
              >
                {h} 日
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {baseline?.length ? (
            <tr className="border-b border-line/60 bg-surface-2/60">
              <td className="py-2 whitespace-nowrap text-faint">常态（不设条件）</td>
              <td className="py-2 pr-3 text-right text-faint">—</td>
              {horizons.map((h) => (
                <td key={h} className="num py-2 pr-2 text-right text-faint sm:pl-3">
                  {fmtProb(baseOf(h))}
                </td>
              ))}
            </tr>
          ) : null}
          {rows.map((row) => {
            const empty = row.sampleDays === 0
            return (
              <tr key={row.threshold} className="border-b border-line/60 last:border-0">
                <td className="py-2 whitespace-nowrap">
                  <span className="num font-medium text-ink">
                    {prefix} {row.threshold}%
                  </span>
                  {row.triggeredNow ? (
                    <span className="ml-1.5 text-[10.5px] font-medium text-steel">● 现在</span>
                  ) : null}
                </td>
                <td className="num py-2 pr-3 text-right text-ink-2">
                  {empty ? '—' : fmtInt(row.episodes)}
                </td>
                {horizons.map((h) => {
                  const stat = pick(row, h)
                  if (empty || !stat || !Number.isFinite(stat.winRate)) {
                    return (
                      <td key={h} className="py-2 pr-2 text-right text-faint sm:pl-3">
                        —
                      </td>
                    )
                  }
                  // 相对常态的偏离幅度决定底色深浅；低于常态用灰，不做「伪信号」
                  const base = baseOf(h)
                  const delta = Number.isFinite(base) ? stat.winRate - base : 0
                  const strength = Math.min(1, Math.abs(delta) / 0.15)
                  const tint = delta >= 0 ? rgb : BELOW
                  // 超额的色更浓（0.36），低于常态的灰更淡（0.18），差异更醒目
                  const alpha = delta >= 0 ? strength * 0.36 : strength * 0.18
                  return (
                    <td key={h} className="py-2 pr-2 text-right sm:pl-3">
                      <span
                        className="num inline-block rounded-md px-1.5 py-1 tabular-nums font-medium text-ink sm:px-2"
                        style={{
                          background: `rgba(${tint}, ${alpha.toFixed(3)})`,
                        }}
                        title={
                          `胜率 ${fmtProb(stat.winRate)} · 常态 ${fmtProb(base)} · ` +
                          `超额 ${(delta * 100).toFixed(1)}pp\n` +
                          `均值 ${fmtPct(stat.avg * 100)} · 最差 ${fmtPct(stat.worst * 100)}`
                        }
                      >
                        {fmtProb(stat.winRate)}
                      </span>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </HScroll>
  )
}

/* ───────── 完整表：统计页用 ───────── */

export function ThresholdTable({
  rows,
  horizons,
  mode,
  thresholdPrefix,
  emptyHint,
  baseline,
}: {
  rows: ThresholdRow[]
  horizons: number[]
  mode: 'dip' | 'top'
  /** 阈值的展示前缀，如 "≤" 或 "≥" */
  thresholdPrefix?: string
  emptyHint?: string
  baseline?: BaselineStat[]
}) {
  const prefix = thresholdPrefix ?? (mode === 'dip' ? '≤' : '≥')
  const tone = mode === 'dip' ? 'steel' : 'up'

  const baseOf = (h: number) => {
    const b = pickBase(baseline, h)
    if (!Number.isFinite(b)) return Number.NaN
    return mode === 'dip' ? b : 1 - b
  }
  const baseAvg = (h: number) => baseline?.find((b) => b.days === h)?.avg ?? Number.NaN

  return (
    <div className="thin-scroll overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="py-2 pr-4 font-medium text-faint">触发条件</th>
            <th className="py-2 pr-4 text-right font-medium text-faint">样本天数</th>
            <th className="py-2 pr-4 text-right font-medium text-faint">独立信号</th>
            {horizons.map((h) => (
              <Fragment key={h}>
                <th className="py-2 pr-4 text-right font-medium text-faint">
                  {h} 日胜率
                </th>
                <th className="py-2 pr-4 text-right font-medium text-faint">
                  {h} 日均值
                </th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {baseline?.length ? (
            <tr className="border-b-2 border-line bg-surface-2/70">
              <td className="py-2.5 pr-4 whitespace-nowrap font-medium text-faint">
                常态（不设条件）
              </td>
              <td className="py-2.5 pr-4 text-right text-faint">—</td>
              <td className="py-2.5 pr-4 text-right text-faint">—</td>
              {horizons.map((h) => (
                <Fragment key={h}>
                  <td className="num py-2.5 pr-4 text-right text-faint">{fmtProb(baseOf(h))}</td>
                  <td className="num py-2.5 pr-4 text-right text-faint">
                    {Number.isFinite(baseAvg(h)) ? fmtPct(baseAvg(h) * 100) : '—'}
                  </td>
                </Fragment>
              ))}
            </tr>
          ) : null}
          {rows.map((row) => {
            const empty = row.sampleDays === 0
            return (
              <tr
                key={row.threshold}
                className={`border-b border-line/70 last:border-0 ${
                  row.triggeredNow ? 'bg-steel-soft/45' : ''
                }`}
              >
                <td className="py-2.5 pr-4 whitespace-nowrap">
                  <span className="num font-medium text-ink">
                    {prefix} {row.threshold}%
                  </span>
                  {row.triggeredNow ? (
                    <span className="ml-2 text-[10.5px] text-steel">● 现在</span>
                  ) : null}
                </td>
                <td className="num py-2.5 pr-4 text-right text-ink-2">
                  {empty ? '—' : fmtInt(row.sampleDays)}
                </td>
                <td className="num py-2.5 pr-4 text-right text-ink-2">
                  {empty ? '—' : fmtInt(row.episodes)}
                </td>
                {horizons.map((h) => {
                  const stat = pick(row, h)
                  return (
                    <Fragment key={h}>
                      <td className="py-2.5 pr-4 text-right">
                        {empty || !stat ? (
                          <span className="text-faint">—</span>
                        ) : (
                          <ProbBar value={stat.winRate} tone={tone} />
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        {empty || !stat ? (
                          <span className="text-faint">—</span>
                        ) : (
                          <ReturnText v={stat.avg} />
                        )}
                      </td>
                    </Fragment>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      {emptyHint ? <p className="mt-3 text-[11.5px] text-faint">{emptyHint}</p> : null}
    </div>
  )
}

/** 分时期胜率矩阵：行=阈值，列=历史时期 */
export function EraMatrix({
  rows,
  horizon,
}: {
  rows: {
    threshold: number
    cells: { id: string; label: string; winRate: number; samples: number; avg: number }[]
  }[]
  horizon: number
}) {
  const eras = rows[0]?.cells ?? []
  return (
    <HScroll>
      <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="py-2 pr-4 whitespace-nowrap font-medium text-faint">触发条件</th>
            {eras.map((e) => (
              <th key={e.id} className="py-2 pr-4 whitespace-nowrap font-medium text-faint">
                {e.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.threshold} className="border-b border-line/70 last:border-0">
              <td className="num py-2.5 pr-4 whitespace-nowrap font-medium text-ink">
                ≤ {row.threshold}%
              </td>
              {row.cells.map((c) => (
                <td key={c.id} className="py-2.5 pr-4">
                  {c.samples === 0 ? (
                    <span className="text-faint">—</span>
                  ) : (
                    <div>
                      <ProbBar value={c.winRate} tone="steel" width={46} />
                      <p className="num mt-0.5 text-[10.5px] text-faint">
                        n={fmtInt(c.samples)} · 均值 <ReturnText v={c.avg} digits={1} />
                      </p>
                    </div>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </HScroll>
  )
}

/** 分时期汇总表（行动水位在各时期的表现） */
export function EraSummaryTable({
  rows,
  level,
  keyLabel,
}: {
  rows: {
    id: string
    label: string
    note: string
    years: string
    samples: number
    episodes: number
    win20: number
    avg20: number
    win60: number
    avg60: number
  }[]
  level: number | null
  keyLabel: string
}) {
  return (
    <div>
      <HScroll>
        <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="py-2 pr-4 whitespace-nowrap font-medium text-faint">历史时期</th>
            <th className="py-2 pr-4 whitespace-nowrap font-medium text-faint">区间</th>
            <th className="py-2 pr-4 text-right whitespace-nowrap font-medium text-faint">
              独立信号
            </th>
            <th className="py-2 pr-4 text-right whitespace-nowrap font-medium text-faint">
              20 日胜率
            </th>
            <th className="py-2 text-right whitespace-nowrap font-medium text-faint">
              60 日胜率
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line/70 last:border-0">
              <td className="py-2.5 pr-4 whitespace-nowrap font-medium text-ink">
                {r.label}
              </td>
              <td className="num py-2.5 pr-4 whitespace-nowrap text-muted">{r.years}</td>
              <td className="num py-2.5 pr-4 text-right text-ink-2">
                {r.episodes === 0 ? <span className="text-faint">—</span> : r.episodes}
              </td>
              <td className="py-2.5 pr-4 text-right">
                {r.samples === 0 ? (
                  <span className="text-faint">—</span>
                ) : (
                  <ProbBar value={r.win20} tone="steel" width={48} />
                )}
              </td>
              <td className="num py-2.5 text-right text-ink">
                {r.samples === 0 ? <span className="text-faint">—</span> : fmtProb(r.win60)}
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </HScroll>
      <p className="mt-3 text-[11.5px] text-faint">
        {level === null
          ? `${keyLabel}偏离度在这个指数上没有标定出可用的行动水位 —— 各档位深跌之后的表现都不优于常态（不设条件），因此这里不给出水位，而不是硬凑一个。`
          : `${keyLabel}偏离度 ≤ ${level}% 的「行动水位」在各时期的表现。独立信号 = 把连续满足条件的区间合并成一次机会。`}
      </p>
    </div>
  )
}
