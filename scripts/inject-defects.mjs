#!/usr/bin/env node
/**
 * Mutation harness: inject one defect at a time into `src/`, rebuild, and
 * require the suite to notice.
 *
 * A defect the suite does **not** notice is a line of this plugin nobody is
 * measuring, so it is reported as `SILENT` and the run fails. A defect that does
 * not compile proves nothing at all — `tsc` refuses the tree and the suite never
 * runs — so it is reported as `TYPEFAIL` and the run fails too; `noEmitOnError`
 * in `tsconfig.json` is what makes that state impossible to mistake for a caught
 * one.
 *
 * A defect whose behaviour is indistinguishable from the original is declared
 * `equivalent` and **not run**: running it would print `SILENT` for a mutation
 * that changed nothing, and a harness that cannot tell those two apart is a
 * harness whose green means nothing.
 *
 * Usage: `npm run test:inject` (the pre-publish gate: `npm run build` first).
 *
 * @module scripts/inject-defects
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TSC = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')

/** Every defect this harness knows, in the order it reports them. */
const DEFECTS = [
  // ---- what the plugin accepts ----------------------------------------------
  {
    id: 'M01-default-marker-forgotten',
    file: 'src/config.ts',
    find: "export const DEFAULT_NAMES: readonly string[] = ['ELECTRON_RUN_AS_NODE']",
    replace: 'export const DEFAULT_NAMES: readonly string[] = []',
    what: 'the marker this plugin exists for is not the default',
  },
  {
    id: 'M02-enabled-defaults-off',
    file: 'src/config.ts',
    find: 'const enabled = raw.enabled === undefined ? true : raw.enabled',
    replace: 'const enabled = raw.enabled === undefined ? false : raw.enabled',
    what: 'a mount with no configuration strips nothing',
  },
  {
    id: 'M03-unknown-key-ignored',
    file: 'src/config.ts',
    find: '    if (!KNOWN_KEYS.includes(key)) {',
    replace: '    if (false) {',
    what: 'a misspelled knob mounts cleanly and removes nothing',
  },
  {
    id: 'M04-enabled-type-unchecked',
    file: 'src/config.ts',
    find: 'if (typeof enabled !== \'boolean\') fail(`"enabled" was ${typeof enabled} rather than a boolean`)',
    replace: 'if (typeof enabled !== \'boolean\') return resolveConfig(undefined)',
    what: 'a non-boolean enabled falls back to the defaults instead of failing the mount',
  },
  {
    id: 'M05-log-level-unchecked',
    file: 'src/config.ts',
    find: 'if (typeof log !== \'string\' || !STRIP_LOG_LEVELS.includes(log as StripLogLevel)) {',
    replace: 'if (false) {',
    what: 'an unknown log level is accepted',
  },
  {
    id: 'M06-empty-name-list-accepted',
    file: 'src/config.ts',
    find: "if (kept.length === 0) fail('no marker names were configured, so there is nothing to strip')",
    replace: 'if (false) fail(\'unreachable\')',
    what: 'an empty name list mounts and strips nothing',
  },
  {
    id: 'M07-equals-name-accepted',
    file: 'src/config.ts',
    find: "    if (name.includes('=')) {",
    replace: '    if (false) {',
    what: 'a name no environment can carry is accepted and matched zero times',
  },
  {
    id: 'M08-nul-name-accepted',
    file: 'src/config.ts',
    find: "    if (name.includes('\\0')) {",
    replace: '    if (false) {',
    what: 'a name carrying a NUL byte is accepted',
  },
  {
    id: 'M09-empty-name-accepted',
    file: 'src/config.ts',
    find: '    if (typeof name !== \'string\' || name.length === 0) {',
    replace: '    if (typeof name !== \'string\') {',
    what: 'an empty name is accepted',
  },
  {
    id: 'M10-duplicates-kept',
    file: 'src/config.ts',
    find: '    if (kept.some(existing => sameEnvironmentName(existing, name, platform))) continue',
    replace: '    if (false) continue',
    what: 'a configured duplicate is removed twice',
  },
  {
    id: 'M11-windows-case-rule-inverted',
    file: 'src/config.ts',
    find: "  return platform === 'win32' ? left.toUpperCase() === right.toUpperCase() : left === right",
    replace: "  return platform === 'win32' ? left === right : left.toUpperCase() === right.toUpperCase()",
    what: 'each platform gets the other platform\'s case rule',
  },
  {
    id: 'M12-names-array-unchecked',
    file: 'src/config.ts',
    find: "if (!Array.isArray(names)) fail(`\"names\" was ${typeof names} rather than an array of names`)",
    replace: 'if (false) fail(\'unreachable\')',
    what: 'a string where a list belongs is iterated character by character',
  },
  {
    id: 'M13-name-list-unfrozen',
    file: 'src/config.ts',
    find: '  return Object.freeze(kept)',
    replace: '  return kept',
    what: 'a caller can edit the settings every later mount reads',
  },
  {
    id: 'M14-names-extend-instead-of-replace',
    file: 'src/config.ts',
    find: 'const names = raw.names === undefined ? DEFAULT_NAMES : raw.names',
    replace: 'const names = raw.names === undefined ? DEFAULT_NAMES : [...DEFAULT_NAMES, ...(raw.names as readonly string[])]',
    what: 'a custom list silently keeps stripping the default too',
  },

  // ---- what the primitives do with an environment ---------------------------
  {
    id: 'M15-presence-by-key-not-value',
    file: 'src/strip.ts',
    find: '  return names.filter(name => typeof environment[name] === \'string\')',
    replace: '  return names.filter(name => name in environment)',
    what: 'a name mapped to undefined counts as carried',
  },
  {
    id: 'M16-capture-by-key-not-value',
    file: 'src/strip.ts',
    find: '    if (typeof value === \'string\') records.push({ name, value })',
    replace: '    if (name in environment) records.push({ name, value: String(value) })',
    what: 'an absent value is captured and later restored as undefined',
  },
  {
    id: 'M17-empty-value-not-captured',
    file: 'src/strip.ts',
    find: '    if (typeof value === \'string\') records.push({ name, value })',
    replace: '    if (typeof value === \'string\' && value.length > 0) records.push({ name, value })',
    what: 'an empty value is treated as absence and never handed back',
  },
  {
    id: 'M18-removal-assigns-undefined',
    file: 'src/strip.ts',
    find: '    Reflect.deleteProperty(environment, record.name)',
    replace: '    environment[record.name] = undefined',
    what: 'the name survives as the four letters "undefined", which an Electron binary reads as yes',
  },
  {
    id: 'M19-removal-reports-what-it-did-not-do',
    file: 'src/strip.ts',
    find: '    if (!Object.hasOwn(environment, record.name)) continue',
    replace: '    if (false) continue',
    what: 'a deletion somebody else performed is claimed by this pass',
  },
  {
    id: 'M20-removal-restores-nothing',
    file: 'src/strip.ts',
    find: '    environment[record.name] = record.value',
    replace: '    environment[record.name] = \'\'',
    what: 'disposal writes an empty value instead of the one it took',
  },
  {
    id: 'M21-restore-overwrites-a-later-writer',
    file: 'src/strip.ts',
    find: '    if (typeof environment[record.name] === \'string\') {',
    replace: '    if (false) {',
    what: 'disposal overwrites a value another writer set, having never owned it',
  },

  // ---- installation and disposal -------------------------------------------
  {
    id: 'M22-second-mount-not-recognised',
    file: 'src/install.ts',
    find: '  const existing = mounted.get(environment)',
    replace: '  const existing = undefined as StripHandle | undefined',
    what: 'a second mount captures a second time and reports a fresh strip',
  },
  {
    id: 'M23-nothing-to-strip-claims-the-environment',
    file: 'src/install.ts',
    find: "    return { outcome: 'nothing-to-strip', removed: [], restore: () => [] }",
    replace: '    mounted.set(environment, { outcome: \'nothing-to-strip\', removed: [], restore: () => [] });\n'
      + "    return { outcome: 'nothing-to-strip', removed: [], restore: () => [] }",
    what: 'a mount that took nothing blocks the mount that would take something',
  },
  {
    id: 'M24-second-mount-owes-the-first-handles-value',
    file: 'src/install.ts',
    find: '      restore: () => [],',
    replace: '      restore: () => existing.restore(),',
    what: 'the second mount restores on behalf of the first',
  },
  {
    id: 'M25-restore-keeps-the-environment-claimed',
    file: 'src/install.ts',
    find: '      mounted.delete(environment)',
    replace: '      void environment',
    what: 'a disposed strip cannot be re-installed',
  },
  {
    id: 'M26-restore-is-not-idempotent',
    file: 'src/install.ts',
    find: '      if (restored) return []',
    replace: '      if (false) return []',
    what: 'a second disposal writes again',
  },
  {
    id: 'M27-empty-removal-treated-as-success',
    file: 'src/install.ts',
    find: '  if (removedNames.length === 0) {',
    replace: '  if (removedNames.length === -1) {',
    what: 'a strip that removed nothing is reported as a strip',
  },

  // ---- the plugin on the process -------------------------------------------
  {
    id: 'M29-disabled-still-strips',
    file: 'src/index.ts',
    find: '  if (!settings.enabled) {',
    replace: '  if (false) {',
    what: 'enabled: false is ignored',
  },
  {
    id: 'M30-disposal-never-registered',
    file: 'src/index.ts',
    find: '  ctx.effect(() => () => { handle.restore() }, `${LOG_PREFIX}restore()`)',
    replace: '  void handle',
    what: 'the marker is taken and never handed back',
  },
  {
    id: 'M31-silent-still-logs',
    file: 'src/index.ts',
    find: "    if (settings.log === 'silent') return",
    replace: '    if (false) return',
    what: 'the operator cannot turn the plugin\'s chatter off',
  },
  {
    id: 'M32-debug-logged-as-warning',
    file: 'src/index.ts',
    find: "    if (level === 'debug' || settings.log === 'debug') ctx.logger.debug(message)",
    replace: "    if (level === 'debug' && settings.log === 'debug') ctx.logger.debug(message)",
    what: 'the debug level stops reaching the debug log',
  },
  {
    id: 'M33-configured-names-ignored',
    file: 'src/index.ts',
    find: '  const handle: StripHandle = stripProcessMarkers(process.env, settings.names)',
    replace: "  const handle: StripHandle = stripProcessMarkers(process.env, ['ELECTRON_RUN_AS_NODE'])",
    what: 'a configured name is never stripped',
  },
]

