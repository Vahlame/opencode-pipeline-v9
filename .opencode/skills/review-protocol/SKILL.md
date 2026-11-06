---
name: Protocolo de revisión
description: Veredictos independientes, consolidación determinista, aprobaciones obligatorias y regla de optimización.
---

# Protocolo de revisión

## Jueces

1. **Pruebas** — obligatorio.
2. **Depuración** — obligatorio.
3. **Arquitectura** — obligatorio.
4. **Optimización** — solo bloquea hallazgos `CRITICAL` demostrables.

Cada juez se ejecuta en una sesión independiente, sobre un snapshot inmutable, y registra su propio dictamen. No hay coordinación entre jueces.

## Veredicto

```json
{
  "judgeRole": "JUDGE_TESTS|JUDGE_DEBUG|JUDGE_ARCHITECTURE|JUDGE_OPTIMIZATION",
  "moduleVersionId": "string",
  "commitSha": "string",
  "contentHash": "string",
  "verdict": "APPROVE|REJECT",
  "findings": [
    {
      "severity": "INFO|MINOR|MAJOR|CRITICAL",
      "message": "string",
      "criterion": "string",
      "evidence": ["string"]
    }
  ],
  "summary": "string"
}
```

## Consolidación determinista

- Las tres aprobaciones obligatorias deben ser `APPROVE`.
- Si falta un dictamen, el módulo no avanza.
- Si un juez obligatorio rechaza, el módulo pasa a `REWORK_REQUIRED`.
- Si optimización tiene un `CRITICAL` válido, el módulo pasa a `REWORK_REQUIRED`.
- Un hallazgo `MINOR` o `MAJOR` de optimización no bloquea por sí solo.
- Solo el módulo afectado vuelve a su autor; los demás conservan sus aprobaciones.
- Un módulo modificado invalida las aprobaciones de su versión anterior.

## Definición de CRITICAL para optimización

Debe ser reproducible, demostrable, ligado a un criterio o límite del contrato, y causar un riesgo grave de fallo, corrupción, pérdida de datos, agotamiento de recursos o incumplimiento de seguridad. Una preferencia de estilo no es `CRITICAL`.

## Auditoría

- Cada dictamen debe indicar la versión exacta evaluada.
- Las decisiones de consolidación se registran como eventos.
- No se permite reutilizar un veredicto de otra versión.
