/**
 * Extract recorded DeepSeek Harness sessions into plain JSONL for the benches.
 *
 * The benches score the shipped estimator against what the provider actually
 * reported, so they need real session logs. The Host stores them compressed:
 *
 *   $DSH_HOME/sessions/<project-slug>/<session-id>/session.v4.jsonl.zst
 *
 * This script walks that tree, decompresses every session log it finds and
 * writes the plain `.jsonl` files into `./.sessions` (git-ignored, never
 * committed — they contain your conversations).
 *
 *   node scripts/extract-sessions.mjs                 # uses $DSH_HOME or ~/.dsh
 *   node scripts/extract-sessions.mjs --home /path    # explicit DSH_HOME
 *   node scripts/extract-sessions.mjs --out /tmp/sess # explicit output dir
 *
 * Decompression needs `zstd` on PATH (macOS: `brew install zstd`). Files that
 * are already plain `.jsonl` are copied through unchanged.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}

const home = flag('home', process.env.DSH_HOME || path.join(os.homedir(), '.dsh'))
const out = flag('out', path.join(here, '..', '.sessions'))
const sessions = path.join(home, 'sessions')

if (!fs.existsSync(sessions)) {
  console.error('no session directory at', sessions)
  console.error('pass --home <DSH_HOME> if your installation lives elsewhere')
  process.exit(1)
}

fs.mkdirSync(out, { recursive: true })

const hasZstd = (() => {
  try {
    execFileSync('zstd', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

let written = 0
let skipped = 0

for (const slug of fs.readdirSync(sessions)) {
  const slugDir = path.join(sessions, slug)
  if (!fs.statSync(slugDir).isDirectory()) continue

  for (const session of fs.readdirSync(slugDir)) {
    const dir = path.join(slugDir, session)
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue

    for (const file of fs.readdirSync(dir)) {
      const from = path.join(dir, file)
      if (!fs.statSync(from).isFile()) continue

      const base = path.join(out, `${slug}__${session}__${file}`.replace(/[^\w.@-]+/g, '_'))
      const target = base.replace(/\.zst[ds]?$/, '').endsWith('.jsonl') ? base.replace(/\.zst[ds]?$/, '') : base.replace(/\.zst[ds]?$/, '') + '.jsonl'

      if (file.endsWith('.jsonl')) {
        fs.copyFileSync(from, target)
        written += 1
        continue
      }

      if (!/\.(jsonl\.)?zst[ds]?$/.test(file)) {
        skipped += 1
        continue
      }

      if (!hasZstd) {
        console.error('zstd is required to decompress session logs (brew install zstd)')
        process.exit(1)
      }

      const text = execFileSync('zstd', ['-dc', from], { maxBuffer: 512 * 1024 * 1024 })
      fs.writeFileSync(target.replace(/\.zst[ds]?$/, ''), text)
      written += 1
    }
  }
}

console.log('sessions written %d, other files skipped %d', written, skipped)
console.log('output           %s', out)
console.log('next             SESS_DIR=%s npm run bench', out)
