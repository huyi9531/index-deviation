import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { ExtremesTable } from '~/components/Blocks'
import { EraMatrix } from '~/components/ThresholdTable'
import { Card, Metric, SectionHead, Segmented } from '~/components/ui'
import { fmtInt, fmtProb } from '~/lib/format'
import { activeErasFor } from '~/lib/indices/queries'
import { isIndexId, indexByIdOrDefault } from '~/lib/indices/registry'
import {
  DEFAULT_ERA,
  DEFAULT_HORIZON,
  DEFAULT_MA,
  eraParam,
  horizonParam,
  maParam,
} from '~/lib/indices/search'
import { getExtremes, getStats } from '~/lib/indices/service'
import type { EraId, MaKey } from '~/lib/indices/types'

const MA_LABEL: Record<MaKey, string> = {
  dev60: '60 日偏离度',
  dev200: '200 日偏离度',
}

export const Route = createFileRoute('/stats/$indexId')({
  params: {
    parse: (raw) => {
      if (!isIndexId(raw.indexId)) throw notFound()
      return { indexId: raw.indexId }
    },
    stringify: (params) => ({ indexId: params.indexId }),
  },
  validateSearch: z.object({ era: eraParam, ma: maParam, horizon: horizonParam }),
  loaderDeps: ({ search }) => ({
    era: search.era ?? DEFAULT_ERA,
    ma: search.ma ?? DEFAULT_MA,
    horizon: search.horizon ?? DEFAULT_HORIZON,
  }),
  loader: async ({ params, deps }) => {
    const [stats, extremes] = await Promise.all([
      getStats({ data: { indexId: params.indexId, ...deps } }),
      getExtremes({ data: { indexId: params.indexId, era: deps.era } }),
    ])
    return { stats, extremes }
  },
  component: StatsPage,
})

