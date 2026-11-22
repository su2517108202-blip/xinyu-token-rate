/**
 * End-to-end accuracy bench for the *shipped* estimator.
 *
 * The functions under test are sliced straight out of pkg/client.js, so this
 * measures the code the browser actually runs rather than a port of it.
 *
 * Ground truth per step: `usage.outputTokens` (already includes reasoning)
 * spread across the recorded chunk timeline in proportion to weighted chars,
 * which is the same convention bench/estimator*.py use.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = process.env.PLUGIN_CLIENT || fileURLToPath(new URL('../client.js', import.meta.url))
const SESS = process.env.SESS_DIR || fileURLToPath(new URL('../.sessions', import.meta.url))

/* ---- slice the pure functions out of the plugin ---------------------- */

const source = fs.readFileSync(PKG, 'utf8')
const start = source.indexOf('    const CJK_CHAR')
const end = source.indexOf('     * Hooks')
if (start < 0 || end < 0) throw new Error('cannot locate pure-function block')

const slice = source.slice(start, source.lastIndexOf('/*', end))
const NAMES = [
  'CJK_CHAR', 'NARROW_WEIGHT', 'PRIOR', 'RIDGE_LAMBDA', 'CALIBRATION_WINDOW',
  'SAMPLE_MS', 'WINDOW_MS', 'BAR_MS', 'BAR_COUNT',
  'addWeight', 'blockWeights', 'fitCalibration', 'solve3', 'estimateTokens',
  'stepReading', 'recentSteps', 'promptTokens', 'estimateDecode',
  'DECODE_LOG_A', 'DECODE_SPAN_B', 'DECODE_OUT_C', 'DECODE_PROMPT_D',
  'formatRate', 'formatTokens', 'formatExact',
  'formatDuration', 'formatPercent', 'usageTotals',
]
const lib = new Function(slice + '\nreturn {' + NAMES.join(',') + '}')()
for (const name of NAMES) {
  if (lib[name] === undefined) throw new Error('missing export: ' + name)
}

/* ---- load recorded sessions ------------------------------------------ */

function chunkStream(stream) {
  const out = []
  for (const event of stream ?? []) {
    const type = event?.type
    if (type !== 'text-chunks' && type !== 'reasoning-chunks' && type !== 'tool-call-chunks') continue
    const t0 = event.time0 ?? 0
    const dt = event.dt ?? []
    const texts = event.texts ?? event.args ?? []
    const kind = type === 'reasoning-chunks' ? 'reasoning' : type === 'tool-call-chunks' ? 'tool-call' : 'text'
    let acc = 0
    for (let i = 0; i < texts.length; i += 1) {
      acc += dt[i] ?? 0
      out.push({ time: t0 + acc, text: texts[i] ?? '', kind })
    }
  }
  return out
}

function readSessions() {
  const files = fs.readdirSync(SESS).filter(name => name.endsWith('.jsonl'))
  const sessions = []
  for (const file of files) {
    const nodes = []
    for (const line of fs.readFileSync(path.join(SESS, file), 'utf8').split('\n')) {
      if (line === '') continue
      let row
      try { row = JSON.parse(line) } catch { continue }
      if (row.type !== 'assistant/message') continue
      const data = row.data ?? {}
      const usage = data.usage ?? {}
      if (!(usage.outputTokens > 0)) continue
      const chunks = chunkStream(data.stream)
      if (chunks.length < 8) continue
      nodes.push({ turn: data.turn ?? 0, step: data.step ?? 0, usage, chunks })
    }
    if (nodes.length > 0) sessions.push(nodes)
  }
  return sessions
}

/* ---- the plugin's view of a step ------------------------------------- */

function blocksAt(step, count) {
  const blocks = []
  let reasoning = ''
  let text = ''
  let args = ''
  for (let i = 0; i < count; i += 1) {
    const chunk = step.chunks[i]
    if (chunk.kind === 'reasoning') reasoning += chunk.text
    else if (chunk.kind === 'text') text += chunk.text
    else args += chunk.text
  }
  if (reasoning !== '') blocks.push({ kind: 'reasoning', text: reasoning })
  if (text !== '') blocks.push({ kind: 'text', text })
  if (args !== '') blocks.push({ kind: 'tool-call', name: '', argsRaw: args })
  return blocks
}

