import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CHART_SITE, indexByIdOrDefault, type IndexId } from '~/lib/indices/registry'
import type { SignalTone } from '~/lib/indices/types'

export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <section
      // min-w-0：网格/弹性子项的默认 min-width 是 auto，
      // 里面放固定宽度的 SVG 时会被撑破容器，导致整页横向滚动。
      className={`min-w-0 rounded-xl border border-line bg-surface shadow-card ${className}`}
    >
      {children}
    </section>
  )
}

export function SectionHead({
  label,
  title,
  hint,
  right,
  className = '',
}: {
  label?: string
  title: ReactNode
  hint?: ReactNode
  right?: ReactNode
  className?: string
}) {
  return (
    <div
      className={`flex flex-wrap items-end justify-between gap-x-6 gap-y-2 ${className}`}
    >
      <div className="min-w-0">
        {label ? <p className="label-xs">{label}</p> : null}
        <h2 className="mt-1.5 text-[16.5px] font-semibold tracking-[-0.01em] text-ink">
          {title}
        </h2>
        {hint ? (
          <p className="mt-1.5 max-w-[62ch] text-[13px] leading-relaxed text-muted">
            {hint}
          </p>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  )
}

/**
 * 分位刻度尺：把 0~1 的历史分位画成一条仪表轨道。
 * 冷端（便宜）偏钢蓝，热端（贵）偏红，中间是无色纸面；
 * 游标颜色跟随所属区间。SSR 直出、零 JS。
 */
export function Gauge({
  pct,
  tone = 'neutral',
  className = '',
}: {
  pct: number
  tone?: SignalTone
  className?: string
}) {
  const clamped = Number.isFinite(pct) ? Math.max(0, Math.min(1, pct)) : 0.5
  const dotColor =
    tone === 'cold' || tone === 'cool'
      ? '#1f5096'
      : tone === 'warm' || tone === 'hot'
        ? '#c0392b'
        : '#999da3'
  return (
    <span
      className={`relative block h-[5px] w-full max-w-[150px] rounded-full ${className}`}
      style={{
        background:
          'linear-gradient(90deg, #d3e1f3 0%, #ebecea 30%, #ebecea 70%, #f4dfD7 100%)',
      }}
      aria-hidden="true"
    >
      <span
        className="absolute top-1/2 h-[11px] w-[11px] -translate-y-1/2 rounded-full border-2 bg-surface"
        style={{
          left: `calc(${(clamped * 100).toFixed(1)}% - 5.5px)`,
          borderColor: dotColor,
          boxShadow: '0 1px 2px rgba(21,23,26,0.12)',
        }}
      />
    </span>
  )
}

/** 一格一值：一个标签 + 一个数字，不堆叠第二指标 */
export function Metric({
  label,
  value,
  unit,
  sub,
  tone = 'neutral',
  size = 'md',
  hint,
  gauge,
}: {
  label: ReactNode
  value: ReactNode
  unit?: string
  sub?: ReactNode
  tone?: 'neutral' | 'up' | 'down' | 'amber' | 'steel'
  size?: 'sm' | 'md' | 'lg' | 'xl'
  hint?: string
  /** 可选的历史分位刻度尺（0~1），仅在明确有分位含义时使用 */
  gauge?: { pct: number; tone?: SignalTone }
}) {
  const toneClass =
    tone === 'up'
      ? 'text-up'
      : tone === 'down'
        ? 'text-down'
        : tone === 'amber'
          ? 'text-amber'
          : tone === 'steel'
            ? 'text-steel'
            : 'text-ink'
  const sizeClass =
    size === 'xl'
      ? 'text-[44px] leading-none'
      : size === 'lg'
        ? 'text-[32px] leading-none'
        : size === 'sm'
          ? 'text-[18px] leading-none'
          : 'text-[24px] leading-none'

  return (
    <div className="min-w-0" title={hint}>
      <p className="label-xs truncate">{label}</p>
      <p className={`num mt-2.5 font-semibold tracking-[-0.015em] ${sizeClass} ${toneClass}`}>
        {value}
        {unit ? (
          <span className="ml-0.5 text-[0.5em] font-medium text-faint">
            {unit}
          </span>
        ) : null}
      </p>
      {gauge ? <Gauge pct={gauge.pct} tone={gauge.tone} className="mt-3" /> : null}
      {sub ? (
        <p className="mt-2 text-[12px] leading-snug text-muted">{sub}</p>
      ) : null}
    </div>
  )
}

export interface SegmentedOption<T extends string> {
  id: T
  label: string
  hint?: string
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  compact = false,
}: {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (id: T) => void
  compact?: boolean
}) {
  return (
    <div
      role="tablist"
      className="inline-flex flex-wrap gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5"
    >
      {options.map((o) => {
        const active = o.id === value
        return (
          <button
            key={o.id}
            role="tab"
            type="button"
            aria-selected={active}
            title={o.hint}
            onClick={() => onChange(o.id)}
            className={`rounded-md transition-colors ${
              compact ? 'px-2.5 py-1.5 text-[12px]' : 'px-3 py-2 text-[13px]'
            } ${
              active
                ? 'bg-surface font-medium text-ink shadow-[0_1px_2px_rgba(21,23,26,0.10),0_0_0_1px_rgba(21,23,26,0.04)]'
                : 'text-muted hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Tag({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  /** 市场 tone（cn/us/hk/jp）与 MarketId 一一对应，可直接把 row.market 传进来 */
  tone?: 'neutral' | 'up' | 'down' | 'amber' | 'steel' | 'warn' | 'cn' | 'us' | 'hk' | 'jp'
}) {
  const map: Record<string, string> = {
    neutral: 'border-line bg-surface-2 text-muted',
    up: 'border-[#f0d3cc] bg-[#fcf1ef] text-up',
    down: 'border-[#c8e0d5] bg-[#eff7f3] text-down',
    amber: 'border-[#ecdcbf] bg-amber-soft text-amber',
    steel: 'border-[#d0dcee] bg-steel-soft text-steel',
    warn: 'border-[#e9cfb6] bg-[#fbf2e9] text-[#9c5718]',
    cn: 'border-market-cn-line bg-market-cn-bg text-market-cn-fg',
    us: 'border-market-us-line bg-market-us-bg text-market-us-fg',
    hk: 'border-market-hk-line bg-market-hk-bg text-market-hk-fg',
    jp: 'border-market-jp-line bg-market-jp-bg text-market-jp-fg',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${map[tone]}`}
    >
      {children}
    </span>
  )
}

/**
 * 可横向滚动的表格容器：内容真的超宽时才在下方显示滑动提示。
 * SSR 首屏提示隐藏，hydration 后按 scrollWidth 实测决定是否显示，
 * 避免桌面端出现「左右滑动」的无意义文案。视口变化时复检。
 */
export function HScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollable, setScrollable] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setScrollable(el.scrollWidth > el.clientWidth + 1)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  return (
    <div>
      <div ref={ref} className="thin-scroll overflow-x-auto">
        {children}
      </div>
      <p
        aria-hidden
        className={`mt-2 text-[11px] text-faint transition-opacity ${
          scrollable ? 'opacity-100' : 'opacity-0'
        }`}
      >
        ← 表格超宽，可左右滑动 →
      </p>
    </div>
  )
}

const TONE_STYLE: Record<
  SignalTone,
  { bg: string; border: string; text: string; dot: string; bar: string }
> = {
  cold: {
    bg: 'bg-cold-band',
    border: 'border-[#ccdbef]',
    text: 'text-steel',
    dot: 'bg-steel',
    bar: 'bg-steel',
  },
  cool: {
    bg: 'bg-cold-band',
    border: 'border-[#dbe4f1]',
    text: 'text-steel',
    dot: 'bg-steel/60',
    bar: 'bg-steel/60',
  },
  neutral: {
    bg: 'bg-surface-2',
    border: 'border-line',
    text: 'text-ink-2',
    dot: 'bg-faint',
    bar: 'bg-faint',
  },
  warm: {
    bg: 'bg-hot-band',
    border: 'border-[#f0d2ca]',
    text: 'text-up',
    dot: 'bg-up/60',
    bar: 'bg-up/60',
  },
  hot: {
    bg: 'bg-hot-band',
    border: 'border-[#ecc3ba]',
    text: 'text-up',
    dot: 'bg-up',
    bar: 'bg-up',
  },
}

export function SignalBanner({
  tone,
  title,
  desc,
  right,
}: {
  tone: SignalTone
  title: string
  desc: string
  right?: ReactNode
}) {
  const s = TONE_STYLE[tone]
  return (
    <div
      className={`relative flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-xl border ${s.border} ${s.bg} py-3.5 pl-5 pr-4`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${s.bar}`} />
      <div className="flex min-w-0 items-start gap-3">
        <span className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
        <div className="min-w-0">
          <p className={`text-[15px] font-semibold ${s.text}`}>{title}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{desc}</p>
        </div>
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  )
}

/** 概率条：把 0~1 的胜率画成一条细线，同时给出数值 */
export function ProbBar({
  value,
  tone = 'steel',
  width = 64,
}: {
  value: number
  tone?: 'steel' | 'up' | 'down'
  width?: number
}) {
  const pct = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
  const color =
    tone === 'up' ? 'bg-up' : tone === 'down' ? 'bg-down' : 'bg-steel'
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="relative inline-block h-[3px] overflow-hidden rounded-full bg-line"
        style={{ width }}
      >
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${color}`}
          style={{ width: `${pct * 100}%` }}
        />
      </span>
      <span className="num text-[13px] font-medium text-ink">
        {(pct * 100).toFixed(1)}%
      </span>
    </span>
  )
}

export function Divider({ className = '' }: { className?: string }) {
  return <div className={`h-px w-full bg-line ${className}`} />
}

/**
 * 「走势 ↗」外链：跳到该指数的外部行情走势页，**新标签页**打开。
 *
 * ⚠️ 就用 `<a target="_blank">`，**不要**改成 `window.open` 开新窗口：
 * 曾经按需求做过一版「带尺寸特征强制新窗口」，用户实测后明确要回标签页。
 * （而且那版本还有坑：features 里带 noopener 时无论成败都返回 null，
 *  分不清「开窗成功」与「被拦截」，会窗口+标签页各开一个。）
 * 现在不需要任何 JS：标签页是浏览器默认行为，没有弹窗、没有拦不拦的问题。
 *
 * 用原生 <a> 而不是 <Link>：目标是站外站点，不该走客户端路由，
 * 也不该被 TanStack Router 预加载。URL 从 registry 取（chartUrl），
 * 所以调用方只需要给 indexId。
 *
 * 注意：不要把它嵌在指向详情页的 <Link> 里面 —— <a> 套 <a> 是非法 HTML，
 * 移动端卡片因此拆成了「标题链接 + 内容链接 + 底部外链」，不要合并回去。
 */
export function ChartLink({
  indexId,
  label = '走势',
  className = '',
}: {
  indexId: IndexId
  label?: string
  className?: string
}) {
  const def = indexByIdOrDefault(indexId)
  return (
    <a
      href={def.chartUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={`${def.name} · ${CHART_SITE}（新标签打开）`}
      aria-label={`${def.name} 走势（${CHART_SITE}，新标签打开）`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-surface px-2 py-[3px] text-[11.5px] font-medium text-muted transition-colors hover:border-line-strong hover:text-steel ${className}`}
    >
      {label}
      <span aria-hidden="true" className="text-[9.5px] leading-none opacity-70">
        ↗
      </span>
    </a>
  )
}
