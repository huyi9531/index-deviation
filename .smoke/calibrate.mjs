/**
 * 行动水位标定（**只读，不写任何文件**）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 规则（2026-09 重做；旧版是「20 日绝对胜率」口径，已废弃）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 全样本口径：候选阈值中，满足下列**全部**条件的**最浅**一档 ——
 *   ① 60 日前瞻胜率相对「同窗口常态基线」的超额，其置信下界 ≥ ciGate pp
 *   ② 超额点估计 ≥ minExcess pp
 *   ③ 独立信号 ≥ minEpisodes 段
 *   （比例与计数都按「独立信号」口径：连续命中只算一次，取首次触达日）
 *
 * 样本外门槛（决定能不能标 robust）：
 *   ④ 按交易日数对半切：前半段必须也能选出某一档（说明信号在前半段存在）
 *   ⑤ 后半段用**全样本选出的那一档**复核 —— 强度由 `--oos` 决定：
 *        strict（默认）：点估计 ≥ minExcess、≥ minEpisodes 段、置信下界 ≥ 0
 *        sign          ：只需点估计 > 0 且 ≥ minEpisodes 段（不翻负）
 *        off           ：不复核
 *
 * 当前时代复核（全样本标不出时才走）：
 *   ⑥ 用该市场**最后一个时代**的窗口重跑 ①②③，再在时代窗口内做一次 ⑤ 复核
 *
 * 分级：
 *   robust  = 全样本达标 且 ④⑤ 都过
 *   fragile = 全样本达标但样本外不过（后半段翻负，或前半段根本标不出）
 *   eraOnly = 全样本不达标，但 ⑥ 过（只在当前时代成立，UI 必须标出来）
 *   none    = 都不过 → 如实留空，UI 显示「无统计优势」，不硬凑数字
 *
 * ⚠️ **门槛是可调的，因为默认值（ciGate=3）非常严**：只有 12~30 段独立信号时，
 *    置信区间半宽就有 ±20~30pp，要求「下界 ≥ +3pp」等于要求超额 ≥ 25pp ——
 *    结果是它系统性地**选中最深的那一档**（与「取最浅档」的意图相反），
 *    产品会几乎永不触发。跑 `--scenarios` 看不同门槛各剩多少格再决定。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 用法
 * ══════════════════════════════════════════════════════════════════════
 *   node .smoke/calibrate.mjs                    # 报告：重标结果 + 新旧对照
 *   node .smoke/calibrate.mjs --grade-current    # 不改数值，只给 registry 现值定级
 *   node .smoke/calibrate.mjs --scenarios        # 几套门槛各剩多少格（决策用）
 *   node .smoke/calibrate.mjs --check            # 断言 registry 现值与本规则一致
 *   node .smoke/calibrate.mjs --json             # 机器可读
 *   node .smoke/calibrate.mjs --ci-gate=0 --oos=sign   # 调门槛后重跑报告
 *
 * ⚠️ 本脚本**不 import 应用代码**（与 scripts/verify.mjs 同理），统计原语是手抄的，
 *    与 src/lib/indices/stats.ts 同式 —— 改动请同步两处。这样做的代价是可能漂移，
 *    所以 `--check` 会拿 registry 的**现值**对拍，一旦口径漂了就会响。
 *    时代断点也是手抄的（见 ERA_START），真相来源是 src/lib/indices/types.ts。
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const DATA = resolve(process.cwd(), 'src/data')
const REGISTRY = resolve(process.cwd(), 'src/lib/indices/registry.ts')

/** [id, 中文名, market]。market 决定「当前时代」窗口，见 ERA_START */
const LIST = [
  ['sp500', '标普500', 'us'],
  ['nasdaq', '纳斯达克100', 'us'],
  ['hs300', '沪深300', 'cn'],
  ['a500', '中证A500', 'cn'],
  ['csi500', '中证500', 'cn'],
  ['chinext', '创业板指', 'cn'],
  ['star50', '科创50', 'cn'],
  ['hsi', '恒生指数', 'hk'],
  ['hstech', '恒生科技', 'hk'],
  ['n225', '日经225', 'jp'],
]

