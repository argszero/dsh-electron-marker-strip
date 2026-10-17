/**
 * What the plugin accepts, and what it refuses.
 *
 * Every refusal here is a mount that does not happen, which is the safe
 * direction: a plugin that reads a misspelled knob and mounts cleanly removes
 * nothing while the operator believes the environment is clean.
 *
 * @module test/config
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_LOG,
  DEFAULT_NAMES,
  STRIP_LOG_LEVELS,
  normalizeNames,
  resolveConfig,
  sameEnvironmentName,
} from '../lib/index.js'

describe('resolveConfig', () => {
  it('defaults to stripping the Electron runtime marker', () => {
    const settings = resolveConfig()
    assert.equal(settings.enabled, true)
    assert.deepEqual([...settings.names], ['ELECTRON_RUN_AS_NODE'])
    assert.equal(settings.log, DEFAULT_LOG)
  })

  it('treats an empty object as no configuration', () => {
    assert.deepEqual(resolveConfig({}), resolveConfig())
  })

  it('states its default name once', () => {
    assert.deepEqual([...DEFAULT_NAMES], ['ELECTRON_RUN_AS_NODE'])
    assert.equal(DEFAULT_LOG, 'warn')
  })

  it('accepts an explicit enabled: false', () => {
    assert.equal(resolveConfig({ enabled: false }).enabled, false)
  })

  it('refuses a non-boolean enabled', () => {
    assert.throws(() => resolveConfig({ enabled: 'yes' }), /"enabled" was string rather than a boolean/)
  })

  it('accepts every documented log level', () => {
    for (const level of STRIP_LOG_LEVELS) {
      assert.equal(resolveConfig({ log: level }).log, level)
    }
    assert.deepEqual([...STRIP_LOG_LEVELS], ['silent', 'debug', 'warn'])
  })

  it('refuses an unknown log level and lists the accepted ones', () => {
    assert.throws(() => resolveConfig({ log: 'INFO' }), /"log" was "INFO" rather than one of silent, debug, warn/)
  })

  it('refuses an unknown key by name, naming the plugin', () => {
    assert.throws(
      () => resolveConfig({ namez: ['X'] }),
      /electron-marker-strip: unknown configuration key "namez"; this plugin accepts enabled, names, log/,
    )
  })

  it('names the plugin in every refusal, so the throw is attributable', () => {
    assert.throws(() => resolveConfig({ enabled: 1 }), /^TypeError: electron-marker-strip: /)
  })

  it('replaces the default list rather than extending it', () => {
    const settings = resolveConfig({ names: ['FOO_MARKER'] })
    assert.deepEqual([...settings.names], ['FOO_MARKER'])
    assert.equal(settings.names.includes('ELECTRON_RUN_AS_NODE'), false)
  })

  it('keeps configure order and drops an exact duplicate', () => {
    assert.deepEqual([...normalizeNames(['B', 'A', 'B'])], ['B', 'A'])
  })

  it('refuses an empty name list, since nothing would be stripped', () => {
    assert.throws(() => resolveConfig({ names: [] }), /no marker names were configured/)
  })

  it('refuses a names value that is not an array', () => {
    assert.throws(() => resolveConfig({ names: 'ELECTRON_RUN_AS_NODE' }), /"names" was string rather than an array/)
  })

  it('refuses a name carrying "=", which no environment name can have', () => {
    assert.throws(() => normalizeNames(['FOO=bar']), /carries "=", which no environment name can/)
  })

  it('refuses a name carrying a NUL byte', () => {
    assert.throws(() => normalizeNames(['FO\u0000O']), /carries a NUL byte/)
  })

  it('refuses an empty name and a non-string entry', () => {
    assert.throws(() => normalizeNames(['']), /rather than a non-empty string/)
    assert.throws(() => normalizeNames([7]), /rather than a non-empty string/)
  })

  it('hands back a list the caller cannot use to mutate the default', () => {
    const settings = resolveConfig()
    assert.notEqual(settings.names, DEFAULT_NAMES)
    assert.throws(() => { settings.names.push('X') })
  })
})

describe('sameEnvironmentName', () => {
  it('is case-insensitive on Windows, where the environment is one namespace', () => {
    assert.equal(sameEnvironmentName('Path', 'PATH', 'win32'), true)
  })

  it('is case-sensitive everywhere else, where they are two variables', () => {
    assert.equal(sameEnvironmentName('Path', 'PATH', 'darwin'), false)
    assert.equal(sameEnvironmentName('Path', 'PATH', 'linux'), false)
  })

  it('deduplicates case-insensitively on win32 and exactly elsewhere', () => {
    assert.deepEqual([...normalizeNames(['FOO', 'foo'], 'win32')], ['FOO'])
    assert.deepEqual([...normalizeNames(['FOO', 'foo'], 'linux')], ['FOO', 'foo'])
  })

  it('defaults to this process as the platform', () => {
    assert.equal(sameEnvironmentName('A', 'A'), true)
    assert.equal(sameEnvironmentName('A', 'a'), process.platform === 'win32')
  })
})
