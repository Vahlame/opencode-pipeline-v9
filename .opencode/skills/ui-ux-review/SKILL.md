---
name: Revisión UI/UX
description: Checklist exigente para auditar claridad, jerarquía, accesibilidad, estados y consistencia de una interfaz operativa.
---

# Revisión UI/UX

## Principio

La interfaz no es decoración: reduce errores del operador y hace visible el
estado real del sistema. Un control ambiguo es un riesgo, no un detalle estético.

## Flujo

1. **Tarea principal**
   - ¿Qué intenta hacer el operador?
   - ¿Hay una acción primaria evidente por pantalla?

2. **Jerarquía**
   - Título, estado, métricas y acciones deben leerse en ese orden.
   - Evita competir por atención con demasiados colores o badges.

3. **Estados**
   - Carga, vacío, error, éxito, bloqueo, recuperación y entregado.
   - Todo error debe decir qué pasó y qué hacer.

4. **Accesibilidad**
   - Contraste, foco visible, navegación por teclado, labels y `aria-live`.
   - Las acciones destructivas requieren confirmación explícita.

5. **Responsive**
   - Sin scroll horizontal accidental.
   - La navegación y las tablas se adaptan sin perder contexto.

6. **Consistencia**
   - Mismo vocabulario, misma acción, mismo color.
   - Fechas, IDs y hashes con contexto y sin ruido.

## Entrega

Incluye puntuación, hallazgos por severidad, fortalezas, accesibilidad,
responsive y acciones prioritarias.
