/**
 * notify worker 的状态机自检：起桩 → 起 worker → 依次换 payload 触发 cron → 断言。
 *
 * 全程离线：`SITE_BASE` 与 `XTUIS_ENDPOINT` 都指向本地桩，**不会真的往微信发消息**，
 * 也不会打线上接口。所以可以随便重复跑。
 *
 * 覆盖六个分支（这些分支靠等线上真实状态变化是等不到的）：
 *   ① 首次运行（KV 无状态）→ 必须发「监控已启用」并把状态写进 KV
 *   ② 状态未变            → 必须静默（否则每天一条重复消息 = 用户屏蔽）
 *   ③ 新增触发            → 必须发「新触发」
 *   ④ 触发解除            → 必须发「已解除」
 *   ⑤ 接口响应结构异常     → 必须抛错且**不写 KV**（否则这批变化被吞掉，永远不再通知）
 *   ⑥ 回到 ④ 的状态       → 必须静默 → 反证 ⑤ 没有写 KV
 *
 * 用法：node .smoke/notify-check.mjs
 *
 * 脚本会先清空 `notify/.wrangler/state/v3/kv`（本地模拟 KV），所以**可重复跑**：
 * 不清的话「首次运行」分支第二次跑就会被上一轮残留的状态跳过，测试静默失真。
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const REPO = process.cwd()
const STUB_DIR = resolve(REPO, '.smoke/_notify-stub')
const PAYLOAD = resolve(STUB_DIR, 'payload.json')
const LOCAL_KV = resolve(REPO, 'notify/.wrangler/state/v3/kv')
const STUB_PORT = 8799
const WORKER_PORT = 8787
const BASE = `http://127.0.0.1:${WORKER_PORT}`

const logs = { stub: [], worker: [] }
const capture = (buf, key) => {
  for (const line of String(buf).split('\n')) {
    if (line.trim()) {
      logs[key].push(line)
      if (process.env.NOTIFY_CHECK_VERBOSE) console.log(`[${key}] ${line}`)
    }
  }
}

// ── 构造 payload（字段与真实 /api/all 响应一致，见 src/routes/api.$indexId.ts）──
const entry = (indexId, name, close, dev60, dev200, a60, a200) => ({
  indexId,
  name,
  market: 'cn',
  currency: 'CNY',
  date: 20260922,
  close,
  dev60,
  dev200,
  actionable: (a60 !== null && dev60 <= a60) || (a200 !== null && dev200 <= a200),
  flags: [
    {
      key: 'dev60',
      label: `60 日偏离度 ≤ ${a60}%`,
      value: dev60,
      threshold: a60,
      triggered: a60 !== null && dev60 <= a60,
    },
    {
      key: 'dev200',
      label: a200 === null ? '200 日偏离度（该口径无标定水位）' : `200 日偏离度 ≤ ${a200}%`,
      value: dev200,
      threshold: a200,
      triggered: a200 !== null && dev200 <= a200,
    },
  ],
})
const wrap = (indices) => ({
  ok: true,
  generatedAt: new Date().toISOString(),
  count: indices.length,
  actionable: indices.some((i) => i.actionable),
  indices,
})

const STAR50_HIT = entry('star50', '科创50', 1665.04, -4.34, 5.25, -4, -16)
const HSTECH_HIT = entry('hstech', '恒生科技', 4438.21, -8.08, -12.1, -8, -20)
const SP500 = entry('sp500', '标普500', 7764.7, 2.15, 7.72, -7, -10)

const scenarios = [
  {
    name: '① 首次运行（KV 无状态）',
    payload: wrap([STAR50_HIT, SP500]),
    http: 200,
    // 首次运行也要推送：这是唯一一次能验证「消息真的出去了」的机会
    worker: [/已投递.*监控已启用/],
    pushes: 1,
  },
  {
    name: '② 状态未变',
    payload: wrap([STAR50_HIT, SP500]),
    http: 200,
    worker: [/状态未变/],
    pushes: 0,
  },
  {
    name: '③ 新增触发 hstech',
    payload: wrap([STAR50_HIT, HSTECH_HIT, SP500]),
    http: 200,
    worker: [/已投递.*新触发 1 个/],
    pushes: 1,
  },
  {
    name: '④ star50 解除',
    payload: wrap([HSTECH_HIT, SP500]),
    http: 200,
    worker: [/已投递.*已解除 1 个/],
    pushes: 1,
  },
  {
    name: '⑤ 接口响应结构异常',
    payload: { ok: false, error: '模拟接口故障' },
    http: 500,
    worker: [/运行失败/],
    pushes: 0,
  },
  {
    name: '⑥ 回到 ④ 的状态（反证 ⑤ 没写 KV）',
    payload: wrap([HSTECH_HIT, SP500]),
    http: 200,
    worker: [/状态未变/],
    pushes: 0,
  },
]

// ── 进程管理 ───────────────────────────────────────────────────────────
function killTree(proc) {
  if (!proc || proc.killed || proc.pid === undefined) return
  if (process.platform === 'win32') {
    // wrangler 会派 workerd 子进程，只杀父进程会留下占用端口的孤儿
    spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    proc.kill('SIGKILL')
  }
}

async function waitFor(url, label, timeoutMs = 90_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
      if (res.status) return Date.now() - t0
    } catch {
      /* 还没起来 */
    }
    await sleep(600)
  }
  throw new Error(`${label} 在 ${timeoutMs}ms 内没起来`)
}

