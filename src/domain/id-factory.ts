import { randomUUID } from 'node:crypto'

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function addSecondsIso(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString()
}

export function addMinutesIso(minutes: number): string {
  return addSecondsIso(minutes * 60)
}
