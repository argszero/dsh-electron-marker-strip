# @argszero/dsh-electron-marker-strip

Stop the Electron desktop host's own runtime marker from reaching the programs it
spawns.

A dsh **mitigation** for [discussion #9920](https://github.com/deepseek-ai/deepseek-harness/discussions/9920)
and its earlier duplicate [#9599](https://github.com/deepseek-ai/deepseek-harness/discussions/9599):
launching an Electron-based editor from dsh makes it start as a Node interpreter
and fail with a 502, because the editor process inherits
`ELECTRON_RUN_AS_NODE=1` from the host that spawned it.

> **This is a mitigation, not the fix.** The correct fix is one line in core:
> the shared scrub rule should carry `ELECTRON_RUN_AS_NODE`. That line lives in
> the harness, not in a plugin, so this package does the one thing a plugin can.

## The defect, in the source

Every child the harness spawns starts from `scrubbedParentEnv()`
(`packages/subprocess/subprocess/src/index.ts:66`), which keeps a parent name
unless it looks credential-shaped (`SENSITIVE_ENV_PATTERN` at `:47`, which is
`/KEY|PASSWORD|SECRET|TOKEN/i`) or carries the `DSH_` prefix:

```ts
export const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i
```

`ELECTRON_RUN_AS_NODE` matches none of those words, so it survives the scrub and
reaches **every** child: MCP stdio servers, subagent CLIs, browser-host
processes, and any application launched through
`packages/host/open-in-app/src/resolver.ts` — whose `launchDetachedApp` builds the
launch environment as `{ ...scrubbedParentEnv(), ...options.env }` (`:80`). A
child that happens to be an Electron application reads that variable as "be a
Node interpreter" and never opens a window.

The tree already knows the name is not one to pass on: its own desktop scripts
use

```js
/KEY|SECRET|TOKEN|PASSWORD|^NODE_OPTIONS$|^ELECTRON_RUN_AS_NODE$/iu
```

which is exactly the rule that is missing from the shared scrub.

## Why a plugin can fix this one

`scrubbedParentEnv()` reads `Object.entries(process.env)` **at spawn time**
(`:68`), not at module load. Deleting the name from this process therefore
removes it from every child spawned afterwards, whatever component spawns it,
without touching the spawn path:

```js
delete process.env.ELECTRON_RUN_AS_NODE   // 'ELECTRON_RUN_AS_NODE' in process.env === false
```

`delete`, never `process.env.X = undefined`: Node stores the four letters for an
assignment, and a child would then receive a *defined* marker — worse than not
touching it.

## What in the tree needs the marker, and why the fix must be scoped

Every in-tree launcher that genuinely needs the marker writes it explicitly
**after** the scrub:

| launcher | line |
|---|---|
| `apps/desktop-host/src/cli.ts` | `:21` |
| `apps/desktop-host/src/index.ts` | `:36` |
| `apps/desktop/src/node-environment.ts` | `:15` |
| `packages/host/open-in-app/src/resolver.ts` | `:80`, value at `:584` |
| `packages/experimental/speech-to-text-sensevoice/src/recognizer.ts` | `:265` |

**One launcher is missing from that table, and it is the reason this mitigation is
global-scope only.** `packages/bundle/web-app/src/index.ts:135-141` spawns
`process.execPath` — the Electron binary, in a desktop build — with
`env: scrubbedParentEnv()` and no explicit marker:

```ts
return spawn(process.execPath, ['--input-type=module', '--eval', BROWSER_OPENER_PROGRAM, '--', url], {
  env: scrubbedParentEnv(),
  …
})
```

That child needs the inherited marker to run as Node, so a blanket removal from
the shared scrub would turn it into an Electron GUI launch, and
`@deepseek-ai/dsh-web-app` sits in the default and headless bundle lists
(`packages/boot/app-boot/src/profile.ts:184`, `:199`). This package deletes the
name from `process.env`, which is global by construction: a desktop host that
passes `--no-open` never reaches that launcher, but the risk is not zero.

The scoped fix is therefore not the shared base but the one place that launches
*foreign* programs — `launchDetachedApp` in
`packages/host/open-in-app/src/resolver.ts`, deleting the inherited name after
`{ ...scrubbedParentEnv(), ...options.env }`. Explicit environment still wins, so
the GitHub Desktop adapter at `:584`, whose entry point is `resources/app/cli.js`
and genuinely needs Node mode, keeps working. Reported upstream as
[#10462](https://github.com/deepseek-ai/deepseek-harness/discussions/10462), which
is the third report of this defect after #9599 and #9920.

## Install and mount

```sh
npm install @argszero/dsh-electron-marker-strip
```

The package carries a `dsh.bundle.patch` entry, so mounting it is the whole of
the configuration:

```yaml
- insert:
    - id: electron-marker-strip
      name: '@argszero/dsh-electron-marker-strip'
```

The strip is in force from the moment the fiber activates and is handed back
when the scope is torn down. No service is injected: `process.env` is not a
cordis service, so there is nothing to wait for.

## Configuration

Every field is optional, and an unknown key is refused — a misspelled knob that
mounts cleanly is an operator who believes the environment is clean while every
child still inherits the marker.

```yaml
- id: electron-marker-strip
  name: '@argszero/dsh-electron-marker-strip'
  config:
    names: [ELECTRON_RUN_AS_NODE]   # replaces the default list, does not extend it
    log: warn                       # silent | debug | warn
    enabled: true
```

| field | default | meaning |
|---|---|---|
| `enabled` | `true` | `false` mounts nothing and changes nothing |
| `names` | `['ELECTRON_RUN_AS_NODE']` | the names to remove; duplicates dropped, `=` and NUL refused |
| `log` | `'warn'` | `silent` writes nothing, `debug` writes the same lines at debug level |

Windows environment names are case-insensitive, so the duplicate check follows
the host's rule: `FOO`/`foo` are one variable on `win32` and two everywhere else.

## What it does, precisely

- **Mount**: every configured name present in `process.env` is captured with its
  value and deleted. Absent names are reported, not invented.
- **Second mount** (a reload, a second profile row): recognised, and left alone.
  A mount that removed nothing does not claim the process, so a later mount can
  still strip a marker set in the meantime.
- **Disposal**: the captured values are written back — but a name another writer
  has set in the meantime keeps that writer's value. This plugin is not the owner
  of the environment; it puts back what it took.
- **Never**: an assignment of `undefined`, an overwrite of somebody else's value,
  or a mount that strips nothing while reporting success.

## Scope

This fixes children spawned **after** the mount, in **this** process. It does
not:

- fix a child that was already running;
- reach a dsh process that has not mounted the plugin (a second host, a
  headless run, a subagent spawned by a host that never loaded it);
- change what an Electron process itself does with its own environment.

For those, the one-line core change is the answer. Until it lands, this is the
smallest thing that makes a desktop host stop breaking the editors it launches.

## Verification

The suite is 83 tests over four files, including a witness that spawns **real
child processes** and measures what they can see:

- the shipped keep-rule does not match `ELECTRON_RUN_AS_NODE` (the defect, in one
  assertion) and does match a credential-shaped name (the contrast);
- a child born while the parent carries the marker inherits it;
- a child born after the mount does not, and sees the name *absent* rather than
  the string `undefined`;
- a child born after disposal inherits it again;
- a launch that sets the marker after the scrub still reaches the child — which
  is why the in-tree launchers keep working.

`npm run test:inject` mutates the source one defect at a time and requires the
suite to notice: **32 arms run, 32 CAUGHT, 0 SILENT, 0 TYPEFAIL**, with 2 arms
declared EQUIVALENT and not run (their reasons are printed by the harness).

## License

MIT
