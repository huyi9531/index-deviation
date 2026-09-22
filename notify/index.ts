/**
 * 偏离度看板 · 触发通知 worker
 *
 * 职责只有一个：定时读站点的公开接口 `/api/all`，在**触发状态发生变化**时推送到微信。
 *
 * 为什么必须是独立 worker：站点 worker 的 main 是
 * `@tanstack/react-start/server-entry`（框架托管入口，见根 wrangler.jsonc），
 * 没有地方挂 scheduled handler。所以这里与站点解耦，只依赖一个公开 HTTP 接口。
 *
 * 五条设计约束（都是踩过的坑，别改）：
 *
 * 1. **判定「是否触发」的口径不在本文件里。** 直接用接口返回的 `actionable` ——
 *    它的唯一真相来源是站点 `src/lib/indices/stats.ts` 的 `waterTriggered()`。
 *    在这里重算一遍就会造出第二套判定（站点 2026-09 刚为同类问题返工过一次：
 *    「触发关注」标记曾同时存在分位口径与阈值口径，两者公开打架）。
 *
 * 2. **只在状态变化时推送。** 每次 cron 都推 = 每天一条重复消息 = 用户屏蔽。
 *    状态存 KV，比对后再决定推不推。
 *
 * 3. ⚠️ **「推送成功」不等于「送达」。** 实测（2026-09-22）：虾推啥对**错误 token**
 *    与**完全不存在**的 token 同样返回 `HTTP 200` + `{"code":200,"message":"Message Queue
 *    Success"}`。所以本 worker 只能确认「消息已进队列」，**无法**从响应判断微信端是否
 *    真的收到。能暴露的失败只有「网络层异常 / 非 200 / 响应 code ≠ 200」这几种 ——
 *    它们都意味着请求根本没被受理。真正的送达验证只有一次机会：首次运行那条
 *    「监控已启用」消息。若没收到，第一件事是检查 XTUIS_TOKEN。
 *
 * 4. **发送成功才写 KV。** 顺序反了的话，一次网络抖动就会让「新触发」被记成已通知，
 *    通知永久丢失 —— KV 里存的是「上次状态」，不是「待办队列」。
 *
 * 5. **不 import 站点任何代码。** `notify/` 要能独立部署，也不能依赖 `~/*` 别名
 *    （wrangler 不解析它）。三个格式化小函数因此在这里手抄了一份，
 *    真相来源是 `src/lib/format.ts`，改那边记得同步这里。
 *
 * 与站点的唯一契约是 `/api/all` 的响应结构，见 `src/routes/api.$indexId.ts`
 * 与 `src/lib/indices/service.ts` 的 `alertStateAll()`。
 */

const STATE_KEY = 'alert-state-v1'
const XTUIS_DEFAULT_ENDPOINT = 'https://wx.xtuis.cn'

/**
 * 单次出网请求的超时。
 *
 * 不是预防性设置 —— 2026-09-22 本地实测踩到过：网络挂起时 `fetch` 会一直挂着
 * （等了 180s 毫无返回），整个 cron 调用就此卡死，既没有日志也没有 KV 写入。
 * 加了超时后失败变成「10s 后抛错 → 日志留痕 → 不写 KV → 下个 cron 重试」。
 */
const FETCH_TIMEOUT_MS = 10_000

/**
 * KV 的结构类型。
 *
 * 刻意手写而不用 `KVNamespace` 全局类型：那来自 `wrangler types` 生成的
 * `worker-configuration.d.ts`，而它在 `.gitignore` 里 —— 干净仓库没有它，
 * 用了会让 `tsc --noEmit` 直接挂掉（站点侧 `source.server.ts` 的 `cloudflare:workers`
 * import 也踩过同一个坑）。本 worker 的 KV 绑定（ALERT_STATE）与站点（DAILY_DATA）
 * 也不同，那个生成的 Env 本来就不适用。
 */
interface KVLike {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
}

interface Env {
  ALERT_STATE: KVLike
  /** 虾推啥 token，走 secret：`wrangler secret put XTUIS_TOKEN -c notify/wrangler.jsonc` */
  XTUIS_TOKEN: string
  /**
   * 推送端点，**只给测试用**：`.smoke/notify-check.mjs` 把它指向本地桩，
   * 这样自检不会真的往微信发消息。生产不设这个变量，走下面的默认值。
   */
  XTUIS_ENDPOINT?: string
  /** 站点地址。默认线上；本地对拍时可指向 preview（见 wrangler.jsonc 的 vars） */
  SITE_BASE: string
}

