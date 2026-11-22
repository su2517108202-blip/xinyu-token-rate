/**
 * 心语 token 速率 — browser half.
 *
 * One composer-dock instrument that answers a single question about the
 * conversation in front of you: how fast is the model writing right now?
 *
 * Data comes only from what the Host already publishes for *this* session:
 *
 *   · `useChat`       — settled steps, the in-flight partial, turn starts
 *   · `useProjection` — `tokenUsage` (session totals) and `contextPressure`
 *   · `useSession`    — `running`, `lastAgentError`
 *
 * Streaming chunks carry characters, not tokens, so the live figure is a
 * calibrated estimate. The calibration is a small ridge fit over three
 * content classes (reasoning / prose / tool-call payload) against every
 * settled step that reports real provider usage. Benchmarked against 1304
 * recorded steps the fitted model keeps the windowed rate inside ~4% median
 * error, versus ~13% for a single blended density.
 *
 * The visual language is one continuous signal: a hairline flow field runs
 * the full width of the bar and is driven by the same buckets as the panel
 * chart, so the instrument reads as a pulse rather than a number next to a
 * sparkline. Nothing here is decorative motion — every movement is a datum.
 *
 * No network, no timers outside effects, no second app on `document.body`
 * besides the detail popover portal. Styles render as an element inside the
 * dock, so they leave with the surface.
 */
