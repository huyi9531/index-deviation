import { z } from 'zod'
import type { EraId, MaKey, RangeId } from './types'

/**
 * 搜索参数 schema。
 *
 * 全部字段声明为 optional + catch，好处有两个：
 *   1. 不必在每一个 <Link> 上重复传 search
 *   2. URL 里出现脏值（?range=xx）时不会抛错，直接回落到默认值
 * 组件侧统一用 `search.range ?? DEFAULT_RANGE` 读取。
 *
 * ⚠️ TanStack Router 会用 JSON.parse 解析搜索参数，`?era=2010` 会变成数字 2010
 * 而通不过 z.enum(['2010'])。所以 era 的取值刻意全部使用非数字字符串
 * （since2010 而不是 2010），历史上踩过这个坑。
 */
export const eraParam = z
  .enum([
    'all',
    'since1970',
    'since2000',
    'since2010',
    'since2016',
    'since2019',
    'since1997',
    'since2014',
    'since2018',
    'since1990',
    'since2013',
  ])
  .optional()
  .catch(undefined)

export const rangeParam = z
  .enum(['5y', '10y', '20y', 'max'])
  .optional()
  .catch(undefined)

export const maParam = z.enum(['dev60', 'dev200']).optional().catch(undefined)

export const horizonParam = z.coerce
  .number()
  .int()
  .min(5)
  .max(60)
  .optional()
  .catch(undefined)

export const DEFAULT_RANGE: RangeId = '10y'
export const DEFAULT_ERA: EraId = 'all'
export const DEFAULT_MA: MaKey = 'dev200'
export const DEFAULT_HORIZON = 20
