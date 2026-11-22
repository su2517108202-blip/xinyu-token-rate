/**
 * Settled-rate accuracy bench.
 *
 * The host never records `firstTokenTime` for a replayed step (it is set from
 * live stream deltas only), so every historical step arrives as
 * `{ stepStartTime, firstTokenTime: null, completedTime }`. `stepReading` has to
 * recover the decode window from that, and this bench measures how close it
 * lands against the decode window the recorded chunk timeline actually shows.
 *
 * Nodes are built exactly as the Chat projection builds them, then fed to the
 * functions sliced out of pkg/client.js.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = process.env.PLUGIN_CLIENT || fileURLToPath(new URL('../client.js', import.meta.url))
const SESS = process.env.SESS_DIR || fileURLToPath(new URL('../.sessions', import.meta.url))

const source = fs.readFileSync(PKG, 'utf8')
const start = source.indexOf('    const CJK_CHAR')
const end = source.indexOf('     * Hooks')
const slice = source.slice(start, source.lastIndexOf('/*', end))
const NAMES = ['stepReading', 'recentSteps', 'estimateDecode']
const lib = new Function(slice + '\nreturn {' + NAMES.join(',') + '}')()
for (const name of NAMES) if (lib[name] === undefined) throw new Error('missing ' + name)

function pct(values, q) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
}
const p = value => (value * 100).toFixed(1) + '%'

/**
 * Read one session into the two shapes this bench needs: the truth (when the
 * first token actually arrived, from the chunk timeline) and the node the host
 * would hand the plugin (no `firstTokenTime`).
 */
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
    const key = row.data.turn + ':' + row.data.step
    const step = steps.get(key)
    if (step === undefined) continue
    let first = null
    for (const event of row.data.stream ?? []) {
      const type = String(event?.type ?? '')
      if (type.endsWith('-chunks') && event.time0 !== undefined) {
        first = first === null ? event.time0 : Math.min(first, event.time0)
      } else if (type === 'chunk' && event.time !== undefined) {
        first = first === null ? event.time : Math.min(first, event.time)
      }
    }
    const output = row.data.usage?.outputTokens ?? 0
    if (first === null || output <= 0) continue
    step.output = output
    step.first = first
    step.done = row.time
    step.usage = row.data.usage
  }
  const list = [...steps.values()]
    .filter(step => step.output > 0 && step.first !== undefined && step.done !== undefined)
    .sort((a, b) => a.start - b.start)
  return list.length < 4 ? null : list
}

/** The node the Chat projection builds for a replayed settled step. */
function replayNode(step) {
  return {
    kind: 'assistant',
    turn: step.turn,
    step: step.step,
    blocks: [],
    usage: step.usage,
    timing: { stepStartTime: step.start, firstTokenTime: null, completedTime: step.done },
  }
}

const files = fs.readdirSync(SESS).filter(name => name.endsWith('.jsonl'))
const sessions = []
for (const file of files) {
  const steps = readSession(path.join(SESS, file))
  if (steps !== null) sessions.push(steps)
}

const errors = []
let threefold = 0
let measured = 0
let exact = 0

for (const steps of sessions) {
  const nodes = []
  for (const step of steps) {
    const truthDecode = step.done - step.first
    const reading = lib.stepReading(replayNode(step))
    if (reading.rate !== null && truthDecode >= 400 && step.output >= 20) {
      const truth = step.output / (truthDecode / 1_000)
      errors.push(Math.abs(reading.rate - truth) / truth)
      if (reading.rate / truth > 3 || truth / reading.rate > 3) threefold += 1
      measured += 1
    }
    // The host does record first-token times for steps streamed in this very
    // page, so the same node with a real stamp must reproduce the truth.
    const exactNode = {
      ...replayNode(step),
      timing: { stepStartTime: step.start, firstTokenTime: step.first, completedTime: step.done },
    }
    const exactReading = lib.stepReading(exactNode)
    if (exactReading.rate !== null && truthDecode >= 400 && step.output >= 20) {
      const truth = step.output / (truthDecode / 1_000)
      if (Math.abs(exactReading.rate - truth) / truth < 1e-9) exact += 1
    }
    nodes.push(replayNode(step))
  }
}

const ttftAll = []
for (const steps of sessions) {
  for (const step of steps) {
    const value = step.first - step.start
    if (value > 0) ttftAll.push(value)
  }
}
ttftAll.sort((a, b) => a - b)

console.log('sessions            %d', sessions.length)
console.log('measured steps      %d', measured)
console.log('rate error          median %s  p75 %s  p90 %s',
  p(pct(errors, 0.5)), p(pct(errors, 0.75)), p(pct(errors, 0.9)))
console.log('off by >3x          %d steps (%s)', threefold, p(threefold / Math.max(1, measured)))
console.log('stamped steps exact %d', exact)
console.log('recorded ttft       median %sms  p10 %sms  p90 %sms',
  Math.round(ttftAll[ttftAll.length >> 1]),
  Math.round(ttftAll[Math.floor(ttftAll.length * 0.1)]),
  Math.round(ttftAll[Math.floor(ttftAll.length * 0.9)]))
