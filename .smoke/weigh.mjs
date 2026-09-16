/**
 * 量化「页面到底有多少字」：统计渲染后 HTML 里的中文字符数。
 * 用来对比精简前后的信息密度，避免只看源码行数自欺欺人。
 *
 * 分三个口径：
 *   all   —— 含 title 悬停提示等属性
 *   text  —— 只算真正的文本节点（剥掉所有标签及其属性）
 *   fold  —— text 里属于 <details> 折叠内容的字数
 */
const B = process.env.BASE ?? 'http://localhost:3000'

const PATHS = [
  '/',
  '/i/sp500',
  '/i/nasdaq',
  '/i/hs300',
  '/i/a500',
  '/i/csi500',
  '/i/chinext',
  '/stats/sp500',
  '/stats/hs300',
  '/method',
]

for (const path of PATHS) {
  const html = await (await fetch(B + path)).text()
  const body = html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')

  const all = (body.match(/[\u4e00-\u9fa5]/g) || []).length

  // <details> 内部单独统计，再从正文里剔除
  const folds = body.match(/<details[\s\S]*?<\/details>/g) || []
  const foldCjk = folds.reduce(
    (n, f) => n + ((f.replace(/<[^>]*>/g, '').match(/[\u4e00-\u9fa5]/g) || []).length),
    0,
  )
  const withoutFold = body.replace(/<details[\s\S]*?<\/details>/g, '')
  const text = (withoutFold.replace(/<[^>]*>/g, '').match(/[\u4e00-\u9fa5]/g) || []).length

  console.log(
    path.padEnd(15) +
      ' 正文可见 ' +
      String(text).padStart(4) +
      '   折叠内 ' +
      String(foldCjk).padStart(4) +
      '   含属性 ' +
      String(all).padStart(5),
  )
}
