# Repository Guidelines

## 项目概述

多指数偏离度监控看板：用对数偏离度 `100 × ln(收盘 ÷ N日均线)` 量化 7 个指数
（标普500 / 纳斯达克100 / 沪深300 / 中证A500 / 中证500 / 创业板指 / 科创50）
的超买超卖位置，并用全量历史统计各阈值下的前瞻胜率与超额。

技术栈：TanStack Start 1.168（React 19 + TanStack Router，文件路由）+ Vite 8 +
Tailwind v4 + Zod 4，目标运行时 Cloudflare Workers（`@cloudflare/vite-plugin`）。
图表全部为手写 SVG，无图表库依赖，SSR 直出。
线上：<https://index.aiconductor.top（Cloudflare> Workers，worker 名 `index-deviation`）。

## 项目结构与模块组织

```
src/
  lib/indices/          ← 全部业务逻辑，唯一的领域层
    registry.ts         指数注册表：纯元数据（id/market/provider/currency/liveSince/action 水位/
                        chartUrl 外部走势页）。不 import 任何数据，客户端可安全引用。加指数从这里开始。
    types.ts            领域类型 + 载荷类型 + ERAS_US/ERAS_CN/RANGES 常量
    series.ts           纯计算：CSV 解析、均线、对数偏离度（同构，可进客户端）
    stats.ts            纯统计：阈值扫描、baselineRates、复归速度、currentStatus、
                        neighborhoodStats（同类位置统计）
    queries.ts          载荷拼装（同构）+ activeErasFor / buildOverviewRow
    search.ts           各路由共享的 zod 搜索参数定义
    format.ts           数字/日期/百分比/超额格式化（fmtExcess 等）
    service.ts          serverFn 层：缓存 + CACHE_VERSION + alertState
    source.server.ts    取数（fetchYahoo/fetchEastmoney 按派发）+ 四级兜底（内存 → 平台缓存 → KV → 内置快照）
  routes/               文件路由：/ 总览、/i/$indexId 详情、/stats/$indexId 历史证据、
                        /method 说明、/api/$indexId JSON（indexId 可为 all）
  components/           ui.tsx（Card/Metric/Tag/Segmented/Gauge 等基础件）+ 图表 + 表格
  styles/app.css        设计令牌（@theme 色板）+ num/label-xs/shadow-card 工具类
  data/                 <id>-daily.csv 离线快照 + <id>-meta.json（经 ?raw 打进 server bundle）
scripts/
  build-seed.mjs        抓全量历史刷新快照（npm run seed [id...]）
  verify.mjs            独立复算 + 与 /api 对拍（无应用代码依赖；支持 --base=<url>）
.smoke/                 开发自检脚本（不入部署）：check/overflow/shots/weigh/
                        check-backfill/calibrate（行动水位标定工具）/inspect 等
```

分层规则：`series.ts`/`stats.ts`/`queries.ts` 必须保持同构（无 fetch/缓存）；
一切触网、缓存、快照读取只在 `*.server.ts`。

## 构建、测试与开发命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 开发服务器，<http://localhost:3000> —— **日常 UI 迭代走这里（HMR）** |
| `npm run build` | `vite build && tsc --noEmit`，部署前必须通过 |
| `npm run preview` | workerd 里跑构建产物（**端口 4173**，不读 server.port；重建 dist 后必须重启） |
| `npm run seed [id...]` | 重新抓取并刷新离线快照（`npm run seed` = 全部 7 个） |
| `npm run deploy` | build + `wrangler deploy` |
| `node .smoke/check.mjs` | 路由内容断言（默认 3000；`BASE=<url>` 可指向 preview/线上） |
| `node .smoke/overflow.mjs <path> [width]` | 窄屏横向溢出检查（headless Chrome，默认 390px） |
| `node scripts/verify.mjs --base=<url>` | 从 CSV 独立复算并与 `/api/:id` 对拍 |
| `node .smoke/calibrate.mjs` | 全量重算各指数行动水位（换标的/改标定规则后必跑） |