function nodeFor(step) {
  const first = step.chunks[0].time
  const last = step.chunks[step.chunks.length - 1].time
  const blocks = blocksAt(step, step.chunks.length)
  return {
    kind: 'assistant',
    turn: step.turn,
    step: step.step,
    blocks,
    usage: { outputTokens: step.usage.outputTokens },
    timing: { stepStartTime: first - 900, firstTokenTime: first, completedTime: last },
  }
}

/* ---- truth series (weights, not the plugin's calibration) ------------- */

function weight(text) {
  let wide = 0
  for (const char of text) if (lib.CJK_CHAR.test(char)) wide += 1
  return wide + (text.length - wide) * lib.NARROW_WEIGHT
}

function truthSeries(step) {
  const weights = step.chunks.map(chunk => weight(chunk.text))
  const total = weights.reduce((sum, value) => sum + value, 0) || 1
  let acc = 0
  const out = []
  for (let i = 0; i < step.chunks.length; i += 1) {
    acc += (step.usage.outputTokens * weights[i]) / total
    out.push([step.chunks[i].time, acc])
  }
  return out
}

/* ---- windowed rate, mirroring useThroughput -------------------------- */

function windowRates(series, window = lib.WINDOW_MS, step = lib.SAMPLE_MS, minSpan = window * 0.4) {
  const out = []
  if (series.length < 2) return out
  const t0 = series[0][0]
  const t1 = series[series.length - 1][0]
  for (let t = t0; t <= t1; t += step) {
    let j = 0
    while (j + 1 < series.length && series[j + 1][0] <= t) j += 1
    let k = j
    while (k > 0 && series[k][0] >= t - window) k -= 1
    if (series[k][0] < t - window) k += 1
    const span = series[j][0] - series[k][0]
    if (span < minSpan) continue
    out.push([t, (series[j][1] - series[k][1]) / (span / 1_000)])
  }
  return out
}

function pct(values, q) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
}

function median(values) {
  return values.length === 0 ? 0 : pct(values, 0.5)
}

/* ---- run -------------------------------------------------------------- */

const sessions = readSessions()
const finalErr = []
const liveErr = []
const coldFinalErr = []
let steps = 0
let coldSteps = 0

for (const session of sessions) {
  const settled = []
  for (const step of session) {
    const calibration = lib.fitCalibration(settled)
    const blocksTotal = blocksAt(step, step.chunks.length)
    const estimate = lib.estimateTokens(blocksTotal, calibration)
    const truth = step.usage.outputTokens
    if (truth >= 200) {
      finalErr.push(Math.abs(estimate - truth) / truth)
      if (calibration.samples === 0) {
        coldFinalErr.push(Math.abs(estimate - truth) / truth)
        coldSteps += 1
      }
      // live path: sample the growing partial the way the dock does
      const live = []
      for (let i = 1; i <= step.chunks.length; i += 1) {
        live.push([step.chunks[i - 1].time, lib.estimateTokens(blocksAt(step, i), calibration)])
      }
      const truthRates = windowRates(truthSeries(step))
      const liveRates = windowRates(live)
      const lookup = new Map(liveRates)
      for (const [time, value] of truthRates) {
        if (value <= 20) continue
        const got = lookup.get(time)
        if (got === undefined) continue
        liveErr.push(Math.abs(got - value) / value)
      }
      steps += 1
    }
    settled.push(nodeFor(step))
  }
}

const p = value => (value * 100).toFixed(1) + '%'
console.log('sessions           %d', sessions.length)
console.log('measured steps     %d', steps)
console.log('cold (no samples)  %d steps, final error median %s', coldSteps, p(median(coldFinalErr)))
console.log('final token error  median %s  p75 %s  p90 %s', p(median(finalErr)), p(pct(finalErr, 0.75)), p(pct(finalErr, 0.9)))
console.log('live rate error    median %s  p75 %s  p90 %s  samples %d',
  p(median(liveErr)), p(pct(liveErr, 0.75)), p(pct(liveErr, 0.9)), liveErr.length)
console.log('lib constants      WINDOW_MS=%d SAMPLE_MS=%d RIDGE_LAMBDA=%d CALIBRATION_WINDOW=%d',
  lib.WINDOW_MS, lib.SAMPLE_MS, lib.RIDGE_LAMBDA, lib.CALIBRATION_WINDOW)
