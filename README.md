# 指数偏离度监控

用 **60 日 / 200 日均线的对数偏离度** 衡量一个指数「离中长期均线有多远」，
再用尽可能长的真实历史，统计每个偏离水平之后 5 / 10 / 20 / 60 个交易日的
上涨或下跌概率。数据每日自动更新，部署在 Cloudflare Workers。

当前覆盖 **7 个指数，跨两个市场**：

| 市场 | 指数 | 代码 | 数据源 | 数据起点 |
| --- | --- | --- | --- | --- |
| 美股 | 标普500 | `^GSPC` | Yahoo Finance | 1950 |
| 美股 | 纳斯达克100 | `^NDX` | Yahoo Finance | 1985 |
| A 股 | 沪深300 | `000300` | 东方财富 | 2005 |
| A 股 | 中证A500 | `000510` | 东方财富 | 2005（含回溯段） |
| A 股 | 中证500 | `000905` | 东方财富 | 2005（含回溯段） |
| A 股 | 创业板指 | `399006` | 东方财富 | 2010 |
| A 股 | 科创50 | `000688` | 东方财富 | 2020（基日 2019-12-31，发布日 2020-07-23） |

数据源按市场分两条，不能共用：**Yahoo 对 A 股指数基本是「有代码无历史」**
（沪深300 只从 2021 年起、创业板指完全没有数据、科创50 只返回 1 根 K 线），
所以 A 股走东方财富 `push2his` 日线接口（`klt=101` 日线、`fqt=1` 前复权）。
东财限流时 `build-seed.mjs` 会降级到新浪 getKLineData 兜底，并在 meta 里记录实际用了哪个源。

- 框架：TanStack Start（React 19 + TanStack Router）
- 运行时：Cloudflare Workers（`@cloudflare/vite-plugin`）
- 样式：Tailwind CSS v4
- 图表：手写 SVG（无图表库依赖，SSR 友好，服务端渲染即出图）

---

## 快速开始

```bash
npm install
npm run dev          # http://localhost:3000
```

其他脚本：

```bash
npm run build        # vite build + tsc --noEmit
npm run typecheck    # 只做类型检查
npm run preview      # 用构建产物在本地跑 wrangler 预览
npm run seed         # 刷新全部指数的离线快照
npm run seed nasdaq  # 只刷新某一个（可传多个 id）
npm run deploy       # build + wrangler deploy（部署到 Cloudflare）
```

---

## 页面结构

| 路径 | 内容 |
| --- | --- |
| `/` | 总览：一行一个指数（点位 / 60 日偏离 / 200 日偏离 / 近一年走势 / 同类位置超额 / 状态） |
| `/i/$indexId` | 单指数详情，**固定 4 个区块**：当前状态、偏离度主图、概率速查、时代差异 |
| `/stats/$indexId` | 历史证据：复归速度、时期 × 阈值矩阵、历史极值样本（阈值全表在详情页「概率速查」） |
| `/method` | 偏离度定义、对数口径的理由、统计口径、数据来源、已知局限 |
| `/api/$indexId` | JSON 接口，`$indexId` 传 `all` 时一次返回全部指数 |
| `/statistics` | 旧路径，重定向到 `/stats/sp500` |

搜索参数（全部 optional + catch，脏值回落到默认值，不会报错）：

- `/i/$indexId` → `?range=5y|10y|20y|max`、`?era=all|since1970|since2000|since2010|since2016|since2019`、`?ma=dev60|dev200`
- `/stats/$indexId` → `?era=`、`?ma=`、`?horizon=5..60`

> `era` 的取值刻意做成非数字（`since2010`）。TanStack Router 默认用 `JSON.parse`
> 解析搜索参数，`"2010"` 会被解析成数字 `2010`，字符串枚举就会匹配失败。
>
> 历史分段**按市场分别定义**（`ERAS_BY_MARKET`）：美股是 `all/1970/2000/2010`，
> A 股是 `all/2010/2016/2019`。分段的意义来自该市场自身的制度变迁 ——
> 拿「1970 年后」去套沪深300（2005 年才有数据）没有意义。
> 因此 `eraById(market, id)` 必须带 market，`activeErasFor(market, firstDate)`
> 会剔除起点早于数据起点的分段。

---