/** 各市场**最后一个时代**的起点（手抄自 types.ts 的 ERAS_BY_MARKET 末项） */
const ERA_START = { us: 20100101, cn: 20190101, hk: 20180101, jp: 20130101 }

const DEV60 = [-4, -5, -6, -7, -8, -9, -10, -12, -15, -18]
const DEV200 = [-6, -8, -10, -12, -14, -16, -18, -20, -25, -30]

const THRESHOLDS = { dev60: DEV60, dev200: DEV200 }

// ── CLI ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const flag = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? dflt : hit.slice(name.length + 3)
}
const RULE = {
  horizon: 60,
  minExcess: Number(flag('min-excess', 3)),
  minEpisodes: Number(flag('min-episodes', 12)),
  ciGate: flag('ci-gate', '3') === 'off' ? Number.NEGATIVE_INFINITY : Number(flag('ci-gate', 3)),
  oos: flag('oos', 'strict'),
  z: 1.96,
}
const MODE = argv.includes('--check')
  ? 'check'
  : argv.includes('--json')
    ? 'json'
    : argv.includes('--grade-current')
      ? 'grade'
      : argv.includes('--scenarios')
        ? 'scenarios'
        : 'report'

// ── 统计原语（手抄自 src/lib/indices/stats.ts，改动同步两处）─────────────────

function sma(v, w) {
  const out = new Array(v.length).fill(NaN)
  let sum = 0
  for (let i = 0; i < v.length; i++) {
    sum += v[i]
    if (i >= w) sum -= v[i - w]
    if (i >= w - 1) out[i] = sum / w
  }
  return out
}

function buildSeries(dates, closes) {
  const ma60 = sma(closes, 60)
  const ma200 = sma(closes, 200)
  const D = []
  const C = []
  const V60 = []
  const V200 = []
  for (let i = 0; i < closes.length; i++) {
    if (Number.isNaN(ma60[i]) || Number.isNaN(ma200[i])) continue
    D.push(dates[i])
    C.push(closes[i])
    V60.push(100 * Math.log(closes[i] / ma60[i]))
    V200.push(100 * Math.log(closes[i] / ma200[i]))
  }
  return { dates: D, close: C, dev60: V60, dev200: V200 }
}

