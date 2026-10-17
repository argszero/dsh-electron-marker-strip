/**
 * Installing the strip on one environment, and handing it back on disposal.
 *
 * The seam is `process.env` itself. `packages/subprocess/subprocess/src/index.ts`
 * builds every child's base environment through `scrubbedParentEnv()`, and that
 * function enumerates `Object.entries(process.env)` **at spawn time** (`:68`) —
 * not at module load — so a name deleted from this process before the spawn
 * reaches every child spawned afterwards, with no need to hook the spawn at all:
 * MCP stdio servers, subagent CLIs, browser-host processes, the VS Code launcher
 * (`packages/host/open-in-app/src/resolver.ts:80` spreads `scrubbedParentEnv()`
 * as the launch environment) and any confined exec that routes through the
 * service.
 *
 * What the scrub keeps is decided by `SENSITIVE_ENV_PATTERN` at `:47`
 * (`/KEY|PASSWORD|SECRET|TOKEN/i`) plus a `DSH_*` prefix. `ELECTRON_RUN_AS_NODE`
 * matches neither, so a desktop host that sets it for its own CLI hands it to
 * every child it ever spawns — and a child that *is* an Electron application
 * then starts as a Node interpreter instead of a window.
 *
 * The strip is registered per environment object, so mounting twice (a reload, a
 * second profile row) does not capture a second time and cannot restore a value
 * it never took.
 *
 * @module @argszero/dsh-electron-marker-strip/install
 */

import {
  captureMarkers,
  removeMarkers,
  restoreMarkers,
  type EnvironmentLike,
  type MarkerRecord,
  type RestoreResult,
} from './strip.ts'

/** What one install did. */
export type StripOutcome =
  /** The markers were present and are now absent. */
  | 'stripped'
  /** The markers were already absent; nothing was removed and nothing is owed. */
  | 'nothing-to-strip'
  /** This environment already carries this plugin's strip, which is left in place. */
  | 'already-stripped'

/** The install, and the way back. */
export interface StripHandle {
  readonly outcome: StripOutcome
  /** What was taken off, with the value a restore will hand back. */
  readonly removed: readonly MarkerRecord[]
  /**
   * Put back what this handle took, at most once.
   * @returns one result per removed name; empty when there was nothing to
   *   restore or this handle had already restored.
   */
  restore(): readonly RestoreResult[]
}

/**
 * The strips currently in force, keyed by the environment they were written to.
 *
 * A `WeakMap` because the key is an environment object — usually `process.env`,
 * which outlives the plugin — and a registry that kept environments alive would
 * be a leak shaped like a feature.
 */
const mounted = new WeakMap<EnvironmentLike, StripHandle>()

/**
 * Remove the configured names from `environment` and return the way back.
 *
 * Registering only when something was actually removed is deliberate: a mount on
 * an environment that had no marker must not claim the name, because a later
 * writer may set the marker for its own reasons and the second mount is the one
 * that should remove it.
 * @param environment - the record to modify, normally `process.env`.
 * @param names - the validated names to remove.
 * @returns the handle; `restore()` is safe to call more than once.
 */
export function stripProcessMarkers(
  environment: EnvironmentLike,
  names: readonly string[],
): StripHandle {
  const existing = mounted.get(environment)
  if (existing !== undefined) {
    return {
      outcome: 'already-stripped',
      removed: existing.removed,
      // The strip in force belongs to the earlier handle; this one took nothing
      // and so owes nothing.
      restore: () => [],
    }
  }

  const captured = captureMarkers(environment, names)
  const removedNames = removeMarkers(environment, captured)
  if (removedNames.length === 0) {
    return { outcome: 'nothing-to-strip', removed: [], restore: () => [] }
  }

  const removed = captured.filter(record => removedNames.includes(record.name))
  let restored = false
  const handle: StripHandle = {
    outcome: 'stripped',
    removed,
    restore(): readonly RestoreResult[] {
      if (restored) return []
      restored = true
      mounted.delete(environment)
      return restoreMarkers(environment, removed)
    },
  }
  mounted.set(environment, handle)
  return handle
}
