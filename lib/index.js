/**
 * `@argszero/dsh-electron-marker-strip` — stop the desktop host's own runtime
 * marker from reaching the programs it spawns.
 *
 * **This is a mitigation, not the fix.** Discussion #9920 (and its earlier
 * duplicate #9599) report that launching an Electron-based editor from dsh makes
 * it start as a Node interpreter and then fail with a 502: the editor process
 * inherits `ELECTRON_RUN_AS_NODE=1` from the desktop host that spawned it. The
 * correct fix is one line in the shared scrub rule —
 * `packages/subprocess/subprocess/src/index.ts:47`'s `SENSITIVE_ENV_PATTERN`
 * should carry `ELECTRON_RUN_AS_NODE` the way the tree's own desktop scripts
 * already do (`apps/desktop/scripts/` uses
 * `/KEY|SECRET|TOKEN|PASSWORD|^NODE_OPTIONS$|^ELECTRON_RUN_AS_NODE$/iu`) — and it
 * is a line this plugin cannot write, because it is in the harness, not in a
 * plugin.
 *
 * What a plugin *can* do is take the name out of the process the scrub reads.
 * `scrubbedParentEnv()` (:66) walks `Object.entries(process.env)` at spawn time
 * (:68), so deleting the name on mount covers every child spawned afterwards —
 * every one of them, whatever component spawns it, without touching the spawn
 * path. That is what this plugin does, and it puts the value back on disposal.
 *
 * **Nothing in the tree depends on the leak.** Every in-tree launcher that needs
 * the marker writes it explicitly *after* the scrub
 * (`apps/desktop-host/src/cli.ts:21`, `apps/desktop-host/src/index.ts:36`,
 * `apps/desktop/src/node-environment.ts:15`,
 * `packages/host/open-in-app/src/resolver.ts:584`,
 * `packages/experimental/speech-to-text-sensevoice/src/recognizer.ts:265`) —
 * which is why removing it from the base breaks nothing, and why the same change
 * is safe upstream.
 *
 * @module @argszero/dsh-electron-marker-strip
 */
import { resolveConfig } from "./config.js";
import { stripProcessMarkers } from "./install.js";
export { DEFAULT_LOG, DEFAULT_NAMES, STRIP_LOG_LEVELS, normalizeNames, resolveConfig, sameEnvironmentName, } from "./config.js";
export { captureMarkers, presentMarkers, removeMarkers, restoreMarkers, } from "./strip.js";
export { stripProcessMarkers } from "./install.js";
/** The name cordis mounts this plugin under. */
export const name = 'electron-marker-strip';
const LOG_PREFIX = 'electron-marker-strip:';
/**
 * Remove the marker from this process for as long as the plugin is mounted.
 *
 * No `inject` is declared: this plugin reads and writes `process.env`, which is
 * not a cordis service, so there is nothing to wait for and the strip is in
 * force from the moment the fiber activates.
 * @param ctx - the plugin context; disposal is registered on it.
 * @param raw - the mounted configuration.
 * @throws when the configuration itself is unusable.
 */
export function apply(ctx, raw = {}) {
    const settings = resolveConfig(raw);
    const report = (message, level = 'warn') => {
        if (settings.log === 'silent')
            return;
        // A debug line is always debug; a warning line is a warning unless the
        // operator asked for this plugin's chatter to stay off the warning log.
        if (level === 'debug' || settings.log === 'debug')
            ctx.logger.debug(message);
        else
            ctx.logger.warn(message);
    };
    if (!settings.enabled) {
        report(`${LOG_PREFIX} disabled by configuration, so ${settings.names.join(', ')} still reaches every child`, 'debug');
        return;
    }
    const handle = stripProcessMarkers(process.env, settings.names);
    switch (handle.outcome) {
        case 'stripped':
            report(`${LOG_PREFIX} removed ${handle.removed.map(record => record.name).join(', ')} from this process, `
                + 'so no child spawned from here inherits it (the value is restored on disposal)', 'debug');
            break;
        case 'nothing-to-strip':
            report(`${LOG_PREFIX} ${settings.names.join(', ')} was not present in this process, so there was nothing to remove `
                + '— a child is only at risk when the parent carried the marker', 'debug');
            break;
        case 'already-stripped':
            report(`${LOG_PREFIX} this process already carries this plugin's strip, leaving it in place`, 'debug');
            break;
    }
    ctx.effect(() => () => { handle.restore(); }, `${LOG_PREFIX}restore()`);
}
export default { name, apply };