function indexOfDate(dates, ymd) {
  let lo = 0
  let hi = dates.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (dates[mid] < ymd) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Wilson 得分区间。p 是比例，n 是**独立观测数**。与 stats.ts 的 wilsonInterval 同式 */
function wilsonInterval(p, n, z = RULE.z) {
  if (n <= 0 || !Number.isFinite(p)) return [NaN, NaN]
  const z2 = z * z
  const denom = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return [Math.max(0, center - half), Math.min(1, center + half)]
}

/** Newcombe 比例差区间（method 10）。与 stats.ts 的 newcombeDiff 同式 */
function newcombeDiff(p1, n1, p0, n0, z = RULE.z) {
  if (n1 <= 0 || n0 <= 0 || !Number.isFinite(p1) || !Number.isFinite(p0)) return [NaN, NaN]
  const [l1, u1] = wilsonInterval(p1, n1, z)
  const [l0, u0] = wilsonInterval(p0, n0, z)
  return [
    p1 - p0 - Math.sqrt((p1 - l1) ** 2 + (u0 - p0) ** 2),
    p1 - p0 + Math.sqrt((u1 - p1) ** 2 + (p0 - l0) ** 2),
  ]
}

// ── 统计口径 ────────────────────────────────────────────────────────────

/**
 * 常态基线。
 * 胜率按**交易日**算（与页面上的「常态」一致，用户看到的那个数就是它）；
 * 但**独立观测数按非重叠块折算**（h 日的前瞻收益彼此高度重叠，直接拿交易日数当 n
 * 会把基线的不确定性压得几乎为零、区间假窄）。
 */
function baseline(s, from, to, h) {
  let n = 0
  let w = 0
  for (let i = from; i + h < to; i++) {
    n++
    if (s.close[i + h] / s.close[i] - 1 > 0) w++
  }
  const win = n ? w / n : NaN
  const nEff = Math.max(1, Math.floor((to - from) / h))
  return { win, nEff }
}

/**
 * 扫描一个阈值。
 *
 * **点估计按交易日加权**（满足条件的每一天都算）—— 回答「处于这个状态下平均会怎样」，
 * 与页面、与方法页、与历史上已发布的全部数字同口径。
 *
 * ⚠️ **不要用「每段只取首次触达日」当点估计**：首次触达日永远是那一段里**最浅**的
 * 一天（刚跨过阈值），而段内更深的日子历史上反弹更好 —— 它回答的是「恰好在穿越那天
 * 买入」，能翻转 10 格里 5~6 格的样本外结论（2026-09 实测）。
 * 段数只用于两处：独立信号门槛，以及**置信区间的样本量**（同一段内观测高度相关，
 * 拿交易日当 n 会把区间压得假窄）。
 */
function scan(s, key, from, to, threshold) {
  const dev = s[key]
  const h = RULE.horizon
  let episodes = 0
  let episodesWithFwd = 0
  let days = 0
  let wins = 0
  for (let i = from; i < to; i++) {
    if (dev[i] > threshold) continue
    const isNew = !(i > from && dev[i - 1] <= threshold)
    if (isNew) episodes++
    const j = i + h
    if (j >= s.close.length) continue
    days++
    if (s.close[j] / s.close[i] - 1 > 0) wins++
    if (isNew) episodesWithFwd++
  }
  return { episodes, episodesWithFwd, days, wins, win: days ? wins / days : NaN }
}

/** 在一个窗口上评估某个阈值：超额点估计 + 置信区间 + 是否达标 */
function evaluate(s, key, from, to, threshold) {
  const base = baseline(s, from, to, RULE.horizon)
  const r = scan(s, key, from, to, threshold)
  const excessPp =
    Number.isFinite(r.win) && Number.isFinite(base.win) ? (r.win - base.win) * 100 : NaN
  const ci = newcombeDiff(r.win, r.episodesWithFwd, base.win, base.nEff).map((x) => x * 100)
  const passes =
    r.episodes >= RULE.minEpisodes &&
    Number.isFinite(excessPp) &&
    excessPp >= RULE.minExcess &&
    ci[0] >= RULE.ciGate
  return {
    threshold,
    episodes: r.episodes,
    days: r.days,
    win: r.win,
    baseWin: base.win,
    excessPp,
    ci,
    passes,
  }
}

/** 在一个窗口上选档：由浅到深，取第一个达标的 */
function selectLevel(s, key, from, to) {
  for (const t of THRESHOLDS[key]) {
    const e = evaluate(s, key, from, to, t)
    if (e.passes) return e
  }
  return null
}

/** 样本外复核：后段用给定档位。强度由 RULE.oos 决定 */
function validateOutOfSample(s, key, from, to, threshold) {
  const e = evaluate(s, key, from, to, threshold)
  const ok =
    RULE.oos === 'off'
      ? true
      : RULE.oos === 'sign'
        ? e.episodes >= RULE.minEpisodes && e.excessPp > 0
        : e.episodes >= RULE.minEpisodes && e.excessPp >= RULE.minExcess && e.ci[0] >= 0
  return { ...e, ok }
}

/**
 * 给**指定档位**定级（用于 --grade-current：不改数值，只看现有水位站不站得住）。
 */
function gradeLevel(s, key, market, level) {
  const to = s.dates.length
  const mid = Math.floor(to / 2)
  const full = evaluate(s, key, 0, to, level)
  const firstSel = selectLevel(s, key, 0, mid)
  const eraFrom = indexOfDate(s.dates, ERA_START[market])

  if (full.passes) {
    const second = validateOutOfSample(s, key, mid, to, level)
    const robust = firstSel !== null && second.ok
    return { grade: robust ? 'robust' : 'fragile', full, firstSel, second, era: null }
  }

  const eraFull = evaluate(s, key, eraFrom, to, level)
  const eraMid = eraFrom + Math.floor((to - eraFrom) / 2)
  const eraSecond = eraFull.passes ? validateOutOfSample(s, key, eraMid, to, level) : null
  const eraOk = eraFull.passes && eraSecond.ok
  return {
    grade: eraOk ? 'eraOnly' : 'none',
    full,
    firstSel,
    second: null,
    era: { fromIdx: eraFrom, fromDate: s.dates[eraFrom], full: eraFull, second: eraSecond, ok: eraOk },
  }
}

/** 完整标定一个指数的某个口径：先选档，再定级 */
function calibrate(s, key, market) {
  const to = s.dates.length
  const eraFrom = indexOfDate(s.dates, ERA_START[market])
  const picked = selectLevel(s, key, 0, to) ?? selectLevel(s, key, eraFrom, to)
  const oosBackup = RULE.oos
  // 定级一律用严格样本外（`--oos` 只影响选档时的复核），这样不同门槛方案之间可比
  RULE.oos = 'strict'
  const g = picked
    ? gradeLevel(s, key, market, picked.threshold)
    : {
        grade: 'none',
        full: null,
        firstSel: selectLevel(s, key, 0, Math.floor(to / 2)),
        second: null,
        era: null,
      }
  RULE.oos = oosBackup
  return { level: g.grade === 'none' ? null : picked.threshold, ...g }
}

// ── 读数据 ──────────────────────────────────────────────────────────────

async function loadSeries(id) {
  const csv = await readFile(resolve(DATA, `${id}-daily.csv`), 'utf8')
  const dates = []
  const closes = []
  for (const raw of csv.split('\n')) {
    const l = raw.trim()
    if (!l) continue
    const p = l.split(',')
    const d = Number(p[0])
    const c = Number(p[1])
    if (!Number.isInteger(d) || !Number.isFinite(c) || c <= 0) continue
    dates.push(d)
    closes.push(c)
  }
  return buildSeries(dates, closes)
}

/** 从 registry.ts 里读出**现值**（正则扫描；不 import，因为它是 TS） */
async function readRegistry() {
  const src = await readFile(REGISTRY, 'utf8')
  const out = {}
  const re = /id: '(\w+)',[\s\S]{0,4000}?action: \{ dev60: (null|-?[\d.]+), dev200: (null|-?[\d.]+) \}/g
  for (const m of src.matchAll(re)) {
    out[m[1]] = {
      dev60: m[2] === 'null' ? null : Number(m[2]),
      dev200: m[3] === 'null' ? null : Number(m[3]),
    }
  }
  return out
}

// ── 主流程 ──────────────────────────────────────────────────────────────

const registry = await readRegistry()
const series = {}
const results = {}
for (const [id, cn, market] of LIST) {
  const s = await loadSeries(id)
  series[id] = s
  results[id] = {
    cn,
    market,
    days: s.dates.length,
    first: s.dates[0],
    last: s.dates[s.dates.length - 1],
  }
  for (const key of ['dev60', 'dev200']) {
    const cur = registry[id]?.[key] ?? null
    if (MODE === 'grade') {
      // 数值不动，只看它按当前门槛站不站得住
      results[id][key] =
        cur === null
          ? { level: null, grade: 'none', full: null, firstSel: null, second: null, era: null }
          : { ...gradeLevel(s, key, market, cur), level: cur }
    } else {
      results[id][key] = calibrate(s, key, market)
    }
  }
}

const GRADE_LABEL = { robust: 'robust ', eraOnly: 'eraOnly', fragile: 'fragile', none: 'none   ' }
const fmtLvl = (v) => (v === null ? 'null' : `${v}%`).padStart(6)
const fmtPp = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}` : '—').padStart(7)
const fmtCi = (ci) => (Number.isFinite(ci[0]) ? `${ci[0].toFixed(1)}~${ci[1].toFixed(1)}` : '—')

if (MODE === 'json') {
  console.log(
    JSON.stringify(
      Object.fromEntries(
        LIST.map(([id]) => [
          id,
          {
            dev60: { level: results[id].dev60.level, grade: results[id].dev60.grade },
            dev200: { level: results[id].dev200.level, grade: results[id].dev200.grade },
          },
        ]),
      ),
      null,
      2,
    ),
  )
  process.exit(0)
}

if (MODE === 'scenarios') {
  const SCENARIOS = [
    ['A 计划原案：CI下界≥+3 且超额≥+3 且≥12段', { minExcess: 3, ciGate: 3 }],
    ['B 显著性门槛放到 0：CI下界≥0', { minExcess: 3, ciGate: 0 }],
    ['C 不做显著性检验，只看幅度≥+3pp', { minExcess: 3, ciGate: 'off' }],
    ['D 同 C 但幅度门槛提到 +5pp', { minExcess: 5, ciGate: 'off' }],
    ['E 现行 registry 口径（点估计≥+3）', { minExcess: 3, ciGate: 'off' }],
  ]
  console.log('门槛方案对比（每格 = 一个指数的某个口径，共 20 格）')
  console.log('选档按各行门槛；**定级一律用严格样本外复核**，所以各行可比\n')
  console.log('方案'.padEnd(40) + ' 有水位  样本外通过  eraOnly  fragile  无水位')
  console.log('─'.repeat(78))
  for (const [name, cfg] of SCENARIOS) {
    Object.assign(RULE, {
      minExcess: cfg.minExcess,
      minEpisodes: 12,
      ciGate: cfg.ciGate === 'off' ? Number.NEGATIVE_INFINITY : cfg.ciGate,
    })
    const counts = { total: 0, robust: 0, eraOnly: 0, fragile: 0, none: 0 }
    for (const [id, , market] of LIST) {
      for (const key of ['dev60', 'dev200']) {
        const r = calibrate(series[id], key, market)
        counts.total++
        counts[r.grade] += 1
      }
    }
    const have = counts.total - counts.none
    console.log(
      name.padEnd(40) +
        ` ${String(have).padStart(5)}  ${String(counts.robust).padStart(9)}  ${String(counts.eraOnly).padStart(7)}  ${String(counts.fragile).padStart(7)}  ${String(counts.none).padStart(6)}`,
    )
  }
  console.log('\n注：A 是本计划原本的规则。C/D 不做显著性检验 —— 选出的水位只是「历史频率」，')
  console.log('    不构成统计显著的优势；fragile 那些在样本外复核里已经翻负。')
  console.log('    现行 registry 的 20 格用 --grade-current 看它们各自站不站得住。')
  process.exit(0)
}

if (MODE === 'check') {
  let bad = 0
  console.log('═══ registry 现值 vs 本规则重算 ═══')
  console.log(
    `规则：超额 ≥ ${RULE.minExcess}pp，CI 下界 ≥ ${RULE.ciGate === Number.NEGATIVE_INFINITY ? 'off' : RULE.ciGate}pp，≥ ${RULE.minEpisodes} 段，样本外 ${RULE.oos}\n`,
  )
  for (const [id, cn] of LIST) {
    for (const key of ['dev60', 'dev200']) {
      const cur = registry[id]?.[key] ?? null
      const got = results[id][key].level
      const grade = results[id][key].grade
      const ok = cur === got
      if (!ok) bad++
      console.log(
        `${ok ? 'OK  ' : 'FAIL'} ${cn.padEnd(11)} ${key.padEnd(7)} registry ${fmtLvl(cur)}  规则 ${fmtLvl(got)}  (${GRADE_LABEL[grade]})`,
      )
    }
  }
  console.log(
    bad === 0
      ? '\n全部一致 ✓'
      : `\n有 ${bad} 格与规则不一致 —— 若刚改过门槛，这是预期的（替换 registry 是单独一步）`,
  )
  process.exit(bad === 0 ? 0 : 1)
}

// ── report / grade ──────────────────────────────────────────────────────

const title =
  MODE === 'grade' ? '现有水位定级（数值不动，只看站不站得住）' : '行动水位重标报告（只读，未写入 registry）'
console.log('═'.repeat(100))
console.log(title)
console.log(
  `规则：超额 ≥ ${RULE.minExcess}pp，CI 下界 ≥ ${RULE.ciGate === Number.NEGATIVE_INFINITY ? '不做检验' : `${RULE.ciGate}pp`}，独立信号 ≥ ${RULE.minEpisodes} 段，样本外 ${RULE.oos}`,
)
console.log('═'.repeat(100))

for (const [id, cn] of LIST) {
  const r = results[id]
  console.log(`\n${cn} (${id}, ${r.market})   ${r.days} 个交易日  ${r.first} → ${r.last}`)
  for (const key of ['dev60', 'dev200']) {
    const c = r[key]
    const cur = registry[id]?.[key] ?? null
    const mark = MODE === 'grade' ? '' : cur === c.level ? '' : `   ⚠️ registry 现值 ${fmtLvl(cur)}`
    console.log(`  ${key}  → ${fmtLvl(c.level)}   ${GRADE_LABEL[c.grade]}${mark}`)
    if (c.full) {
      console.log(
        `      全样本：超额 ${fmtPp(c.full.excessPp)}pp  区间 ${fmtCi(c.full.ci)}  ${c.full.episodes} 段  ${c.full.passes ? '✓ 达标' : '✗ 不达标'}`,
      )
      if (c.second) {
        console.log(
          `      前半段选档：${c.firstSel ? `${c.firstSel.threshold}%（超额 ${fmtPp(c.firstSel.excessPp)}pp, ${c.firstSel.episodes} 段）` : '标不出水位'}`,
        )
        console.log(
          `      后半段复核：超额 ${fmtPp(c.second.excessPp)}pp  区间 ${fmtCi(c.second.ci)}  ${c.second.episodes} 段  ${c.second.ok ? '✓ 通过' : '✗ 未通过'}`,
        )
      }
    } else {
      console.log('      全样本：无档位达标')
    }
    if (c.era) {
      console.log(
        `      当前时代窗口（自 ${c.era.fromDate} 起）：超额 ${fmtPp(c.era.full.excessPp)}pp  区间 ${fmtCi(c.era.full.ci)}  ${c.era.full.episodes} 段  ${c.era.full.passes ? '✓ 达标' : '✗ 不达标'}`,
      )
      console.log(
        `      时代窗口内后半段复核：${c.era.second ? `${c.era.second.ok ? '✓ 通过' : '✗ 未通过'}（超额 ${fmtPp(c.era.second.excessPp)}pp）` : '未做'}`,
      )
    }
    if (!c.full && !c.era) console.log('      全样本与当前时代窗口都无档位达标')
  }
}

console.log(`\n${'═'.repeat(100)}`)
console.log('汇总（robust = 全样本+样本外都过；eraOnly = 仅当前时代成立；fragile = 全样本过但样本外翻负；none = 无水位）')
console.log('  指数           dev60 现值→新值     grade     dev200 现值→新值     grade')
for (const [id, cn] of LIST) {
  const cell = (key) => {
    const c = results[id][key]
    return `${fmtLvl(registry[id]?.[key] ?? null)} →${fmtLvl(c.level)}  ${GRADE_LABEL[c.grade]}`
  }
  console.log(`  ${cn.padEnd(11)}  ${cell('dev60')}  ${cell('dev200')}`)
}
console.log('\n⚠️ 本脚本不写 registry。替换是单独一步：先确认报告，再改 registry 的 action 与 EVIDENCE 表。')
