/**
 * Estimator sweep for replay-only steps (no firstTokenTime).
 *
 * Truth: decode window = last chunk end - first chunk start, recorded in the
 * session log. Candidate estimators only see {stepStartTime, completedTime,
 * usage} — exactly what the plugin sees at runtime — so this sweep tells which
 * formula to ship, not what the model could know with extra data.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SESS = process.env.SESS_DIR || fileURLToPath(new URL('../.sessions', import.meta.url))

const median = list => {
  if (list.length === 0) return null
  const sorted = [...list].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}
const q = (list, ratio) => {
  const sorted = [...list].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]
}

function readSession(file) {
  const steps = new Map()
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line === '') continue
    let row
    try { row = JSON.parse(line) } catch { continue }
    if (row.type === 'step/start') {
      steps.set(row.data.turn + ':' + row.data.step, { turn: row.data.turn, step: row.data.step, start: row.time })
      continue
    }
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
    const usage = row.data.usage ?? {}
    step.prompt = (usage.uncachedInputTokens ?? usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
    // Share of the step's characters that are reasoning: decoding speed differs
    // a lot between reasoning and visible text, so it is a candidate feature.
    let reasoning = 0
    let text = 0
    for (const event of row.data.stream ?? []) {
      const type = String(event?.type ?? '')
      if (type === 'reasoning-chunks') reasoning += (event.texts ?? []).join('').length
      else if (type === 'text-chunks') text += (event.texts ?? []).join('').length
    }
    step.reasoningShare = reasoning + text === 0 ? 0 : reasoning / (reasoning + text)
  }
  const list = [...steps.values()].filter(s => s.output > 0 && s.first !== undefined && s.done !== undefined)
    .sort((a, b) => a.start - b.start)
  return list.length < 4 ? null : list
}

const sessions = []
for (const name of fs.readdirSync(SESS)) {
  if (!name.endsWith('.jsonl')) continue
  const steps = readSession(path.join(SESS, name))
  if (steps !== null) sessions.push(steps)
}

const rows = []
for (const steps of sessions) {
  for (const step of steps) {
    const truthDecode = step.done - step.first
    const span = step.done - step.start
    if (truthDecode < 400 || step.output < 20 || span <= 0) continue
    rows.push({
      output: step.output,
      span,
      truth: step.output / (truthDecode / 1000),
      prompt: step.prompt,
      reasoningShare: step.reasoningShare,
      decodeRatio: truthDecode / span,
    })
  }
}

const report = (label, pick) => {
  const errors = []
  const ratios = []
  let threefold = 0
  for (const row of rows) {
    const decode = pick(row)
    if (!(decode > 0)) continue
    const rate = row.output / (decode / 1000)
    const err = Math.abs(rate - row.truth) / row.truth
    errors.push(err)
    ratios.push(decode / (row.span * row.decodeRatio))
    if (rate / row.truth > 3 || row.truth / rate > 3) threefold += 1
  }
  console.log('%s  median %s  p75 %s  p90 %s  >3x %s  bias %s',
    label.padEnd(34),
    (median(errors) * 100).toFixed(1).padStart(5) + '%',
    (q(errors, 0.75) * 100).toFixed(1).padStart(5) + '%',
    (q(errors, 0.9) * 100).toFixed(1).padStart(5) + '%',
    (threefold / errors.length * 100).toFixed(1).padStart(5) + '%',
    median(ratios).toFixed(2))
}

const A = 2.011, B = 0.592
const logTtft = prompt => Math.min(24000, Math.max(1200, Math.exp(A + B * Math.log(Math.max(1, prompt)))))

console.log('rows %d', rows.length)
console.log('truth decode share of span: median %s', median(rows.map(r => r.decodeRatio)).toFixed(3))
report('no subtraction', r => r.span)
report('loglinear ttft', r => r.span - logTtft(r.prompt))
report('loglinear, 0.7 cap', r => Math.min(r.span - logTtft(r.prompt), r.span * 0.7))
report('const 6000', r => Math.max(r.span * 0.12, r.span - 6000))
report('const 6000, 0.7 cap', r => Math.max(r.span * 0.12, Math.min(r.span - 6000, r.span * 0.8)))
report('span * 0.5', r => r.span * 0.5)
report('span * median decode share', r => r.span * median(rows.map(x => x.decodeRatio)))

// A ratio model fitted on output length: longer answers spend a smaller share
// of the step inside the prefill window.
const fitRatio = () => {
  const xs = []
  const ys = []
  for (const row of rows) { xs.push(Math.log(row.output)); ys.push(Math.log(row.decodeRatio)) }
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = ys.reduce((a, b) => a + b, 0) / ys.length
  let num = 0, den = 0
  for (let i = 0; i < xs.length; i += 1) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2 }
  const slope = num / den
  return { slope, intercept: my - slope * mx }
}
const fit = fitRatio()
console.log('ratio model: log(share) = %s + %s * log(output)', fit.intercept.toFixed(3), fit.slope.toFixed(3))
report('ratio model (output)', r => r.span * Math.min(0.95, Math.max(0.05, Math.exp(fit.intercept + fit.slope * Math.log(r.output)))))

// Same idea including prompt size, which is what actually drives prefill.
const fitBoth = () => {
  const xs = rows.map(r => [1, Math.log(r.output), Math.log(Math.max(1, r.prompt))])
  const ys = rows.map(r => Math.log(r.decodeRatio))
  // Normal equations for a 3-parameter least squares, solved by elimination.
  const n = 3
  const m = Array.from({ length: n }, () => new Array(n + 1).fill(0))
  for (let i = 0; i < xs.length; i += 1) {
    for (let a = 0; a < n; a += 1) {
      for (let b = 0; b < n; b += 1) m[a][b] += xs[i][a] * xs[i][b]
      m[a][n] += xs[i][a] * ys[i]
    }
  }
  for (let col = 0; col < n; col += 1) {
    let pivot = col
    for (let row = col + 1; row < n; row += 1) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row
    ;[m[col], m[pivot]] = [m[pivot], m[col]]
    const div = m[col][col]
    for (let k = col; k <= n; k += 1) m[col][k] /= div
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue
      const factor = m[row][col]
      for (let k = col; k <= n; k += 1) m[row][k] -= factor * m[col][k]
    }
  }
  return m.map(row => row[n])
}
const both = fitBoth()
console.log('ratio model: log(share) = %s + %s*log(out) + %s*log(prompt)',
  both[0].toFixed(3), both[1].toFixed(3), both[2].toFixed(3))
report('ratio model (output,prompt)', r => r.span * Math.min(0.95, Math.max(0.05,
  Math.exp(both[0] + both[1] * Math.log(r.output) + both[2] * Math.log(Math.max(1, r.prompt))))))
