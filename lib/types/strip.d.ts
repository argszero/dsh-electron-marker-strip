/**
 * Removing a name from an environment — the four operations, over a plain
 * record so they can be measured without touching this process.
 *
 * The one fact every function here rests on is that an environment entry is
 * removed with `delete`, never assigned `undefined`:
 *
 * ```js
 * process.env.X = undefined   // process.env.X === 'undefined'  (a string!)
 * delete process.env.X        // 'X' in process.env === false
 * ```
 *
 * Node deprecated assigning `undefined` precisely because it stores the four
 * letters, and a child spawned from that environment receives
 * `ELECTRON_RUN_AS_NODE=undefined` — a *defined* marker, which an Electron
 * binary reads as "yes, be a Node interpreter". That is why
 * {@link restoreMarkers} writes a value back but {@link removeMarkers} does not,
 * and why the removal is reported by the callers' own read-back rather than
 * assumed.
 *
 * @module @argszero/dsh-electron-marker-strip/strip
 */
/** Any environment-shaped record: `process.env`, or a literal in a test. */
export interface EnvironmentLike {
    [name: string]: string | undefined;
}
/** One marker found in an environment, with the value it carried. */
export interface MarkerRecord {
    readonly name: string;
    readonly value: string;
}
/** What {@link restoreMarkers} did to one name. */
export type RestoreOutcome = 
/** The value was written back: the name was absent and is absent no more. */
'restored'
/** Something else had set the name meanwhile, so the other writer's value stands. */
 | 'kept';
/** One line of a restore. */
export interface RestoreResult {
    readonly name: string;
    readonly outcome: RestoreOutcome;
}
/**
 * The configured names the environment actually carries.
 *
 * A name mapped to `undefined` is not carried: `process.env.X` reads back
 * `undefined` for a name that is absent, and an environment object built by hand
 * can hold that same shape.
 * @param environment - the record to read.
 * @param names - the names to look for.
 * @returns the carried names, in configured order.
 */
export declare function presentMarkers(environment: EnvironmentLike, names: readonly string[]): readonly string[];
/**
 * The markers an environment carries, with their values — what a restore needs.
 *
 * The value is copied here, before anything is removed, because it is the only
 * record of what the process started with: once the name is deleted there is
 * nothing left to hand back.
 * @param environment - the record to read.
 * @param names - the names to capture.
 * @returns one record per carried name, in configured order.
 */
export declare function captureMarkers(environment: EnvironmentLike, names: readonly string[]): readonly MarkerRecord[];
/**
 * Delete the captured names and report which deletions actually happened.
 *
 * The `hasOwn` check is what makes the report honest: a name someone else
 * deleted between the capture and this call is not claimed as removed by this
 * pass, so the caller never restores on behalf of a deletion it did not perform.
 * @param environment - the record to modify.
 * @param records - the captures from {@link captureMarkers}.
 * @returns the names this call deleted.
 */
export declare function removeMarkers(environment: EnvironmentLike, records: readonly MarkerRecord[]): readonly string[];
/**
 * Hand the captured values back.
 *
 * A name another writer has set in the meantime keeps that writer's value: this
 * plugin is not the owner of the environment, and disposal puts back what it
 * took rather than overwriting what it never had.
 * @param environment - the record to modify.
 * @param records - the captures from {@link captureMarkers}.
 * @returns one result per record.
 */
export declare function restoreMarkers(environment: EnvironmentLike, records: readonly MarkerRecord[]): readonly RestoreResult[];
//# sourceMappingURL=strip.d.ts.map