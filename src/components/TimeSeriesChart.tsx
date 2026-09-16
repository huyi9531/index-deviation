import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtMonth } from '~/lib/format'

export interface ChartSeries {
  key: string
  label: string
  color: string
  values: number[]
  width?: number
  dash?: string
  /** 填充到基线（零线或 y 轴下沿） */
  area?: boolean
  areaOpacity?: number
}

export interface ChartBand {
  from: number
  to: number
  fill: string
}

export interface ChartRefLine {
  value: number
  color: string
  label?: string
  dash?: string
}

export interface ChartMarker {
  index: number
  label: string
  color: string
  above?: boolean
}

interface Props {
  dates: number[]
  series: ChartSeries[]
  bands?: ChartBand[]
  refLines?: ChartRefLine[]
  markers?: ChartMarker[]
  height?: number
  logScale?: boolean
  yFormat: (v: number) => string
  valueFormat?: (v: number) => string
  yDomain?: [number, number]
  legendExtra?: React.ReactNode
  footnote?: React.ReactNode
}

/** 容器太窄时给一个下限，避免图表被压成一团 */
const MIN_W = 300
const FALLBACK_W = 900

function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min
  if (!(span > 0) || !Number.isFinite(span)) return [min]
  const mag = 10 ** Math.floor(Math.log10(span / count))
  const norm = span / count / mag
  let step =
    (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag

  // 按初始步长只能拿到 2 条刻度时把步长减半，避免整张图只剩上下两条线
  for (let attempt = 0; attempt < 4; attempt++) {
    const start = Math.ceil(min / step) * step
    if (Math.floor((max - start) / step) + 1 >= 3) break
    step /= 2
  }

  const start = Math.ceil(min / step) * step
  const out: number[] = []
  for (let v = start; v <= max + step * 1e-6; v += step) {
    out.push(Number((Math.round(v / step) * step).toPrecision(12)))
  }
  return out
}

/**
 * 自定义 SVG 时间序列图。
 *
 * 关键点：viewBox 的宽度 = 容器实测宽度（1 个 SVG 单位 = 1 个 CSS 像素）。
 * 如果用固定宽度 + viewBox 缩放，容器变窄时所有文字会跟着等比缩小，
 * 在页面上就是「刻度看不见」。实测宽度后，字号永远是真实像素。
 */
