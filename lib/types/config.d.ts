/**
 * The plugin's configuration, validated where it is read.
 *
 * The defaults live here rather than in an exported object named `Config`,
 * because the Loader reads a `Config` export as a schema: a plain object there
 * makes the plugin fail to mount with `Cannot read properties of undefined
 * (reading 'validate')`, and a plugin that does not mount strips nothing.
 *
 * An unknown key is refused rather than ignored. An operator who misspells
 * `names` and mounts cleanly is an operator who believes a marker was removed
 * while every child of this process still inherits it — a silent failure on a
 * security-shaped knob is the one kind that must not be silent.
 *
 * @module @argszero/dsh-electron-marker-strip/config
 */
/** How much of what the plugin does is written to the log. */
export type StripLogLevel = 
/** Strip silently; the marker is still removed. */
'silent'
/** One line at mount, and one per distinct thing the strip could not do. */
 | 'debug'
/** The same lines, at warning level. */
 | 'warn';
/** What the plugin accepts, every field optional. */
export interface ElectronMarkerStripConfig {
    /** `false` strips nothing: the parent's environment is handed on unchanged. */
    enabled?: boolean;
    /**
     * The environment variable names to remove from this process. Defaults to
     * {@link DEFAULT_NAMES}; an explicit list replaces it rather than adding to
     * it, so `names: ['FOO']` does not silently keep stripping the default.
     */
    names?: readonly string[];
    /** Level of the plugin's own diagnostics. */
    log?: StripLogLevel;
}
/** The configuration after defaults and validation. */
export interface ResolvedStripConfig {
    readonly enabled: boolean;
    readonly names: readonly string[];
    readonly log: StripLogLevel;
}
/** Every level {@link resolveConfig} accepts, in the order the errors list them. */
export declare const STRIP_LOG_LEVELS: readonly StripLogLevel[];
/** The default level: an environment that still leaks is worth a warning line. */
export declare const DEFAULT_LOG: StripLogLevel;
/**
 * The marker that makes an Electron binary behave as a bare Node interpreter.
 *
 * `ELECTRON_RUN_AS_NODE=1` is set by the Electron desktop host so that it can
 * run the DSH CLI through its own bundled runtime. It is deliberately set again,
 * *after* the scrub, by every in-tree launcher that genuinely needs it
 * (`apps/desktop-host/src/cli.ts:21`, `apps/desktop/src/node-environment.ts:15`,
 * `packages/experimental/speech-to-text-sensevoice/src/recognizer.ts:265`) —
 * which is exactly what makes removing it from the shared base safe.
 */
export declare const DEFAULT_NAMES: readonly string[];
/**
 * Whether two environment names denote the same variable.
 *
 * Windows environment names are case-insensitive, so `Path` and `PATH` are one
 * variable there and two on POSIX. Deduplicating a configured list has to use
 * the host's own rule or it either drops a distinct POSIX variable or strips the
 * same Windows one twice.
 * @param left - one environment name.
 * @param right - the other.
 * @param platform - the host whose rule decides, defaulting to this process's.
 * @returns true when the two names are the same variable on `platform`.
 */
export declare function sameEnvironmentName(left: string, right: string, platform?: string): boolean;
/**
 * Deduplicate and validate a configured name list.
 *
 * A name carrying `=` or NUL cannot exist in an environment block, so it is
 * refused rather than silently matched zero times: an operator who wrote
 * `FOO=bar` meant something, and removing nothing is the wrong answer to it.
 * @param names - the configured names, in the order they were given.
 * @param platform - the host whose case rule decides, defaulting to this process's.
 * @returns the names with duplicates removed, first occurrence kept.
 * @throws when a name cannot be an environment name, or the list is empty.
 */
export declare function normalizeNames(names: readonly string[], platform?: string): readonly string[];
/**
 * Apply the defaults and validate what is left.
 * @param config - the configuration the Loader mounted, if any.
 * @returns the configuration this mount uses.
 * @throws when the configuration is unusable, so a bad mount fails loudly
 *   instead of stripping nothing.
 */
export declare function resolveConfig(config?: ElectronMarkerStripConfig): ResolvedStripConfig;
//# sourceMappingURL=config.d.ts.map