## 指标定义

```
偏离度(%) = 100 × ln( 收盘价 / N 日均线 )
```

用对数而不是 `(收盘/均线 − 1)` 的原因：

1. 算术口径下 `+10%` 与 `−10%` 幅度不对称（跌 10% 后要涨 11.1% 才回本）；
2. 长周期指数涨了几十倍，对数口径下正负两侧才可比。

### 行动水位必须按指数逐个标定

水位不是拍脑袋定的，标定规则（脚本见 `.smoke/calibrate.mjs`）：
**在独立信号 ≥ 12 次的候选阈值中，取「60 日胜率相对常态超额 ≥ +3pp」的最浅一档；
若无任何档位跑赢常态，就不给水位（`null`）**。

| 指数 | 60 日水位 | 200 日水位 | 标定依据（60 日超额 / 独立信号） |
| --- | --- | --- | --- |
| 标普500 | −7% | −10% | −7% → +3.5pp / 134 次；−10% → +3.2pp / 96 次 |
| 纳斯达克综合 | 无 | 无 | 最优档位仅 +1.4pp，200 日全档位为负 |
| 沪深300 | 无 | −12% | 60 日全档位为负；−12% → +5.1pp / 39 次 |
| 中证A500 | 无 | −12% | 60 日全档位为负；−12% → +5.1pp / 36 次 |
| 中证500 | −8% | −20% | −8% → +3.1pp / 82 次；−20% → +6.9pp / 24 次 |
| 创业板指 | −8% | −14% | −8% → +8.5pp / 62 次；−14% → +10.4pp / 53 次 |

> 不分级标定是行不通的：A 股的偏离度摆幅远大于美股，`−8% / −10%` 这种统一值
> 对创业板指太浅（几乎每年触发），对纳指又毫无信息量。
> `null` 是一个**真实结论**而不是缺数据，页面会如实显示「无统计优势」，不硬凑水位。

### 常态（不设条件）才是胜率的参照系

无条件持有的胜率**不是 50%**：标普 1950 年以来 20 日 61.8% / 60 日 66.7%，
A 股宽基约 53~56%。所以「≤ −10% 时胜率 62.4%」几乎等于没有超额 ——
单看 62.4% 却很像机会。页面的概率表首行显式列出常态值，
热力底色的中性点也以常态为准（低于常态用中性灰，不染成「伪信号」色）。

---

## 加一个新指数

只需要三步，**不用写任何页面**：

1. `src/lib/indices/registry.ts` 的 `INDICES` 加一行
   （`id / market / provider / symbol / 名称 / currency / liveSince / action`）；
2. 在 `src/lib/indices/source.server.ts` 的 `SEEDS` 里补一条 `?raw` 导入；
3. `scripts/build-seed.mjs` 的 `TARGETS` 加同名条目，跑 `npm run seed <id>`。

总览页、详情页、统计页、JSON 接口、离线兜底会自动带上它。

- `market`（`us` / `cn`）决定历史分段口径与货币符号；
- `provider`（`yahoo` / `eastmoney`）决定实时取数与解析方式；
- `liveSince` 填指数**真实发布日**；填 `0` 表示不标注回溯段（美股用这个）。

> 若新指数的历史起点晚于某个时代分段（如「1970 年后」），
> 该分段会与「全部历史」完全重合 —— `activeErasFor()` 会自动把它隐藏，
> 避免表格里出现两行一模一样的数字。

### 回溯段：数据早于指数发布日的情况

中证A500 于 2024-09-23 才发布，但数据源按基日回溯算到了 2005 年；
中证500 发布日为 2007-01-15，数据同样回溯到 2005 年。这些交易日
**并非真实可交易历史**，页面会标注「含回溯段」并给出天数
（阈值：超过 250 个交易日，约一年）。

判断这段能不能用，靠一次「有没有接缝」的检验：
把**回溯段**与**真实段**分别对沪深300 算日收益相关性，看两段是否一致
（`.smoke/check-backfill.mjs`）：

```
中证A500   回溯段 0.9914   真实段 0.9886   → 无接缝，可用
中证500    回溯段 0.9153   真实段 0.9222   → 无接缝，可用
```

