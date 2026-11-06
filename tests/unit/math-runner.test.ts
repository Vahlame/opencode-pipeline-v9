import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectHardware, runMathScript } from '../../src/math/runner.js'

let root: string | undefined

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  root = undefined
})

describe('math runner', () => {
  it('detects hardware and executes a numeric script with node', () => {
    root = mkdtempSync(join(tmpdir(), 'orch-math-'))
    writeFileSync(
      join(root, 'check.mjs'),
      "import assert from 'node:assert/strict'\nassert.equal(2 + 2, 4)\nconsole.log('math ok')\n",
    )
    const hardware = detectHardware()
    expect(hardware.cpuCores).toBeGreaterThan(0)
    const result = runMathScript({
      script: 'check.mjs',
      repositoryRoot: root!,
      interpreter: 'node',
      timeoutMs: 10_000,
    })
    expect(result.passed).toBe(true)
    expect(result.stdout).toContain('math ok')
    expect(result.interpreter).toBe('node')
  })

  it('rejects scripts outside the repository', () => {
    root = mkdtempSync(join(tmpdir(), 'orch-math-outside-'))
    expect(() =>
      runMathScript({
        script: '../outside.mjs',
        repositoryRoot: root!,
        interpreter: 'node',
      }),
    ).toThrow(/escapes repository/)
  })
})
