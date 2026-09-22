/**
 * notify worker 的本地测试桩：模拟站点的 `/api/all` 与虾推啥的 `/<token>.send`。
 *
 * 为什么需要它（而不是直接打线上）：①通知逻辑的关键分支是「状态变化」，
 * 线上状态不受控，等它自己变化没法测；②本机到 index.aiconductor.top 的链路受代理
 * 影响不稳定（2026-09-22 实测挂死过）；③自检不该真的往微信发消息。
 *
 * 桩每次请求都**重新读** payload 文件，所以换场景只要改写那个文件，不用重启。
 * 正常用法是交给 `.smoke/notify-check.mjs` 驱动，不单独跑。
 *
 * 用法：node .smoke/notify-stub.mjs [port] [payloadPath]
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.argv[2] ?? 8799)
const payloadPath = resolve(
  process.argv[3] ?? resolve(process.cwd(), '.smoke/_notify-stub/payload.json'),
)

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)

  // 虾推啥的推送端点：/<token>.send。只回一个和真实接口同构的响应，
  // 不发任何外部请求 —— 这就是自检不会打扰真人的原因。
  if (pathname.endsWith('.send')) {
    const text = new URL(req.url ?? '/', `http://127.0.0.1:${port}`).searchParams.get('text')
    console.log(`[stub] 200 ${pathname.replace(/^\/[^.]*/, '/<token>')} ← text=${text ?? ''}`)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        code: 200,
        message: 'Message Queue Success',
        msg_id: `stub_${Date.now()}`,
      }),
    )
    return
  }

  if (pathname !== '/api/all') {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: `桩只实现了 /api/all 与 /*.send，收到 ${pathname}` }))
    return
  }

  let body
  try {
    body = await readFile(payloadPath, 'utf8')
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: `读不到 ${payloadPath}` }))
    console.log(`[stub] 500 读不到 ${payloadPath}：${err instanceof Error ? err.message : err}`)
    return
  }

  // payload 不是合法 JSON 时原样返回 —— 这正是用来测 worker 异常分支的场景
  let parsed = null
  try {
    parsed = JSON.parse(body)
  } catch {
    console.log('[stub] 200 /api/all（非法 JSON，原样返回，用于测 worker 的异常分支）')
  }

  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(body)
  if (parsed) {
    const ids = (parsed.indices ?? []).filter((i) => i.actionable).map((i) => i.indexId)
    console.log(`[stub] 200 /api/all → 触发 [${ids.join(', ') || '无'}]`)
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[stub] 监听 http://127.0.0.1:${port}，payload 来自 ${payloadPath}`)
})
