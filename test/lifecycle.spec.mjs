/**
 * The plugin as the Loader mounts it: `apply(ctx, config)`, on the real
 * `process.env`, with the logger observed and disposal driven through the
 * registered effect.
 *
 * `process.env` is the plugin's actual subject — `apply` has no environment
 * parameter, on purpose, because the seam is the process the harness runs in —
 * so this file mutates it and restores it after every test. Every mount goes
 * through `mount()` below, which also disposes it: a mount left standing claims
 * the process in the install registry, and the next test's mount would then be
 * a no-op that proves nothing.
 *
 * @module test/lifecycle
 */

import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { apply, name, default as plugin } from '../lib/index.js'
import { MARKER, fakeContext, preserveEnvironment, recordingLogger } from './harness.mjs'

const restorers = []
const contexts = []
afterEach(() => {
  while (contexts.length > 0) contexts.pop().disposeAll()
  while (restorers.length > 0) restorers.pop()()
})

/** Save the marker, set it to `value`, and mount nothing yet. */
function withMarker(value = '1') {
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

describe('the plugin entry', () => {
  it('is named for what it does', () => {
    assert.equal(name, 'electron-marker-strip')
  })

  it('exports the cordis plugin shape the Loader reads', () => {
    assert.equal(plugin.name, 'electron-marker-strip')
    assert.equal(plugin.apply, apply)
  })

  it('declares no inject, since process.env is not a service', () => {
    assert.equal(Object.hasOwn(plugin, 'inject'), false)
  })
})

describe('apply', () => {
  it('removes the marker from this process', () => {
    withMarker()
    mount({})
    assert.equal(Object.hasOwn(process.env, MARKER), false)
  })

  it('says what it removed at debug level', () => {
    withMarker()
    const { logger } = mount({})
    assert.deepEqual(logger.levels(), ['debug'])
    assert.match(logger.text(), /removed ELECTRON_RUN_AS_NODE from this process/)
  })

  it('says nothing at all when the log level is silent', () => {
    withMarker()
    const { logger } = mount({ log: 'silent' })
    assert.deepEqual(logger.lines, [])
    assert.equal(Object.hasOwn(process.env, MARKER), false)
  })

  it('writes a warning line at warning level', () => {
    withMarker()
    const { logger } = mount({ log: 'warn' })
    assert.deepEqual(logger.levels(), ['debug'])
  })

  it('registers one effect, labelled for the disposal it performs', () => {
    withMarker()
    const { effects } = mount({})
    assert.equal(effects.length, 1)
    assert.match(effects[0].label, /electron-marker-strip:restore\(\)/)
    assert.equal(typeof effects[0].undo, 'function')
  })

  it('puts the marker back when the scope is torn down', () => {
    withMarker('1')
    const context = mount({})
    assert.equal(Object.hasOwn(process.env, MARKER), false)
    context.disposeAll()
    assert.equal(process.env[MARKER], '1')
  })

  it('survives a dispose that runs twice', () => {
    withMarker('1')
    const context = mount({})
    context.disposeAll()
    context.disposeAll()
    assert.equal(process.env[MARKER], '1')
  })

  it('does nothing at all when disabled, and says why', () => {
    withMarker()
    const { logger, effects } = mount({ enabled: false })
    assert.equal(process.env[MARKER], '1')
    assert.equal(effects.length, 0)
    assert.deepEqual(logger.levels(), ['debug'])
    assert.match(logger.text(), /disabled by configuration/)
  })

  it('reports an environment that never carried the marker', () => {
    restorers.push(preserveEnvironment(MARKER))
    delete process.env[MARKER]
    const { logger } = mount({})
    assert.deepEqual(logger.levels(), ['debug'])
    assert.match(logger.text(), /was not present in this process/)
  })

  it('reports a second mount that finds the strip already in force', () => {
    withMarker()
    mount({})
    const second = fakeContext()
    contexts.push(second)
    apply(second.ctx, {})
    assert.match(second.logger.text(), /already carries this plugin's strip/)
    assert.deepEqual(second.logger.levels(), ['debug'])
  })

  it('strips a custom name on request', () => {
    restorers.push(preserveEnvironment('NODE_OPTIONS'))
    process.env.NODE_OPTIONS = '--inspect'
    mount({ names: ['NODE_OPTIONS'] })
    assert.equal(Object.hasOwn(process.env, 'NODE_OPTIONS'), false)
  })

  it('leaves the default marker alone when the names are replaced', () => {
    withMarker()
    restorers.push(preserveEnvironment('NODE_OPTIONS'))
    delete process.env.NODE_OPTIONS
    mount({ names: ['NODE_OPTIONS'] })
    assert.equal(process.env[MARKER], '1')
  })

  it('throws out of apply on an unusable configuration, so the mount fails loudly', () => {
    const { ctx, effects } = fakeContext()
    assert.throws(() => apply(ctx, { enabled: 'yes' }), /"enabled" was string/)
    assert.equal(effects.length, 0)
  })

  it('leaves the process untouched when the configuration is refused', () => {
    withMarker()
    assert.throws(() => apply(fakeContext().ctx, { names: [] }), /no marker names were configured/)
    assert.equal(process.env[MARKER], '1')
  })

  it('mounts on a context that only offers a logger and an effect', () => {
    withMarker()
    const logger = recordingLogger()
    let undo
    apply({ logger, effect: register => { undo = register() } }, {})
    assert.equal(Object.hasOwn(process.env, MARKER), false)
    assert.match(logger.text(), /removed/)
    if (typeof undo === 'function') undo()
  })
})