interface ScheduledEventLike {
  scheduledTime: number
  cron: string
}

/** `/api/all` 里本 worker 用到的字段（只声明用到的，多余字段忽略） */
interface Flag {
  key: string
  label: string
  value: number
  threshold: number | null
  triggered: boolean
}

interface ApiIndexState {
  indexId: string
  name: string
  date: number
  close: number
  dev60: number
  dev200: number
  actionable: boolean
  flags: Flag[]
}

interface ApiAllPayload {
  ok: boolean
  count: number
  indices: ApiIndexState[]
}

interface AlertState {
  /** 上次运行后处于触发状态的指数 id（排序后存，便于人工比对 KV） */
  triggered: string[]
  /** 上次成功推送后写回的 UTC 时刻 */
  updatedAt: string
}

// ── 格式化：手抄自 src/lib/format.ts（那边是真相来源，改动同步两处）──────────────

function fmtPoint(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function fmtPct(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`
}

/** YYYYMMDD → 2026-09-22。这是「交易日」不是时间戳，直接按数字拆位，不做时区换算 */
function fmtDate(ymd: number): string {
  if (!Number.isFinite(ymd)) return '—'
  const s = String(ymd)
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

// ── 取数与推送 ──────────────────────────────────────────────────────────

async function fetchAll(env: Env): Promise<ApiAllPayload> {
  const url = new URL('/api/all', env.SITE_BASE).toString()
  let res: Response
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (err) {
    throw new Error(
      `GET ${url} 失败（${FETCH_TIMEOUT_MS / 1000}s 超时或网络异常）：${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const body = await res.text()
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}：${body.slice(0, 200)}`)
  let json: ApiAllPayload
  try {
    json = JSON.parse(body) as ApiAllPayload
  } catch {
    throw new Error(`GET ${url} → 响应不是 JSON：${body.slice(0, 200)}`)
  }
  if (json.ok !== true || !Array.isArray(json.indices)) {
    throw new Error(`GET ${url} → 响应结构异常：${body.slice(0, 200)}`)
  }
  return json
}

async function readState(env: Env): Promise<AlertState | null> {
  const raw = await env.ALERT_STATE.get(STATE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as AlertState
    if (!Array.isArray(parsed?.triggered)) return null
    return parsed
  } catch {
    // KV 里是坏值（手工改过 / 旧格式）：按「无状态」处理，本轮走首次运行分支。
    // 刻意不抛错 —— 抛了就会永远卡在同一个坏值上，连自愈的机会都没有。
    console.error(`[notify] KV ${STATE_KEY} 不是合法 JSON，本轮按无状态处理`)
    return null
  }
}

async function writeState(env: Env, state: AlertState): Promise<void> {
  await env.ALERT_STATE.put(STATE_KEY, JSON.stringify(state))
}

/** 推送。注意 URL 里带 token，任何日志都不要打印 url 本身 */
async function push(env: Env, text: string, desp: string): Promise<void> {
  if (!env.XTUIS_TOKEN) throw new Error('缺少 XTUIS_TOKEN secret，未发送')
  const endpoint = env.XTUIS_ENDPOINT || XTUIS_DEFAULT_ENDPOINT
  const qs = new URLSearchParams({ text, desp }).toString()
  let res: Response
  try {
    res = await fetch(`${endpoint}/${env.XTUIS_TOKEN}.send?${qs}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (err) {
    // 注意：这里的错误信息**不能**带上 url —— 它含 token
    throw new Error(
      `虾推啥请求失败（${FETCH_TIMEOUT_MS / 1000}s 超时或网络异常）：${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const body = await res.text()
  if (!res.ok) throw new Error(`虾推啥 HTTP ${res.status}：${body.slice(0, 200)}`)
  let code: unknown
  try {
    code = (JSON.parse(body) as { code?: unknown }).code
  } catch {
    code = undefined
  }
  // 见文件头第 3 条：code=200 只代表进了队列。这里仍要校验，
  // 因为 code ≠ 200 说明请求压根没被受理，那种情况必须让本轮失败、下轮重试。
  if (code !== 200) throw new Error(`虾推啥 code=${String(code)}：${body.slice(0, 200)}`)
}

// ── 文案 ───────────────────────────────────────────────────────────────

/** 一行描述：名称 + 点位 + 已跌破的水位口径 */
function describe(i: ApiIndexState): string {
  const hit = i.flags.filter((f) => f.triggered)
  const parts = hit.map((f) => {
    const side = f.key === 'dev60' ? '60 日' : '200 日'
    const cur = f.key === 'dev60' ? i.dev60 : i.dev200
    const lvl = f.threshold === null ? '无水位' : fmtPct(f.threshold, 0)
    return `${side} ${fmtPct(cur)}（水位 ${lvl}）`
  })
  const tail = parts.length > 0 ? parts.join(' / ') : '触发'
  return `${i.name} ${fmtPoint(i.close)} · ${tail}`
}

function buildMessage(a: {
  siteBase: string
  firstRun: boolean
  /** 需要在正文里逐条列出的指数（首次运行 = 当前全部触发，之后 = 本次新触发） */
  highlight: ApiIndexState[]
  releasedIds: string[]
  byId: Map<string, ApiIndexState>
  triggeredCount: number
  total: number
  date: number
}): { text: string; desp: string } {
  const lines: string[] = []
  let text: string

  if (a.firstRun) {
    text = '偏离度看板 · 监控已启用'
    lines.push(`当前触发 ${a.triggeredCount} / ${a.total} 个指数`, '')
  } else if (a.highlight.length > 0 && a.releasedIds.length > 0) {
    text = `偏离度看板 · 新触发 ${a.highlight.length} 个 / 解除 ${a.releasedIds.length} 个`
  } else if (a.highlight.length > 0) {
    text = `偏离度看板 · 新触发 ${a.highlight.length} 个`
  } else {
    text = `偏离度看板 · 已解除 ${a.releasedIds.length} 个`
  }

  for (const i of a.highlight) {
    lines.push(describe(i), `${a.siteBase}/i/${i.indexId}`, '')
  }
  for (const id of a.releasedIds) {
    const i = a.byId.get(id)
    lines.push(`已回到水位之上：${i ? describe(i) : id}`, `${a.siteBase}/i/${id}`, '')
  }
  lines.push(`数据 ${fmtDate(a.date)}`)
  return { text, desp: lines.join('\n').trimEnd() }
}

// ── 主流程 ─────────────────────────────────────────────────────────────

async function runOnce(env: Env): Promise<void> {
  const payload = await fetchAll(env)
  const current = payload.indices.filter((i) => i.actionable)
  const prev = await readState(env)
  const firstRun = prev === null

  const prevIds = new Set(prev?.triggered ?? [])
  const currentIds = new Set(current.map((i) => i.indexId))
  const newly = current.filter((i) => !prevIds.has(i.indexId))
  const releasedIds = [...prevIds].filter((id) => !currentIds.has(id))

  if (!firstRun && newly.length === 0 && releasedIds.length === 0) {
    console.log(
      `[notify] 状态未变（触发 ${currentIds.size}/${payload.indices.length}），不推送`,
    )
    return
  }

  const byId = new Map(payload.indices.map((i) => [i.indexId, i]))
  const { text, desp } = buildMessage({
    siteBase: env.SITE_BASE,
    firstRun,
    highlight: firstRun ? current : newly,
    releasedIds,
    byId,
    triggeredCount: currentIds.size,
    total: payload.indices.length,
    date: payload.indices[0]?.date ?? 0,
  })

  // 顺序不能反：先推、后写 KV。push 抛错时 KV 保持旧值，下次 cron 重试同一批变化。
  await push(env, text, desp)
  await writeState(env, {
    triggered: [...currentIds].sort(),
    updatedAt: new Date().toISOString(),
  })
  console.log(
    `[notify] 已投递：${text}｜触发 ${currentIds.size} 个：${[...currentIds].sort().join(',') || '无'}`,
  )
}

export default {
  async scheduled(_event: ScheduledEventLike, env: Env): Promise<void> {
    try {
      await runOnce(env)
    } catch (err) {
      // 抛出去让 invocation 标记为失败 —— Cloudflare observability 靠它，
      // 静默吞掉就只能在「没收到通知」时两眼一抹黑。
      console.error(`[notify] 运行失败：${err instanceof Error ? err.message : String(err)}`)
      throw err
    }
  },
}
