/**
 * Static checks for the bundle manifest and its locale dictionaries.
 *
 * Run in CI and locally before tagging:
 *
 *   node scripts/check-manifest.mjs
 *
 * It verifies the files the Host will actually load, that `dsh.bundle.patch`
 * and `dsh.client` are declared, that both `meta.detail` paths exist, and that
 * the zh/en dictionaries agree and cover every key referenced from the code.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(root, rel))

const problems = []
const report = (condition, message) => {
  if (!condition) problems.push(message)
}

// --- package.json ---------------------------------------------------------
const pkg = JSON.parse(read('package.json'))

report(pkg.name === 'dsh-xinyu-token-rate', `unexpected package name: ${pkg.name}`)
report(typeof pkg.version === 'string' && /^\d+\.\d+\.\d+/.test(pkg.version), 'version is not semver')
report(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'package.json must declare dsh.bundle.patch = ./cordis.patch.yml')
report(pkg.dsh?.client?.platform === 'web', 'dsh.client.platform must be "web"')
report(Array.isArray(pkg.dsh?.client?.inject) && pkg.dsh.client.inject.length > 0, 'dsh.client.inject must list the client modules it consumes')

for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'locale/zh.json', 'locale/en.json', 'docs/DETAIL.md', 'docs/DETAIL.zh.md', 'docs/preview.svg']) {
  report(exists(file), `missing file: ${file}`)
}

// --- cordis patch ---------------------------------------------------------
const patch = read('cordis.patch.yml')
report(/-\s*id:\s*xinyu-token-rate/.test(patch), 'cordis.patch.yml must register id xinyu-token-rate')
report(patch.includes(`'${pkg.name}'`) || patch.includes(`"${pkg.name}"`), `cordis.patch.yml must mount ${pkg.name}`)

// --- locale metadata ------------------------------------------------------
for (const lang of ['zh', 'en']) {
  const meta = JSON.parse(read(`locale/${lang}.json`)).meta
  report(Boolean(meta?.title), `locale/${lang}.json lacks meta.title`)
  report(Boolean(meta?.description), `locale/${lang}.json lacks meta.description`)
  report(exists(meta?.detail ?? ''), `locale/${lang}.json meta.detail points nowhere: ${meta?.detail}`)
}

// --- dictionaries ---------------------------------------------------------
const src = read('client.js')

function dictionary(name) {
  const start = src.indexOf(`const ${name} = {`)
  if (start < 0) return null
  const body = src.slice(start)
  const end = body.indexOf('\n    }')
  return end < 0 ? null : body.slice(0, end)
}

const zhBlock = dictionary('zh')
const enBlock = dictionary('en')
report(Boolean(zhBlock), 'cannot find the zh dictionary in client.js')
report(Boolean(enBlock), 'cannot find the en dictionary in client.js')

const keysOf = (block) => [...block.matchAll(/^\s{6}'?([a-zA-Z.]+)'?:/gm)].map((m) => m[1]).sort()

if (zhBlock && enBlock) {
  const zh = keysOf(zhBlock)
  const en = keysOf(enBlock)

  for (const key of zh) report(en.includes(key), `en dictionary is missing: ${key}`)
  for (const key of en) report(zh.includes(key), `zh dictionary is missing: ${key}`)

  // Dynamic lookups such as t('state.' + state) land here as a bare prefix.
  const prefixes = [...src.matchAll(/(?<![a-zA-Z0-9_.$])t\(\s*'([a-zA-Z.]+)'/g)]
    .map((m) => m[1])
    .filter((key) => key.endsWith('.'))

  const referenced = new Set(
    [...src.matchAll(/(?<![a-zA-Z0-9_.$])t\(\s*'([a-zA-Z.]+)'/g)]
      .map((m) => m[1])
      .filter((key) => !key.endsWith('.')),
  )

  // Conditional lookups such as t(open ? 'a' : 'b') never match the pattern
  // above, so treat any quoted key-shaped literal appearing in the file as used
  // when deciding whether a defined key is dead.
  const usedAnywhere = new Set(
    [...src.matchAll(/'([a-zA-Z]+(?:\.[a-zA-Z]+)+)'/g)].map((m) => m[1]),
  )

  for (const key of referenced) {
    report(zh.includes(key), `client.js references an undefined key: ${key}`)
  }

  const dynamicCovered = (key) => prefixes.some((prefix) => key.startsWith(prefix))
  const unused = zh.filter((key) => !referenced.has(key) && !usedAnywhere.has(key) && !dynamicCovered(key))
  if (unused.length) console.log('note: defined but never referenced:', unused.join(', '))

  console.log('locale ok · %d keys · %d referenced', zh.length, referenced.size)
}

// --- report ---------------------------------------------------------------
if (problems.length) {
  console.error('')
  for (const problem of problems) console.error('✗', problem)
  console.error('')
  console.error('%d problem(s)', problems.length)
  process.exit(1)
}

console.log('manifest ok · %s v%s', pkg.name, pkg.version)