沙箱环境注意：本机 AI 会话里 `npm run` 系列可能触发 wsl.exe 被沙箱拦截报
`npm_path` 相关错误——绕开方式是 node 直调：
`node_modules/vite/bin/vite.js build`、`node_modules/typescript/bin/tsc --noEmit`、
`node_modules/wrangler/bin/wrangler.js deploy`。
（注意 node 托管版本目录会随升级变号，如 `22.22.2-2` → `22.22.2-3`，报
"No such file or directory" 时先确认真实路径。）

## 编码风格与命名约定

- TypeScript strict；`~/*` 别名指向 `src/*`（vite.config 与 tsconfig 双处维护）。
- 组件/常量 PascalCase，路由文件名即 URL（`i.$indexId.tsx` → `/i/:indexId`）。
- Tailwind v4 的设计令牌集中在 `app.css` 的 `@theme`，页面里只引用语义色
  （`text-ink`、`text-amber`、`bg-steel-soft`…），禁止裸写十六进制色值
  （SVG 图表组件内的 `COLOR` 常量表除外）。
- 数字一律加 `num` 工具类（mono + tabular-nums）；A 股配色惯例**红涨绿跌**
  （`text-up`=红=涨，`text-down`=绿=跌），不要照搬美式配色。
- **总览表格数值列左对齐**（用户明确偏好），表头与单元格不写 `text-right`；
  胜率/超额差值用 `pp`（百分点）作单位，格式化走 `format.ts`，不要手拼字符串。
- 中文文案：标题直接、正文克制；解释性长文一律下沉到 `/method`，
  页面内一格一值，同一数字不得在两处重复展示。
- 诚实性优先：没有统计优势就显示「无标定水位 / 无超额」，绝不硬凑数字诱导操作。

## 测试指南

无单测框架，验证靠分层自检：

**日常 UI 迭代**（dev server 跑着时）：

1. HMR 生效即可浏览器直看；改动涉及路由/文案 → 同步更新 `.smoke/check.mjs`
   的 `checks` 表，跑 `node .smoke/check.mjs`（对 3000 端口）；
2. UI 改动加跑 `node .smoke/overflow.mjs /<path> 390` 确认移动端不溢出。

**部署前**（停 dev → build → preview 或直接 deploy）：
3. `npm run build`（vite + tsc）；
4. `node scripts/verify.mjs --base=<preview地址>` 统计数字对拍（改了
   stats/queries 逻辑后必跑；A 股盘中时最后一根 K 线是实时值 vs 快照，FAIL 属预期漂移）。

注意验证 SSR 页面时，指数名在 HTML 里出现三块（移动端卡片、桌面表格、内嵌
loader JSON——第三块是未排序原始数据属正常）；按文档顺序列全部出现位置再判读。

## 提交与 PR 规范

本仓库未初始化 git（无提交历史可归纳），暂无提交规范。如启用 git，建议中文祈使句标题。

## 架构概览与关键机制（改代码前必读）

这些契约不读源码看不出来，违反任何一条都会返工：

1. **搜索参数经 JSON.parse**。TanStack Router 把 `?era=2010` 解析成数字，字符串枚举
   校验直接失败并 307 丢弃参数。所有枚举参数必须用非数字 id（`since2010` 不是 `2010`），
   且全部 `.optional().catch(undefined)`，定义集中在 `search.ts`。

2. **`*.server.ts` 是硬边界**。构建时客户端环境 import 该后缀的文件会直接报错。
   serverFn 内用 `await import('./source.server')` 动态引入，客户端包永远不含它。
   纯计算放同构模块，不要为了省事把取数逻辑写进组件或 queries。

3. **缓存键 = `CACHE_VERSION` + 业务键，三处同步递增**。改统计口径或 payload 结构时：
   `service.ts` 的 `CACHE_VERSION`（现值 8）、`source.server.ts` 里 Cache API 的
   URL 版本段（daily-v2、payload/v6）。漏掉任何一处，TTL 20 分钟内旧 payload 会
   一直被命中，表现为「修复没生效」。

4. **行动水位允许 null**。标定规则：最浅阈值满足「60 日胜率 − 基线 ≥ +3pp 且 ≥12 次
   独立信号」，否则为 `null`。`null` 沿类型一路穿透，UI 显示「无标定水位」，
   不得硬凑数字。热力图中性点是**常态胜率**（标普 20 日 61.8%），不是 50%。
   标定用 `node .smoke/calibrate.mjs`。纳斯达克100 全档位超额为负 → 水位就是
   `null/null`（科技成长趋势性强，深跌买入跑不赢常态），这是实测结论不是缺失。