（中证500 的相关性整体低于 A500，是因为它是中小盘、与大盘股沪深300 本就不那么同步，
不是回溯段的问题。）同理检验过的**中证A50 被排除**：相关性从真实段 0.982
掉到回溯段 0.969，出现了接缝。

即便如此，回溯路径终究是事后构造的，严谨结论仍应以真实段为准。

---

## 数据来源与缓存

```
美股：Yahoo Finance chart API     A 股：东方财富 push2his（klt=101 / fqt=1）
        │   (symbol = ^GSPC)              │   (secid = 1.000300，1=沪 0=深)
        └──────────────┬──────────────────┘
                       ▼  成功
   实时数据 → 内存缓存 + Cloudflare Cache API（TTL 20 分钟）
                       │  失败
                       ▼
   KV `DAILY_DATA` 的 daily/<id>（上次成功抓取，持久）
                       │  再失败 / KV 为空
                       ▼
   内置离线快照 src/data/<id>-daily.csv（每个指数一份）
```

- 快照用 `?raw` 直接以文本打包进 **服务端** bundle（客户端不会带上）。
- 页面会标明当前是「实时」/「缓存」还是「离线快照」，以及数据源与市场。
  **三态都必须显式标出** —— 兜底数据冒充实时是诚实性问题。
- **为什么要有 KV 层**：内置快照是构建产物，只在重新部署时才变，所以只用它兜底
  等于「实时源挂了就一直显示上次部署那天的数据」。KV 把兜底基准改成「上次成功抓取」。
  它只在 `lastDate` 推进时才写入（免费额度 1000 写/天，不去重会到 504 写/天），
  且需要在 `wrangler.jsonc` 里绑定 `DAILY_DATA`。
- `cloudflare:workers` 的 import 带 `@ts-ignore`：模块声明来自 `wrangler types`
  生成的 `worker-configuration.d.ts`，而它在 `.gitignore` 里 —— 干净仓库没有它，
  字面量 import 会让 `tsc --noEmit` 直接挂掉。
- 日线在收盘后更新一次，20 分钟缓存足够；`/api/*` 自身还带 `s-maxage=300`。
- ⚠️ **A 股快照在交易时段刷新时，最后一根 K 线是盘中价**，会随行情变动；
  只有收盘后抓的快照才是当日定盘价。
- 东方财富对高频请求会限流，`build-seed.mjs` 里做了 6 次重试（每次退避 2.5s）
  与逐指数 700ms 间隔；全部失败时降级到新浪 getKLineData（带 4000 根截断保护）。

### 为什么数据要缓存两层

Worker 免费版每个请求的 CPU 时间很紧，而全量重算不是免费的
（单指数就是 5,000~19,000 个交易日 × 26 个阈值 × 4 个前瞻窗口，
现在有 7 个指数）。`cachedJson()` 做了「内存 → Cache API」
两级缓存，命中时几乎不耗 CPU；缓存 key 里带 indexId，各指数互不干扰。

改了统计口径务必把 `src/lib/indices/service.ts` 里的 `CACHE_VERSION` 加一，
否则旧的缓存结果会在 TTL 内继续返回，看起来像「改了没生效」。

---

## 目录结构

