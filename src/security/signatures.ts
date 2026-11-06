import { createHmac, timingSafeEqual } from 'node:crypto'

export function signArtifact(payload: Record<string, unknown>, secret: string): string {
  return createHmac('sha256', secret).update(stableStringify(payload)).digest('hex')
}

export function verifyArtifact(
  payload: Record<string, unknown>,
  signature: string,
  secret: string,
): boolean {
  const expected = signArtifact(payload, secret)
  const left = Buffer.from(expected, 'utf8')
  const right = Buffer.from(signature, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}
