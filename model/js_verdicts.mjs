// Verdicts from the app's own engine (frontend/src/watch/audit.js) for every
// CSV in a folder -- used by parity_check.py to compare with the Python model.
//   node model/js_verdicts.mjs model/exports
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const { parseLog, runAudit } = await import(pathToFileURL(path.join(here, '..', 'frontend', 'src', 'watch', 'audit.js')).href)

const dir = process.argv[2]
const out = {}
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.csv'))) {
  const { series } = parseLog(fs.readFileSync(path.join(dir, f), 'utf8'))
  if (series.length < 2) continue
  const a = runAudit(series, { windowDays: 2 })
  out[f] = { level: a.level, rivals: Object.fromEntries(a.rivals.map((r) => [r.name, { level: r.result.level, score: r.score }])) }
}
console.log(JSON.stringify(out))
