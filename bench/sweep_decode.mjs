/**
 * Second sweep: does a decode-window model beat the share model, and does it
 * still hold when the coefficients are fitted on one half of the sessions and
 * scored on the other?
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SESS = process.env.SESS_DIR || fileURLToPath(new URL('../.sessions', import.meta.url))
const median = list => {
  if (list.length === 0) return null
  const s = [...list].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]
}
const q = (list, r) => { const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * r))] }

function readSession(file) {
  const steps = new Map()
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line === '') continue
    let row
    try { row = JSON.parse(line) } catch { continue }
    if (row.type === 'step/start') { steps.set(row.data.turn + ':' + row.data.step, { start: row.time }); continue }
    if (row.type !== 'assistant/message') continue
    const step = steps.get(row.data.turn + ':' + row.data.step)
    if (step === undefined) continue
    let first = null
    for (const event of row.data.stream ?? []) {
      const type = String(event?.type ?? '')
      if (type.endsWith('-chunks') && event.time0 !== undefined) first = first === null ? event.time0 : Math.min(first, event.time0)
      else if (type === 'chunk' && event.time !== undefined) first = first === null ? event.time : Math.min(first, event.time)
    }
    const output = row.data.usage?.outputTokens ?? 0
    if (first === null || output <= 0) continue
    step.output = output
    step.first = first
    step.done = row.time
    const u = row.data.usage ?? {}
    step.prompt = (u.uncachedInputTokens ?? u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0)
    // Reasoning may decode at a different speed than visible text.
    let reasoning = 0
    let text = 0
    for (const event of row.data.stream ?? []) {
      const type = String(event?.type ?? '')
      if (type === 'reasoning-chunks') reasoning += (event.texts ?? []).join('').length
      else if (type === 'text-chunks') text += (event.texts ?? []).join('').length
    }
    step.rShare = reasoning + text === 0 ? 0 : reasoning / (reasoning + text)
  }
  const list = [...steps.values()].filter(s => s.output > 0 && s.first !== undefined && s.done !== undefined).sort((a, b) => a.start - b.start)
  return list.length < 4 ? null : list
}

const sessions = []
for (const name of fs.readdirSync(SESS)) {
  if (!name.endsWith('.jsonl')) continue
  const steps = readSession(path.join(SESS, name))
  if (steps !== null) sessions.push(steps)
}

const rows = []
const rowsBySession = []
for (const steps of sessions) {
  const mine = []
  rowsBySession.push(mine)
  for (const step of steps) {
    const truth = step.done - step.first
    const span = step.done - step.start
    if (truth < 400 || step.output < 20 || span <= 0) continue
    const row = { output: step.output, span, prompt: Math.max(1, step.prompt), rShare: step.rShare, truth }
    rows.push(row)
    mine.push(row)
  }
}

function solve(features, ys) {
  const n = features[0].length
  const m = Array.from({ length: n }, () => new Array(n + 1).fill(0))
  for (let i = 0; i < features.length; i += 1) {
    for (let a = 0; a < n; a += 1) {
      for (let b = 0; b < n; b += 1) m[a][b] += features[i][a] * features[i][b]
      m[a][n] += features[i][a] * ys[i]
    }
  }
  for (let col = 0; col < n; col += 1) {
    let pivot = col
    for (let r = col + 1; r < n; r += 1) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r
    ;[m[col], m[pivot]] = [m[pivot], m[col]]
    const div = m[col][col]
    for (let k = col; k <= n; k += 1) m[col][k] /= div
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue
      const f = m[r][col]
      for (let k = col; k <= n; k += 1) m[r][k] -= f * m[col][k]
    }
  }
  return m.map(row => row[n])
}

const fitLog = (subset, fn) => solve(subset.map(fn.x), subset.map(r => Math.log(fn.y(r))))

const models = {
  'share(out)': rows => fitLog(rows, { x: r => [1, Math.log(r.output)], y: r => r.truth / r.span }),
  'share(out,prompt)': rows => fitLog(rows, { x: r => [1, Math.log(r.output), Math.log(r.prompt)], y: r => r.truth / r.span }),
  'share(out,prompt,reason)': rows => fitLog(rows, { x: r => [1, Math.log(r.output), Math.log(r.prompt), r.rShare], y: r => r.truth / r.span }),
  'decode(span,out,prompt)': rows => fitLog(rows, { x: r => [1, Math.log(r.span), Math.log(r.output), Math.log(r.prompt)], y: r => r.truth }),
  'decode(span,out,prompt,reason)': rows => fitLog(rows, { x: r => [1, Math.log(r.span), Math.log(r.output), Math.log(r.prompt), r.rShare], y: r => r.truth }),
}

const predict = {
  'share(out)': (c, r) => r.span * Math.exp(c[0] + c[1] * Math.log(r.output)),
  'share(out,prompt)': (c, r) => r.span * Math.exp(c[0] + c[1] * Math.log(r.output) + c[2] * Math.log(r.prompt)),
  'share(out,prompt,reason)': (c, r) => r.span * Math.exp(c[0] + c[1] * Math.log(r.output) + c[2] * Math.log(r.prompt) + c[3] * r.rShare),
  'decode(span,out,prompt)': (c, r) => Math.exp(c[0] + c[1] * Math.log(r.span) + c[2] * Math.log(r.output) + c[3] * Math.log(r.prompt)),
  'decode(span,out,prompt,reason)': (c, r) => Math.exp(c[0] + c[1] * Math.log(r.span) + c[2] * Math.log(r.output) + c[3] * Math.log(r.prompt) + c[4] * r.rShare),
}

const score = (label, coefs, subset, model) => {
  const errors = []
  let threefold = 0
  for (const row of subset) {
    const decode = Math.min(row.span * 0.95, Math.max(row.span * 0.03, predict[model](coefs, row)))
    const rate = row.output / (decode / 1000)
    const truth = row.output / (row.truth / 1000)
    errors.push(Math.abs(rate - truth) / truth)
    if (rate / truth > 3 || truth / rate > 3) threefold += 1
  }
  console.log('%s %s  median %s  p75 %s  p90 %s  >3x %s',
    label.padEnd(30), '  ',
    (median(errors) * 100).toFixed(1).padStart(5) + '%',
    (q(errors, 0.75) * 100).toFixed(1).padStart(5) + '%',
    (q(errors, 0.9) * 100).toFixed(1).padStart(5) + '%',
    (threefold / errors.length * 100).toFixed(1).padStart(5) + '%')
}

console.log('rows %d sessions %d', rows.length, sessions.length)
console.log('\n-- in-sample --')
for (const [name, fit] of Object.entries(models)) score(name, fit(rows), rows, name)

console.log('\n-- cross-validated by session (even sessions fit, odd sessions score) --')
const evenRows = rowsBySession.filter((_, i) => i % 2 === 0).flat()
const oddRows = rowsBySession.filter((_, i) => i % 2 === 1).flat()
console.log('fit rows %d  score rows %d', evenRows.length, oddRows.length)
for (const [name, fit] of Object.entries(models)) {
  const coefs = fit(evenRows)
  score(name, coefs, oddRows, name)
}
