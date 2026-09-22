# Repository Guidelines

## 项目概述

多指数偏离度监控看板：用对数偏离度 `100 × ln(收盘 ÷ N日均线)` 量化 10 个指数
（美股：标普500 / 纳斯达克100；A 股：沪深300 / 中证A500 / 中证500 / 创业板指 / 科创50；
港股：恒生指数 / 恒生科技；日本：日经225）
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
    types.ts            领域类型 + 载荷类型 + ERAS_US/ERAS_CN/ERAS_HK/ERAS_JP/RANGES 常量
    series.ts           纯计算：CSV 解析、均线、对数偏离度（同构，可进客户端）
    stats.ts            纯统计：阈值扫描、baselineRates、复归速度、currentStatus、
                        neighborhoodStats（同类位置统计）
    queries.ts          载荷拼装（同构）+ activeErasFor / buildOverviewRow
    search.ts           各路由共享的 zod 搜索参数定义
    service.ts          serverFn 层：缓存 + CACHE_VERSION + alertState
    source.server.ts    取数（fetchYahoo/fetchEastmoney 按派发）+ 四级兜底（内存 → 平台缓存 → KV → 内置快照）
  lib/format.ts         数字/日期/百分比/超额格式化（fmtExcess 等）—— 注意在 lib/ 下，不在 lib/indices/
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
notify/                 ★ 独立的触发通知 worker（不属于站点构建）：index.ts + wrangler.jsonc，
                        配套 .smoke/notify-check.mjs（自检）与 .smoke/notify-stub.mjs（测试桩）
