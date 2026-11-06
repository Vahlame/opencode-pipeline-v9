# Revision UI/UX de la Control Room

## Contexto

Revision realizada por el agente `disenador` sobre `src/api/ui.ts`. La GUI se
sirve en `/ui` y usa la API local con token humano.

## Puntuacion inicial

```text
score: 58/100
```

## Hallazgos y estado

| ID   | Severidad | Hallazgo                                                                     | Estado                                                                      |
| ---- | --------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| UX-1 | MAJOR     | "Recuperar" aplicaba cambios sin confirmacion contextual                     | Corregido: confirmacion con proyecto, alcance y accion auditada             |
| UX-2 | MAJOR     | No habia estado de carga, error ni marca de actualizacion                    | Corregido: `Cargando...`, `Actualizado HH:MM`, error de carga y `aria-live` |
| UX-3 | MAJOR     | Inputs sin label accesible, toast sin `aria-live` y botones sin foco visible | Corregido: `aria-label`, labels, `role=status/alert` y `:focus-visible`     |

## Mejoras posteriores recomendadas

1. Separar `Promise.all` en `Promise.allSettled` para conservar paneles parciales.
2. Añadir skeleton por panel y un indicador persistente de datos obsoletos.
3. Añadir contenedor con scroll horizontal controlado para tablas en movil.
4. Añadir filtros de tareas y busqueda por ID.
5. Convertir la revision UI/UX en un gate antes de aprobar cambios de GUI.

## Como repetir la revision

```powershell
npm run smoke -- --agent disenador --prompt "Revisa src/api/ui.ts como UI/UX exigente. Devuelve JSON UiReview con hallazgos priorizados." --json
```

El agente solo puede leer y editar `ui/**` y `docs/ui/**`; no modifica logica de
negocio.
