import * as esbuild from 'esbuild'
try {
  await esbuild.build({
    entryPoints: ['.smoke/_stockprobe/entry.ts'],
    bundle: true, platform: 'node', format: 'esm',
    outfile: '.smoke/_stockprobe/lib.mjs',
  })
  console.log('打包成功')
} catch (e) {
  for (const err of e.errors ?? []) {
    console.log(`  ${err.text}`)
    console.log(`     ${err.location?.file}:${err.location?.line}:${err.location?.column}`)
    if (err.location?.lineText) console.log(`     > ${err.location.lineText.trim()}`)
  }
}
