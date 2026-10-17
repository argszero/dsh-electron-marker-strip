/**
 * The four primitives, over plain records.
 *
 * The load-bearing assertion in this file is the one at
 * "removes the name instead of assigning undefined": Node stores the four
 * letters when an environment name is assigned `undefined`, and a child spawned
 * from that environment receives a *defined* marker — which is worse than not
 * touching it at all, because the whole point of the strip is that the child
 * sees the name absent.
 *
 * @module test/strip
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  captureMarkers,
  presentMarkers,
  removeMarkers,
  restoreMarkers,
} from '../lib/index.js'

const NAMES = ['ELECTRON_RUN_AS_NODE']

describe('presentMarkers', () => {
  it('finds a carried name', () => {
    assert.deepEqual([...presentMarkers({ ELECTRON_RUN_AS_NODE: '1' }, NAMES)], NAMES)
  })

  it('reports nothing for an absent name', () => {
    assert.deepEqual([...presentMarkers({}, NAMES)], [])
  })

  it('does not count a name mapped to undefined, which an environment never carries', () => {
    assert.deepEqual([...presentMarkers({ ELECTRON_RUN_AS_NODE: undefined }, NAMES)], [])
  })

  it('keeps configure order across several names', () => {
    const names = ['B', 'A']
    assert.deepEqual([...presentMarkers({ A: '1', B: '2' }, names)], ['B', 'A'])
  })

  it('answers an empty name list with an empty list', () => {
    assert.deepEqual([...presentMarkers({ A: '1' }, [])], [])
  })
})

describe('captureMarkers', () => {
  it('keeps the value a restore will need', () => {
    assert.deepEqual(captureMarkers({ ELECTRON_RUN_AS_NODE: '1' }, NAMES), [
      { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
    ])
  })

  it('captures an empty string as a value, not as absence', () => {
    assert.deepEqual(captureMarkers({ ELECTRON_RUN_AS_NODE: '' }, NAMES), [
      { name: 'ELECTRON_RUN_AS_NODE', value: '' },
    ])
  })

  it('skips an undefined entry', () => {
    assert.deepEqual(captureMarkers({ ELECTRON_RUN_AS_NODE: undefined }, NAMES), [])
  })

  it('captures in configure order', () => {
    const records = captureMarkers({ A: '1', B: '2' }, ['B', 'A'])
    assert.deepEqual(records.map(record => record.name), ['B', 'A'])
  })
})

describe('removeMarkers', () => {
  it('removes the name instead of assigning undefined', () => {
    const environment = { ELECTRON_RUN_AS_NODE: '1' }
    const records = captureMarkers(environment, NAMES)
    removeMarkers(environment, records)
    assert.equal(Object.hasOwn(environment, 'ELECTRON_RUN_AS_NODE'), false)
    assert.equal(environment.ELECTRON_RUN_AS_NODE, undefined)
    // The failure this guards against: an assignment of `undefined` stores the
    // string, and a child would then inherit a *defined* marker.
    assert.notEqual(environment.ELECTRON_RUN_AS_NODE, 'undefined')
  })

  it('reports what it removed', () => {
    const environment = { A: '1', B: '2' }
    assert.deepEqual([...removeMarkers(environment, captureMarkers(environment, ['A', 'B']))], ['A', 'B'])
  })

  it('does not report a name somebody else already removed', () => {
    const environment = { A: '1' }
    const records = captureMarkers(environment, ['A'])
    delete environment.A
    assert.deepEqual([...removeMarkers(environment, records)], [])
  })

  it('leaves every other name in place', () => {
    const environment = { ELECTRON_RUN_AS_NODE: '1', PATH: '/usr/bin' }
    removeMarkers(environment, captureMarkers(environment, NAMES))
    assert.equal(environment.PATH, '/usr/bin')
  })

  it('answers a second pass with nothing to report', () => {
    const environment = { A: '1' }
    const records = captureMarkers(environment, ['A'])
    removeMarkers(environment, records)
    assert.deepEqual([...removeMarkers(environment, records)], [])
  })
})

describe('restoreMarkers', () => {
  it('puts the captured value back', () => {
    const environment = { ELECTRON_RUN_AS_NODE: '1' }
    const records = captureMarkers(environment, NAMES)
    removeMarkers(environment, records)
    assert.deepEqual([...restoreMarkers(environment, records)], [
      { name: 'ELECTRON_RUN_AS_NODE', outcome: 'restored' },
    ])
    assert.equal(environment.ELECTRON_RUN_AS_NODE, '1')
  })

  it('keeps a value another writer set in the meantime', () => {
    const environment = { A: '1' }
    const records = captureMarkers(environment, ['A'])
    removeMarkers(environment, records)
    environment.A = '2'
    assert.deepEqual([...restoreMarkers(environment, records)], [{ name: 'A', outcome: 'kept' }])
    assert.equal(environment.A, '2')
  })

  it('restores an empty string, which is a value and not absence', () => {
    const environment = { A: '' }
    const records = captureMarkers(environment, ['A'])
    removeMarkers(environment, records)
    restoreMarkers(environment, records)
    assert.equal(environment.A, '')
  })

  it('answers an empty record list with an empty result', () => {
    assert.deepEqual([...restoreMarkers({}, [])], [])
  })
})