```
src/
  routes/
    __root.tsx           文档外壳、导航、页脚、错误/404
    index.tsx            总览（桌面表格 + 移动端卡片列表）
    i.$indexId.tsx       单指数详情（4 区块）
    stats.$indexId.tsx   历史证据（复归 / 时代矩阵 / 极值）
    statistics.tsx       旧路径 302
    method.tsx           方法说明
    api.$indexId.ts      GET /api/:indexId
  lib/
    format.ts            数字/日期格式化
    indices/
      registry.ts        指数注册表（纯元数据：market/provider/currency/action，客户端可安全引用）
      types.ts           领域类型 + 载荷类型 + ERAS_BY_MARKET / RANGES 常量
      series.ts          纯计算：解析 CSV、均线、对数偏离度、抽样、分位
      stats.ts           纯统计：阈值扫描、前瞻收益、复归速度、极值、信号、常态基准
      queries.ts         载荷拼装（同构）+ eraById/activeErasFor / buildOverviewRow
      source.server.ts   取数 + 缓存（*.server.ts = 禁止进入客户端包），双数据源分派
      service.ts         4 个 server function + alertState / alertStateAll
      search.ts          搜索参数 schema
  components/
    TimeSeriesChart.tsx  折线图（支持对数轴、区间底色、参考线、极值标注、悬停）
    HistogramChart.tsx   分布直方图
    Sparkline.tsx        迷你走势线（固定 viewBox + non-scaling-stroke，零测量）
    ThresholdTable.tsx   热力速查表 / 全表 / 时期矩阵 / 时期汇总
    Blocks.tsx           SummaryStrip（当前状态）、极值表
    ui.tsx               Card / Metric / SectionHead / Segmented / Tag / ProbBar
  data/
    <id>-daily.csv       各指数离线快照（由 scripts/build-seed.mjs 生成）
    <id>-meta.json       快照元信息
scripts/
  build-seed.mjs     抓取全量历史 → 刷新离线快照（支持指定指数，双数据源 + 重试）
  verify.mjs         独立复算脚本：重算 7 个指数的关键统计量，再跟 /api 对拍
.smoke/              本地验证脚本（仅开发用）
  check.mjs            路由冒烟：逐页断言关键内容 + JSON 接口
  weigh.mjs            统计各页可见中文量，防止「越改越啰嗦」
  overflow.mjs         找出窄屏下超宽的元素
  shots.mjs            CDP 分区截图 + 横向溢出/控制台报错检查
  calibrate.mjs        按「相对常态 60 日超额 ≥ +3pp 且独立信号 ≥ 12 次」标定行动水位
  baseline-check.mjs   验证「常态胜率不是 50%」这个前提
  check-backfill.mjs   检验 A 股回溯段与真实段对沪深300 的收益同步性有无接缝
  probe-a.mjs / probe-cn.mjs   探接口：确认 Yahoo 无 A 股历史、东方财富可取全历史
```

### 边界约定（踩过的坑）

- 所有取数、Cache API、内置快照都放在 `source.server.ts`，由 `service.ts` 在
  server function 的 handler 里**动态 import**。客户端的静态 import 图里
  绝不会出现它（构建时若泄漏会直接报错）。
- 图表用 **容器实测宽度** 做 viewBox 宽度（1 SVG 单位 = 1 CSS 像素）。
  若用固定 viewBox + 缩放，窄容器下所有文字会等比缩小到看不清。
- 对数轴的刻度值已在 log 空间算好，**不能再过一遍 `y(v)`**，否则会被二次变换
  推出画布。`TimeSeriesChart` 里因此区分了 `yOfTransformed` 与 `y`。
- 网格/弹性子项默认 `min-width: auto`，里面放 `min-w-[400px]` 的表格会把整页
  撑破。容器上加 `min-w-0`；`Card` 组件已内置。
- `dominant-baseline: middle` 在 headless Chrome 不渲染，SVG 文字统一用 `dy="0.33em"`。

---

## JSON 接口

```bash
curl -s http://localhost:3000/api/sp500 | jq
curl -s http://localhost:3000/api/all   | jq          # 一次取全部
```

```jsonc
{
  "ok": true,
  "generatedAt": "2026-09-11T03:19:01.197Z",
  "indexId": "chinext",
  "name": "创业板指",
  "market": "cn",              // us | cn
  "currency": "CNY",           // USD | CNY
  "symbol": "0.399006",
  "meta": {
    "source": "live",          // live | snapshot
    "provider": "东方财富（0.399006）",
    "firstDate": 20110330,     // 统计序列起点（已剔除 200 日均线预热期）
    "rawFirstDate": 20100601,  // 数据源原始起点
    "lastDate": 20260911,
    "tradingDays": 3757,
    "liveSince": 20100601,     // 指数真实发布日；0 = 不标注回溯段
    "backfillDays": 0          // 早于发布日、属于回溯计算的天数
  },
  "date": 20260911,
  "close": 3261.52,
  "ma60": 3646.61,
  "ma200": 3506.69,
  "dev60": -11.16,
  "dev200": -7.25,
  "flags": [
    { "key": "dev60",  "label": "60 日偏离度 ≤ -8%",  "value": -11.16, "threshold": -8,  "triggered": true },
    { "key": "dev200", "label": "200 日偏离度 ≤ -14%", "value": -7.25, "threshold": -14, "triggered": false }
  ],
  "actionable": true
}
```

