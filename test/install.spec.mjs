/**
 * Installing the strip on one environment, and handing it back.
 *
 * The registry is keyed by the environment object, so these specs pass their own
 * records and never touch this process — the real `process.env` is measured in
 * `lifecycle.spec.mjs` and by a real child in `witness.spec.mjs`.
 *
 * @module test/install
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { stripProcessMarkers } from '../lib/index.js'

const NAMES = ['ELECTRON_RUN_AS_NODE']

describe('stripProcessMarkers', () => {
  it('removes the marker and says so', () => {
    const environment = { ELECTRON_RUN_AS_NODE: '1' }
    const handle = stripProcessMarkers(environment, NAMES)
    assert.equal(handle.outcome, 'stripped')
    assert.equal(Object.hasOwn(environment, 'ELECTRON_RUN_AS_NODE'), false)
  })

  it('reports the value it took, so the way back is possible', () => {
    const environment = { ELECTRON_RUN_AS_NODE: '1' }
    const handle = stripProcessMarkers(environment, NAMES)
    assert.deepEqual(handle.removed, [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }])
  })

  it('leaves the rest of the environment alone', () => {
    const environment = { ELECTRON_RUN_AS_NODE: '1', PATH: '/usr/bin', DSH_PROFILE: 'web' }
    stripProcessMarkers(environment, NAMES)
    assert.deepEqual(environment, { PATH: '/usr/bin', DSH_PROFILE: 'web' })
  })

  it('reports nothing-to-strip when the marker is absent', () => {
    const handle = stripProcessMarkers({}, NAMES)
    assert.equal(handle.outcome, 'nothing-to-strip')
    assert.deepEqual(handle.removed, [])
  })

  it('does not claim an environment it stripped nothing from', () => {
    const environment = {}
    assert.equal(stripProcessMarkers(environment, NAMES).outcome, 'nothing-to-strip')
    environment.ELECTRON_RUN_AS_NODE = '1'
    // A later writer set the marker for its own reasons; this mount is the one
    // that has to remove it.
    assert.equal(stripProcessMarkers(environment, NAMES).outcome, 'stripped')
    assert.equal(Object.hasOwn(environment, 'ELECTRON_RUN_AS_NODE'), false)
  })

  it('answers already-stripped on a second mount', () => {
    const environment = { ELECTRON_RUN_AS_NODE: '1' }
    stripProcessMarkers(environment, NAMES)
    assert.equal(stripProcessMarkers(environment, NAMES).outcome, 'already-stripped')
  })

  it('reports what the first mount took when the second one asks', () => {
    const environment = { ELECTRON_RUN_AS_NODE: '1' }
    const first = stripProcessMarkers(environment, NAMES)
    const second = stripProcessMarkers(environment, NAMES)
    assert.deepEqual(second.removed, first.removed)
  })

  it('owes nothing from the second mount', () => {
    const environment = { ELECTRON_RUN_AS_NODE: '1' }
    stripProcessMarkers(environment, NAMES)
    const second = stripProcessMarkers(environment, NAMES)
    assert.deepEqual([...second.restore()], [])
    // The strip in force belongs to the first handle and is still in force.
    assert.equal(Object.hasOwn(environment, 'ELECTRON_RUN_AS_NODE'), false)
  })

  it('keeps two environments independent', () => {
    const first = { ELECTRON_RUN_AS_NODE: '1' }
    const second = { ELECTRON_RUN_AS_NODE: '2' }
    stripProcessMarkers(first, NAMES)
    const handle = stripProcessMarkers(second, NAMES)
    assert.equal(handle.outcome, 'stripped')
    assert.deepEqual(handle.removed, [{ name: 'ELECTRON_RUN_AS_NODE', value: '2' }])
  })

  it('strips several configured names at once', () => {
    const environment = { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect' }
    const handle = stripProcessMarkers(environment, ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS'])
    assert.deepEqual(handle.removed.map(record => record.name), ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS'])
    assert.deepEqual(environment, {})
  })

  it('reports only the names that were actually present', () => {
    const environment = { NODE_OPTIONS: '--inspect' }
    const handle = stripProcessMarkers(environment, ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS'])
    assert.deepEqual(handle.removed.map(record => record.name), ['NODE_OPTIONS'])
  })
})

describe('StripHandle.restore', () => {
  it('puts the value back', () => {
    const environment = { ELECTRON_RUN_AS_NODE: '1' }
    const handle = stripProcessMarkers(environment, NAMES)
    assert.deepEqual([...handle.restore()], [{ name: 'ELECTRON_RUN_AS_NODE', outcome: 'restored' }])
    assert.equal(environment.ELECTRON_RUN_AS_NODE, '1')
  })

  it('is safe to call more than once', () => {
    const environment = { ELECTRON_RUN_AS_NODE: '1' }
    const handle = stripProcessMarkers(environment, NAMES)
    handle.restore()
    assert.deepEqual([...handle.restore()], [])
    assert.equal(environment.ELECTRON_RUN_AS_NODE, '1')
  })

  it('does not overwrite a value another writer set', () => {
    const environment = { ELECTRON_RUN_AS_NODE: '1' }
    const handle = stripProcessMarkers(environment, NAMES)
    environment.ELECTRON_RUN_AS_NODE = '0'
    assert.deepEqual([...handle.restore()], [{ name: 'ELECTRON_RUN_AS_NODE', outcome: 'kept' }])
    assert.equal(environment.ELECTRON_RUN_AS_NODE, '0')
  })

  it('frees the environment for a later mount', () => {
    const environment = { ELECTRON_RUN_AS_NODE: '1' }
    const handle = stripProcessMarkers(environment, NAMES)
    handle.restore()
    assert.equal(stripProcessMarkers(environment, NAMES).outcome, 'stripped')
  })

  it('answers nothing-to-strip handles with nothing to restore', () => {
    const handle = stripProcessMarkers({}, NAMES)
    assert.deepEqual([...handle.restore()], [])
  })

  it('restores every name the handle took, in configure order', () => {
    const environment = { A: '1', B: '2' }
    const handle = stripProcessMarkers(environment, ['B', 'A'])
    assert.deepEqual(handle.restore().map(result => result.name), ['B', 'A'])
    assert.deepEqual(environment, { A: '1', B: '2' })
  })
})
