import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { cpus, totalmem, platform, arch } from 'node:os'
import { extname, resolve } from 'node:path'

export interface HardwareProfile {
  readonly platform: string
  readonly arch: string
  readonly cpuModel: string
  readonly cpuCores: number
  readonly memoryGb: number
  readonly recommendedInterpreter: 'python' | 'node'
}

export interface MathRunResult {
  readonly script: string
  readonly interpreter: 'python' | 'node'
  readonly command: string
  readonly passed: boolean
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
  readonly hardware: HardwareProfile
}

export function detectHardware(): HardwareProfile {
  const cpu = cpus()[0]
  return {
    platform: platform(),
    arch: arch(),
    cpuModel: cpu?.model ?? 'unknown',
    cpuCores: cpus().length,
    memoryGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    recommendedInterpreter: hasCommand('python', ['--version'])
      ? 'python'
      : hasCommand('python3', ['--version'])
        ? 'python'
        : 'node',
  }
}

export function resolveInterpreter(
  requested: 'auto' | 'python' | 'node' = 'auto',
  hardware = detectHardware(),
): 'python' | 'node' {
  if (requested !== 'auto') return requested
  return hardware.recommendedInterpreter
}

export function runMathScript(input: {
  readonly script: string
  readonly repositoryRoot: string
  readonly interpreter?: 'auto' | 'python' | 'node'
  readonly timeoutMs?: number
}): MathRunResult {
  const hardware = detectHardware()
  const interpreter = resolveInterpreter(input.interpreter ?? 'auto', hardware)
  const script = resolve(input.repositoryRoot, input.script)
  const root = resolve(input.repositoryRoot)
  if (!script.startsWith(`${root}\\`) && !script.startsWith(`${root}/`) && script !== root) {
    throw new Error(`Math script escapes repository: ${input.script}`)
  }
  if (!existsSync(script) || !statSync(script).isFile()) {
    throw new Error(`Math script not found: ${input.script}`)
  }
  if (
    interpreter === 'python' &&
    !hasCommand('python', ['--version']) &&
    !hasCommand('python3', ['--version'])
  ) {
    throw new Error('Python is not available')
  }
  const started = performance.now()
  const command =
    interpreter === 'python' ? (hasCommand('python', ['--version']) ? 'python' : 'python3') : 'node'
  const args = [script]
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: input.timeoutMs ?? 300_000,
    env: {
      PATH: process.env.PATH ?? '',
      SystemRoot: process.env.SystemRoot ?? '',
      TEMP: process.env.TEMP ?? '',
      TMP: process.env.TMP ?? '',
      PYTHONIOENCODING: 'utf-8',
    },
  })
  const stdout = (result.stdout ?? '').slice(0, 50_000)
  const stderr = (result.stderr ?? '').slice(0, 50_000)
  return {
    script,
    interpreter,
    command: `${command} ${input.script}`,
    passed: result.status === 0,
    exitCode: result.status ?? -1,
    stdout,
    stderr,
    durationMs: Math.round(performance.now() - started),
    hardware,
  }
}

export function inspectMathScript(script: string): {
  readonly extension: string
  readonly lines: number
  readonly bytes: number
  readonly importsPythonNumeric: boolean
} {
  const content = readFileSync(script, 'utf8')
  return {
    extension: extname(script),
    lines: content.split(/\r?\n/).length,
    bytes: Buffer.byteLength(content),
    importsPythonNumeric: /\b(?:numpy|scipy|sympy|jax|torch)\b/.test(content),
  }
}

function hasCommand(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5_000,
    env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' },
  })
  return result.status === 0
}