`threshold` 为 `null` 表示该指数在这个口径上**没有标定出可用水位**
（如纳斯达克两个口径、沪深300 的 60 日口径），此时 `label` 会是
「（该口径无标定水位）」且 `triggered` 恒为 `false`。

`/api/all` 返回 `{ ok, count, actionable, indices: [...] }`，
其中 `actionable` 是「任意一个指数触发」的聚合结果。

可直接接 Cloudflare Cron Worker / Uptime 监控 / n8n 做告警：

```js
// Cloudflare Cron Worker 示例
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      const r = await fetch('https://<你的域名>/api/all')
      const d = await r.json()
      if (!d.ok || !d.actionable) return
      const hit = d.indices.filter((i) => i.actionable).map((i) => i.name)
      await fetch(env.WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `偏离度进入行动水位：${hit.join('、')}` }),
      })
    })())
  },
}
```

---

## 部署到 Cloudflare Workers

```bash
npx wrangler login
npm run deploy
```

`wrangler.jsonc` 已按官方方式配好：

```jsonc
{
  "name": "sp500-deviation",
  "compatibility_date": "2026-09-11",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@tanstack/react-start/server-entry"
}
```

要在推送到 GitHub 后自动部署（Workers Builds / GitHub Actions），
可直接用 `tanstack-start-cloudflare-cicd` 那套流程。

---

## 自检

```bash
npm run build
node .smoke/check.mjs            # 逐个路由断言内容 + JSON 接口
node .smoke/weigh.mjs            # 各页可见中文量（防止内容膨胀）
node .smoke/shots.mjs            # 截图 + 横向溢出 + 控制台报错（需 Chrome）
node .smoke/check-backfill.mjs   # 回溯段接缝检验
node scripts/verify.mjs          # 独立复算 7 个指数 + 与 /api 对拍
node scripts/verify.mjs --offline           # 服务没起时只做本地复算
node scripts/verify.mjs --base=http://localhost:4173
```

`scripts/verify.mjs` 不引用任何应用代码（元数据手抄一份），
用来确认页面数字没算错。对拍规则分两档：

- **已收盘的交易日 → 逐位精确**（容差 0.011）。美股两个指数走的都是这一档。
- **当天正在交易的 A 股 → 接口取到的是盘中实时价**，与快照里那一秒的价格
  天然不同，只能给容差（价格 1.5% / 偏离度 1.0pp）。

最近一次跑（2026-09-11 上午，A 股盘中）：

```
  sp500     PASS（逐位精确）   20260910  7591.70  dev60 +0.23%  dev200 +5.89%
  nasdaq    PASS（逐位精确）   20260910  26081.72 dev60 +0.26%  dev200 +6.43%
  hs300     PASS（盘中实时·容差内）   20260911  4476.29  dev60 -4.77%  dev200 -4.78%
  a500      PASS（盘中实时·容差内）   20260911  5495.23  dev60 -5.95%  dev200 -5.86%
  csi500    PASS（盘中实时·容差内）   20260911  7477.79  dev60 -7.12%  dev200 -6.91%
  chinext   PASS（盘中实时·容差内）   20260911  3278.29  dev60 -10.66% dev200 -6.74%

全部 6 个指数一致 ✓  逐位精确 2 个，盘中容差 4 个
```

同一脚本还会打印各阈值相对常态的超额，可与上面「行动水位标定表」对照复核。

数据快照抽样校验（`npm run seed` 会打印）：

- 标普500：1950-01-03 = 16.66、1987-10-19 = 224.84（黑色星期一）、
  2009-03-09 = 676.53、2020-03-23 = 2237.40
- 纳斯达克：2000-03-10 = 5048.62（互联网泡沫顶）、2002-10-09 = 1114.11
- 创业板指：2015-06-05 盘中最高 4037.96（收盘 3885.83）、
  2024-10-08 单日 +17.2%（历史级暴涨，用于确认解析没串列）
- 解析自检：A 股快照的收盘价取东方财富 klines 的第 2 列（`日期,开,收,高,低,...`），
  若误取最高价，创业板指 2015-06-05 会变成 4037.96 而不是 3885.83。

---

> 本项目为研究与教学用途，所有统计均为历史频率，不构成投资建议。
