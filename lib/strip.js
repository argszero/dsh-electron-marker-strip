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
export function presentMarkers(environment, names) {
    return names.filter(name => typeof environment[name] === 'string');
}
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
export function captureMarkers(environment, names) {
    const records = [];
    for (const name of names) {
        const value = environment[name];
        if (typeof value === 'string')
            records.push({ name, value });
    }
    return records;
}
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
export function removeMarkers(environment, records) {
    const removed = [];
    for (const record of records) {
        if (!Object.hasOwn(environment, record.name))
            continue;
        Reflect.deleteProperty(environment, record.name);
        if (Object.hasOwn(environment, record.name))
            continue;
        removed.push(record.name);
    }
    return removed;
}
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
export function restoreMarkers(environment, records) {
    const results = [];
    for (const record of records) {
        if (typeof environment[record.name] === 'string') {
            results.push({ name: record.name, outcome: 'kept' });
            continue;
        }
        environment[record.name] = record.value;
        results.push({ name: record.name, outcome: 'restored' });
    }
    return results;
}
