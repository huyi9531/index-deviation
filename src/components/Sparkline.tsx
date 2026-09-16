/**
 * 迷你走势线（总览页每行一条）。
 *
 * 刻意不用 ResizeObserver：viewBox 用固定比例 + preserveAspectRatio="none"
 * 拉伸填满容器，配合 vector-effect="non-scaling-stroke" 保证线宽不被拉粗。
 * 这样零测量、零客户端 JS，SSR 直出。
 */
const VB_W = 100
const VB_H = 28

export function Sparkline({
  values,
  color = '#1f5096',
  fill = 'rgba(31,80,150,0.10)',
  height = 28,
  zeroLine = true,
}: {
  values: number[]
  color?: string
  fill?: string
  height?: number
  zeroLine?: boolean
}) {
  const pts = values.filter((v) => Number.isFinite(v))
  if (pts.length < 2) {
    return <div style={{ height }} className="rounded bg-surface-2" />
  }

  let min = Math.min(...pts)
  let max = Math.max(...pts)
  if (zeroLine) {
    min = Math.min(min, 0)
    max = Math.max(max, 0)
  }
  const span = max - min || 1

  const x = (i: number) => (i / (pts.length - 1)) * VB_W
  const y = (v: number) => VB_H - ((v - min) / span) * (VB_H - 4) - 2

  const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const area = `${line} L${VB_W},${VB_H} L0,${VB_H} Z`
  const y0 = zeroLine ? y(0) : null

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      style={{ height }}
      className="block w-full overflow-visible"
      aria-hidden="true"
    >
      <path d={area} fill={fill} stroke="none" />
      {y0 !== null ? (
        <line
          x1="0"
          x2={VB_W}
          y1={y0}
          y2={y0}
          stroke="#c9ccc5"
          strokeWidth="1"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