window.__ModuleLoader__.load({
  id: 'dsh-xinyu-token-rate',
  factory: (require) => {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'xinyuRate'

    const zh = {
      'unit': 'tok/s',
      'state.streaming': '生成中',
      'state.waiting': '等待首字',
      'state.tooling': '工具运行中',
      'state.settled': '已结算',
      'state.idle': '空闲',
      'state.error': '已中断',
      'dock.label': '心语 token 速率',
      'dock.expand': '展开速率详情',
      'dock.collapse': '收起速率详情',
      'dock.waiting': '等待首字 {value}',
      'dock.ttft': '首字 {value}',
      'dock.cache': '缓存 {percent}%',
      'dock.context': '上下文 {percent}%',
      'dock.tooling': '工具 {value}',
      'dock.step': '本步 {tokens}',
      'dock.pulse': '本步实时',
      'panel.title': '心语 token 速率',
      'panel.subtitle': '仅统计当前会话',
      'panel.close': '关闭',
      'panel.hero.live': '本步实时',
      'panel.hero.last': '上一轮平均',
      'panel.hero.idle': '尚无读数',
      'panel.hero.waiting': '等待首字',
      'panel.hero.tooling': '工具运行中，下一段速率待定',
      'panel.hero.subTooling': '工具返回后重新开始计时',
      'panel.hero.subWaiting': '模型尚未输出第一个字',
      'panel.hero.subLive': '{tokens} tok · 已生成 {elapsed}',
      'panel.hero.subLast': '{tokens} tok · 解码 {elapsed}',
      'panel.hero.subIdle': '开始一次对话即可看到实时速率',
      'panel.hero.approx': '由步骤起点估算',
      'panel.flow.title': '吞吐曲线',
      'panel.flow.window': '近 8 秒 · 每 0.2 秒',
      'panel.flow.ago': '8 秒前',
      'panel.flow.now': '现在',
      'panel.flow.scrub': '{rate} · {ago}前',
      'panel.flow.avg': '均值 {value}',
      'panel.flow.peak': '峰值 {value}',
      'panel.context': '上下文占用',
      'panel.contextOf': '{used} / {window}',
      'panel.session': '本会话累计',
      'panel.output': '输出',
      'panel.input': '未缓存输入',
      'panel.cacheRead': '缓存读',
      'panel.cacheWrite': '缓存写',
      'panel.cacheHit': '缓存命中',
      'panel.steps': '最近步骤',
      'panel.stepsEmpty': '还没有已完成的可测步骤',
      'panel.stepsHint': '点选可钉住读数',
      'panel.col.rate': '速率',
      'panel.col.tokens': '输出',
      'panel.col.ttft': '首字',
      'panel.stepTitle': '第 {turn} 轮 · 第 {step} 步',
      'panel.approxMark': '估算',
      'panel.calibration': '按本会话已结算步骤校准（{samples} 个样本）',
      'panel.calibrationCold': '尚无已结算样本，按默认密度估算',
      'panel.footnote': '流式数字由字符与内容类别估算；该步结算后换成服务端上报的真实输出量。',
      'panel.error': '本轮以错误结束：{message}',
    }

    const en = {
      'unit': 'tok/s',
      'state.streaming': 'Streaming',
      'state.waiting': 'Waiting',
      'state.tooling': 'Tool running',
      'state.settled': 'Settled',
      'state.idle': 'Idle',
      'state.error': 'Interrupted',
      'dock.label': 'Xinyu token rate',
      'dock.expand': 'Open rate details',
      'dock.collapse': 'Close rate details',
      'dock.waiting': 'Waiting {value}',
      'dock.ttft': 'TTFT {value}',
      'dock.cache': 'Cache {percent}%',
      'dock.context': 'Context {percent}%',
      'dock.tooling': 'Tool {value}',
      'dock.step': 'Step {tokens}',
      'dock.pulse': 'live',
      'panel.title': 'Xinyu token rate',
      'panel.subtitle': 'This session only',
      'panel.close': 'Close',
      'panel.hero.live': 'Live, this step',
      'panel.hero.last': 'Last step average',
      'panel.hero.idle': 'No reading yet',
      'panel.hero.waiting': 'Waiting for first token',
      'panel.hero.tooling': 'Tool running — next rate pending',
      'panel.hero.subTooling': 'The clock restarts when the tool returns',
      'panel.hero.subWaiting': 'The model has not emitted a token yet',
      'panel.hero.subLive': '{tokens} tok · {elapsed} elapsed',
      'panel.hero.subLast': '{tokens} tok · {elapsed} decode',
      'panel.hero.subIdle': 'Send a message to see the live rate',
      'panel.hero.approx': 'measured from step start',
      'panel.flow.title': 'Throughput',
      'panel.flow.window': 'last 8s · 0.2s buckets',
      'panel.flow.ago': '8s ago',
      'panel.flow.now': 'now',
      'panel.flow.scrub': '{rate} · {ago} ago',
      'panel.flow.avg': 'avg {value}',
      'panel.flow.peak': 'peak {value}',
      'panel.context': 'Context pressure',
      'panel.contextOf': '{used} / {window}',
      'panel.session': 'This session',
      'panel.output': 'Output',
      'panel.input': 'Uncached input',
      'panel.cacheRead': 'Cache read',
      'panel.cacheWrite': 'Cache write',
      'panel.cacheHit': 'Cache hit',
      'panel.steps': 'Recent steps',
      'panel.stepsEmpty': 'No measurable step yet',
      'panel.stepsHint': 'Tap a row to pin it',
      'panel.col.rate': 'Rate',
      'panel.col.tokens': 'Out',
      'panel.col.ttft': 'TTFT',
      'panel.stepTitle': 'Turn {turn} · step {step}',
      'panel.approxMark': 'est.',
      'panel.calibration': 'Calibrated on {samples} settled steps of this session',
      'panel.calibrationCold': 'No settled sample yet — default density',
      'panel.footnote': 'Live figures estimate tokens from streamed characters; the settled step replaces them with provider-reported usage.',
      'panel.error': 'Turn ended with an error: {message}',
    }

    /* ------------------------------------------------------------------ *
     * Constants
     * ------------------------------------------------------------------ */

    /** Wide CJK glyphs cost about one token; everything else about a quarter. */
    const CJK_CHAR = /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/
    const NARROW_WEIGHT = 0.25

    /** Sampling cadence of the live meter. */
    const SAMPLE_MS = 150
    const WINDOW_MS = 1_000
    const BAR_MS = 200
    const BAR_COUNT = 40

    /** Ridge prior: one token per weighted character before any evidence. */
    const PRIOR = 1.0
    const RIDGE_LAMBDA = 40
    const CALIBRATION_WINDOW = 120
    /** A decode window shorter than this cannot produce a trustworthy rate. */
    /**
     * Marks a derived number. A tilde sits at cap height in most UI fonts and
     * reads as a minus sign at 11px, so the explicit approximation sign is used
     * instead — it can never be mistaken for a negative rate.
     */
    const APPROX = '\u2248'

    const RATE_MIN_DECODE = 400
    /** Below this many completion tokens the rate is dominated by one chunk. */
    const RATE_MIN_OUTPUT = 20
    /**
     * A replayed step carries no first-token stamp: the host records it from
     * live stream deltas only, and history replays batched chunks. The decode
     * window therefore has to be reconstructed from what a settled step does
     * report - how long the step took, how many tokens it produced and how big
     * its prompt was. Fitted on this machine's recorded sessions (1346 steps)
     * and scored leave-one-session-out: 26% median error, against 59% for the
     * whole step window and 44% for subtracting an estimated first-token time.
     */
    const DECODE_LOG_A = 4.8189
    const DECODE_SPAN_B = 0.2902
    const DECODE_OUT_C = 0.9687
    const DECODE_PROMPT_D = -0.4987
    /**
     * Time to first token, for display only. A replayed step never records it,
     * so a log-linear fit over prompt size (fitted on 1735 recorded steps:
     * median 5.9 s, p10 3.4 s, p90 16 s) fills the column and is marked with a
     * tilde so an estimate never passes for a measurement.
     */
    const TTFT_LOG_A = 2.011
    const TTFT_LOG_B = 0.592
    const TTFT_MIN = 1_200
    const TTFT_MAX = 24_000
    /** Prompt counters are missing on some providers; refit without them. */
    const DECODE_LOG_A_NO_PROMPT = -0.2037
    const DECODE_SPAN_B_NO_PROMPT = 0.2026
    const DECODE_OUT_C_NO_PROMPT = 0.9913
    /** The estimate must stay inside the step it was drawn from. */
    const DECODE_FLOOR_RATIO = 0.03
    const DECODE_CAP_RATIO = 0.95

    const WAVE_W = 240
    const WAVE_H = 22

    const EMPTY_METER = { live: false, rate: null, bars: EMPTY_BARS(), peak: 0, tokens: 0, elapsed: 0 }
    const EMPTY_NODES = []

    function EMPTY_BARS() {
      return []
    }

    /* ------------------------------------------------------------------ *
     * Small helpers
     * ------------------------------------------------------------------ */

    function readNumber(value) {
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
    }

    function clamp(value, min, max) {
      return value < min ? min : value > max ? max : value
    }

    /** Three content classes; tool payloads tokenize differently from prose. */
    function addWeight(acc, block) {
      if (block === null || typeof block !== 'object') return
      const kind = block.kind
      let text = ''
      let slot = 1
      if (kind === 'text') {
        text = typeof block.text === 'string' ? block.text : ''
      } else if (kind === 'reasoning') {
        text = typeof block.text === 'string' ? block.text : ''
        slot = 0
      } else if (kind === 'tool-call') {
        const name = typeof block.name === 'string' ? block.name : ''
        const args = typeof block.argsRaw === 'string' ? block.argsRaw : ''
        text = name + args
        slot = 2
      } else {
        return
      }
      if (text === '') return
      let wide = 0
      for (const char of text) if (CJK_CHAR.test(char)) wide += 1
      acc[slot] += wide + (text.length - wide) * NARROW_WEIGHT
    }

    function blockWeights(blocks) {
      const acc = [0, 0, 0]
      const list = Array.isArray(blocks) ? blocks : []
      for (let i = 0; i < list.length; i += 1) addWeight(acc, list[i])
      return acc
    }

    /* ------------------------------------------------------------------ *
     * Calibration
     * ------------------------------------------------------------------ */

    /**
     * Ridge fit of tokens-per-weighted-character over the settled steps of
     * this session. Three coefficients (reasoning, prose, tool payload) plus an
     * intercept-free prior pulled toward one token per weighted character, so
     * a cold session starts at the old behaviour and sharpens as it fills.
     *
     * @param nodes - every settled conversation node, oldest first.
     * @returns the fitted model, with the sample count it was built from.
     */
    function fitCalibration(nodes) {
      const list = Array.isArray(nodes) ? nodes : EMPTY_NODES
      const rows = []
      const start = Math.max(0, list.length - CALIBRATION_WINDOW)
      let totalTokens = 0
      let totalWeight = 0
      for (let i = start; i < list.length; i += 1) {
        const node = list[i]
        if (node === null || typeof node !== 'object' || node.kind !== 'assistant') continue
        const usage = node.usage === null || typeof node.usage !== 'object' ? null : node.usage
        const output = readNumber(usage === null ? null : usage.outputTokens)
        if (output === null || output <= 0) continue
        const weights = blockWeights(node.blocks)
        const sum = weights[0] + weights[1] + weights[2]
        if (sum <= 0) continue
        rows.push({ w: weights, y: output })
        totalTokens += output
        totalWeight += sum
      }
      if (rows.length === 0) return { coef: [PRIOR, PRIOR, PRIOR], blended: PRIOR, samples: 0 }
      const blended = totalWeight > 0 ? totalTokens / totalWeight : PRIOR
      // Normal equations of a 3-parameter ridge fit.
      const matrix = [
        [RIDGE_LAMBDA, 0, 0],
        [0, RIDGE_LAMBDA, 0],
        [0, 0, RIDGE_LAMBDA],
      ]
      const rhs = [RIDGE_LAMBDA * blended, RIDGE_LAMBDA * blended, RIDGE_LAMBDA * blended]
      for (let r = 0; r < rows.length; r += 1) {
        const w = rows[r].w
        const y = rows[r].y
        for (let a = 0; a < 3; a += 1) {
          rhs[a] += w[a] * y
          for (let b = 0; b < 3; b += 1) matrix[a][b] += w[a] * w[b]
        }
      }
      const solved = solve3(matrix, rhs)
      const coef = solved === null ? [blended, blended, blended] : solved
      for (let i = 0; i < 3; i += 1) {
        // A pathological fit must never turn the meter into noise.
        if (!Number.isFinite(coef[i]) || coef[i] <= 0.02 || coef[i] > 8) coef[i] = blended
      }
      return { coef, blended, samples: rows.length }
    }

    /** Gaussian elimination with partial pivoting on a 3×3 system. */
    function solve3(matrix, rhs) {
      const a = [
        [matrix[0][0], matrix[0][1], matrix[0][2], rhs[0]],
        [matrix[1][0], matrix[1][1], matrix[1][2], rhs[1]],
        [matrix[2][0], matrix[2][1], matrix[2][2], rhs[2]],
      ]
      for (let col = 0; col < 3; col += 1) {
        let pivot = col
        for (let row = col + 1; row < 3; row += 1) {
          if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row
        }
        if (Math.abs(a[pivot][col]) < 1e-9) return null
        if (pivot !== col) {
          const swap = a[pivot]
          a[pivot] = a[col]
          a[col] = swap
        }
        const lead = a[col][col]
        for (let k = col; k < 4; k += 1) a[col][k] /= lead
        for (let row = 0; row < 3; row += 1) {
          if (row === col) continue
          const factor = a[row][col]
          if (factor === 0) continue
          for (let k = col; k < 4; k += 1) a[row][k] -= factor * a[col][k]
        }
      }
      return [a[0][3], a[1][3], a[2][3]]
    }

    /** Estimated tokens already emitted by the in-flight step. */
    function estimateTokens(blocks, calibration) {
      const weights = blockWeights(blocks)
      const coef = calibration.coef
      const total = weights[0] * coef[0] + weights[1] * coef[1] + weights[2] * coef[2]
      return Number.isFinite(total) && total > 0 ? total : 0
    }

    /* ------------------------------------------------------------------ *
     * Settled readings
     * ------------------------------------------------------------------ */

    /** Prompt-side token count, whichever shape the usage payload uses. */
    function promptTokens(usage) {
      if (usage === null || typeof usage !== 'object') return null
      const uncached = readNumber(usage.uncachedInputTokens) ?? readNumber(usage.inputTokens)
      const cacheRead = readNumber(usage.cacheReadTokens) ?? 0
      const cacheWrite = readNumber(usage.cacheWriteTokens) ?? 0
      if (uncached === null && cacheRead === 0 && cacheWrite === 0) return null
      return (uncached ?? 0) + cacheRead + cacheWrite
    }

    /** Estimated think-before-first-token time, or null without prompt data. */
    function estimateTtft(usage) {
      const prompt = promptTokens(usage)
      if (prompt === null || prompt <= 0) return null
      return clamp(Math.exp(TTFT_LOG_A + TTFT_LOG_B * Math.log(prompt)), TTFT_MIN, TTFT_MAX)
    }

    /**
     * Reconstructed decode window for a settled step that never recorded a
     * first-token stamp. Both the prompt size (prefill that must finish first)
     * and the output size (how much of the step is steady decoding) move the
     * answer, which is why the fit beats subtracting a fixed latency.
     */
    function estimateDecode(span, output, usage) {
      if (!(span > 0) || !(output > 0)) return null
      const prompt = promptTokens(usage)
      const fitted = prompt !== null && prompt > 0
        ? Math.exp(
          DECODE_LOG_A
          + DECODE_SPAN_B * Math.log(span)
          + DECODE_OUT_C * Math.log(output)
          + DECODE_PROMPT_D * Math.log(prompt),
        )
        : Math.exp(
          DECODE_LOG_A_NO_PROMPT
          + DECODE_SPAN_B_NO_PROMPT * Math.log(span)
          + DECODE_OUT_C_NO_PROMPT * Math.log(output),
        )
      return clamp(fitted, span * DECODE_FLOOR_RATIO, span * DECODE_CAP_RATIO)
    }

    /** One settled step's latency and throughput facts. */
    function stepReading(node) {
      const timing = node.timing === null || typeof node.timing !== 'object' ? null : node.timing
      const start = timing === null ? null : readNumber(timing.stepStartTime)
      const first = timing === null ? null : readNumber(timing.firstTokenTime)
      const done = timing === null ? null : readNumber(timing.completedTime)
      const usage = node.usage === null || typeof node.usage !== 'object' ? null : node.usage
      const output = usage === null ? null : readNumber(usage.outputTokens)
      const measuredTtft = start !== null && first !== null ? Math.max(0, first - start) : null
      const ttft = measuredTtft === null ? estimateTtft(usage) : measuredTtft
      const ttftApprox = measuredTtft === null && ttft !== null
      /**
       * A replayed step carries no first-token stamp: the host records it from
       * live stream deltas only, and history replays batched chunks. Anchoring
       * on the step start still yields a real (slightly conservative) decode
       * speed, so it is used and the reading is marked approximate.
       */
      const approx = first === null && start !== null
      let decode = null
      if (first !== null && done !== null) {
        decode = Math.max(0, done - first)
      } else if (start !== null && done !== null && output !== null) {
        decode = estimateDecode(Math.max(0, done - start), output, usage)
      }
      const rate = decode !== null && decode >= RATE_MIN_DECODE && output !== null && output >= RATE_MIN_OUTPUT
        ? output / (decode / 1_000)
        : null
      return { turn: node.turn, step: node.step, ttft, ttftApprox, decode, output, rate, approx }
    }

    /** Newest settled steps that carry a measurable decode window. */
    function recentSteps(nodes, limit) {
      const list = Array.isArray(nodes) ? nodes : EMPTY_NODES
      const out = []
      const fallback = []
      for (let i = list.length - 1; i >= 0 && out.length < limit; i -= 1) {
        const node = list[i]
        if (node === null || typeof node !== 'object' || node.kind !== 'assistant') continue
        const reading = stepReading(node)
        if (reading.output === null || reading.output <= 0) continue
        if (reading.rate === null) {
          if (fallback.length < limit) fallback.push(reading)
          continue
        }
        out.push(reading)
      }
      if (out.length === 0) return fallback
      return out
    }

    /* ------------------------------------------------------------------ *
     * Formatting
     * ------------------------------------------------------------------ */

    function formatRate(value) {
      if (value === null || !Number.isFinite(value) || value < 0) return null
      return value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)
    }

    /**
     * A replayed step has no first-token stamp, so its rate is measured from
     * the step start and runs slightly low. It is prefixed rather than hidden.
     */
    function rateText(step) {
      const rate = step === null || step === undefined ? null : formatRate(step.rate)
      if (rate === null) return null
      return step.approx ? APPROX + rate : rate
    }

    function formatTokens(value) {
      if (!Number.isFinite(value) || value <= 0) return '0'
      const scale = candidate => (candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10))
      if (value < 1_000) return String(Math.round(value))
      if (value < 1_000_000) return scale(value / 1_000) + 'K'
      return scale(value / 1_000_000) + 'M'
    }

    function formatExact(value) {
      if (!Number.isFinite(value) || value <= 0) return '0'
      const rounded = Math.round(value)
      const text = String(rounded)
      let out = ''
      for (let i = 0; i < text.length; i += 1) {
        if (i > 0 && (text.length - i) % 3 === 0) out += ','
        out += text[i]
      }
      return out
    }

    function formatDuration(ms) {
      if (ms === null || !Number.isFinite(ms) || ms < 0) return '—'
      if (ms < 1_000) return Math.round(ms) + 'ms'
      if (ms < 10_000) return (ms / 1_000).toFixed(1) + 's'
      if (ms < 60_000) return Math.round(ms / 1_000) + 's'
      const whole = Math.round(ms / 1_000)
      return Math.floor(whole / 60) + 'm' + String(whole % 60).padStart(2, '0') + 's'
    }

    /** Percent that never rounds a partial hit up to a full hundred. */
    function formatPercent(part, whole) {
      if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null
      const tenths = Math.round((part / whole) * 1_000) / 10
      if (tenths >= 100 && part < whole) return '99.9'
      return String(Math.round(tenths))
    }

    function usageTotals(usage) {
      if (usage === null || typeof usage !== 'object') return null
      const uncached = readNumber(usage.uncachedInputTokens) ?? 0
      const cacheRead = readNumber(usage.cacheReadTokens) ?? 0
      const cacheWrite = readNumber(usage.cacheWriteTokens) ?? 0
      const output = readNumber(usage.outputTokens) ?? 0
      if (uncached + cacheRead + cacheWrite + output === 0) return null
      const billed = uncached + cacheRead + cacheWrite
      return { uncached, cacheRead, cacheWrite, output, billed, cacheHit: formatPercent(cacheRead, billed) }
    }

    /* ------------------------------------------------------------------ *
     * Hooks
     * ------------------------------------------------------------------ */

    /**
     * Live throughput sampler. Token estimates are monotonic inside a step, so
     * the rate is the gain across the newest one-second window; every 200 ms a
     * bucket is appended to the waveform ring. Rates below a half-window of
     * evidence stay `null` instead of spiking on three samples.
     */
    function useThroughput(active, stepKey, tokens) {
      const tokensRef = React.useRef(tokens)
      tokensRef.current = tokens
      const [meter, setMeter] = React.useState(EMPTY_METER)

      React.useEffect(() => {
        if (!active) {
          setMeter(previous => (previous.live ? { ...previous, live: false, rate: null } : previous))
          return undefined
        }
        const origin = Date.now()
        const state = {
          stamps: [{ time: origin, tokens: tokensRef.current }],
          bars: [],
          barAt: origin,
          barTokens: tokensRef.current,
          peak: 0,
        }
        let alive = true
        let timer
        const tick = () => {
          if (!alive) return
          const now = Date.now()
          const current = tokensRef.current
          state.stamps.push({ time: now, tokens: current })
          while (state.stamps.length > 2 && now - state.stamps[0].time > WINDOW_MS) state.stamps.shift()
          const oldest = state.stamps[0]
          const span = now - oldest.time
          const gained = current - oldest.tokens
          const rate = span >= WINDOW_MS * 0.4 && gained >= 0 ? gained / (span / 1_000) : null
          const sinceBucket = now - state.barAt
          if (sinceBucket >= BAR_MS) {
            const bucket = Math.max(0, (current - state.barTokens) / (sinceBucket / 1_000))
            state.bars = state.bars.concat(bucket).slice(-BAR_COUNT)
            if (bucket > state.peak) state.peak = bucket
            state.barAt = now
            state.barTokens = current
          }
          // A hidden window cannot show the bar, so the ~7 renders per second are
          // pure waste there; keep sampling time but skip the commit.
          if (!document.hidden) {
            setMeter({ live: true, rate, bars: state.bars, peak: state.peak, tokens: current, elapsed: now - origin })
          }
          timer = setTimeout(tick, SAMPLE_MS)
        }
        timer = setTimeout(tick, SAMPLE_MS)
        return () => {
          alive = false
          if (timer !== undefined) clearTimeout(timer)
        }
      }, [active, stepKey])

      return meter
    }

    /** Milliseconds elapsed since `startAt`, ticking only while `active`. */
    function useElapsed(active, startAt) {
      const [now, setNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        if (!active) return undefined
        setNow(Date.now())
        const timer = setInterval(() => {
          if (!document.hidden) setNow(Date.now())
        }, 200)
        return () => clearInterval(timer)
      }, [active, startAt])
      if (startAt === null) return null
      return Math.max(0, now - startAt)
    }

    /** Close on Escape or a press outside the panel and its trigger. */
    function useDismiss(open, close, insideRefs) {
      React.useEffect(() => {
        if (!open) return undefined
        const onKey = event => {
          if (event.key === 'Escape') close()
        }
        const onPress = event => {
          const target = event.target
          for (const ref of insideRefs) {
            const node = ref.current
            if (node !== null && node !== undefined && node.contains(target)) return
          }
          close()
        }
        document.addEventListener('keydown', onKey, true)
        document.addEventListener('pointerdown', onPress, true)
        return () => {
          document.removeEventListener('keydown', onKey, true)
          document.removeEventListener('pointerdown', onPress, true)
        }
      }, [open, close, insideRefs])
    }

    /* ------------------------------------------------------------------ *
     * Motion
     * ------------------------------------------------------------------ */

    /**
     * Ease the rendered number toward its target. Only this leaf re-renders,
     * so a rolling reading never repaints the whole dock.
     */
    function useTweened(target, enabled) {
      const [value, setValue] = React.useState(target ?? 0)
      const current = React.useRef(target ?? 0)
      const shown = React.useRef(target ?? 0)
      React.useEffect(() => {
        const goal = target ?? 0
        if (!enabled || Math.abs(goal - current.current) < 0.25) {
          current.current = goal
          setValue(goal)
          return undefined
        }
        let raf = 0
        const step = () => {
          const delta = goal - current.current
          if (Math.abs(delta) < 0.25) {
            current.current = goal
            setValue(goal)
            return
          }
          current.current += delta * 0.24
          // The reading is rendered as whole tok/s, so intermediate floats that
          // round to the same integer are invisible. Emitting only the visible
          // steps turns ~60 renders per second into a handful.
          const visible = Math.round(current.current)
          if (visible !== shown.current) {
            shown.current = visible
            setValue(current.current)
          }
          raf = requestAnimationFrame(step)
        }
        raf = requestAnimationFrame(step)
        return () => cancelAnimationFrame(raf)
      }, [target, enabled])
      return value
    }

    /* ------------------------------------------------------------------ *
     * Glyphs
     * ------------------------------------------------------------------ */

    /** Three-slot level meter; slot heights follow the newest buckets. */
    function PulseMark({ level, state }) {
      const bars = level === null ? [0.28, 0.52, 0.36] : level
      const cells = []
      for (let i = 0; i < 3; i += 1) {
        const ratio = clamp(bars[i] ?? 0, 0, 1)
        const height = state === 'idle' ? 5 : 4 + ratio * 12
        cells.push(h('rect', {
          key: i,
          className: 'xr-mark-bar',
          x: i * 5,
          y: 16 - height,
          width: 3,
          height,
          rx: 1.5,
          style: { transitionDelay: (i * 45) + 'ms' },
        }))
      }
      return h('svg', {
        className: 'xr-mark-svg',
        width: 13,
        height: 16,
        viewBox: '0 0 13 16',
        'aria-hidden': 'true',
        focusable: 'false',
      }, cells)
    }

    function Chevron({ open }) {
      return h('svg', {
        className: 'xr-chevron' + (open ? ' is-open' : ''),
        width: 14,
        height: 14,
        viewBox: '0 0 14 14',
        'aria-hidden': 'true',
        focusable: 'false',
      }, h('path', {
        d: 'M4.4 5.9 L7 8.5 L9.6 5.9',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
    }

    function CloseIcon() {
      return h('svg', {
        width: 13, height: 13, viewBox: '0 0 13 13', 'aria-hidden': 'true', focusable: 'false',
      }, h('path', {
        d: 'M3.4 3.4 L9.6 9.6 M9.6 3.4 L3.4 9.6',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
      }))
    }

    /* ------------------------------------------------------------------ *
     * Signal
     * ------------------------------------------------------------------ */

    /** Catmull-Rom through the bucket points, emitted as cubic beziers. */
    function smoothPath(points) {
      if (points.length === 0) return ''
      let d = 'M' + points[0][0].toFixed(2) + ' ' + points[0][1].toFixed(2)
      for (let i = 0; i < points.length - 1; i += 1) {
        const p0 = points[i === 0 ? 0 : i - 1]
        const p1 = points[i]
        const p2 = points[i + 1]
        const p3 = points[i + 2 === points.length ? i + 1 : i + 2]
        const c1x = p1[0] + (p2[0] - p0[0]) / 6
        const c1y = p1[1] + (p2[1] - p0[1]) / 6
        const c2x = p2[0] - (p3[0] - p1[0]) / 6
        const c2y = p2[1] - (p3[1] - p1[1]) / 6
        d += 'C' + c1x.toFixed(2) + ' ' + c1y.toFixed(2) + ',' + c2x.toFixed(2) + ' ' + c2y.toFixed(2)
          + ',' + p2[0].toFixed(2) + ' ' + p2[1].toFixed(2)
      }
      return d
    }

    /**
     * Buckets stretched across the full width while history is short, then
     * compacted into the last {@link BAR_COUNT}. Padding the left with zeros
     * instead would draw a long dead line before the first sample lands.
     *
     * The vertical axis scales to the observed band rather than to zero: a
     * steady stream varies by single-digit percent between buckets, and against
     * an absolute baseline that is an invisible straight line. A floor on the
     * span keeps a genuinely flat stream flat instead of amplifying noise.
     */
    function wavePoints(bars) {
      const visible = bars.length > BAR_COUNT ? bars.slice(-BAR_COUNT) : bars
      const count = visible.length
      if (count === 0) return []
      let hi = 0
      let lo = Number.POSITIVE_INFINITY
      for (let i = 0; i < count; i += 1) {
        if (visible[i] > hi) hi = visible[i]
        if (visible[i] < lo) lo = visible[i]
      }
      const span = Math.max(hi - lo, hi * 0.22, 24)
      const top = hi + span * 0.18
      const bottom = Math.max(0, hi - span * 1.18)
      const band = top - bottom > 0 ? top - bottom : 1
      const stepX = WAVE_W / Math.max(1, count - 1)
      const points = []
      for (let i = 0; i < count; i += 1) {
        const ratio = clamp((visible[i] - bottom) / band, 0, 1)
        points.push([i * stepX, WAVE_H - 2 - ratio * (WAVE_H - 5)])
      }
      return points
    }

    /**
     * The signal itself. One component serves both surfaces so the dock and the
     * panel always draw the same data with the same easing:
     *
     *   · fewer than two buckets — a hairline with a light crossing it, which
     *     reads as "measuring" rather than as a broken chart;
     *   · otherwise — a filled curve, a travelling sheen while live, and a head
     *     dot pinned to the newest sample. The head is HTML, not SVG: the curve
     *     is stretched with `preserveAspectRatio="none"`, which would squash a
     *     circle into an ellipse.
     */
    const FlowField = React.memo(function FlowField({ bars, live, state, height, dense }) {
      const style = height === undefined ? undefined : { height }
      const empty = bars.length < 2
      const points = empty ? EMPTY_NODES : wavePoints(bars)
      const line = empty ? '' : smoothPath(points)
      const area = empty ? '' : line + 'L' + WAVE_W + ' ' + WAVE_H + 'L0 ' + WAVE_H + 'Z'
      const head = empty ? null : points[points.length - 1]
      const gradient = 'xr-flow-' + (dense ? 'panel' : 'dock')
      const stroke = 'xr-flow-line-' + (dense ? 'panel' : 'dock')

      return h('span', {
        className: 'xr-flow',
        'data-state': state,
        'data-live': live ? 'true' : 'false',
        'data-empty': empty ? 'true' : 'false',
        style,
      },
      dense ? h('span', { className: 'xr-flow-grid', 'aria-hidden': 'true' }) : null,
      empty
        ? h('span', { className: 'xr-flow-ghost', 'aria-hidden': 'true' },
          h('span', { className: 'xr-flow-rule' }),
          h('span', { className: 'xr-flow-ticks' }),
          h('span', { className: 'xr-flow-sweep' }))
        : h('svg', {
          className: 'xr-flow-svg',
          viewBox: '0 0 ' + WAVE_W + ' ' + WAVE_H,
          preserveAspectRatio: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('defs', null,
          h('linearGradient', { id: gradient, x1: '0', y1: '0', x2: '0', y2: '1' },
            h('stop', { offset: '0', className: 'xr-flow-stop-a' }),
            h('stop', { offset: '1', className: 'xr-flow-stop-b' })),
          h('linearGradient', {
            id: stroke,
            gradientUnits: 'userSpaceOnUse',
            x1: '0', y1: '0', x2: String(WAVE_W), y2: '0',
          },
          h('stop', { offset: '0', className: 'xr-flow-edge-a' }),
          h('stop', { offset: '0.06', className: 'xr-flow-edge-b' }),
          h('stop', { offset: '0.94', className: 'xr-flow-edge-b' }),
          h('stop', { offset: '1', className: 'xr-flow-edge-a' }))),
        h('path', { className: 'xr-flow-area', d: area, fill: 'url(#' + gradient + ')' }),
        h('path', {
          className: 'xr-flow-line',
          d: line,
          fill: 'none',
          stroke: 'url(#' + stroke + ')',
          vectorEffect: 'non-scaling-stroke',
        })),
      head === null
        ? null
        : h('span', {
          className: 'xr-flow-head',
          style: { '--xr-head-y': ((head[1] / WAVE_H) * 100).toFixed(1) + '%' },
          'aria-hidden': 'true',
        }),
      live && !empty ? h('span', { className: 'xr-flow-sheen', 'aria-hidden': 'true' }) : null)
    })

    /* ------------------------------------------------------------------ *
     * Detail popover
     * ------------------------------------------------------------------ */

    function Gauge({ percent, level }) {
      const radius = 24
      const circumference = Math.PI * radius
      const clamped = clamp(percent, 0, 100)
      const dash = (clamped / 100) * circumference
      return h('svg', {
        className: 'xr-gauge', viewBox: '0 0 60 38', 'data-level': level, 'aria-hidden': 'true', focusable: 'false',
      },
      h('path', {
        className: 'xr-gauge-track',
        d: 'M6 32 A24 24 0 0 1 54 32',
        fill: 'none',
        strokeWidth: 4.5,
        strokeLinecap: 'round',
      }),
      h('path', {
        className: 'xr-gauge-fill',
        d: 'M6 32 A24 24 0 0 1 54 32',
        fill: 'none',
        strokeWidth: 4.5,
        strokeLinecap: 'round',
        strokeDasharray: dash.toFixed(2) + ' ' + circumference.toFixed(2),
      }))
    }

    function DataRow({ label, value, muted }) {
      return h('li', { className: 'xr-row', 'data-muted': muted ? 'true' : 'false' },
        h('span', { className: 'xr-row-label' }, label),
        h('span', { className: 'xr-row-value' }, value))
    }

    /**
     * One settled step. A row is a button: pressing it pins that step to the
     * hero so an older reading can be inspected without leaving the panel,
     * pressing it again releases the pin.
     */
    function StepRow({ step, scale, selected, onSelect, t }) {
      const rate = formatRate(step.rate)
      const width = rate === null || scale <= 0 ? 0 : clamp((step.rate / scale) * 100, 2, 100)
      return h('li', { className: 'xr-step-item' },
        h('button', {
          type: 'button',
          className: 'xr-step',
          'data-selected': selected ? 'true' : 'false',
          'aria-pressed': selected ? 'true' : 'false',
          title: t('panel.stepTitle', { turn: step.turn, step: step.step }),
          onClick: () => onSelect(step),
        },
        h('span', { className: 'xr-step-rate' },
          rate === null ? '—' : (step.approx ? APPROX : '') + rate,
          step.approx ? h('span', { className: 'xr-step-est' }, t('panel.approxMark')) : null),
        h('span', { className: 'xr-step-track', 'aria-hidden': 'true' },
          h('span', { className: 'xr-step-fill', style: { width: width.toFixed(1) + '%' } })),
        h('span', { className: 'xr-step-tok' }, formatTokens(step.output ?? 0)),
        h('span', { className: 'xr-step-ttft' },
          (step.ttftApprox ? APPROX : '') + formatDuration(step.ttft))))
    }

    function PanelBody({ model, t, close }) {
      const {
        state, liveRate, last, focused, meter, usage, context, steps,
        calibration, errorText, onSelect,
      } = model

      const view = focused !== null && focused !== undefined ? focused : last
      const samples = calibration.samples
      const blank = state === 'waiting' || state === 'tooling'

      /**
       * Scrubbing the curve. Pointer x maps to the bucket under the cursor, and
       * the footer swaps its average/peak for that bucket's own reading — the
       * chart becomes queryable instead of only decorative.
       */
      const bars = meter.bars
      const [hovered, setHovered] = React.useState(null)
      const onScrub = React.useCallback(event => {
        if (bars.length < 2) return
        const node = event.currentTarget
        const rect = node.getBoundingClientRect()
        if (rect.width <= 0) return
        const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1)
        const index = clamp(Math.round(ratio * (bars.length - 1)), 0, bars.length - 1)
        setHovered({ index, percent: (index / Math.max(1, bars.length - 1)) * 100 })
      }, [bars])
      const stopScrub = React.useCallback(() => setHovered(null), [])
      const scrub = hovered === null || hovered.index >= bars.length ? null : {
        value: bars[hovered.index],
        age: (bars.length - 1 - hovered.index) * BAR_MS,
        percent: hovered.percent,
      }

      const heroLabel = state === 'streaming'
        ? t('panel.hero.live')
        : blank
          ? t(state === 'tooling' ? 'panel.hero.tooling' : 'panel.hero.waiting')
          : focused !== null && focused !== undefined
            ? t('panel.stepTitle', { turn: focused.turn, step: focused.step })
            : last !== null ? t('panel.hero.last') : t('panel.hero.idle')

      const heroValue = state === 'streaming'
        ? formatRate(liveRate)
        : blank ? '0' : rateText(view)

      const heroSub = state === 'streaming'
        ? t('panel.hero.subLive', { tokens: formatTokens(meter.tokens), elapsed: formatDuration(meter.elapsed) })
        : state === 'tooling'
          ? t('panel.hero.subTooling')
          : state === 'waiting'
            ? t('panel.hero.subWaiting')
            : view === null
              ? t('panel.hero.subIdle')
              : t('panel.hero.subLast', { tokens: formatTokens(view.output), elapsed: formatDuration(view.decode) })

      const avg = meter.bars.length > 0
        ? meter.bars.reduce((sum, value) => sum + value, 0) / meter.bars.length
        : null

      const sessionRows = usage === null
        ? EMPTY_NODES
        : [
          ['output', formatExact(usage.output)],
          ['input', formatExact(usage.uncached)],
          ['cacheRead', formatExact(usage.cacheRead)],
          ['cacheWrite', formatExact(usage.cacheWrite)],
          ['cacheHit', usage.cacheHit === null ? '—' : usage.cacheHit + '%'],
        ].filter(([key]) => key !== 'cacheWrite' || usage.cacheWrite > 0)

      const scale = steps.reduce((max, step) => (step.rate !== null && step.rate > max ? step.rate : max), 0)

      return h('div', { className: 'xr-panel-inner', 'data-state': state },
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),

        h('header', { className: 'xr-head' },
          h('span', { className: 'xr-head-mark' }, h(PulseMark, { level: null, state })),
          h('div', { className: 'xr-head-text' },
            h('h2', { className: 'xr-title' }, t('panel.title')),
            h('p', { className: 'xr-subtitle' }, t('panel.subtitle'))),
          h('span', { className: 'xr-badge', 'data-state': state },
            state === 'streaming' ? h('span', { className: 'xr-badge-dot', 'aria-hidden': 'true' }) : null,
            t('state.' + state)),
          h('button', {
            type: 'button',
            className: 'xr-close',
            onClick: close,
            title: t('panel.close'),
            'aria-label': t('panel.close'),
          }, h(CloseIcon, null))),

        h('div', { className: 'xr-hero' },
          h('div', { className: 'xr-hero-main' },
            h('span', { className: 'xr-hero-label' }, heroLabel),
            h('div', { className: 'xr-hero-line' },
              h('span', { className: 'xr-hero-value' }, heroValue === null ? '—' : heroValue),
              heroValue === null ? null : h('span', { className: 'xr-hero-unit' }, t('unit'))),
            h('span', { className: 'xr-hero-sub' }, heroSub),
            view !== null && view !== undefined && view.approx && !blank && state !== 'streaming'
              ? h('span', { className: 'xr-hero-note' }, t('panel.hero.approx'))
              : null),
          context === null
            ? null
            : h('div', { className: 'xr-hero-gauge' },
              h(Gauge, { percent: context.percent, level: context.level }),
              h('span', { className: 'xr-gauge-value' }, context.percent + '%'),
              h('span', { className: 'xr-gauge-label' }, t('panel.context')))),

        h('section', { className: 'xr-sec' },
          h('div', { className: 'xr-sec-head' },
            h('span', null, t('panel.flow.title')),
            h('span', { className: 'xr-sec-meta' }, t('panel.flow.window'))),
          h('div', {
            className: 'xr-flow-box',
            onPointerMove: onScrub,
            onPointerLeave: stopScrub,
            onPointerCancel: stopScrub,
          },
          h(FlowField, { bars, live: state === 'streaming', state, height: 58, dense: true }),
          scrub === null
            ? null
            : h('span', {
              className: 'xr-scrub',
              style: { left: scrub.percent.toFixed(2) + '%' },
              'aria-hidden': 'true',
            })),
          h('div', { className: 'xr-flow-foot' },
            h('span', { className: 'xr-flow-ago' }, t('panel.flow.ago')),
            h('span', { className: 'xr-flow-stats' },
              scrub === null
                ? [
                  avg === null ? null : h('span', { key: 'avg', className: 'xr-flow-stat' },
                    t('panel.flow.avg', { value: formatRate(avg) ?? '—' })),
                  meter.peak > 0
                    ? h('span', { key: 'peak', className: 'xr-flow-stat' },
                      t('panel.flow.peak', { value: formatRate(meter.peak) ?? '—' }))
                    : null,
                ]
                : h('span', { className: 'xr-flow-stat xr-flow-scrub-stat' },
                  t('panel.flow.scrub', {
                    rate: (formatRate(scrub.value) ?? '0') + ' ' + t('unit'),
                    ago: formatDuration(scrub.age),
                  }))),
            h('span', { className: 'xr-flow-now' }, t('panel.flow.now')))),

        sessionRows.length === 0 ? null : h('section', { className: 'xr-sec' },
          h('div', { className: 'xr-sec-head' }, h('span', null, t('panel.session'))),
          h('ul', { className: 'xr-rows' }, sessionRows.map(([key, value]) => h(DataRow, {
            key,
            label: t('panel.' + key),
            value,
            muted: value === '0' || value === '—',
          })))),

        context === null ? null : h('section', { className: 'xr-sec' },
          h('div', { className: 'xr-sec-head' },
            h('span', null, t('panel.context')),
            h('span', { className: 'xr-sec-meta' },
              t('panel.contextOf', {
                used: formatTokens(context.used),
                window: formatTokens(context.window),
              }))),
          h('div', { className: 'xr-meter', 'data-level': context.level },
            h('span', {
              className: 'xr-meter-fill',
              style: { width: clamp(context.percent, 1.5, 100) + '%' },
            }))),

        h('section', { className: 'xr-sec xr-sec-steps' },
          h('div', { className: 'xr-sec-head' },
            h('span', null, t('panel.steps')),
            steps.length === 0 ? null : h('span', { className: 'xr-sec-meta' }, t('panel.stepsHint'))),
          steps.length === 0
            ? h('p', { className: 'xr-empty' }, t('panel.stepsEmpty'))
            : h('div', { className: 'xr-step-cols', 'aria-hidden': 'true' },
              h('span', { className: 'xr-step-rate' }, t('panel.col.rate')),
              h('span', { className: 'xr-step-gap' }),
              h('span', { className: 'xr-step-tok' }, t('panel.col.tokens')),
              h('span', { className: 'xr-step-ttft' }, t('panel.col.ttft'))),
          steps.length === 0
            ? null
            : h('ul', { className: 'xr-steps' }, steps.map(step => h(StepRow, {
              key: step.turn + ':' + step.step,
              step,
              scale,
              t,
              selected: focused !== null && focused !== undefined
                && focused.turn === step.turn && focused.step === step.step,
              onSelect,
            }))),

        errorText === null ? null : h('p', { className: 'xr-error' }, t('panel.error', { message: errorText })),

        h('footer', { className: 'xr-foot' },
          h('span', { className: 'xr-calib', 'data-cold': samples === 0 ? 'true' : 'false' },
            samples === 0 ? t('panel.calibrationCold') : t('panel.calibration', { samples })),
          h('span', { className: 'xr-foot-note' }, t('panel.footnote')))))
    }

    /* ------------------------------------------------------------------ *
     * Dock entry
     * ------------------------------------------------------------------ */

    /**
     * The reading itself, isolated so its eased tween re-renders only the
     * number and never the surrounding chrome.
     */
    function HeroReading({ value, unit, placeholder, dim, approx, live, liveLabel }) {
      const tweened = useTweened(value, value !== null)
      const empty = value === null
      const text = empty ? placeholder : (approx ? APPROX : '') + formatRate(tweened)
      return h('span', {
        className: 'xr-read',
        'data-dim': dim ? 'true' : 'false',
        'data-empty': empty ? 'true' : 'false',
      },
      live ? h('span', { className: 'xr-live-dot', title: liveLabel, 'aria-hidden': 'true' }) : null,
      h('span', { className: 'xr-value' }, text),
      empty ? null : h('span', { className: 'xr-unit' }, unit))
    }

    function Meter(props) {
      const { useChat, useProjection, useSession, t: seatT } = props
      const t = typeof seatT === 'function' ? seatT : (key, params) => interpolate(zh[key] ?? key, params)

      const running = useSession(snapshot => snapshot.running) === true
      const lastError = useSession(snapshot => snapshot.lastAgentError)
      const legacy = useChat(snapshot => snapshot.legacy)
      const usageProjection = useProjection('tokenUsage')
      const pressureProjection = useProjection('contextPressure')

      const nodes = legacy === null || legacy === undefined ? EMPTY_NODES : (legacy.nodes ?? EMPTY_NODES)
      const partial = legacy === null || legacy === undefined ? null : (legacy.partial ?? null)
      const turnTimings = legacy === null || legacy === undefined ? null : legacy.turnTimings

      const calibration = React.useMemo(() => fitCalibration(nodes), [nodes])
      const streaming = running && partial !== null
      const stepKey = partial === null ? '' : partial.turn + ':' + partial.step
      const streamed = React.useMemo(
        () => (partial === null ? 0 : estimateTokens(partial.blocks, calibration)),
        [partial, calibration],
      )
      const meter = useThroughput(streaming, stepKey, streamed)

      const steps = React.useMemo(() => recentSteps(nodes, 5), [nodes])
      const last = steps.length > 0 ? steps[0] : null

      /** Start of the newest turn — the clock the waiting state counts from. */
      const turnStart = React.useMemo(() => {
        if (turnTimings === null || typeof turnTimings.forEach !== 'function') return null
        let newest = null
        turnTimings.forEach(timing => {
          const start = timing === null || timing === undefined ? null : readNumber(timing.startTime)
          if (start !== null && (newest === null || start > newest)) newest = start
        })
        return newest
      }, [turnTimings])

      /**
       * A turn spends time in tool calls between steps. That is neither
       * "streaming" nor "waiting for the first token", and it is the reason a
       * plain `running && !partial` test shows a stale 60-minute wait clock
       * while the agent is actually working.
       */
      const runningCalls = legacy === null || legacy === undefined || legacy.runningCalls === undefined
        ? EMPTY_NODES
        : legacy.runningCalls
      const tooling = running && partial === null && runningCalls.length > 0
      const waiting = running && partial === null && !tooling

      /** Newest completed step — the boundary the interlude clock starts from. */
      const lastCompleted = React.useMemo(() => {
        let newest = null
        for (let i = nodes.length - 1; i >= 0 && newest === null; i -= 1) {
          const node = nodes[i]
          if (node === null || typeof node !== 'object' || node.kind !== 'assistant') continue
          const timing = node.timing === null || typeof node.timing !== 'object' ? null : node.timing
          const done = timing === null ? null : readNumber(timing.completedTime)
          if (done !== null) newest = done
        }
        return newest
      }, [nodes])

      const waitAnchor = turnStart === null
        ? lastCompleted
        : lastCompleted === null ? turnStart : Math.max(turnStart, lastCompleted)
      const waited = useElapsed(waiting, waitAnchor)
      const toolingFor = useElapsed(tooling, waitAnchor)

      const state = streaming
        ? 'streaming'
        : tooling
          ? 'tooling'
          : waiting
            ? 'waiting'
            : lastError !== null && lastError !== undefined
              ? 'error'
              : last !== null ? 'settled' : 'idle'

      const liveRate = state === 'streaming' && streamed > 0 ? meter.rate : null
      const heroValue = state === 'streaming'
        ? (streamed > 0 ? liveRate : 0)
        : state === 'waiting' || state === 'tooling'
          ? 0
          : last === null ? null : last.rate
      const heroDim = state === 'idle' || state === 'error' || state === 'tooling'

      const level = React.useMemo(() => {
        if (state !== 'streaming') return null
        const tail = meter.bars.slice(-3)
        if (tail.length === 0) return null
        const ceiling = Math.max(60, meter.peak)
        return [0, 0, 0].map((_, index) => (tail[index] ?? 0) / ceiling)
      }, [state, meter.bars, meter.peak])

      const usage = React.useMemo(
        () => usageTotals(usageProjection === undefined ? null : usageProjection),
        [usageProjection],
      )

      const context = React.useMemo(() => {
        if (pressureProjection === null || pressureProjection === undefined) return null
        const used = readNumber(pressureProjection.pressureTokens)
        const projected = readNumber(pressureProjection.projectedTokens)
        const size = readNumber(pressureProjection.contextWindow)
        const taken = used ?? projected
        if (taken === null || size === null || size <= 0) return null
        const percent = Math.round(clamp((taken / size) * 100, 0, 100))
        return {
          used: taken,
          window: size,
          percent,
          level: percent >= 95 ? 'danger' : percent >= 80 ? 'warn' : 'normal',
        }
      }, [pressureProjection])

      const [open, setOpen] = React.useState(false)
      const [pinned, setPinned] = React.useState(null)
      const barRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const [anchor, setAnchor] = React.useState(null)
      const close = React.useCallback(() => setOpen(false), [])
      const inside = React.useMemo(() => [barRef, panelRef], [])
      useDismiss(open, close, inside)

      React.useEffect(() => {
        if (open) return undefined
        setAnchor(null)
        setPinned(null)
        return undefined
      }, [open])

      React.useEffect(() => {
        if (!open) return undefined
        const measure = () => {
          const node = barRef.current
          if (node === null || node === undefined) return
          const rect = node.getBoundingClientRect()
          setAnchor({
            bottom: Math.max(12, window.innerHeight - rect.top + 10),
            right: Math.max(12, Math.min(window.innerWidth - 12, window.innerWidth - rect.right)),
          })
        }
        measure()
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
      }, [open])

      /** A pinned step only counts while it is still in the visible list. */
      const focused = React.useMemo(() => {
        if (pinned === null) return null
        for (const step of steps) {
          if (step.turn === pinned.turn && step.step === pinned.step) return step
        }
        return null
      }, [pinned, steps])

      const onSelect = React.useCallback(step => {
        setPinned(current => (current !== null && current.turn === step.turn && current.step === step.step
          ? null
          : { turn: step.turn, step: step.step }))
      }, [])

      const errorText = lastError === null || lastError === undefined
        ? null
        : (typeof lastError === 'string' ? lastError : (lastError.message ?? String(lastError)))

      const chips = []
      if (state === 'streaming' && streamed > 0) {
        chips.push({ key: 'step', text: t('dock.step', { tokens: formatTokens(streamed) }), tone: 'live' })
      } else if (state === 'tooling') {
        chips.push({
          key: 'tool',
          text: toolingFor === null ? t('state.tooling') : t('dock.tooling', { value: formatDuration(toolingFor) }),
          tone: 'wait',
        })
      } else if (state === 'waiting') {
        chips.push({
          key: 'wait',
          text: waited === null ? t('state.waiting') : t('dock.waiting', { value: formatDuration(waited) }),
          tone: 'wait',
        })
      } else if (last !== null && last.output !== null) {
        chips.push({ key: 'step', text: t('dock.step', { tokens: formatTokens(last.output) }) })
      }
      if (last !== null && last.ttft !== null && state !== 'waiting') {
        chips.push({
          key: 'ttft',
          text: t('dock.ttft', { value: (last.ttftApprox ? APPROX : '') + formatDuration(last.ttft) }),
          tone: 'quiet',
          className: 'xr-chip-ttft',
        })
      }
      if (usage !== null && usage.cacheHit !== null) {
        chips.push({
          key: 'cache',
          text: t('dock.cache', { percent: usage.cacheHit }),
          tone: 'quiet',
          className: 'xr-chip-cache',
        })
      }
      if (context !== null) {
        chips.push({
          key: 'ctx',
          text: t('dock.context', { percent: context.percent }),
          tone: context.level,
          className: 'xr-chip-ctx',
        })
      }

      const model = {
        state, liveRate, last, focused, meter, usage, context, steps, calibration, errorText, onSelect,
      }

      const reading = state === 'streaming' ? formatRate(liveRate) : null
      const describe = reading === null
        ? t('dock.expand')
        : t('dock.label') + ' ' + reading + ' ' + t('unit') + ' · ' + t('state.' + state)

      const panel = open && anchor !== null
        ? createPortal(
          h('div', {
            ref: panelRef,
            className: 'xr-panel',
            role: 'dialog',
            'aria-modal': 'false',
            'aria-label': t('panel.title'),
            style: { bottom: anchor.bottom, right: anchor.right },
          }, h(PanelBody, { model, t, close })),
          document.body,
        )
        : null

      return h('div',
        { className: 'xr-dock', 'data-xinyu-token-rate': state },
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
        h('button', {
          type: 'button',
          ref: barRef,
          className: 'xr-bar',
          'data-state': state,
          onClick: () => setOpen(value => !value),
          'aria-expanded': open ? 'true' : 'false',
          'aria-label': describe,
          title: t(open ? 'dock.collapse' : 'dock.expand'),
        },
        h('span', { className: 'xr-mark', 'data-state': state, 'aria-hidden': 'true' },
          h(PulseMark, { level, state })),
        h('span', { className: 'xr-read-slot', 'aria-hidden': 'true' },
          h(HeroReading, {
            value: heroValue,
            approx: state === 'settled' && last !== null && last.approx === true,
            unit: t('unit'),
            placeholder: '—',
            dim: heroDim,
            live: state === 'streaming',
            liveLabel: t('dock.pulse'),
          })),
        h('span', { className: 'xr-flow-slot', 'aria-hidden': 'true' },
          h(FlowField, {
            bars: state === 'streaming' ? meter.bars : EMPTY_NODES,
            live: state === 'streaming',
            state,
          })),
        h('span', { className: 'xr-chips' },
          chips.map(chip => h('span', {
            key: chip.key,
            className: 'xr-chip' + (chip.className === undefined ? '' : ' ' + chip.className),
            'data-tone': chip.tone ?? 'normal',
          }, chip.text))),
        h('span', { className: 'xr-chevron-slot', 'aria-hidden': 'true' }, h(Chevron, { open }))),
        panel)
    }

    /** A thrown derivation must never take the composer down with it. */
    class Guard extends React.Component {
      constructor(properties) {
        super(properties)
        this.state = { failed: false }
      }

      static getDerivedStateFromError() {
        return { failed: true }
      }

      componentDidCatch(error) {
        if (typeof console !== 'undefined' && typeof console.error === 'function') {
          console.error('[xinyu-token-rate]', error)
        }
      }

      render() {
        if (!this.state.failed) return this.props.children
        return h('div', { className: 'xr-dock', 'data-xinyu-token-rate': 'failed' },
          h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
          h('div', { className: 'xr-bar', 'data-state': 'idle' },
            h('span', { className: 'xr-mark', 'data-state': 'idle', 'aria-hidden': 'true' },
              h(PulseMark, { level: null, state: 'idle' })),
            h('span', { className: 'xr-read-slot' },
              h('span', { className: 'xr-read', 'data-empty': 'true' },
                h('span', { className: 'xr-value' }, '—')))))
      }
    }

    function DockEntry(properties) {
      return h(Guard, null, h(Meter, properties))
    }

    function interpolate(template, params) {
      if (typeof template !== 'string') return String(template)
      if (params === undefined || params === null) return template
      return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
    }

    /* ------------------------------------------------------------------ *
     * Styles
     * ------------------------------------------------------------------ */

    const CSS = `
@layer xinyu-token-rate {
  .xr-dock {
    width: calc(100% - 2 * var(--dsh-composer-side-clearance, 16px) - 4 * var(--dsh-composer-dock-inset, 8px));
    max-width: calc(var(--dsh-composer-card-max-width, 952px) - 4 * var(--dsh-composer-dock-inset, 8px));
    margin: 0 auto 6px;
    --xr-ink: var(--dsw-alias-state-business-primary);
    --xr-radius: var(--dsw-radius-md, 12px);
  }

  /* ---- the bar ----------------------------------------------------- */

  .xr-bar {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 36px;
    padding: 0 8px 0 11px;
    border: 0;
    border-radius: var(--xr-radius);
    background: transparent;
    box-shadow: var(--dsw-elevation-panel);
    color: var(--dsw-alias-label-secondary);
    font: inherit;
    text-align: left;
    cursor: pointer;
    isolation: isolate;
    transition: color 200ms ease, box-shadow 200ms ease;
  }

  .xr-bar::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2));
    /* No backdrop-filter here on purpose. The surface token is ~94% opaque, so
       the blur was invisible, but it still forced the whole bar to re-blur on
       every animated frame — by far the most expensive thing in this widget. */
    box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l1);
    transition: box-shadow 200ms ease;
  }

  .xr-bar:hover::before { box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); }
  .xr-bar:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
  .xr-bar:focus-visible::before { box-shadow: inset 0 0 0 1px var(--dsw-alias-brand-primary); }

  .xr-bar[data-state='streaming'] { --xr-ink: var(--dsw-alias-state-business-primary); }
  .xr-bar[data-state='waiting']   { --xr-ink: var(--dsw-alias-state-warn-primary); }
  .xr-bar[data-state='tooling']   { --xr-ink: var(--dsw-alias-state-warn-primary); }
  .xr-bar[data-state='settled']   { --xr-ink: var(--dsw-alias-state-success-primary); }
  .xr-bar[data-state='error']     { --xr-ink: var(--dsw-alias-state-error-primary); }
  .xr-bar[data-state='idle']      { --xr-ink: var(--dsw-alias-label-tertiary); }

  /* ---- mark -------------------------------------------------------- */

  .xr-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 13px;
    height: 16px;
    color: var(--xr-ink);
    transition: color 320ms ease;
  }

  .xr-mark-svg { display: block; overflow: visible; }

  .xr-mark-bar {
    fill: currentColor;
    opacity: 0.9;
    transform-box: fill-box;
    transform-origin: 50% 100%;
    transition: height 260ms cubic-bezier(0.22, 1, 0.36, 1),
                y 260ms cubic-bezier(0.22, 1, 0.36, 1),
                opacity 260ms ease;
  }

  .xr-mark[data-state='idle'] .xr-mark-bar { opacity: 0.42; }
  .xr-mark[data-state='error'] .xr-mark-bar { opacity: 0.55; }

  /* While streaming the curve itself is the motion; a second infinite loop in
     the same 36px strip only competes with it (and costs a frame). */

  .xr-mark[data-state='waiting'] .xr-mark-bar:nth-child(1) { opacity: 0.5; }
  .xr-mark[data-state='waiting'] .xr-mark-bar:nth-child(2) { opacity: 0.78; }
  .xr-mark[data-state='waiting'] .xr-mark-bar:nth-child(3) { opacity: 0.36; }

  .xr-mark[data-state='tooling'] .xr-mark-bar:nth-child(1) { opacity: 0.34; }
  .xr-mark[data-state='tooling'] .xr-mark-bar:nth-child(2) { opacity: 0.46; }
  .xr-mark[data-state='tooling'] .xr-mark-bar:nth-child(3) { opacity: 0.28; }

  /* One moving thing per state. The 13px mark used to pulse alongside the
     sweep / the curve; two infinite loops in a 36px strip read as noise and
     each one costs a compositor frame. Its slots still differ in opacity so
     the state is legible at rest. */

  /* ---- reading ----------------------------------------------------- */

  .xr-read-slot {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    min-width: 74px;
  }

  .xr-read {
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
    color: var(--dsw-alias-label-primary);
    transition: color 240ms ease, opacity 240ms ease;
  }

  .xr-read[data-dim='true'] { color: var(--dsw-alias-label-tertiary); }
  .xr-read[data-empty='true'] .xr-value { opacity: 0.7; }

  .xr-live-dot {
    align-self: center;
    width: 5px;
    height: 5px;
    margin-right: 4px;
    border-radius: 50%;
    color: var(--xr-ink);
    background: currentColor;
  }

  @keyframes xr-breathe {
    0%, 100% { opacity: 0.35; transform: scale(0.86); }
    50%      { opacity: 1; transform: scale(1); }
  }

  .xr-value {
    min-width: 34px;
    font-size: 15px;
    font-weight: 600;
    line-height: 1;
    letter-spacing: -0.012em;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .xr-unit {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.02em;
    color: var(--dsw-alias-label-tertiary);
    white-space: nowrap;
  }

  .xr-bar[data-state='streaming'] .xr-read { color: var(--dsw-alias-label-primary); }
  .xr-bar[data-state='streaming'] .xr-value { color: var(--xr-ink); }
  .xr-bar[data-state='waiting'] .xr-value,
  .xr-bar[data-state='waiting'] .xr-unit { color: var(--xr-ink); }
  .xr-bar[data-state='waiting'] .xr-unit { opacity: 0.65; }

  /* ---- the signal -------------------------------------------------- */

  .xr-flow-slot {
    position: relative;
    flex: 1 1 auto;
    min-width: 48px;
    height: 100%;
    display: flex;
    align-items: center;
    color: var(--xr-ink);
    overflow: hidden;
    /* No mask-image here. A mask on the container forced the whole strip to be
       re-masked on every frame of the head/curve animation; the fade was worth
       less than the compositing it cost. */
    padding-right: 4px;
    /* The hairline still needs a soft entry so the first bucket does not start
       with a blunt edge; a tiny inset shadow is cheaper than a mask. */
  }

  .xr-flow {
    position: relative;
    display: block;
    width: 100%;
    height: 22px;
    color: var(--xr-ink);
  }

  .xr-flow[data-state='idle']    { opacity: 0.5; }
  .xr-flow[data-state='waiting'] { opacity: 0.72; }
  .xr-flow[data-state='tooling'] { opacity: 0.6; }

  .xr-flow-svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .xr-flow-line {
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.9;
  }

  .xr-flow-area { opacity: 0.5; }
  .xr-flow-stop-a { stop-color: currentColor; stop-opacity: 0.34; }
  .xr-flow-stop-b { stop-color: currentColor; stop-opacity: 0; }

  /* The curve fades out at both ends through its own stroke gradient instead of
     a mask on the container: same look, nothing to recomposite per frame. */
  .xr-flow-edge-a { stop-color: currentColor; stop-opacity: 0; }
  .xr-flow-edge-b { stop-color: currentColor; stop-opacity: 0.95; }

  .xr-flow-head {
    position: absolute;
    right: 0;
    top: var(--xr-head-y, 50%);
    width: 6px;
    height: 6px;
    margin-top: -3px;
    border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 18%, transparent);
    transition: top 240ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  /* The halo is a sibling ring, not an animated box-shadow: repainting a blur
     every frame is the one thing that made this bar expensive. */
  .xr-flow-head::after {
    content: "";
    position: absolute;
    inset: -3px;
    border-radius: 50%;
    box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 22%, transparent);
  }

  .xr-flow[data-live='true'] .xr-flow-head { animation: xr-beat 1.4s ease-in-out infinite; }

  @keyframes xr-beat {
    0%, 100% { opacity: 0.55; }
    50%      { opacity: 1; }
  }

  /* Kept only for the panel's tall chart, where a moving line over 58px is not
     enough to read as live. The 22px dock strip relies on the curve itself. */
  .xr-flow-sheen {
    position: absolute;
    inset: 0 auto 0 0;
    width: 46%;
    pointer-events: none;
    background: linear-gradient(
      100deg,
      transparent 0%,
      color-mix(in srgb, currentColor 15%, transparent) 42%,
      color-mix(in srgb, currentColor 24%, transparent) 50%,
      color-mix(in srgb, currentColor 15%, transparent) 58%,
      transparent 100%
    );
    animation: xr-sheen 2.6s linear infinite;
    will-change: transform;
  }

  .xr-dock .xr-flow-sheen { display: none; }

  /* Translate a narrow band instead of sliding a 220%-wide background: the
     compositor moves one layer, the paint cost stays flat. */
  @keyframes xr-sheen {
    from { transform: translate3d(-100%, 0, 0); }
    to   { transform: translate3d(218%, 0, 0); }
  }

  /* ---- empty signal: a measuring hairline -------------------------- */

  .xr-flow-ghost {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }

  .xr-flow-rule {
    position: absolute;
    inset: 50% 0 auto;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent 0%,
      color-mix(in srgb, currentColor 15%, transparent) 22%,
      color-mix(in srgb, currentColor 15%, transparent) 78%,
      transparent 100%
    );
  }

  /* Ticks make the empty state read as a measuring instrument rather than
     as a broken chart: short marks every 8px, a taller one every 40px. */
  .xr-flow-ticks {
    position: absolute;
    inset: 50% 12px auto;
    height: 9px;
    transform: translateY(-50%);
    opacity: 0.5;
    background-image:
      repeating-linear-gradient(90deg,
        color-mix(in srgb, currentColor 20%, transparent) 0 1px,
        transparent 1px 40px),
      repeating-linear-gradient(90deg,
        color-mix(in srgb, currentColor 11%, transparent) 0 1px,
        transparent 1px 8px);
    background-size: 100% 9px, 100% 4px;
    background-position: 0 0, 0 2.5px;
    background-repeat: repeat-x;
    -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%);
    mask-image: linear-gradient(90deg, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%);
  }

  .xr-flow-sweep {
    position: absolute;
    top: 50%;
    left: 0;
    width: 72px;
    height: 1.5px;
    margin-top: -0.75px;
    border-radius: 1px;
    background: linear-gradient(90deg, transparent, currentColor, transparent);
    opacity: 0.6;
    animation: xr-sweep 2.4s cubic-bezier(0.42, 0, 0.58, 1) infinite;
    /* Promote the sweep to its own layer: it is the only element that moves in
       the waiting/tooling states, so it should not repaint the whole strip. */
    transform: translateZ(0);
    will-change: transform;
  }

  .xr-flow[data-state='idle'] .xr-flow-ticks { opacity: 0.24; }
  .xr-flow[data-state='settled'] .xr-flow-ticks { opacity: 0.32; }
  .xr-flow[data-state='tooling'] .xr-flow-ticks { opacity: 0.34; }

  /* In the 36px dock the travelling sweep is replaced by a slow pulse of the
     hairline itself: same "still measuring" read, one composited layer instead
     of a repaint every frame. The taller panel chart keeps the sweep. */
  .xr-dock .xr-flow-sweep { display: none; }

  .xr-dock .xr-flow[data-state='waiting'] .xr-flow-ghost { animation: xr-breathe 2.4s ease-in-out infinite; }
  .xr-dock .xr-flow[data-state='tooling'] .xr-flow-ghost { animation: xr-breathe 3.2s ease-in-out infinite; }

  /* Idle is the only state that would animate forever while nothing happens,
     so it is deliberately still: a measured hairline, not a heartbeat. */
  .xr-flow[data-state='idle'] .xr-flow-sweep { animation: none; opacity: 0.3; }
  .xr-flow[data-state='tooling'] .xr-flow-sweep { animation-duration: 3.4s; opacity: 0.36; }
  .xr-flow[data-state='settled'] .xr-flow-sweep,
  .xr-flow[data-state='error'] .xr-flow-sweep { animation: none; opacity: 0; }

  @keyframes xr-sweep {
    0%   { transform: translateX(-72px); opacity: 0; }
    16%  { opacity: 0.75; }
    84%  { opacity: 0.75; }
    100% { transform: translateX(var(--xr-flow-span, 100%)); opacity: 0; }
  }

  /* ---- chips ------------------------------------------------------- */

  .xr-chips {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 9px;
    padding-left: 2px;
  }

  .xr-chip {
    font-size: 11px;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: var(--dsw-alias-label-tertiary);
    white-space: nowrap;
    transition: color 200ms ease;
  }

  .xr-chip[data-tone='live']   { color: var(--dsw-alias-label-secondary); }
  .xr-chip[data-tone='wait']   { color: var(--dsw-alias-state-warn-primary); }
  .xr-chip[data-tone='warn']   { color: var(--dsw-alias-state-warn-primary); }
  .xr-chip[data-tone='danger'] { color: var(--dsw-alias-state-error-primary); }

  /* ---- chevron ----------------------------------------------------- */

  .xr-chevron-slot {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    color: var(--dsw-alias-label-tertiary);
    transition: color 160ms ease;
  }

  .xr-bar:hover .xr-chevron-slot { color: var(--dsw-alias-label-primary); }

  .xr-chevron { transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1); }
  .xr-chevron.is-open { transform: rotate(180deg); }

  /* ---- panel ------------------------------------------------------- */

  .xr-panel {
    position: fixed;
    z-index: 1200;
    width: max-content;
    min-width: min(316px, calc(100vw - 24px));
    max-width: min(432px, calc(100vw - 24px));
    border-radius: var(--dsw-radius-lg, 16px);
    background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2));
    backdrop-filter: var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%));
    box-shadow: var(--dsw-elevation-prominent, var(--dsw-elevation-panel)),
                inset 0 0 0 1px var(--dsw-alias-border-l1);
    color: var(--dsw-alias-label-primary);
    overflow: hidden;
    animation: xr-panel-in 220ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes xr-panel-in {
    from { opacity: 0; transform: translateY(6px) scale(0.982); }
    to   { opacity: 1; transform: none; }
  }

  .xr-panel-inner {
    display: flex;
    flex-direction: column;
    gap: 13px;
    padding: 13px 15px 12px;
    --xr-ink: var(--dsw-alias-label-tertiary);
  }

  .xr-panel-inner[data-state='streaming'] { --xr-ink: var(--dsw-alias-state-business-primary); }
  .xr-panel-inner[data-state='waiting']   { --xr-ink: var(--dsw-alias-state-warn-primary); }
  .xr-panel-inner[data-state='tooling']   { --xr-ink: var(--dsw-alias-state-warn-primary); }
  .xr-panel-inner[data-state='settled']   { --xr-ink: var(--dsw-alias-state-success-primary); }
  .xr-panel-inner[data-state='error']     { --xr-ink: var(--dsw-alias-state-error-primary); }

  .xr-head {
    display: flex;
    align-items: center;
    gap: 9px;
  }

  .xr-head-mark { display: inline-flex; color: var(--xr-ink); }
  .xr-head-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }

  .xr-title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--dsw-alias-label-primary);
  }

  .xr-subtitle {
    margin: 0;
    font-size: 11px;
    color: var(--dsw-alias-label-tertiary);
  }

  .xr-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    padding: 2px 7px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.02em;
    white-space: nowrap;
    color: var(--xr-ink);
    background: color-mix(in srgb, currentColor 12%, transparent);
  }

  .xr-badge-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: currentColor;
    animation: xr-breathe 1.6s ease-in-out infinite;
  }

  .xr-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: var(--dsw-radius-xs, 4px);
    background: transparent;
    color: var(--dsw-alias-label-tertiary);
    cursor: pointer;
    transition: background 160ms ease, color 160ms ease;
  }

  .xr-close:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
  .xr-close:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }

  /* ---- hero -------------------------------------------------------- */

  .xr-hero {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
  }

  .xr-hero-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }

  .xr-hero-label {
    font-size: 10px;
    letter-spacing: 0.045em;
    text-transform: uppercase;
    color: var(--dsw-alias-label-tertiary);
  }

  .xr-hero-line { display: flex; align-items: baseline; gap: 4px; }

  .xr-hero-value {
    font-size: 31px;
    font-weight: 600;
    line-height: 1;
    letter-spacing: -0.025em;
    font-variant-numeric: tabular-nums;
    color: var(--dsw-alias-label-primary);
    transition: color 240ms ease;
  }

  .xr-panel-inner[data-state='streaming'] .xr-hero-value { color: var(--xr-ink); }

  .xr-hero-unit { font-size: 11px; color: var(--dsw-alias-label-tertiary); }

  .xr-hero-sub {
    font-size: 11px;
    color: var(--dsw-alias-label-secondary);
    font-variant-numeric: tabular-nums;
  }

  .xr-hero-note { font-size: 10px; color: var(--dsw-alias-label-tertiary); }

  .xr-hero-gauge {
    position: relative;
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    align-items: center;
    width: 78px;
  }

  .xr-gauge { width: 60px; height: 38px; overflow: visible; }
  .xr-gauge-track { stroke: var(--dsw-alias-border-l2); }

  .xr-gauge-fill {
    stroke: var(--dsw-alias-state-business-primary);
    transition: stroke-dasharray 420ms cubic-bezier(0.22, 1, 0.36, 1), stroke 220ms ease;
  }

  .xr-gauge[data-level='warn'] .xr-gauge-fill { stroke: var(--dsw-alias-state-warn-primary); }
  .xr-gauge[data-level='danger'] .xr-gauge-fill { stroke: var(--dsw-alias-state-error-primary); }

  .xr-gauge-value {
    position: absolute;
    top: 19px;
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--dsw-alias-label-primary);
  }

  .xr-gauge-label {
    margin-top: -1px;
    font-size: 10px;
    color: var(--dsw-alias-label-tertiary);
    white-space: nowrap;
  }

  /* ---- sections ---------------------------------------------------- */

  .xr-sec { display: flex; flex-direction: column; gap: 6px; }

  .xr-sec-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-size: 10px;
    letter-spacing: 0.035em;
    text-transform: uppercase;
    color: var(--dsw-alias-label-tertiary);
  }

  .xr-sec-meta {
    text-transform: none;
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
  }

  .xr-flow-box {
    position: relative;
    padding: 5px 9px;
    border-radius: var(--dsw-radius-sm, 8px);
    background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 58%, transparent);
    box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l1);
    color: var(--xr-ink);
    overflow: hidden;
    cursor: crosshair;
    touch-action: none;
  }

  .xr-scrub {
    position: absolute;
    top: 4px;
    bottom: 4px;
    width: 1px;
    margin-left: -0.5px;
    background: color-mix(in srgb, var(--dsw-alias-label-primary) 55%, transparent);
    pointer-events: none;
    transition: left 60ms linear;
  }

  .xr-scrub::before {
    content: '';
    position: absolute;
    top: 1px;
    left: -1.5px;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--dsw-alias-label-primary);
  }

  .xr-flow-box .xr-flow { height: 58px; }

  .xr-flow-grid {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image: linear-gradient(
      180deg,
      color-mix(in srgb, var(--dsw-alias-border-l1) 65%, transparent) 0 1px,
      transparent 1px 100%
    );
    background-size: 100% 33.33%;
    opacity: 0.5;
  }

  .xr-flow-foot {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    color: var(--dsw-alias-label-tertiary);
  }

  .xr-flow-stats { display: inline-flex; gap: 10px; }
  .xr-flow-stat { color: var(--dsw-alias-label-secondary); }

  .xr-flow-scrub-stat {
    color: var(--dsw-alias-label-primary);
    font-weight: 500;
  }
  .xr-flow-ago, .xr-flow-now { opacity: 0.72; }

  /* ---- rows -------------------------------------------------------- */

  .xr-rows {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 16px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .xr-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    padding: 3.5px 0;
    font-size: 11px;
    border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 50%, transparent);
  }

  .xr-row-label { color: var(--dsw-alias-label-tertiary); }

  .xr-row-value {
    font-variant-numeric: tabular-nums;
    color: var(--dsw-alias-label-primary);
  }

  .xr-row[data-muted='true'] .xr-row-value { color: var(--dsw-alias-label-tertiary); }

  .xr-meter {
    height: 4px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--dsw-alias-border-l2) 90%, transparent);
    overflow: hidden;
  }

  .xr-meter-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--dsw-alias-state-business-primary);
    transition: width 420ms cubic-bezier(0.22, 1, 0.36, 1), background 220ms ease;
  }

  .xr-meter[data-level='warn'] .xr-meter-fill { background: var(--dsw-alias-state-warn-primary); }
  .xr-meter[data-level='danger'] .xr-meter-fill { background: var(--dsw-alias-state-error-primary); }

  /* ---- steps ------------------------------------------------------- */

  .xr-step-cols {
    display: grid;
    grid-template-columns: 52px 1fr 44px 44px;
    align-items: center;
    gap: 8px;
    padding: 0 6px 2px;
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.035em;
    text-transform: uppercase;
    color: var(--dsw-alias-label-tertiary);
  }

  .xr-step-cols .xr-step-rate { font-weight: 400; color: inherit; }

  .xr-step-cols .xr-step-tok,
  .xr-step-cols .xr-step-ttft { width: auto; }

  .xr-sec-steps { gap: 3px; }

  .xr-steps {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .xr-step-item { display: block; }

  .xr-step {
    display: grid;
    grid-template-columns: 52px 1fr 44px 44px;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 6px;
    border: 0;
    border-radius: var(--dsw-radius-xs, 4px);
    background: transparent;
    color: var(--dsw-alias-label-secondary);
    font: inherit;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    text-align: right;
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease;
  }

  .xr-step:hover { background: var(--dsw-alias-interactive-bg-hover); }
  .xr-step:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }

  .xr-step[data-selected='true'] {
    background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
    color: var(--dsw-alias-label-primary);
  }

  .xr-step-rate {
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
    justify-content: flex-start;
    font-weight: 600;
    color: var(--dsw-alias-label-primary);
  }

  .xr-step-est {
    font-size: 9px;
    font-weight: 400;
    color: var(--dsw-alias-label-tertiary);
  }

  .xr-step-track {
    position: relative;
    height: 3px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--dsw-alias-border-l2) 80%, transparent);
    overflow: hidden;
  }

  .xr-step-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg,
      color-mix(in srgb, var(--xr-ink) 45%, transparent),
      var(--xr-ink));
    transition: width 320ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .xr-step-tok,
  .xr-step-ttft {
    width: 44px;
    text-align: right;
    color: var(--dsw-alias-label-tertiary);
  }

  .xr-empty, .xr-error {
    margin: 0;
    font-size: 11px;
    color: var(--dsw-alias-label-tertiary);
  }

  .xr-error { color: var(--dsw-alias-state-error-primary); }

  /* ---- footer ------------------------------------------------------ */

  .xr-foot {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding-top: 8px;
    border-top: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 70%, transparent);
  }

  .xr-calib { font-size: 10px; color: var(--dsw-alias-state-success-primary); }
  .xr-calib[data-cold='true'] { color: var(--dsw-alias-label-tertiary); }

  .xr-foot-note {
    font-size: 10px;
    line-height: 1.5;
    color: var(--dsw-alias-label-tertiary);
  }

  /* ---- narrow composer: shed the least important reading first ------ */

  @media (max-width: 1040px) {
    .xr-chip-ttft { display: none; }
  }

  @media (max-width: 900px) {
    .xr-chip-cache { display: none; }
  }

  @media (max-width: 780px) {
    .xr-flow-slot { display: none; }
  }

  @media (max-width: 620px) {
    .xr-chip-ctx { display: none; }
    .xr-read-slot { min-width: 62px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .xr-mark-bar,
    .xr-live-dot,
    .xr-badge-dot,
    .xr-flow-head,
    .xr-flow-sheen,
    .xr-flow-sweep,
    .xr-panel { animation: none !important; }
    .xr-chevron,
    .xr-meter-fill,
    .xr-gauge-fill,
    .xr-step-fill,
    .xr-step,
    .xr-scrub { transition: none !important; }
  }
}
`

    /* ------------------------------------------------------------------ *
     * Plugin body
     * ------------------------------------------------------------------ */

    const inject = ['slots', 'locale']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'xinyu-token-rate: dictionaries')
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'xinyu-token-rate',
        order: 15,
        locale: NS,
      }, DockEntry))
    }

    return { inject, apply }
  },
})