function StatsPage() {
  const { stats, extremes } = Route.useLoaderData()
  const search = Route.useSearch()
  const { indexId } = Route.useParams()
  const navigate = useNavigate()

  const def = indexByIdOrDefault(indexId)
  const era = search.era ?? DEFAULT_ERA
  const ma = search.ma ?? DEFAULT_MA
  const horizon = search.horizon ?? DEFAULT_HORIZON
  const eras = activeErasFor(stats.meta.market, stats.meta.firstDate)

  const setSearch = (patch: Record<string, unknown>) =>
    navigate({
      to: '/stats/$indexId',
      params: { indexId },
      search: (prev) => ({ ...prev, ...patch }),
    })

  const best = stats.dip
    .filter((r) => r.episodes >= 3)
    .reduce<(typeof stats.dip)[number] | null>((acc, r) => {
      const w = r.horizons.find((h) => h.days === horizon)?.winRate ?? 0
      const bw = acc?.horizons.find((h) => h.days === horizon)?.winRate ?? -1
      return w > bw ? r : acc
    }, null)

  return (
    <div className="space-y-8">
      {/* 标题 + 开关 */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <Link
            to="/i/$indexId"
            params={{ indexId }}
            search={{ era, ma }}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted transition-colors hover:text-ink"
          >
            <span aria-hidden="true" className="text-[13px] leading-none">←</span>
            回到 {def.name} 详情
          </Link>
          <p className="label-xs mt-3">历史证据</p>
          <h1 className="mt-2 flex flex-wrap items-baseline gap-x-3">
            <span className="text-[32px] font-semibold leading-tight tracking-tight text-ink">
              {stats.meta.name}
            </span>
            <span className="num text-[12px] font-medium text-faint">{MA_LABEL[stats.ma]}</span>
          </h1>
          <p className="mt-2 text-[13px] text-muted">
            检验这个指标的三份证据：偏离之后多快被拉回均线、同一阈值在不同时期是否依然成立、历史极端位置之后发生了什么。各阈值完整胜率见详情页「概率速查」。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
          <Segmented<MaKey>
            compact
            options={[
              { id: 'dev200', label: '200 日线' },
              { id: 'dev60', label: '60 日线' },
            ]}
            value={ma}
            onChange={(ma) => setSearch({ ma })}
          />
          <Segmented<EraId>
            compact
            options={eras.map((e) => ({ id: e.id, label: e.label, hint: e.note }))}
            value={era}
            onChange={(era) => setSearch({ era })}
          />
        </div>
      </div>

      {/* 概览：四个数字，一格一值 */}
      <Card className="grid grid-cols-2 gap-x-8 gap-y-7 p-6 sm:grid-cols-4 sm:p-7">
        <Metric
          label="样本池"
          value={`${fmtInt(stats.meta.tradingDays)} 天`}
          size="sm"
          sub={`${eras.find((e) => e.id === stats.era)?.label ?? ''} · ${stats.meta.rawFirstDate ? String(stats.meta.rawFirstDate).slice(0, 4) : ''} 年起`}
        />
        <Metric
          label={`胜率最高的抄底阈值（${horizon} 日）`}
          value={best ? `≤ ${best.threshold}%` : '—'}
          tone="steel"
          hint="「常态」是不设任何条件时的胜率。只有明显高于常态的阈值才算真有超额。"
          sub={
            best
              ? `${fmtProb(best.horizons.find((h) => h.days === horizon)?.winRate ?? Number.NaN)} · 常态 ${fmtProb(
                  stats.baseline.find((b) => b.days === horizon)?.winRate ?? Number.NaN,
                )} · ${best.episodes} 次独立信号`
              : '样本不足'
          }
        />
        <Metric
          label="深跌后 20 日内复归"
          value={fmtProb(stats.revert.dip.within20)}
          tone="steel"
          sub={`偏离度 ≤ −${stats.revert.dip.level}% 之后回到 ±1% 以内的比例`}
        />
        <Metric
          label="超涨后 20 日内复归"
          value={fmtProb(stats.revert.top.within20)}
          tone="amber"
          sub={`偏离度 ≥ +${stats.revert.top.level}% 之后回到 ±1% 以内的比例`}
        />
      </Card>

      {/* 观察窗口 */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="label-xs">时代矩阵的列</span>
        <Segmented<string>
          compact
          options={[
            { id: '5', label: '5 日' },
            { id: '10', label: '10 日' },
            { id: '20', label: '20 日' },
            { id: '60', label: '60 日' },
          ]}
          value={String(horizon)}
          onChange={(v) => setSearch({ horizon: Number(v) })}
        />
      </div>

      {/* 复归速度 */}
      <Card className="p-6 sm:p-7">
        <SectionHead
          label="复归特性"
          title="偏离度到底多快会被拉回均线"
          hint="这是「偏离度」这个指标能成立的根本原因。判定标准：偏离度回到 ±1% 以内。"
        />
        <div className="mt-5 grid gap-8 sm:grid-cols-2">
          <RevertBlock
            title={`深跌之后（偏离度 ≤ −${stats.revert.dip.level}%）`}
            tone="steel"
            summary={stats.revert.dip}
          />
          <RevertBlock
            title={`超涨之后（偏离度 ≥ +${stats.revert.top.level}%）`}
            tone="amber"
            summary={stats.revert.top}
          />
        </div>
      </Card>

      {/* 分时期矩阵 */}
      <Card className="p-6 sm:p-7">
        <SectionHead
          label="时代差异"
          title={`各阈值胜率 × 历史时期（${horizon} 日）`}
          hint="横着念一行：同一个阈值，越靠右的时期胜率越高。"
        />
        <div className="mt-5">
          <EraMatrix rows={stats.eraByThreshold} horizon={horizon} />
        </div>
      </Card>

      {/* 历史极值 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ExtremesTable
          title="历史极端低点（200 日偏离度最深的 10 次）"
          hint="这些日子之后的走势，是「深跌后反弹」最直接的证据。"
          points={extremes.lows}
          mode="low"
        />
        <ExtremesTable
          title="历史极端高点（200 日偏离度最高的 10 次）"
          hint="注意「回到均线」这一列：很多次并不是跌回去的，而是横盘等均线追上来。"
          points={extremes.highs}
          mode="high"
        />
      </div>
    </div>
  )
}

function RevertBlock({
  title,
  summary,
  tone,
}: {
  title: string
  tone: 'steel' | 'amber'
  summary: {
    samples: number
    within20: number
    within60: number
    within250: number
    never: number
    medianDays: number
  }
}) {
  const dot = tone === 'steel' ? 'bg-steel' : 'bg-amber'
  const rows: { k: string; v: string }[] = [
    { k: '样本天数', v: `${fmtInt(summary.samples)} 天` },
    { k: '20 日内回到均线', v: fmtProb(summary.within20) },
    { k: '60 日内回到均线', v: fmtProb(summary.within60) },
    { k: '250 日内回到均线', v: fmtProb(summary.within250) },
    { k: '250 日内始终未复归', v: fmtProb(summary.never) },
    {
      k: '复归耗时中位数',
      v: summary.medianDays < 0 ? '—' : `${Math.round(summary.medianDays)} 个交易日`,
    },
  ]
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
      </div>
      <dl className="mt-4 divide-y divide-line/70 border-t border-line">
        {rows.map((r) => (
          <div key={r.k} className="flex items-center justify-between py-2.5">
            <dt className="text-[12.5px] text-muted">{r.k}</dt>
            <dd className="num text-[13px] font-medium text-ink">{r.v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
