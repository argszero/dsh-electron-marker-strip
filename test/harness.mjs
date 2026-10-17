/**
 * Shared fixtures: a logger that keeps every line, a cordis-shaped context that
 * records what the plugin registered for disposal, and the two environment
 * shapes the seam touches.
 *
 * The plugin's outward surface is one call on a context plus mutations of a
 * record, so the fakes here are small on purpose — a test that mounts a real
 * fiber just to assert a log line would be testing cordis rather than this
 * plugin. The places a real fiber and a real child process *are* the point use
 * them in `witness.spec.mjs`.
 */

/** A logger that keeps every line, with the level it was written at. */
export function recordingLogger() {
  const lines = []
  const record = level => (message) => { lines.push({ level, message: String(message) }) }
  return {
    lines,
    warn: record('warn'),
    debug: record('debug'),
    info: record('info'),
    error: record('error'),
    /** Every line whose text contains `needle`. */
    matching(needle) { return lines.filter(line => line.message.includes(needle)) },
    /** The joined text of every line. */
    text() { return lines.map(line => line.message).join('\n') },
    /** The levels the lines were written at. */
    levels() { return lines.map(line => line.level) },
  }
}

/**
 * A cordis-shaped context: a logger, and an `effect` that runs the body now and
 * keeps the disposer, exactly as cordis does on a scope teardown.
 */
export function fakeContext(options = {}) {
  const logger = options.logger ?? recordingLogger()
  const effects = []
  const ctx = {
    logger,
    effect(register, label) {
      effects.push({ undo: register(), label })
    },
  }
  return {
    ctx,
    logger,
    effects,
    /** Run every registered disposer, newest first, as a scope teardown does. */
    disposeAll() {
      for (const entry of [...effects].reverse()) entry.undo()
    },
  }
}

/** The shipped keep-rule, restated so this suite can measure it. */
export const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i

/**
 * The shipped scrub, restated: `packages/subprocess/subprocess/src/index.ts`
 * keeps a parent name unless it looks like a credential (`:47`) or carries the
 * harness prefix, and it reads `process.env` through `Object.entries` at spawn
 * time (`:68`). Only the proxy overlay is left out — it is not part of what
 * decides whether one marker survives.
 */
export function scrubbedParentEnv(parent = process.env) {
  const env = {}
  for (const [key, value] of Object.entries(parent)) {
    if (value !== undefined && !SENSITIVE_ENV_PATTERN.test(key) && !key.toUpperCase().startsWith('DSH_')) {
      env[key] = value
    }
  }
  return env
}

/** The marker this plugin exists for. */
export const MARKER = 'ELECTRON_RUN_AS_NODE'

/**
 * Save one environment name, so a spec that mutates the real `process.env` can
 * put it back however the test ends.
 * @param name - the environment name to guard.
 * @returns a function that restores the saved state.
 */
export function preserveEnvironment(name) {
  const had = Object.hasOwn(process.env, name)
  const value = process.env[name]
  return () => {
    if (had) process.env[name] = value
    else delete process.env[name]
  }
}
