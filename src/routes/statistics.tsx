import { createFileRoute, redirect } from '@tanstack/react-router'
import { DEFAULT_INDEX_ID } from '~/lib/indices/registry'

/**
 * 旧路径兜底。
 *
 * 统计页改为「按指数」的 /stats/$indexId 之后，老书签与外部链接
 * 会落到这里 —— 直接 302 到默认指数的统计页，而不是给人一个 404。
 */
export const Route = createFileRoute('/statistics')({
  beforeLoad: () => {
    throw redirect({
      to: '/stats/$indexId',
      params: { indexId: DEFAULT_INDEX_ID },
      search: {},
    })
  },
})
