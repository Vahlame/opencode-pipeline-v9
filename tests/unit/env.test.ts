import { describe, expect, it } from 'vitest'
import { loadConfig, parseModelRef, ConfigurationError } from '../../src/config/env.js'

describe('environment configuration', () => {
  it('uses conservative defaults', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      OPENCODE_PROJECT_DIR: process.cwd(),
    })

    expect(config.OPENCODE_RUNTIME).toBe('http')
    expect(config.OPENCODE_AGENT).toBe('padre')
    expect(config.OPENCODE_REAL_TESTS).toBe(false)
    expect(config.projectDir).toBe(process.cwd())
  })

  it('accepts the sdk and mock runtimes', () => {
    expect(
      loadConfig({ NODE_ENV: 'test', OPENCODE_RUNTIME: 'sdk', OPENCODE_PROJECT_DIR: '.' })
        .OPENCODE_RUNTIME,
    ).toBe('sdk')
    expect(
      loadConfig({ NODE_ENV: 'test', OPENCODE_RUNTIME: 'mock', OPENCODE_PROJECT_DIR: '.' })
        .OPENCODE_RUNTIME,
    ).toBe('mock')
  })

  it('rejects an invalid runtime', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'test', OPENCODE_RUNTIME: 'v1', OPENCODE_PROJECT_DIR: '.' }),
    ).toThrow()
  })

  it('parses provider/model and variants', () => {
    expect(parseModelRef(undefined)).toBeUndefined()
    expect(parseModelRef('openai/gpt-5')).toEqual({ providerID: 'openai', id: 'gpt-5' })
    expect(parseModelRef('openai/gpt-5#high')).toEqual({
      providerID: 'openai',
      id: 'gpt-5',
      variant: 'high',
    })
    expect(() => parseModelRef('invalid')).toThrow(ConfigurationError)
  })
})