/** Arms whose behaviour is indistinguishable from the original, so not run. */
const EQUIVALENT = [
  {
    id: 'M28-removed-list-not-filtered',
    file: 'src/install.ts',
    why: '`removedNames` is produced by the delete pass immediately before this filter, over the same '
      + 'captures and with nothing running in between, so the filter can only differ for an environment '
      + 'object that refuses a delete mid-pass. `process.env` always accepts it and the plugin never builds '
      + 'one, so `removed = captured` is the same list — the filter is a guard, not a behaviour to measure',
  },
  {
    id: 'E01-readback-check-after-delete',
    file: 'src/strip.ts',
    why: 'removing the `if (Object.hasOwn(...)) continue` read-back cannot be observed on a record: '
      + '`Reflect.deleteProperty` succeeds on every plain object and on `process.env`, so the check only '
      + 'earns its place against a proxy that refuses the delete, which this suite does not construct',
  },
]

const read = file => readFileSync(join(ROOT, file), 'utf8')

/** Compile; the first error line, or undefined when the tree compiles. */
function build() {
  try {
    execFileSync(process.execPath, [TSC], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    return undefined
  } catch (error) {
    const output = String(error.stdout ?? '') + String(error.stderr ?? '')
    return output.trim().split('\n')[0] ?? 'tsc failed'
  }
}

/** Run the suite; true when it noticed something. */
function suiteNotices() {
  try {
    execFileSync(process.execPath, ['--test', 'test/*.spec.mjs'], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    return false
  } catch {
    return true
  }
}

const results = []
let failures = 0

for (const defect of DEFECTS) {
  const original = read(defect.file)
  const occurrences = original.split(defect.find).length - 1
  if (occurrences !== 1) {
    results.push([defect.id, `ANCHOR(${String(occurrences)})`, defect.what])
    failures += 1
    continue
  }
  writeFileSync(join(ROOT, defect.file), original.replace(defect.find, defect.replace))
  const compileError = build()
  let outcome
  if (compileError !== undefined) {
    outcome = 'TYPEFAIL'
    results.push([defect.id, outcome, `${defect.what} — ${compileError}`])
    failures += 1
  } else {
    outcome = suiteNotices() ? 'CAUGHT' : 'SILENT'
    if (outcome !== 'CAUGHT') failures += 1
    results.push([defect.id, outcome, defect.what])
  }
  writeFileSync(join(ROOT, defect.file), original)
  build()
}

const rebuilt = build()

for (const [id, outcome, what] of results) {
  console.log(`${outcome.padEnd(9)} ${id.padEnd(42)} ${what}`)
}
for (const entry of EQUIVALENT) {
  console.log(`${'EQUIVALENT'.padEnd(9)} ${entry.id.padEnd(42)} ${entry.why}`)
}
const caught = results.filter(([, outcome]) => outcome === 'CAUGHT').length
console.log('')
console.log(`arms: ${String(DEFECTS.length)} run, ${String(caught)} CAUGHT, `
  + `${String(results.filter(([, o]) => o === 'SILENT').length)} SILENT, `
  + `${String(results.filter(([, o]) => o === 'TYPEFAIL').length)} TYPEFAIL, `
  + `${String(results.filter(([, o]) => o.startsWith('ANCHOR'))).length} ANCHOR-MISS, `
  + `${String(EQUIVALENT.length)} declared EQUIVALENT`)
console.log(`restored tree: ${rebuilt === undefined ? 'compiles' : `FAILED — ${rebuilt}`}`)

if (failures > 0 || rebuilt !== undefined) {
  console.error('inject-defects: the suite does not pin every line this plugin promises')
  process.exitCode = 1
}