// ── 主流程 ────────────────────────────────────────────────────────────
// 先清本地 KV：否则「首次运行」分支会被上一轮残留状态吃掉（实测踩过）
await rm(LOCAL_KV, { recursive: true, force: true })
await mkdir(STUB_DIR, { recursive: true })
await writeFile(PAYLOAD, JSON.stringify(scenarios[0].payload, null, 2))

const stub = spawn('node', ['.smoke/notify-stub.mjs', String(STUB_PORT), PAYLOAD], { cwd: REPO })
stub.stdout.on('data', (b) => capture(b, 'stub'))
stub.stderr.on('data', (b) => capture(b, 'stub'))

const worker = spawn(
  'node',
  [
    'node_modules/wrangler/bin/wrangler.js',
    'dev',
    '-c',
    'notify/wrangler.jsonc',
    '--test-scheduled',
    '--port',
    String(WORKER_PORT),
    '--var',
    `SITE_BASE:http://127.0.0.1:${STUB_PORT}`,
    '--var',
    `XTUIS_ENDPOINT:http://127.0.0.1:${STUB_PORT}`,
    // 给一个桩 token，让没有 notify/.dev.vars 的干净仓库也能跑这个自检
    '--var',
    'XTUIS_TOKEN:stub-token',
  ],
  { cwd: REPO },
)
worker.stdout.on('data', (b) => capture(b, 'worker'))
worker.stderr.on('data', (b) => capture(b, 'worker'))

const results = []
try {
  await waitFor(`http://127.0.0.1:${STUB_PORT}/api/all`, '桩服务')
  // worker 没有 fetch handler，根路径必然 500 —— 能返回状态码就算起来了
  await waitFor(`${BASE}/`, 'worker')
  await sleep(1200)

  for (const sc of scenarios) {
    await writeFile(PAYLOAD, JSON.stringify(sc.payload, null, 2))
    await sleep(300)
    const wBefore = logs.worker.length
    const sBefore = logs.stub.filter((l) => l.includes('.send')).length

    let http
    try {
      const res = await fetch(`${BASE}/__scheduled?cron=${encodeURIComponent('0 1 * * 1-5')}`, {
        signal: AbortSignal.timeout(60_000),
      })
      http = res.status
    } catch (err) {
      http = `请求失败：${err instanceof Error ? err.message : String(err)}`
    }
    await sleep(2500)

    const wLines = logs.worker.slice(wBefore).join('\n')
    const pushes = logs.stub.filter((l) => l.includes('.send')).length - sBefore
    const problems = []
    if (http !== sc.http) problems.push(`HTTP 期望 ${sc.http}，实得 ${http}`)
    if (pushes !== sc.pushes) problems.push(`推送次数期望 ${sc.pushes}，实得 ${pushes}`)
    for (const re of sc.worker) {
      if (!re.test(wLines)) problems.push(`worker 日志未匹配 ${re}`)
    }
    results.push({ name: sc.name, problems })
  }
} finally {
  killTree(worker)
  killTree(stub)
  await sleep(600)
  await rm(STUB_DIR, { recursive: true, force: true })
}

console.log('\n════════════ notify worker 自检 ════════════')
let failed = 0
for (const r of results) {
  if (r.problems.length === 0) {
    console.log(`  ✓ ${r.name}`)
  } else {
    failed += 1
    console.log(`  ✗ ${r.name}`)
    for (const p of r.problems) console.log(`      - ${p}`)
  }
}
console.log(`\n共 ${results.length} 个场景，失败 ${failed} 个`)
console.log('提示：加 NOTIFY_CHECK_VERBOSE=1 打印 worker/桩的全部日志')
process.exit(failed === 0 ? 0 : 1)
