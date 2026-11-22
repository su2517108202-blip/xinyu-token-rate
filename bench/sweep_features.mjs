/**
 * Feature sweep for the replay decode model, scored with leave-session-out CV
 * so the shipped coefficients are not fitted to the sessions they are scored on.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SESS = process.env.SESS_DIR || fileURLToPath(new URL('../.sessions', import.meta.url))
const median = l => { if (!l.length) return null; const s = [...l].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const q = (l, r) => { const s = [...l].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * r))] }

function readSession(file) {
  const steps = new Map()
  const order = []
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line === '') continue
    let row
    try { row = JSON.parse(line) } catch { continue }
    if (row.type === 'step/start') {
      steps.set(row.data.turn + ':' + row.data.step, { turn: row.data.turn, step: row.data.step, start: row.time })
      order.push(row.data.turn + ':' + row.data.step)
      continue
    }
    if (row.type !== 'assistant/message') continue
    const st = steps.get(row.data.turn + ':' + row.data.step)
    if (st === undefined) continue
    let first = null
    let text = 0
    let reasoning = 0
    let toolArgs = 0
    for (const ev of row.data.stream ?? []) {
      const t = String(ev?.type ?? '')
      if (t.endsWith('-chunks') && ev.time0 !== undefined) first = first === null ? ev.time0 : Math.min(first, ev.time0)
      else if (t === 'chunk' && ev.time !== undefined) first = first === null ? ev.time : Math.min(first, ev.time)
      if (t === 'text-chunks') text += (ev.texts ?? []).join('').length
      else if (t === 'reasoning-chunks') reasoning += (ev.texts ?? []).join('').length
      else if (t === 'tool-call-chunks') toolArgs += JSON.stringify(ev.args ?? '').length
    }
    const output = row.data.usage?.outputTokens ?? 0
    if (first === null || output <= 0) continue
    st.output = output
    st.first = first
    st.done = row.time
    const u = row.data.usage ?? {}
    st.prompt = (u.uncachedInputTokens ?? u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0)
    st.chars = text + reasoning + toolArgs
    st.reasonShare = text + reasoning + toolArgs === 0 ? 0 : reasoning / (text + reasoning + toolArgs)
    st.toolShare = text + reasoning + toolArgs === 0 ? 0 : toolArgs / (text + reasoning + toolArgs)
    st.cacheShare = st.prompt === 0 ? 0 : (u.cacheReadTokens ?? 0) / st.prompt
  }
  const list = [...steps.values()].filter(s => s.output > 0 && s.first !== undefined && s.done !== undefined)
  // Step index inside its turn, which separates the prefill-heavy first step.
  const seen = new Map()
  for (const s of list) {
    const index = seen.get(s.turn) ?? 0
    s.stepIndex = index
    seen.set(s.turn, index + 1)
  }
  return list.length < 4 ? null : list.sort((a, b) => a.start - b.start)
}

const sessions = []
for (const name of fs.readdirSync(SESS)) {
  if (!name.endsWith('.jsonl')) continue
  const steps = readSession(path.join(SESS, name))
  if (steps !== null) sessions.push(steps)
}

const rowsBySession = sessions.map(steps => {
  const rows = []
  for (const s of steps) {
    const truth = s.done - s.first
    const span = s.done - s.start
    if (truth < 400 || s.output < 20 || span <= 0) continue
    rows.push({
      output: s.output,
      span,
      prompt: Math.max(1, s.prompt),
      reasonShare: s.reasonShare,
      toolShare: s.toolShare,
      cacheShare: s.cacheShare,
      stepIndex: Math.min(s.stepIndex, 6),
      truth,
    })
  }
  return rows
})
const rows = rowsBySession.flat()

function solve(X, y) {
  const n = X[0].length
  const m = Array.from({ length: n }, () => new Array(n + 1).fill(0))
  for (let i = 0; i < X.length; i += 1) {
    for (let a = 0; a < n; a += 1) {
      for (let b = 0; b < n; b += 1) m[a][b] += X[i][a] * X[i][b]
      m[a][n] += X[i][a] * y[i]
    }
  }
  for (let c = 0; c < n; c += 1) {
    let p = c
    for (let r = c + 1; r < n; r += 1) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r
    ;[m[c], m[p]] = [m[p], m[c]]
    const d = m[c][c]
    if (Math.abs(d) < 1e-12) return null
    for (let k = c; k <= n; k += 1) m[c][k] /= d
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue
      const f = m[r][c]
      for (let k = c; k <= n; k += 1) m[r][k] -= f * m[c][k]
    }
  }
  return m.map(row => row[n])
}

const FEATURES = {
  'span,out': r => [1, Math.log(r.span), Math.log(r.output)],
  'span,out,prompt': r => [1, Math.log(r.span), Math.log(r.output), Math.log(r.prompt)],
  '+reasonShare': r => [1, Math.log(r.span), Math.log(r.output), Math.log(r.prompt), r.reasonShare],
  '+reason+toolShare': r => [1, Math.log(r.span), Math.log(r.output), Math.log(r.prompt), r.reasonShare, r.toolShare],
  '+reason+tool+cache': r => [1, Math.log(r.span), Math.log(r.output), Math.log(r.prompt), r.reasonShare, r.toolShare, r.cacheShare],
  '+reason+tool+cache+step': r => [1, Math.log(r.span), Math.log(r.output), Math.log(r.prompt), r.reasonShare, r.toolShare, r.cacheShare, r.stepIndex],
}

const score = (label, coefs, subset, feature) => {
  const errors = []
  let gross = 0
  for (const row of subset) {
    const vec = feature(row)
    let logDecode = 0
    for (let i = 0; i < coefs.length; i += 1) logDecode += coefs[i] * vec[i]
    const decode = Math.min(row.span * 0.95, Math.max(row.span * 0.03, Math.exp(logDecode)))
    const rate = row.output / (decode / 1000)
    const truthRate = row.output / (row.truth / 1000)
    const err = Math.abs(rate - truthRate) / truthRate
    errors.push(err)
    if (rate / truthRate > 3 || truthRate / rate > 3) gross += 1
  }
  console.log('  %s median %s  p75 %s  p90 %s  >3x %s',
    label.padEnd(28),
    (median(errors) * 100).toFixed(1).padStart(5) + '%',
    (q(errors, 0.75) * 100).toFixed(1).padStart(5) + '%',
    (q(errors, 0.9) * 100).toFixed(1).padStart(5) + '%',
    (gross / errors.length * 100).toFixed(1).padStart(5) + '%')
}

const fit = subset => feature => {
  const X = subset.map(feature)
  const y = subset.map(r => Math.log(r.truth))
  return solve(X, y)
}

console.log('rows %d sessions %d', rows.length, sessions.length)
console.log('\n-- in-sample --')
for (const [name, feature] of Object.entries(FEATURES)) {
  const coefs = fit(rows)(feature)
  score(name, coefs, rows, feature)
}

console.log('\n-- leave-one-session-out CV --')
for (const [name, feature] of Object.entries(FEATURES)) {
  const pooled = []
  for (let held = 0; held < rowsBySession.length; held += 1) {
    const train = rowsBySession.filter((_, i) => i !== held).flat()
    const test = rowsBySession[held]
    if (test.length === 0) continue
    const coefs = fit(train)(feature)
    for (const row of test) {
      const vec = feature(row)
      let logDecode = 0
      for (let i = 0; i < coefs.length; i += 1) logDecode += coefs[i] * vec[i]
      const decode = Math.min(row.span * 0.95, Math.max(row.span * 0.03, Math.exp(logDecode)))
      const rate = row.output / (decode / 1000)
      const truthRate = row.output / (row.truth / 1000)
      pooled.push({ err: Math.abs(rate - truthRate) / truthRate, gross: rate / truthRate > 3 || truthRate / rate > 3 })
    }
  }
  console.log('  %s median %s  p75 %s  p90 %s  >3x %s',
    name.padEnd(28),
    (median(pooled.map(p => p.err)) * 100).toFixed(1).padStart(5) + '%',
    (q(pooled.map(p => p.err), 0.75) * 100).toFixed(1).padStart(5) + '%',
    (q(pooled.map(p => p.err), 0.9) * 100).toFixed(1).padStart(5) + '%',
    (pooled.filter(p => p.gross).length / pooled.length * 100).toFixed(1).padStart(5) + '%')
}

const best = fit(rows)(FEATURES['span,out,prompt'])
console.log('\nshipped coefficients (span,out,prompt):')
console.log('  const DECODE_LOG_A = %s        // exp(4.8189)', best[0].toFixed(4))
console.log('  const DECODE_SPAN_B = %s', best[1].toFixed(4))
console.log('  const DECODE_OUT_C = %s', best[2].toFixed(4))
console.log('  const DECODE_PROMPT_D = %s', best[3].toFixed(4))

// Coefficients for the fallback path (replayed steps whose usage carries no
// prompt-side counters): span and output only.
const noPrompt = fit(rows)(FEATURES['span,out'])
console.log('\nfallback coefficients (span,out):')
console.log('  A=%s  span=%s  out=%s', noPrompt[0].toFixed(4), noPrompt[1].toFixed(4), noPrompt[2].toFixed(4))
