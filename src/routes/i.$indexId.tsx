import { createFileRoute, Link, notFound, useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'
import { z } from 'zod'
import { HistogramChart } from '~/components/HistogramChart'
import { SummaryStrip } from '~/components/Blocks'
import { DenseThresholdTable, EraSummaryTable } from '~/components/ThresholdTable'
import { TimeSeriesChart } from '~/components/TimeSeriesChart'
import { Card, ChartLink, SectionHead, Segmented } from '~/components/ui'
import { fmtDate, fmtPoint } from '~/lib/format'
import { isIndexId, indexByIdOrDefault } from '~/lib/indices/registry'
import { activeErasFor } from '~/lib/indices/queries'
import {
  DEFAULT_ERA,
  DEFAULT_MA,
  DEFAULT_RANGE,
  eraParam,
  maParam,
  rangeParam,
} from '~/lib/indices/search'
import { getDashboard } from '~/lib/indices/service'
import { RANGES, type EraId, type MaKey, type RangeId } from '~/lib/indices/types'

const COLOR = {
  ink: '#15171a',
  amber: '#a85e06',
  steel: '#1f5096',
  zero: '#c9ccc5',
}

export const Route = createFileRoute('/i/$indexId')({
  params: {
    parse: (raw) => {
      if (!isIndexId(raw.indexId)) throw notFound()
      return { indexId: raw.indexId }
    },
    stringify: (params) => ({ indexId: params.indexId }),
  },
  validateSearch: z.object({ range: rangeParam, era: eraParam, ma: maParam }),
  loaderDeps: ({ search }) => ({
    range: search.range ?? DEFAULT_RANGE,
    era: search.era ?? DEFAULT_ERA,
  }),
  loader: ({ params, deps }) => getDashboard({ data: { indexId: params.indexId, ...deps } }),
  component: DetailPage,
})

function DetailPage() {
  const d = Route.useLoaderData()
  const search = Route.useSearch()
  const { indexId } = Route.useParams()
  const navigate = useNavigate()

  const def = indexByIdOrDefault(indexId)
  const era = search.era ?? DEFAULT_ERA
  const range = search.range ?? DEFAULT_RANGE
  const ma = search.ma ?? DEFAULT_MA

  const eras = activeErasFor(d.meta.market, d.meta.firstDate)

  const dateIndex = useMemo(() => {
    const m = new Map<number, number>()
    d.chart.dates.forEach((v, i) => {
      m.set(v, i)
    })
    return m
  }, [d.chart.dates])
  const at = (date: number) => dateIndex.get(date) ?? -1

  const is200 = ma === 'dev200'
  const dipRows = is200 ? d.dip200 : d.dip60
  const topRows = is200 ? d.top200 : d.top60

  return (
    <div className="space-y-8">
      {/* ───────────────── 标题 + 全局开关 ───────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted transition-colors hover:text-ink"
          >
            <span aria-hidden="true" className="text-[13px] leading-none">
              ←
            </span>
            返回总览
          </Link>
          <p className="label-xs mt-3">指数详情</p>
          <h1 className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[32px] font-semibold leading-tight tracking-tight text-ink">
              {d.meta.name}
            </span>
            <span className="num text-[12px] font-medium text-faint">
              {def.ticker} · {def.enName}
            </span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
          <Segmented<EraId>
            compact
            options={eras.map((e) => ({
              id: e.id,
              label: e.label,
              hint: e.note,
            }))}
            value={era}
            onChange={(era) =>
              navigate({
                to: '/i/$indexId',
                params: { indexId },
                search: (p) => ({ ...p, era }),
              })
            }
          />
          <Link
            to="/stats/$indexId"
            params={{ indexId }}
            search={{ era, ma, horizon: 20 }}
            className="text-[12.5px] font-medium text-steel hover:underline"
          >
            历史证据 →
          </Link>
          {/* 外部实时走势（新标签）。本站只画偏离度，K 线/分时看外部 */}
          <ChartLink indexId={def.id} />
        </div>
      </div>

      {/* ───────────────── ① 当前状态（全部数字只在此出现一次） ───────────────── */}
      <SummaryStrip
        meta={d.meta}
        status={d.status}
        actionLevel={d.actionLevel}
        analog={d.analogs.dev200}
        baseline={d.baseline}
      />

      {/* ───────────────── ② 偏离度主图 ───────────────── */}
      <Card className="p-6 sm:p-7">
        <SectionHead
          label="核心指标"
          title="对数偏离度"
          hint="底纹为历史级抄底 / 过热区间。"
          right={
            <Segmented<RangeId>
              compact
              options={RANGES.map((r) => ({ id: r.id, label: r.label }))}
              value={range}
              onChange={(range) =>
                navigate({
                  to: '/i/$indexId',
                  params: { indexId },
                  search: (p) => ({ ...p, range }),
                })
              }
            />
          }
        />
        <div className="mt-5">
          <TimeSeriesChart
            dates={d.chart.dates}
            height={320}
            yFormat={(v) => `${v.toFixed(0)}%`}
            series={[
              {
                key: 'dev200',
                label: '200 日偏离度',
                color: COLOR.steel,
                values: d.chart.dev200,
                width: 2.0,
                area: true,
                areaOpacity: 0.1,
              },
              {
                key: 'dev60',
                label: '60 日偏离度',
                color: COLOR.amber,
                values: d.chart.dev60,
                width: 1.3,
              },
            ]}
            bands={[
              { from: -60, to: d.actionLevel.dev200 ?? -12, fill: '#e9f0f9' },
              { from: 8, to: 60, fill: '#fbeae4' },
            ]}
            refLines={[
              { value: 0, color: COLOR.zero },
              ...(d.actionLevel.dev60 === null
                ? []
                : [
                    {
                      value: d.actionLevel.dev60,
                      color: '#d3b47e',
                      label: '60 日水位',
                      dash: '6 5',
                    },
                  ]),
              ...(d.actionLevel.dev200 === null
                ? []
                : [
                    {
                      value: d.actionLevel.dev200,
                      color: '#a9c0de',
                      label: '200 日水位',
                      dash: '6 5',
                    },
                  ]),
            ]}
            markers={[
              {
                index: at(d.chartMarks.minDev200.date),
                label: `${fmtDate(d.chartMarks.minDev200.date).slice(0, 7)} · ${d.chartMarks.minDev200.value.toFixed(1)}%`,
                color: COLOR.steel,
                above: false,
              },
              {
                index: at(d.chartMarks.maxDev200.date),
                label: `${fmtDate(d.chartMarks.maxDev200.date).slice(0, 7)} · +${d.chartMarks.maxDev200.value.toFixed(1)}%`,
                color: '#c0392b',
                above: true,
              },
            ].filter((m) => m.index >= 0)}
          />
        </div>

        <div className="mt-5 space-y-2 border-t border-line pt-4">
          <Fold title="价格结构（对数轴 · 含 60 / 200 日均线）">
            <TimeSeriesChart
              dates={d.chart.dates}
              logScale
              height={300}
              yFormat={(v) => fmtPoint(v, 0)}
              series={[
                {
                  key: 'close',
                  label: d.meta.name,
                  color: COLOR.ink,
                  values: d.chart.close,
                  width: 1.7,
                },
                {
                  key: 'ma200',
                  label: '200 日均线',
                  color: COLOR.steel,
                  values: d.chart.ma200,
                  width: 1.6,
                  dash: '6 3',
                },
                {
                  key: 'ma60',
                  label: '60 日均线',
                  color: COLOR.amber,
                  values: d.chart.ma60,
                  width: 1.3,
                  dash: '2 3',
                },
              ]}
            />
          </Fold>
          <Fold title="偏离度分布（当前值落在哪一端）">
            <HistogramChart
              hist={d.hist}
              current60={d.status.dev60}
              current200={d.status.dev200}
              color60={COLOR.amber}
              color200={COLOR.steel}
            />
          </Fold>
        </div>
      </Card>

      {/* ───────────────── ③ 概率速查 ───────────────── */}
      <Card className="p-6 sm:p-7">
        <SectionHead
          label="概率速查"
          title={`${is200 ? '200' : '60'} 日偏离度 · 各阈值下持有 N 个交易日的胜率`}
          hint="底色越深，相对「常态」（不设条件）的超额越大；灰色表示低于常态。"
          right={
            <Segmented<MaKey>
              compact
              options={[
                { id: 'dev200', label: '200 日线' },
                { id: 'dev60', label: '60 日线' },
              ]}
              value={ma}
              onChange={(ma) =>
                navigate({
                  to: '/i/$indexId',
                  params: { indexId },
                  search: (p) => ({ ...p, ma }),
                })
              }
            />
          }
        />
        <div className="mt-5 grid gap-8 lg:grid-cols-2">
          {/* min-w-0 必须加：网格子项默认 min-width:auto，
              里面放定宽表格时会被撑破容器，导致整页横向滚动 */}
          <div className="min-w-0">
            <p className="mb-3 flex items-center gap-2 text-[13px] font-medium text-ink-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-steel" />
              抄底口径 · ≤ 阈值买入，上涨算赢
            </p>
            <DenseThresholdTable
              rows={dipRows}
              horizons={[5, 10, 20, 60]}
              mode="dip"
              baseline={d.baseline}
            />
          </div>
          <div className="min-w-0">
            <p className="mb-3 flex items-center gap-2 text-[13px] font-medium text-ink-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-up" />
              逃顶口径 · ≥ 阈值离场，下跌算赢
            </p>
            <DenseThresholdTable
              rows={topRows}
              horizons={[5, 10, 20, 60]}
              mode="top"
              baseline={d.baseline}
            />
          </div>
        </div>
      </Card>

      {/* ───────────────── ④ 时代差异 ───────────────── */}
      <Card className="p-6 sm:p-7">
        <SectionHead
          label="时代差异"
          title={
            d.actionLevel.dev200 === null
              ? '200 日偏离度 · 各历史时期的表现'
              : `200 日偏离度 ≤ ${d.actionLevel.dev200}% 在各历史时期的表现`
          }
        />
        <div className="mt-5">
          <EraSummaryTable rows={d.eraSummary} level={d.actionLevel.dev200} keyLabel="200 日" />
        </div>
      </Card>
    </div>
  )
}

/** 默认折叠的附表：不占首屏，需要时才展开 */
function Fold({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1.5 text-[12.5px] text-muted hover:text-ink">
        <span className="inline-block transition-transform group-open:rotate-90">▸</span>
        {title}
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  )
}
