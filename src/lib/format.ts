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
