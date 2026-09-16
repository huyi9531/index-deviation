import { createFileRoute } from '@tanstack/react-router'
import { INDICES } from '~/lib/indices/registry'
import { alertState, alertStateAll } from '~/lib/indices/service'

const DEFINITION = {
  deviation: '100 * ln(close / movingAverage)',
  maWindows: [60, 200],
}

const CORS = {
  'cache-control': 'public, max-age=300, s-maxage=300',
  'access-control-allow-origin': '*',
}

/**
 * GET /api/:indexId
 *
 * 面向外部调用的公开接口：只返回「当前状态 + 行动水位是否触发」，不返回历史序列。
 * 可以直接喂给 Cloudflare Cron Worker、Uptime 监控或 Zapier / n8n 做偏离度告警。
 *
 *   /api/sp500    单个指数
 *   /api/nasdaq   单个指数
 *   /api/all      一次返回全部指数（更适合做「任意一个触发就报警」）
 *
 * 例：标普偏离度跌破 −10% 时发通知
 *   curl -s https://<your-worker>/api/sp500 | jq '.actionable'
 */
export const Route = createFileRoute('/api/$indexId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const indexId = params.indexId
        try {
          if (indexId === 'all') {
            const states = await alertStateAll()
            return Response.json(
              {
                ok: true,
                generatedAt: new Date().toISOString(),
                count: states.length,
                actionable: states.some((s) => s.actionable),
                indices: states,
                definition: DEFINITION,
                note: '历史统计频率，非预测，不构成投资建议。',
              },
              { headers: CORS },
            )
          }

          const state = await alertState(indexId)
          if (!state) {
            return Response.json(
              {
                ok: false,
                error: `未知指数：${indexId}`,
                available: INDICES.map((i) => i.id),
              },
              { status: 404, headers: CORS },
            )
          }

          return Response.json(
            {
              ok: true,
              generatedAt: new Date().toISOString(),
              ...state,
              definition: DEFINITION,
              note: '历史统计频率，非预测，不构成投资建议。',
            },
            { headers: CORS },
          )
        } catch (error) {
          return Response.json(
            { ok: false, error: (error as Error).message },
            { status: 500, headers: CORS },
          )
        }
      },
    },
  },
})
