import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const expectedAgents = [
  'padre',
  'coordinador',
  'frontend',
  'backend',
  'database',
  'testing',
  'debugger',
  'architecture',
  'optimizer',
  'integrador',
  'feedback',
] as const
const expectedSections = [
  'Identidad y especialidad',
  'Responsabilidades',
  'Límites de autoridad',
  'Herramientas necesarias',
  'Entradas esperadas',
  'Formato estructurado de salida',
  'Reglas de comunicación',
  'Criterios de finalización',
]

describe('V2 agent profiles', () => {
  it('contains all expected profiles', () => {
    for (const agent of expectedAgents) {
      expect(existsSync(join(root, '.opencode', 'agents', `${agent}.md`))).toBe(true)
    }
  })

  it('uses V2 fields and avoids V1 fields', async () => {
    for (const agent of expectedAgents) {
      const content = await readFile(join(root, '.opencode', 'agents', `${agent}.md`), 'utf8')
      expect(content).toMatch(/^---\r?\n/)
      expect(content).toMatch(/^mode: primary$/m)
      expect(content).toMatch(/^permissions:$/m)
      expect(content).not.toMatch(/^permission:/m)
      expect(content).not.toMatch(/^maxSteps:/m)
      expect(content).not.toMatch(/^tools:/m)
      expect(content).not.toMatch(/^bash:/m)
    }
  })

  it('contains the required profile sections', async () => {
    for (const agent of expectedAgents) {
      const content = await readFile(join(root, '.opencode', 'agents', `${agent}.md`), 'utf8')
      for (const section of expectedSections) {
        expect(content).toContain(`## ${section}`)
      }
    }
  })

  it('contains the shared skills', () => {
    for (const skill of [
      'orchestrator-contracts',
      'delivery-protocol',
      'review-protocol',
      'security-boundaries',
    ]) {
      expect(existsSync(join(root, '.opencode', 'skills', skill, 'SKILL.md'))).toBe(true)
    }
  })
})