export function TimeSeriesChart({
  dates,
  series,
  bands = [],
  refLines = [],
  markers = [],
  height = 300,
  logScale = false,
  yFormat,
  valueFormat,
  yDomain,
  legendExtra,
  footnote,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [width, setWidth] = useState(FALLBACK_W)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => {
      const next = Math.max(MIN_W, Math.round(el.clientWidth))
      setWidth((prev) => (Math.abs(prev - next) > 1 ? next : prev))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const n = dates.length
  const H = height
  const narrow = width < 580
  const pad = { l: narrow ? 40 : 56, r: 12, t: 18, b: 26 }
  const innerW = width - pad.l - pad.r
  const innerH = H - pad.t - pad.b
  const fontSize = narrow ? 10.5 : 11.5

  const { yMin, yMax, transform } = useMemo(() => {
    const all: number[] = []
    for (const s of series) for (const v of s.values) if (Number.isFinite(v)) all.push(v)
    for (const r of refLines) all.push(r.value)
    if (all.length === 0) return { yMin: 0, yMax: 1, transform: (v: number) => v }

    const t = logScale ? (v: number) => Math.log10(Math.max(v, 1e-9)) : (v: number) => v
    let lo = Infinity
    let hi = -Infinity
    for (const v of all) {
      const tv = t(v)
      if (tv < lo) lo = tv
      if (tv > hi) hi = tv
    }
    if (yDomain) {
      lo = t(yDomain[0])
      hi = t(yDomain[1])
    }
    if (hi - lo < 1e-9) {
      hi = lo + 1
    } else {
      const padY = (hi - lo) * 0.06
      lo -= padY
      hi += padY
    }
    return { yMin: lo, yMax: hi, transform: t }
  }, [series, refLines, logScale, yDomain])

  const x = (i: number) =>
    pad.l + (n <= 1 ? 0 : (i / (n - 1)) * innerW)
  /**
   * 注意：ticks 是在「变换后」的空间里算出来的（对数刻度时就是 log10 值）。
   * 所以刻度定位必须用 yOfTransformed，不能再走一次 transform，
   * 否则对数轴上会把刻度推到画布外（被 SVG 裁掉，看起来「刻度消失了」）。
   */
  const yOfTransformed = (tv: number) =>
    pad.t + (1 - (tv - yMin) / (yMax - yMin)) * innerH
  const y = (v: number) => yOfTransformed(transform(v))

  const paths = useMemo(
    () =>
      series.map((s) => {
        let d = ''
        let started = false
        for (let i = 0; i < n; i++) {
          const v = s.values[i]
          if (!Number.isFinite(v)) {
            started = false
            continue
          }
          d += `${started ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`
          started = true
        }
        return d
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, n, yMin, yMax, innerW, innerH, width],
  )

  const areas = useMemo(
    () =>
      series.map((s) => {
        if (!s.area) return ''
        const base = refLines.length === 0 && !logScale ? pad.t + innerH : y(0)
        let d = ''
        let started = false
        let firstX = 0
        let lastX = 0
        for (let i = 0; i < n; i++) {
          const v = s.values[i]
          if (!Number.isFinite(v)) continue
          if (!started) {
            firstX = x(i)
            d += `M${firstX.toFixed(2)},${base.toFixed(2)}`
            started = true
          }
          d += `L${x(i).toFixed(2)},${y(v).toFixed(2)}`
          lastX = x(i)
        }
        if (!started) return ''
        d += `L${lastX.toFixed(2)},${base.toFixed(2)}Z`
        return d
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, n, yMin, yMax, innerH, refLines.length, logScale, width],
  )

  const ticks = useMemo(() => niceTicks(yMin, yMax, narrow ? 4 : 5), [yMin, yMax, narrow])

  const xTicks = useMemo(() => {
    const count = narrow ? 4 : 6
    const out: number[] = []
    for (let k = 0; k < count; k++) {
      const i = Math.round((k / (count - 1)) * (n - 1))
      if (out[out.length - 1] !== i) out.push(i)
    }
    return out
  }, [n, narrow])

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const el = svgRef.current
    if (!el || n === 0) return
    const rect = el.getBoundingClientRect()
    const px = e.clientX - rect.left
    const i = Math.round(((px - pad.l) / innerW) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }

  const active = hover
  const tooltipLeftPct = active !== null ? (x(active) / width) * 100 : 0
  const clampLeft = Math.max(6, Math.min(94, tooltipLeftPct))

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-muted">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-[2px] w-4 rounded-full"
              style={{ background: s.color }}
            />
            {s.label}
          </span>
        ))}
        {refLines
          .filter((r) => r.label)
          .map((r) => (
            <span key={r.label} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-[2px] w-4 rounded-full"
                style={{
                  backgroundImage: `repeating-linear-gradient(90deg,${r.color} 0 3px,transparent 3px 6px)`,
                }}
              />
              {r.label}
            </span>
          ))}
        {legendExtra}
      </div>

      <div ref={wrapRef} className="relative w-full overflow-hidden">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${H}`}
          width={width}
          height={H}
          className="block max-w-full touch-none select-none"
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
        >
          {bands.map((b, i) => {
            const yTop = y(Math.max(b.from, b.to))
            const yBottom = y(Math.min(b.from, b.to))
            return (
              <rect
                key={i}
                x={pad.l}
                y={yTop}
                width={innerW}
                height={Math.max(1, yBottom - yTop)}
                fill={b.fill}
              />
            )
          })}

          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={pad.l}
                x2={width - pad.r}
                y1={yOfTransformed(t)}
                y2={yOfTransformed(t)}
                stroke="#e8eae5"
                strokeWidth={1}
              />
              <text
                x={pad.l - 7}
                y={yOfTransformed(t)}
                dy="0.33em"
                textAnchor="end"
                fontSize={fontSize}
                fill="#9ba0a6"
                fontWeight={500}
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {yFormat(logScale ? 10 ** t : t)}
              </text>
            </g>
          ))}

          {refLines.map((r) => (
            <line
              key={r.value + r.color}
              x1={pad.l}
              x2={width - pad.r}
              y1={y(r.value)}
              y2={y(r.value)}
              stroke={r.color}
              strokeWidth={1.5}
              strokeDasharray={r.dash ?? '6 5'}
            />
          ))}

          {areas.map((d, i) =>
            d ? (
              <path
                key={series[i].key}
                d={d}
                fill={series[i].color}
                opacity={series[i].areaOpacity ?? 0.1}
              />
            ) : null,
          )}

          {paths.map((d, i) => (
            <path
              key={series[i].key}
              d={d}
              fill="none"
              stroke={series[i].color}
              strokeWidth={series[i].width ?? 1.6}
              strokeDasharray={series[i].dash}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {/* 末端读数点：像仪表的实时指针，标记序列最新值 */}
          {series.map((s, i) => {
            for (let k = n - 1; k >= 0; k--) {
              const v = s.values[k]
              if (Number.isFinite(v)) {
                return (
                  <circle
                    key={`end-${s.key}`}
                    cx={x(k)}
                    cy={y(v)}
                    r={i === 0 ? 3.2 : 2.6}
                    fill="#fff"
                    stroke={s.color}
                    strokeWidth={2}
                  />
                )
              }
            }
            return null
          })}

          {markers.map((m, i) => {
            const v = series[0]?.values[m.index]
            if (!Number.isFinite(v)) return null
            const px = x(m.index)
            const py = y(v)
            const anchor = px > width - 110 ? 'end' : px < 110 ? 'start' : 'middle'
            return (
              <g key={i}>
                <circle
                  cx={px}
                  cy={py}
                  r={3.5}
                  fill="#fff"
                  stroke={m.color}
                  strokeWidth={2}
                />
                <text
                  x={px + (anchor === 'end' ? -5 : anchor === 'start' ? 5 : 0)}
                  y={m.above ? py - 9 : py + 16}
                  textAnchor={anchor}
                  fontSize={fontSize}
                  fill={m.color}
                  fontWeight={500}
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {m.label}
                </text>
              </g>
            )
          })}

          {xTicks.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={H - 8}
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
              fontSize={fontSize}
              fill="#9ba0a6"
              fontWeight={500}
            >
              {fmtMonth(dates[i])}
            </text>
          ))}

          {active !== null ? (
            <>
              <line
                x1={x(active)}
                x2={x(active)}
                y1={pad.t}
                y2={pad.t + innerH}
                stroke="#15171a"
                strokeWidth={1}
                opacity={0.18}
              />
              {series.map((s) => {
                const v = s.values[active]
                if (!Number.isFinite(v)) return null
                return (
                  <circle
                    key={s.key}
                    cx={x(active)}
                    cy={y(v)}
                    r={3.2}
                    fill="#fff"
                    stroke={s.color}
                    strokeWidth={2}
                  />
                )
              })}
            </>
          ) : null}
        </svg>

        {active !== null ? (
          <div
            className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-lg border border-line bg-surface/97 px-3.5 py-2.5 shadow-[0_6px_20px_rgba(21,23,26,0.10)]"
            style={{ left: `${clampLeft}%` }}
          >
            <p className="num text-[11.5px] font-medium text-faint">{fmtDateFull(dates[active])}</p>
            <div className="mt-1.5 space-y-1">
              {series.map((s) => {
                const v = s.values[active]
                if (!Number.isFinite(v)) return null
                return (
                  <p
                    key={s.key}
                    className="flex items-center gap-2 whitespace-nowrap text-[12px]"
                  >
                    <span
                      className="inline-block h-[2px] w-3 rounded-full"
                      style={{ background: s.color }}
                    />
                    <span className="text-muted">{s.label}</span>
                    <span className="num ml-auto pl-3 font-semibold text-ink">
                      {valueFormat
                        ? valueFormat(v)
                        : s.key.includes('dev')
                          ? `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
                          : v.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </span>
                  </p>
                )
              })}
            </div>
          </div>
        ) : null}
      </div>

      {footnote ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-faint">{footnote}</p>
      ) : null}
    </div>
  )
}

function fmtDateFull(ymd: number): string {
  const s = String(ymd)
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}