```

分层规则：`series.ts`/`stats.ts`/`queries.ts` 必须保持同构（无 fetch/缓存）；
一切触网、缓存、快照读取只在 `*.server.ts`。

## 构建、测试与开发命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 开发服务器，<http://localhost:3000> —— **日常 UI 迭代走这里（HMR）** |
| `npm run build` | `vite build && tsc --noEmit`，部署前必须通过 |
| `npm run preview` | workerd 里跑构建产物（**端口 4173**，不读 server.port；重建 dist 后必须重启） |
| `npm run seed [id...]` | 重新抓取并刷新离线快照（`npm run seed` = 全部 10 个） |
| `npm run deploy` | build + `wrangler deploy` |
| `node .smoke/check.mjs` | 路由内容断言（默认 3000；`BASE=<url>` 可指向 preview/线上） |
| `node .smoke/overflow.mjs <path> [width]` | 窄屏横向溢出检查（headless Chrome，默认 390px） |
| `node scripts/verify.mjs --base=<url>` | 从 CSV 独立复算并与 `/api/:id` 对拍 |
| `node .smoke/calibrate.mjs` | 行动水位标定（**只读**，不写 registry）：默认出报告，`--check` 与 registry 对拍，`--grade-current` 给现有值定级，`--scenarios` 换门槛看剩多少格 |
| `node .smoke/notify-check.mjs` | 通知 worker 状态机自检（**全程离线**，六场景断言，约 40s） |
| `wrangler deploy -c notify/wrangler.jsonc` | 部署通知 worker（独立于站点，见架构第 15 条） |

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
- **多个 Tag 放在一行 flex 里时，容器必须 `flex-wrap` 且 Tag 自带 `whitespace-nowrap`**。
  总览移动端卡片的头部曾同时出现「名称 + ticker + 市场标签 + 来源标签」四个元素，
  390px 下需 202px、实际只有 183px；不换行时 flex 会把标签压成两行竖排的圆形，
  名称也会断行。宁可换行，不可压形。（`Tag` 已内置 `whitespace-nowrap`）
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

`main` 分支，远端 `github.com/huyi9531/index-deviation`。标题格式：
`[Agent] <type>: <中文祈使句描述>`，type 取 `feat` / `fix` / `chore`。
**默认不 push，需要时显式说明。**

正文写得详细是既有习惯，不是可选装饰。每个提交交代五件事：问题是什么、改成什么、
为什么这么改（含**被否掉的方案及原因**）、踩到的坑、以及**本轮实跑过哪些验证命令**。
第三种尤其重要 —— 多数坑是「看起来能用但不这么写就会坏」，不写下来下一轮会重踩。

提交前排除密钥、凭证、缓存、大产物（`.gitignore` 已覆盖 `dist`、`.dev.vars`、
`.wrangler`、`worker-configuration.d.ts`、`_stockprobe` 的抓取数据等）。
工作区有不属于本轮的未提交改动时，先判归属，不要用 `git add -A` 一把扫进来。

## 架构概览与关键机制（改代码前必读）

这些契约不读源码看不出来，违反任何一条都会返工：

1. **搜索参数经 JSON.parse**。TanStack Router 把 `?era=2010` 解析成数字，字符串枚举
   校验直接失败并 307 丢弃参数。所有枚举参数必须用非数字 id（`since2010` 不是 `2010`），
   且全部 `.optional().catch(undefined)`，定义集中在 `search.ts`。

2. **`*.server.ts` 是硬边界**。构建时客户端环境 import 该后缀的文件会直接报错。
   serverFn 内用 `await import('./source.server')` 动态引入，客户端包永远不含它。
   纯计算放同构模块，不要为了省事把取数逻辑写进组件或 queries。

3. **三个版本号各有各的作用域，别一律「同步递增」**。改统计口径或载荷结构时，
   该动的是前两个，**不是** `daily-v3`：

   | 位置 | 缓存的东西 | 什么时候递增 |
   | --- | --- | --- |
   | `service.ts` 的 `CACHE_VERSION`（现值 10） | 进程内 `bundles`（序列 + meta） | 改统计口径 / 载荷结构 |
   | `source.server.ts` 的 `payload/vN`（现值 v8） | Cache API 里的计算结果 | 同上；只改 action 水位这类「结构没变但值变了」也要 |
   | `source.server.ts` 的 `daily-vN`（现值 v3） | Cache API 里的**原始 CSV 数据** | **只有 DailyData 结构或数据口径变了才动** |

   漏掉前两个，TTL 20 分钟内旧 payload 会一直被命中，表现为「修复没生效」。

   注：新增指数本身会自然产生新 key（payload 是按 `indexId + 末日 + source` 分桶的），
   但 `CACHE_VERSION` 仍要递增 —— 它同时是总览页与详情页共用的缓存前缀，
   不递增会跟旧载荷挂在同一个版本号下。

4. **行动水位：两半段都要成立，且必须带证据分级**。规则（2026-09 重做）：
   ① 全样本 —— 最浅阈值满足「60 日超额 ≥ +3pp 且 ≥12 段独立信号」；
   ② 样本外 —— 按交易日对半切，**前后两半段都要有 ≥ +3pp 的超额**；
   ③ ① 的档位全不达标时，改用**当前时代窗口**（基线也只在窗口内算）复核一遍。
   标不出就是 `null`，沿类型一路穿透，UI 显示「无统计优势」，不得硬凑数字。
   分级（`registry.ts` 的 `EVIDENCE` 表，UI 读它）：`robust` ①②都过 /
   `eraOnly` 只有 ③ 过 / `fragile` ① 过但 ② 翻负 / `none` 无水位。
   2026-09 重标后：**4 robust / 3 eraOnly / 12 fragile / 1 none**。

   ⚠️ **「值得关注」这个措辞只在 robust / eraOnly 出现**（见 `registry.ts` 的
   `TRIGGER_LABEL`）。fragile 的格子照旧参与触发（判定逻辑不变），但标签写
   「已进入水位 · 证据薄弱」。把「历史频率」说成「统计优势」是这个产品最不能犯的错。

   ⚠️ 试过更严的「置信下界 ≥ +3pp」并打算采纳，**实测会把 20 格全部清零**，而且反直觉：
   12~30 段独立信号时区间半宽就有 ±20~30pp，要求下界 ≥ +3pp 等于要求超额 ≥ 25pp，
   于是它系统性地**选中最深的那一档**（与「取最浅档」的意图相反），水位会深到几乎
   永不触发。所以用「两半段都要」这个**稳健性**门槛，不用显著性门槛。

   ⚠️ 点估计**必须按交易日加权**，不许用「每段只取首次触达日」。首次触达日永远是那一段
   里最浅的一天（刚跨过阈值），而段内更深的日子历史上反弹更好 —— 那个口径系统性低估
   「处于该位置时任意一天买入」的平均体验，实测能翻转 10 格里 5~6 格的样本外结论。
   段数只用于门槛与**置信区间的样本量**（聚类数据的标准保守处理）。

   标定命令：`node .smoke/calibrate.mjs`（只读报告）、`--check`（与 registry 对拍）、
   `--grade-current`（给现有值定级）、`--scenarios`（换门槛看剩多少格）。
   热力图中性点是**常态胜率**（标普 20 日 61.8%），不是 50%。

5. **「同类位置」只展示超额，不展示裸胜率**。超额 = 同类位置胜率 − 常态胜率（pp）。
   裸胜率的大头是常态漂移，展示它会诱导「概率高=该买」（用户明确反馈过）。
   点估计按**交易日加权**；着色看 **95% 置信区间**（Newcombe），两道门槛都过才上色：
   幅度 |超额| ≥ 3pp **且** 区间不含 0。规则唯一收在 `lib/format.ts` 的 `excessToneOf()`，
   页面把（点估计, 区间, 色档）渲成 data-* 属性供 `.smoke/check.mjs` 对拍。
   为什么看区间而不是点估计：科创50 的同类位置只有 59 个交易日，当前值挪动 ±0.2%
   就能让点估计在 −0.0pp 与 +6.0pp 之间跳，正好横跨 3pp 分界 —— 颜色会由噪声决定。
   样本 < 30 天如实给 null。

6. **总览排序 = 「离值得动手的距离」**：信号温度 cold→hot（cold/cool 是超卖机会区
   在上，hot 是过热警戒垫底——注意 `currentStatus` 里 hot 也是 `actionable: true`，
   **不能**用 actionable 浮顶，否则过热的也会被顶上去）；同温内按
   `index.tsx` 的 `distanceToAction()` 升序 —— 已触发任一水位 → 0，否则取
   `min(|to60|, |to200|)`（两个都是负数「还需跌%」，所以取绝对值），两条水位都没标定
   才是 Infinity 垫底。**两个坑**：原来只认 `to200`，于是跌破 dev60 水位的指数会被按
   dev200 的距离排到第 8 位（等于把 dev60 触发当成不存在）；而「`to200 === null` 就
   垫底」会让纳斯达克100 永远排最后（它的 dev200 没有水位、dev60 才有）。
   排序键用的是**阈值口径**的 `waterTriggered`，不是 `signal.tone` 的分位口径。稳定排序。

7. **回溯段**。中证A500/中证500 数据起点早于发布日（`liveSince`），前段是回溯构造。
   判断依据 `meta.backfillDays > 250`；相关文案和统计解释已在 UI 固化，不要删除。

   2026-09 新增的**恒生科技**是同类问题里最严重的一个：恒生指数公司官方 factsheet
   写明 Launch Date 2020-07-27、Base Date 2014-12-31、Base Index 3000，并注明
   「发布日之前的全部信息均为 back-tested（假设历史表现）」。数据源恰好从基日开始
   （首行 `20141231,3000.00`），于是 2882 根里前 1370 根（48%）是回溯段。
   它的水位按**含回溯段的全样本**标定（与中证A500 先例一致），只用真实段会得到
   更浅的 -6%/-18% —— 两套值不等价，不要混用。

8. **时代分段按市场，四套**。`ERAS_US`（1970/2000/2010）、`ERAS_CN`（2010/2016/2019）、
   `ERAS_HK`（1997/2014/2018）、`ERAS_JP`（1990/2013）；`activeErasFor(market, firstDate)`
   会自动隐藏早于数据起点的段（如纳指100 数据 1985 年起，`since1970` 自动隐藏；
   恒生科技数据 2014-12 起，港股的前两段都隐藏）。

   港股的三个断点不是指数编制规则变化，而是「谁在定价」：1997 回归与亚洲金融危机、
   2014 沪港通（内地资金成为边际定价者）、2018 上市制度改革（同股不同权 +
   未盈利生物科技），恒生科技指数本身就是 2018 那次改革的产物。

   `EraId` 目前是全局联合类型（尚无跨市场共用的分段名）。新增分段要同步三处：
   `types.ts` 的 `ALL_ERA_IDS`、`search.ts` 的 `eraParam`、`service.ts` 的 `ERA`。

9. **双数据源，但按指数派发、不是按市场派发**。注册表 `provider` 字段决定：
   Yahoo `chart` API 跑美股（标普 `^GSPC`、纳指100 `^NDX`）与**日经225（`^N225`）**；
   东方财富 `push2his` 跑 A 股 5 个与**港股 2 个**（`parts[2]` 才是收盘价，限流严重，
   已有重试 + 间隔，新增标的直接复用 `fetchEastmoney`）。

   为什么是这个分工（两边都是被数据可得性逼出来的，别想当然地「一市场一源」）：
   Yahoo 对恒生科技指数只有 1 根 K 线（`HSTECH.HK` / `^HSTECH` 都没历史），
   所以港股只能走东财；反过来东财压根没有日经225（`100.N225` / `100.NIKKEI`
   在三个 push2his host 上均返回空 data），而 Yahoo 的 `^N225` 自 1965 年起有 15170 根。
   恒生指数两边都有（Yahoo 自 1987、东财自 1990），选东财只为同市场同源便于对照。

   ⚠️ **A 股取数据的 host 是列表，不是官网域名**（`EASTMONEY_KLINE_HOSTS`）。
   2026-09-16 实测：从 Cloudflare 边缘打 `push2his.eastmoney.com` 的
   `/api/qt/stock/kline/get` **100% 返回 520**（带不带 UA/Referer、http/https 都一样；
   同 host 的 `/trends2/get` 却是 200 → 是东财 WAF 按路径拦了机房 IP）。
   当时的表象：A 股 5 个指数线上全挂「快照」标签、KV 里一条 A 股记录都没有
   （KV 只在抓取成功时才写），因为那一层是 `catch { return null }` 静默失败 + 没有日志，
   只能靠临时探针 worker 才定位到。所以：①host 列表按可用性排序、逐个试；
   ②**三个 host 全失败时用 `console.error` 留痕**（不要改回静默 return，observability 靠它）。
   编号集群节点（`1./2.push2his`）是独立源站集群，实测 5 个 A 股指数全量历史都能拿到，
   与官网域名数据一致；官网域名留作最后兜底。`scripts/build-seed.mjs`（本地跑）
   仍用官网域名 —— 住宅 IP 没这个限制，两边不必强行统一。

   另一处不对称：`build-seed.mjs` 的东财兜底源（新浪 K 线）**只对 A 股有效**。
   `sinaSymbol()` 对 `100.` / `124.` 开头的港股 secid 返回 `null`，
   调用方直接抛原始错误 —— 不拦的话会拼出 `szHSI` 这种代码，
   只是拿到空数组 + 白白多等一轮重试，还报出误导性的错误信息。

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
    总览页的 Hero 计数、总览页**每一行**的「值得关注」标记（`index.tsx` 的 `WaterMark`）、
    详情页的「值得关注」标签（`status.waterTriggered`）、`/api/*` 的 `actionable`
    四处**必须都调它**。
    而 `signal.tone`（cold/cool/neutral/warm/hot）只看**该时期内的相对分位**，
    不含统计优势，只配颜色和文案。两套口径曾各自实现：2026-09 科创50 的 −4%
    浅水令它们公开分歧（API 说 actionable=true、页面「触发关注」显示 0 个）。
    判据：纳斯达克100 的 dev200 至今没有水位，**那个口径永远不该被算作触发** ——
    改用分位口径就会把它重新算成「值得关注」，直接达反产品的诚实性立场。
    `.smoke/check.mjs` 里对此加了两条状态无关的哨兵：①`actionable` 必须等于
    `flags` 里那两个阈值的比较本身（不依赖当天涨跌，谁把判定换成分位口径都会响）；
    ②`/api/nasdaq` 的水位必须是 `-10 / null`（2026-09 补的 dev60 不许再被清空）。

    ⚠️ 2026-09 踩的坑：这个标记当时**只存在于详情页**，总览的行里没有 ——
    `waterTriggered` 在总览页仅被用来数了个 Hero 总数。于是用户看到「触发关注 1 个」
    却找不出是哪一个，而同行渲染的状态标签用的是分位口径（那行还写着
    「中性区 · 无极端信号」），两个口径公开打架。另有两个同源现象：
    ① 排序只认 dev200（`to200`），所以已经跌破 dev60 水位的指数会被排到第 8 位，
    等于把 dev60 触发当成不存在；② 详情页的 SummaryStrip 也只显示 dev200 的距离，
    于是会出现「到 -16% 水位还需跌 17%」和「值得关注」同时出现在一屏。
    ① **已于 2026-09 修掉**（改用 `distanceToAction()`，两个口径一起看）；
    ② **修了一半**：SummaryStrip 现在是「dev200 优先、为空时回落到 dev60」
    （`Blocks.tsx` 的 `use60`，专为纳斯达克100 而加）—— 但两个水位都在时它仍然只
    显示 dev200 那条，所以 ② 说的「已触发 dev60、却显示 dev200 的距离」仍会发生。
    彻底修法是把 binding level 提出来给排序与 SummaryStrip 共用，别再加第三套判定。

    现在总览行里也渲标记，位置固定在状态标签**之后**（用户明确要求，不要挪到前面）。
    `.smoke/check.mjs` 有一条交叉断言把「总览页标记数」与「`/api/all` 的 actionable 数」
    钉成 2 倍关系（桌面表格 + 移动卡片各渲染一次）—— 单看路由断言发现不了
    「两侧各自都能拿出来、但彼此没关系」这种问题。

    ⚠️ 数标记靠的是 `data-water-trigger="<级别>"` 属性，**不是文案**：2026-09 重标后
    标记措辞随证据级别变（robust/eraOnly 写「值得关注」、fragile 写「已进入水位 · 证据薄弱」），
    数文案的哨兵会因为改措辞而误报。级别取 **binding 那一侧**（`bindingLevel()`），
    与排序、详情页水位格同源。

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
    `.gitignore` 里。（2026-09-22 复核：把该文件移走后 `tsc --noEmit` 实测零错误，
    所以「干净仓库会挂」这句现在不成立；但新增 `*.server.ts` 时仍别依赖那个文件里的
    类型 —— `notify/index.ts` 为此手写了 KV 的结构类型，照那个写法办。）
    改 payload 结构或 `source` 枚举时，缓存版本三处同步（见上一条）。

14. **「走势 ↗」是站外外链，用新标签页打开 —— 不要改成新窗口**。URL 存在 `registry.ts` 的
    `chartUrl`（百度股市通：A 股 `ab-<代码>`、美股 `us-<Baidu代码>`，注意标普是
    `us-SPX`、纳指100 是 `us-NDX`；港股 `hk-<Baidu代码>`、日股 `jp-<Baidu代码>`，
    注意恒生科技在百度是 `HZ2083` 而非 `HSTECH`、日经是 `NK225` —— 全与东财/Yahoo 的
    代码不同；拿不准时查 `https://finance.pae.baidu.com/selfselect/sug?wd=<名字>`，
    返回里 `type=index` 那条的 `code` + `market` 就是要用的），由 `ui.tsx` 的
    `ChartLink` 统一渲染：`<a target="_blank" rel="noopener noreferrer">`，零 JS，不走客户端路由、不预加载。

    曾经按需求做过一版「`onClick` 里 `window.open` + width/height 特征强制开新窗口」
    （标签页还是窗口本是浏览器策略，HTML 没这个开关，只能这样强制），**用户实测后明确要回标签页，
    已移除**。两个别踩回去的理由：①. 开新窗口要带尺寸特征，而 features 里一旦包含 `noopener`，
    `window.open` 无论成败都返回 null，调用方就分不清「开窗成功」与「被弹窗拦截」，
    会把两种相反的处理都做错（会窗口+标签页各开一个）；②弹窗拦截器是真实存在的失败模式，
    纯 `<a>` 没有这两个问题。

    它**不参与任何取数与计算**，也不进 payload —— 所以总览页是现查 registry，
    而不是把 URL 塞进 `OverviewRow`（那要同步递增缓存版本，白增成本）。
    另一个坑：总览移动端卡片的外链必须是卡片 `<Link>` 的**兄弟节点**，
    不能嵌进去（`<a>` 套 `<a>` 是非法 HTML，hydration 会报错）——
    所以卡片样式留在外层 `<div>`，别把两个链接合并回一个。

15. **触发通知是独立的 Cron worker，不是站点的一部分**。`notify/`（`index.ts` +
    `wrangler.jsonc`）跑在自己的 worker `index-deviation-notify` 上，每工作日
    UTC 01:00（北京 09:00）读一次 `/api/all`，**只在触发状态发生变化时**推送到微信。

    为什么必须独立：站点 worker 的 `main` 是 `@tanstack/react-start/server-entry`
    （框架托管入口），没有地方挂 `scheduled` handler。所以它只依赖一个公开 HTTP 接口，
    不 import 站点任何代码（也解析不了 `~/*` 别名），三个格式化函数因此手抄了一份。

    五条不能改的约束（细节与理由写在 `notify/index.ts` 文件头）：
    ①「是否触发」直接用接口的 `actionable`，**不许在 notify 里重算** —— 那会造出
    第二套判定，站点刚为同类问题返工过；②只在状态变化时推，否则等于每天发重复消息；
    ③**「推送成功」≠「送达」**：虾推啥对错误 token 也返回 `HTTP 200 + code 200`
    （2026-09-22 实测，连完全瞎编的 token 也一样），所以能发现的失败只有
    网络层异常 / 非 200 / 响应 code ≠ 200；④先推、后写 KV —— 顺序反了的话，
    一次网络抖动就会把「新触发」记成已通知，通知永久丢失；⑤所有出网请求必须带
    `AbortSignal.timeout` —— 实测网络挂起时 `fetch` 会一直挂着，整个 cron 卡死且毫无日志。

    自检：`node .smoke/notify-check.mjs`（全程离线，不发真微信，可重复跑）。
    改通知逻辑后必跑；改文案也要跑，它断言了六种状态迁移。

### 新增一个指数（最短路径）

总览、详情、历史证据、API、离线兜底会自动生效，无需新增页面。
但下面 8 处必须手动接线 —— 前 4 处是数据链路（漏了页面就 500），
后 4 处是断言与文案（漏了不会报错，但会静默不覆盖 / 数字写错）。
**若是新增一个市场，后面还有 4 处。**

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
8. `src/routes/method.tsx` 的「覆盖标的」与「数据源」两段（指数清单、数据起点）；
   另：`.smoke/calibrate.mjs` 的 `LIST` 也有一份手抄清单，漏了不会报错、
   只是那个工具静默地少覆盖几个标的。

**新增市场另需 4 处**（漏了时代分段会全部落到美股口径上，不会报错）：

1. `types.ts`：加 `ERAS_XX` 常量、挂进 `ERAS_BY_MARKET`、把 `EraId` 与 `ALL_ERA_IDS` 补齐；
2. `search.ts` 的 `eraParam` 与 `service.ts` 的 `ERA` 两处 `z.enum` 同步；
3. `registry.ts` 的 `MARKET_LABEL` 与 `currencySymbol` 的 `CURRENCY_SYMBOL` 表
    （注意 `¥` 同时属于人民币和日元，新币种要想清楚怎么消歧 —— 日元的 `JP¥` 就是这么来的）；
4. `app.css` 加 `--color-market-<id>-{bg,fg,line}` 三件套、`ui.tsx` 的 `Tag` tone
    联合类型与 map、以及 `index.tsx` 传 tone 的地方（`Tag` 的 market tone 与 `MarketId`
    一一对应，页面直接传 `row.market` / `def.market`，不要再写三目运算符）。

最后 `node .smoke/calibrate.mjs` 标定水位；`--check` 会**直接读 registry 的 action 值对拍**，
不一致就退出码 1。**改水位必须让 `--check` 通过** —— provenance 从此由命令保证，不靠注释。

✅ **2026-09 已完成**：标定工具与 registry 的口径已经统一（都是「60 日超额 + 两半段」，
见第 4 条），`calibrate.mjs` 的旧「20 日绝对胜率」口径已删除。下面这段保留的是**重标前**
的体检结论 —— 它解释了为什么要改规则，读它比读规则本身更能理解这个产品处在什么水平：

- **旧口径没有区分度**：26 个候选指数（A 股宽基/红利/行业 + 港股 + 美股 + 欧日印巴澳）
  里 22 个（85%）都能标出 dev60 水位。一个放过 85% 的筛子不叫筛子。
- **旧口径经不起分段**：水位表里只有 3 个三段都成立、2 个在后半段直接翻负。
- **弱显著是常态而不是例外**：按独立信号数做的单侧检验，p 值大多落在 0.1~0.35。
  **别拿 p 值去单独推翻某一个水位** —— 要改就整表一起改。

重标（新规则）后的现实是：**20 格里只有 4 格 robust，12 格样本外已翻负**。
这不是标注失误，是实测结论 —— 整个水位体系处在弱显著水平，**任何一格都不该被当成
「统计上已验证的买卖信号」来读**。所以 UI 用 `TRIGGER_LABEL` 把措辞与证据级别绑定。

每个指数的水位来源、段数与局限都写在 `registry.ts` 标定结果表及其后的 ⚠️ 段落里，
改任何一个水位前先把那几段读完。
