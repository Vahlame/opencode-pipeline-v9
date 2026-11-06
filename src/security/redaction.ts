const SENSITIVE_KEY =
  /(password|passwd|secret|token|authorization|api[_-]?key|credential|private[_-]?key|connection[_-]?string)/i
const SENSITIVE_TEXT =
  /((?:password|passwd|secret|token|authorization|api[_-]?key|credential|private[_-]?key)\s*[:=]\s*)(?:Bearer\s+)?([^\s,;]+)/gi

export const REDACTED = '[REDACTED]'

export function redactText(value: string): string {
  return value.replace(SENSITIVE_TEXT, `$1${REDACTED}`)
}

export function redact<T>(value: T): T {
  return redactValue(value) as T
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value)
  if (Array.isArray(value)) return value.map(redactValue)
  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(child)
    }
    return output
  }
  return value
}

export function assertNoSecret(value: unknown, label = 'payload'): void {
  const serialized = JSON.stringify(value)
  if (SENSITIVE_TEXT.test(serialized)) {
    throw new Error(`${label} contains a value that looks like a secret`)
  }
}
