import { useEffect, useRef, useState } from 'react'
import type { Histogram } from '~/lib/indices/types'

/**
 * 偏离度分布直方图。
 * 60 日与 200 日两条分布叠在一起，用竖线标出「今天」的位置 ——
 * 一眼看出当前处于分布的哪一端。
 *
 * 与折线图一样，viewBox 宽度取容器实测宽度，保证字号是真实像素。
 */
export function HistogramChart({
  hist,
  current60,
  current200,
  color60,
  color200,
}: {
  hist: Histogram
  current60: number
  current200: number
  color60: string
  color200: string
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(900)
  const H = 250

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => {
      const next = Math.max(300, Math.round(el.clientWidth))
      setWidth((prev) => (Math.abs(prev - next) > 1 ? next : prev))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const bins = hist.counts60.length
  if (bins === 0) return null

  const narrow = width < 580
  const pad = { l: 10, r: 12, t: 20, b: 30 }
  const innerW = width - pad.l - pad.r
  const innerH = H - pad.t - pad.b
  const min = hist.min
  const max = hist.max
  const span = max - min || 1

  const peak = Math.max(...hist.counts60, ...hist.counts200, 1)
  const barW = innerW / bins
  const x = (v: number) => pad.l + ((v - min) / span) * innerW
  const h = (c: number) => (c / peak) * innerH

  const step = narrow ? 10 : 5
  const ticks: number[] = []
  for (let t = Math.ceil(min / step) * step; t <= max; t += step) ticks.push(t)

  const clamp = (v: number) => Math.max(min, Math.min(max, v))

  return (
    <div className="w-full overflow-hidden" ref={wrapRef}>
      <svg
        viewBox={`0 0 ${width} ${H}`}
        width={width}
        height={H}
        className="block max-w-full select-none"
        role="img"
        aria-label="偏离度分布直方图"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={x(t)}
              x2={x(t)}
              y1={pad.t}
              y2={pad.t + innerH}
              stroke="#e8eae5"
              strokeWidth={1}
            />
            <text
              x={x(t)}
              y={H - 10}
              textAnchor="middle"
              fontSize={narrow ? 10 : 11}
              fill="#9ba0a6"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {t > 0 ? `+${t}%` : `${t}%`}
            </text>
          </g>
        ))}

        {hist.counts60.map((c, i) => {
          const x0 = pad.l + i * barW
          const h60 = h(c)
          const h200 = h(hist.counts200[i])
          return (
            <g key={i}>
              <rect
                x={x0 + 0.5}
                y={pad.t + innerH - h60}
                width={Math.max(1, barW - 1)}
                height={h60}
                fill={color60}
                opacity={0.5}
              />
              <rect
                x={x0 + 0.5}
                y={pad.t + innerH - h200}
                width={Math.max(1, barW - 1)}
                height={h200}
                fill={color200}
                opacity={0.5}
              />
            </g>
          )
        })}

        {/* 零轴 */}
        <line
          x1={x(0)}
          x2={x(0)}
          y1={pad.t}
          y2={pad.t + innerH}
          stroke="#15171a"
          strokeWidth={1}
          opacity={0.22}
        />

        {/* 今天的位置 */}
        {[
          { v: current200, color: color200, label: '200日', ty: pad.t + 12 },
          { v: current60, color: color60, label: '60日', ty: pad.t + 26 },
        ].map((m) => {
          const px = x(clamp(m.v))
          const anchor = px > width - 90 ? 'end' : px < 90 ? 'start' : 'middle'
          return (
            <g key={m.label}>
              <line
                x1={px}
                x2={px}
                y1={pad.t}
                y2={pad.t + innerH}
                stroke={m.color}
                strokeWidth={1.6}
              />
              <circle cx={px} cy={pad.t} r={2.6} fill={m.color} />
              <text
                x={px + (anchor === 'end' ? -5 : anchor === 'start' ? 5 : 0)}
                y={m.ty}
                textAnchor={anchor}
                fontSize={narrow ? 10 : 11}
                fill={m.color}
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {m.label} {m.v > 0 ? '+' : ''}
                {m.v.toFixed(1)}%
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