5. **「同类位置」只展示超额，不展示裸胜率**。超额 = 同类位置胜率 − 常态胜率（pp）。
   裸胜率的大头是常态漂移，展示它会诱导「概率高=该买」（用户明确反馈过）。
   色阶：|超额| < 3pp 灰色（与常态无异，3pp 是标定阈值，全站一个标准），正红负绿。
   样本 < 30 天如实给 null。

6. **总览排序 = 「离值得动手的距离」**：信号温度 cold→hot（cold/cool 是超卖机会区
   在上，hot 是过热警戒垫底——注意 `currentStatus` 里 hot 也是 `actionable: true`，
   **不能**用 actionable 浮顶，否则过热的也会被顶上去）；同温内按 |to200| 升序
   （to200 是负数「还需跌%」，直接升序会把最远的排最前），无水位垫底。稳定排序。

7. **回溯段**。中证A500/中证500 数据起点早于发布日（`liveSince`），前段是回溯构造。
   判断依据 `meta.backfillDays > 250`；相关文案和统计解释已在 UI 固化，不要删除。

8. **时代分段按市场**。`ERAS_US`（1970/2000/2010）与 `ERAS_CN`（2010/2016/2019）
   是两套；`activeErasFor(market, firstDate)` 会自动隐藏早于数据起点的段
   （如纳指100 数据 1985 年起，`since1970` 自动隐藏）。新增分段要同步 `search.ts`。

9. **双数据源**。注册表 `provider` 字段派发：美股走 Yahoo `chart` API
   （标普 `^GSPC`、纳指100 `^NDX`）；A 股走东方财富 `push2his`（`parts[2]` 才是
   收盘价，限流严重，已有重试 + 间隔，新增 A 股标的直接复用 `fetchEastmoney`）。
   从 Cloudflare 出口 IP 实测东财可用（偶发单次失败会回落快照标签，20 分钟自愈）。

10. **dev 与 build 互斥**。dev server 运行时跑 `vite build` 会争抢
    `routeTree.gen.ts`（"modified by another process"），且路由增删后 dev 会一直
    `ERR_LOAD_URL`。顺序：停 dev → build → 重启 dev。dev 刚启动的头几个请求可能
    502（worker 冷启动），重试一次再判断。

11. **部署：`wrangler deploy` 实际读的是 `dist/server/wrangler.json`**（vite 插件
    构建时从根 `wrangler.jsonc` 生成，worker 名、routes 等在 build 时刻固化）。
    改了根配置（worker 名、自定义域名、兼容日期等）**必须重新 build 再 deploy**，
    只改根配置直接 deploy 无效。自定义域名 `index.aiconductor.top`
    （`routes` + `custom_domain: true`，自动建 DNS + 证书）；配置了 `routes` 后
    workers.dev 预览地址默认停用（404），要两个都活需显式 `"workers_dev": true`。

12. **「触发关注」与 `signal.tone` 是两件事，判定的唯一处只有一处**。
    「是否触发」= 是否跌破该指数**标定水位**，由 `stats.ts` 的 `waterTriggered()` 唯一定义，
    总览页的 Hero 计数（`row.waterTriggered`）、详情页的「值得关注」标签
    （`status.waterTriggered`）、`/api/*` 的 `actionable` 三处**必须都调它**。
    而 `signal.tone`（cold/cool/neutral/warm/hot）只看**该时期内的相对分位**，
    不含统计优势，只配颜色和文案。两套口径曾各自实现：2026-09 科创50 的 −4%
    浅水令它们公开分歧（API 说 actionable=true、页面「触发关注」显示 0 个）。
    判据：纳指100 两个水位都是 `null`（实测无优势），它**永远不该**被算作触发 ——
    改用分位口径就会把它重新算成「值得关注」，直接达反产品的诚实性立场。
    `.smoke/check.mjs` 里对此加了断言嗂兵。

