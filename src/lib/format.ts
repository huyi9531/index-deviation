/** 展示格式化工具 */

export function fmtPoint(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function fmtPct(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '—'
  const s = v.toFixed(digits)
  return `${v > 0 ? '+' : ''}${s}%`
}

export function fmtPctAbs(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '—'
  return `${v.toFixed(digits)}%`
}

export function fmtProb(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(digits)}%`
}

/** 百分点差额（超额）：+2.0pp / -17.5pp；null 或 NaN 显示 — */
export function fmtExcess(v: number | null, digits = 1): string {
  if (v === null || !Number.isFinite(v)) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}pp`
}

/** 1950 年来的交易日数 → "19,795" */
export function fmtInt(v: number): string {
  if (!Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US')
}

/** YYYYMMDD → 2026-09-10 */
export function fmtDate(ymd: number): string {
  if (!Number.isFinite(ymd)) return '—'
  const s = String(ymd)
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

/** YYYYMMDD → 2026/09 */
export function fmtMonth(ymd: number): string {
  const s = String(ymd)
  return `${s.slice(0, 4)}/${s.slice(4, 6)}`
}

/** ISO → 2026-09-10 14:32 */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 相对时长："12 分钟前" */
export function fmtAgo(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.round(hours / 24)} 天前`
}

/** 交易日 → "约 4 周" */
export function fmtTradingDays(days: number): string {
  if (days < 0) return '未复归'
  if (days <= 5) return `${days} 个交易日`
  const weeks = days / 5
  if (weeks < 10) return `${weeks.toFixed(1)} 周`
  return `${(days / 252).toFixed(1)} 年`
}

/** 同类位置超额的语义色档。渲染层各自映射到自己的 class / 组件 tone */
export type ExcessTone = 'up' | 'down' | 'neutral'

/** 幅度门槛（pp）。全站一个标准：水位标定、热力图底色、着色都用它 */
export const EXCESS_THRESHOLD_PP = 3

/**
 * 同类位置超额的着色判定 —— **全站唯一的一处**（总览表格/移动卡片、详情页水位卡共用）。
 *
 * 两道门槛，**都过才着色**：
 *   ① 幅度：|点估计| ≥ 3pp —— 低于此值不值得看（与水位标定同一标准）
 *   ② 方向：95% 置信区间不含 0 —— 这个幅度分得清方向，不是噪声
 * 否则一律「与常态无异」（灰）。
 *
 * 为什么不是「区间整体在 ±3pp 之外」：2026-09 拿 10 个指数实测过，那条规则下
 * **会全部落灰**（连 532 段独立信号的标普500 也不行 —— n≈530 时区间半宽就有 ±5pp，
 * 要着色得超额 > 8pp）。一列恒灰等于不传递任何信息。
 *
 * 为什么不能只看点估计（改动前的做法）：科创50 的同类位置只有 59 个交易日，
 * 当前值挪动 ±0.2%（一天内的正常波动）就能让点估计在 −0.0pp 与 +6.0pp 之间跳，
 * 正好横跨 3pp 分界 —— **颜色完全由噪声决定**。加上门槛②后，小样本因区间很宽
 * 而自动落灰，不再拿噪声当优势。
 */
export function excessToneOf(
  excess: number | null,
  ci: [number, number] | null,
): ExcessTone {
  if (excess === null || !Number.isFinite(excess)) return 'neutral'
  // 样本不足（区间给不出来）就不给颜色 —— 没证据就不该有色
  if (!ci || !Number.isFinite(ci[0]) || !Number.isFinite(ci[1])) return 'neutral'
  if (Math.abs(excess) < EXCESS_THRESHOLD_PP) return 'neutral'
  if (ci[0] > 0) return 'up'
  if (ci[1] < 0) return 'down'
  return 'neutral'
}
