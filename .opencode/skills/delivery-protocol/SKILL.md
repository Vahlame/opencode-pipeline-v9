---
name: Protocolo de entrega
description: Formato de entrega, evidencia reproducible, validación de rutas e idempotencia para especialistas e integrador.
---

# Protocolo de entrega

## Regla central

El agente propone una entrega; el orquestador valida rutas, ejecuta pruebas, crea el commit y versiona el módulo. El agente no crea commits ni inventa SHAs.

## Flujo

1. El agente lee el contrato y confirma que la tarea está `RUNNING` y asignada a él.
2. Implementa solo dentro de las rutas permitidas.
3. Solicita la ejecución de las pruebas del contrato mediante la herramienta oficial.
4. Corrige los fallos y vuelve a solicitar pruebas.
5. Envía un `DeliveryDraft` con resumen, archivos, pruebas, evidencia, limitaciones y desviaciones.
6. El orquestador valida el diff, rechaza rutas no autorizadas y ejecuta las pruebas.
7. Si todo pasa, crea el commit y la versión inmutable; si no, devuelve errores accionables.

## Formato

```json
{
  "kind": "DeliveryDraft",
  "taskId": "string",
  "module": "string",
  "summary": "string",
  "filesChanged": ["string"],
  "testsRun": [{ "commandId": "string", "passed": true, "evidence": "string" }],
  "evidence": ["string"],
  "knownLimitations": ["string"],
  "contractDeviations": [],
  "readyForReview": true
}
```

## Evidencia

- Debe ser reproducible: comando, resultado y ruta o hash.
- No incluyas secretos, credenciales, prompts privados ni datos personales.
- No afirmes que una prueba pasó si no fue ejecutada por el mecanismo autorizado.
- Un `readyForReview: true` con pruebas fallidas es una entrega inválida.

## Idempotencia

- Reintentar la misma entrega no debe crear commits duplicados.
- La clave de idempotencia incluye tarea, contenido y contrato.
- Si el contenido no cambió, el orquestador reutiliza la versión existente.