13. **数据兜底是四级链，`DailyData.source` 有三态**。顺序：
    内存缓存（实时，≤20min）→ 平台缓存 Cache API（实时，≤20min）→
    **KV `DAILY_DATA`（上次成功抓取）** → 内置离线快照（构建产物）。
    `source` 取值：`live` / `cached` / `snapshot`，**每一态都必须在 UI 上显式标出**
    （总览页 Tag、详情页一句话说明）—— 兜底数据冒充实时是诚实性问题。
    为什么要有 KV 层：内置快照是构建产物，只在重新部署时才变，所以只用它兜底
    等于「实时源挂了就一直显示上次部署那天的数据」。KV 把兜底基准改成「上次成功抓取」。
    两个坑：①KV 写只有 **lastDate 推进时**才真写（免费额度 1000 写/天，不去重
    会到 504 写/天）；②`cloudflare:workers` 的 import 必须带 `@ts-ignore` ——
    模块声明来自 `wrangler types` 生成的 `worker-configuration.d.ts`，而它在
    `.gitignore` 里，干净仓库没有它会让 `tsc --noEmit` 挂掉。
    改 payload 结构或 `source` 枚举时，缓存版本三处同步（见上一条）。

14. **「走势 ↗」是站外外链，不是站内路由**。URL 存在 `registry.ts` 的 `chartUrl`
    （百度股市通：A 股 `ab-<代码>`、美股 `us-<Baidu代码>`，注意标普是 `us-SPX`、纳指100 是
    `us-NDX`，与 Yahoo 的 `^GSPC`/`^NDX` 不同），由 `ui.tsx` 的 `ChartLink` 统一渲染
    （`<a target="_blank" rel="noopener noreferrer">`，不走客户端路由、不预加载）。
    它**不参与任何取数与计算**，也不进 payload —— 所以总览页是现查 registry，
    而不是把 URL 塞进 `OverviewRow`（那要同步递增缓存版本，白增成本）。
    坑：总览移动端卡片的外链必须是卡片 `<Link>` 的**兄弟节点**，
    不能嵌进去（`<a>` 套 `<a>` 是非法 HTML，hydration 会报错）——
    所以卡片样式留在外层 `<div>`，别把两个链接合并回一个。

### 新增一个指数（最短路径）

总览、详情、历史证据、API、离线兜底会自动生效，无需新增页面。
但下面 8 处必须手动接线 —— 前 4 处是数据链路（漏了页面就 500），
后 4 处是断言与文案（漏了不会报错，但会静默不覆盖 / 数字写错）：

**数据链路**

1. `registry.ts` 的 `INDICES` 加条目（id / symbol / market / provider / currency /
   liveSince / chartUrl 外部走势页 / 标定后的 action 水位，未标定写 `null`），
   并同步 `IndexId` 联合类型；
2. `src/data/<id>-daily.csv` 加离线快照；
3. `source.server.ts` 的 `SEEDS` 加一条 `?raw` 导入；
4. `scripts/build-seed.mjs` 的 `TARGETS` 加同名条目，跑 `node scripts/build-seed.mjs <id>`。

**断言与文案**
5. `.smoke/check.mjs`：`checks` 表补路由断言，**同时**在 `apiPaths` 加 `/api/<id>`，
   并把 `/api/all` 的 `json.count !== N` 断言 +1；
6. `scripts/verify.mjs` 的 `INDICES` 手抄表加条目（它故意不引用 registry，
   靠人抄来保证「独立复算」的独立性 —— 漏了就不会校验新指数）；
7. `src/routes/index.tsx` 的「N 个主要指数」文案；
8. `src/routes/method.tsx` 的「覆盖标的」与「数据源」两段（指数清单、数据起点）。

最后 `node .smoke/calibrate.mjs` 标定水位，有达标档位才填 `action`。

⚠️ **标定规则目前是分裂的**：`calibrate.mjs` 用「20 日绝对胜率」，而 registry 里已发布的
水位用的是「60 日胜率 − 常态基线 ≥ +3pp」（两者取最浅档）。两套规则值不同（实测：
中证A500 dev60 前者给 -5、registry 写 null）。**以 registry 的口径为准**，改水位前先读
`calibrate.mjs` 顶部的警告；这个不统一已在 `.agents/plans/` 里立项待修。比如
科创50（2026-09 新增）：按 registry 口径得 dev60 -4% / dev200 -16%，
而 `calibrate.mjs` 会给出 -9% / -14% —— 后者**没有**被采用。
