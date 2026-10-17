/**
 * The seam against the shipped behaviour: a real `Context`, the shipped keep-rule
 * restated from its source, and a real child process.
 *
 * `lifecycle.spec.mjs` proves what the plugin decides. This file proves the four
 * things that decision assumes away, because they are exactly what the plugin
 * promises:
 *
 * 1. **The defect is real in the shipped rule.** `SENSITIVE_ENV_PATTERN`
 *    (`packages/subprocess/subprocess/src/index.ts:47`) is
 *    `/KEY|PASSWORD|SECRET|TOKEN/i`, and `ELECTRON_RUN_AS_NODE` matches none of
 *    those words — so `scrubbedParentEnv()` (`:66`) hands it to every child.
 * 2. **A child born before the strip sees it**, which is what a desktop host
 *    does to the editor it launches.
 * 3. **A child born after the strip does not see it**, and sees the name
 *    *absent* rather than the four letters `undefined`.
 * 4. **The launchers that need it still work**: a launch that sets the marker
 *    after the scrub still reaches the child, which is why removing it from the
 *    base breaks nothing in the tree.
 *
 * Everything here runs for real: `execFileSync` with an explicit `env` is the
 * same handoff the harness's spawners perform, and the environment handed over is
 * the shipped scrub restated (`harness.mjs`), not a stand-in for it.
 *
 * @module test/witness
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, it } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../lib/index.js'
import {
  MARKER,
  SENSITIVE_ENV_PATTERN,
  fakeContext,
  preserveEnvironment,
  recordingLogger,
  scrubbedParentEnv,
} from './harness.mjs'

const restorers = []
const contexts = []
afterEach(() => {
  // Disposal first: a strip handed back before the marker is restored puts the
  // value the test found in place, and the environment restore then agrees with
  // it instead of racing it.
  while (contexts.length > 0) contexts.pop().disposeAll()
  while (restorers.length > 0) restorers.pop()()
})

/** Set the marker in this process, remembering how to put the environment back. */
function parentCarries(value = '1') {
  restorers.push(preserveEnvironment(MARKER))
  process.env[MARKER] = value
}

/** Mount the plugin on a recording context, and remember to dispose it. */
function mount(config) {
  const context = fakeContext()
  contexts.push(context)
  apply(context.ctx, config)
  return context
}

/** A child that reports what it can see from the inside. */
function probe(environment) {
  const script = 'process.stdout.write(JSON.stringify({'
    + 'present: Object.hasOwn(process.env, "ELECTRON_RUN_AS_NODE"),'
    + 'value: process.env.ELECTRON_RUN_AS_NODE ?? null,'
    + 'path: typeof process.env.PATH'
    + '}))'
  return JSON.parse(execFileSync(process.execPath, ['-e', script], { env: environment, encoding: 'utf8' }))
}

describe('the shipped keep-rule', () => {
  it('does not treat the Electron marker as credential-shaped', () => {
    assert.equal(SENSITIVE_ENV_PATTERN.test(MARKER), false)
  })

  it('does treat a credential-shaped name that way, which is the contrast', () => {
    assert.equal(SENSITIVE_ENV_PATTERN.test('DEEPSEEK_API_KEY'), true)
  })
})

describe('a child of this process', () => {
  it('inherits the marker while the parent carries it', () => {
    parentCarries()
    assert.equal(probe(scrubbedParentEnv()).present, true)
  })

  it('does not inherit it once the plugin is mounted', () => {
    parentCarries()
    mount({})
    const child = probe(scrubbedParentEnv())
    assert.equal(child.present, false)
    assert.equal(child.value, null)
  })

  it('sees the name absent rather than the string "undefined"', () => {
    parentCarries()
    mount({})
    const child = probe(scrubbedParentEnv())
    // The failure an assignment instead of a delete would produce: `present` is
    // true and the value is the four letters, which an Electron binary reads as
    // "yes, be a Node interpreter".
    assert.equal(child.present, false)
    assert.notEqual(child.value, 'undefined')
  })

  it('inherits it again after the plugin is disposed', () => {
    parentCarries('1')
    const context = mount({})
    assert.equal(probe(scrubbedParentEnv()).present, false)
    context.disposeAll()
    assert.equal(probe(scrubbedParentEnv()).present, true)
  })

  it('still receives the rest of the environment', () => {
    parentCarries()
    mount({})
    assert.equal(probe(scrubbedParentEnv()).path, 'string')
  })

  it('still sees the marker when the launch sets it after the scrub', () => {
    parentCarries()
    mount({})
    // This is what every in-tree launcher that needs the marker does —
    // `desktop-host/src/cli.ts:21`, `host/open-in-app/src/resolver.ts:80` and
    // its `:584` value — spread the explicit value over the scrubbed base, so
    // the strip cannot break them.
    const launch = { ...scrubbedParentEnv(), [MARKER]: '1' }
    assert.equal(probe(launch).present, true)
  })
})

describe('a real context', () => {
  it('registers a disposal cordis itself runs, and the strip is in force meanwhile', () => {
    parentCarries('1')
    const app = new Context()
    const logger = recordingLogger()
    // `logger` is an own property of a cordis context, so replacing it is a
    // shadow — and it is the only substitution in this test.
    Object.defineProperty(app, 'logger', { value: logger, configurable: true })
    const registrations = []
    const realEffect = app.effect.bind(app)
    app.effect = (execute, label) => {
      const undo = realEffect(execute, label)
      registrations.push({ undo, label })
      return undo
    }

    apply(app, {})

    assert.equal(registrations.length, 1)
    assert.match(logger.text(), /removed ELECTRON_RUN_AS_NODE/)
    assert.equal(probe(scrubbedParentEnv()).present, false)

    registrations[0].undo()

    assert.equal(process.env[MARKER], '1')
    assert.equal(probe(scrubbedParentEnv()).present, true)
  })
})
