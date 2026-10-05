# BF-001 — Verificación de la documentación base

Fecha: 2026-10-05 (America/Buenos_Aires).

## 1. Estado del ticket BF-001

Documentación instalada y revisada. Aceptación completa pendiente: esta carpeta no es un repositorio Git y, por lo tanto, no es posible satisfacer la validación de `git status` / `git diff`. Las inconsistencias y ambigüedades identificadas requieren revisión humana; no se resolvieron cambiando requisitos aprobados.

## 2. Inspección realizada

- Carpeta de trabajo: `C:/Users/BRYAN/desarrollo/app joaco`.
- Estado inicial: paquete `BarberFlow_Documentation_v1.0/barberflow-docs` y tres imágenes JPEG. No existían `docs/`, aplicación ni metadatos Git.
- Se leyeron completos los nueve documentos requeridos, los quince ADR y el documento adicional `PROMPT_BF-001_CODEX.md` del paquete.
- No se encontraron README, AGENTS.md, reglas locales de `.agents`, `.codex`, `.cursor` o `.github`, ni otra documentación del proyecto fuera del paquete. Tampoco se encontraron AGENTS.md en los directorios ascendentes hasta la raíz de la unidad.
- La sección 52 de `CODEX_PROJECT_SPEC.md` establece la precedencia de la especificación y los ADR aceptados. Se conserva esa precedencia; este informe registra hallazgos y no aprueba ni sustituye decisiones.

## 3. Documentos encontrados

Los siguientes nueve archivos fueron encontrados en el paquete e instalados mediante copia exacta en `docs/`:

| Documento | Verificación |
| --- | --- |
| CODEX_PROJECT_SPEC.md | Version: 1.0; Status: APPROVED FOR DEVELOPMENT |
| BACKLOG.md | Version: 1.0; Status: APPROVED BASELINE |
| FRONTEND_ARCHITECTURE.md | Version: 1.0; Status: APPROVED |
| DATABASE_SCHEMA.md | Version: 1.0; Status: APPROVED |
| BUSINESS_RULES.md | Version: 1.0; Status: APPROVED |
| RPC_CONTRACTS.md | Version: 1.0; Status: APPROVED |
| RLS_MATRIX.md | Version: 1.0; Status: APPROVED BASELINE |
| DESIGN_SYSTEM.md | Version: 1.0; Status: APPROVED |
| ERROR_CONTRACT.md | Version: 1.0; Status: APPROVED |

El documento adicional `PROMPT_BF-001_CODEX.md` permanece en el paquete original; no es un documento requerido de `docs/` ni se generó un nuevo prompt.

## 4. ADR encontrados

Se verificaron los nombres exactos y `Status: ACCEPTED` en los quince archivos instalados en `docs/adr/`:

1. ADR-001-feature-first-frontend.md
2. ADR-002-supabase-backend.md
3. ADR-003-business-tenancy.md
4. ADR-004-unified-sale.md
5. ADR-005-inventory-ledger.md
6. ADR-006-transactional-checkout.md
7. ADR-007-historical-snapshots.md
8. ADR-008-state-management.md
9. ADR-009-no-negative-stock.md
10. ADR-010-timezone.md
11. ADR-011-one-currency.md
12. ADR-012-derived-metrics.md
13. ADR-013-soft-archive.md
14. ADR-014-universal-app.md
15. ADR-015-accounting-scope.md

## 5. Validaciones realizadas

- Presencia de los nueve documentos y los quince ADR con sus nombres requeridos.
- Metadatos exactos de versión y aprobación de la especificación; aceptación de los quince ADR.
- Comparación SHA-256 de los veinticuatro archivos instalados contra el paquete: coincidencia en todos ellos.
- Inventario y hashes SHA-256 de los veintiocho archivos iniciales para verificar su conservación: todos permanecen sin modificaciones ni eliminaciones.
- Revisión de consistencia de stack, plataformas, tenancy, RLS, ventas unificadas, inventario por movimientos, transacciones server-side, snapshots, estado cliente/servidor, stock no negativo, zona horaria, moneda única, métricas derivadas, archivo lógico y alcance contable.
- No se ejecutaron instalaciones, herramientas de inicialización, pruebas de aplicación ni tareas de tickets posteriores. No se creó package.json, código, configuración de Supabase, migraciones ni proyectos externos.
- `git status --short --branch` falló con `not a git repository`. `git diff --stat` y `git diff --cached --stat` tampoco pudieron obtener diferencias de repositorio. No se considera esta falla un diff limpio y no se inicializó Git como parte de BF-001.

## 6. Cambios realizados

- Creados: nueve documentos en `docs/`, quince ADR en `docs/adr/` y este informe `docs/BF-001_VERIFICATION.md` (veinticinco archivos Markdown).
- Archivos preexistentes modificados o eliminados: ninguno.
- Los documentos originales mantienen nombres, contenido y jerarquía. Las copias no alteran bytes ni decisiones aprobadas.
- No se crearon README, AGENTS.md, tickets ni nuevas reglas arquitectónicas.

## 7. Conflictos o inconsistencias encontradas

### Contradicción: orden de desarrollo

Archivo: `docs/CODEX_PROJECT_SPEC.md`.

Secciones: 37, Development phases (líneas 800–804), y 53, Development order (líneas 1136–1137).

La sección 37 ubica Checkout / payments en la fase 9 y Products en la fase 10. La sección 53 ubica products en el paso 13 y transactional checkout en el paso 14, invirtiendo ese orden. `BACKLOG.md`, Epic 15 Products y Epic 16 Checkout DB, también ubica productos antes del checkout. La regla de precedencia de la sección 52 no resuelve por sí sola una contradicción dentro de la misma especificación. No se eligió ni modificó una secuencia.

### Ambigüedad: descuento global y métricas por tipo de venta

Archivos/secciones: `docs/BUSINESS_RULES.md`, Checkout (línea 16) y Finance (línea 44); `docs/CODEX_PROJECT_SPEC.md`, sección 46, Financial rules; `docs/DATABASE_SCHEMA.md`, sales y sale_items.

El descuento global reduce el total de la venta, mientras los ingresos de servicios y productos se derivan de sus items. No se define si esas métricas son brutas o netas ni cómo repartir el descuento entre tipos de item en una venta mixta. La suma de métricas por tipo puede diferir del ingreso total según la interpretación. No se inventó una regla de asignación ni se cambió el modelo de ventas.

### Ambigüedad: permisos CRUD y preservación del histórico

Archivos/secciones: `docs/RLS_MATRIX.md`, Matrix (líneas 19–24) y Principles; `docs/BUSINESS_RULES.md`, Voids and corrections (línea 40); `docs/adr/ADR-013-soft-archive.md`, Decision.

La matriz usa CRUD para compras, gastos y turnos, sin distinguir borradores, registros completados y gastos generados por compras. Las reglas exigen conservar operaciones históricas y corregir compras completadas mediante una estrategia explícita. Una lectura literal de CRUD podría habilitar borrados o cambios que rompan esas reglas. Los principios de la matriz ya recomiendan restringir escrituras directas, pero falta precisar el alcance por estado y origen. Se registra como ambigüedad, no como autorización para borrar ni como una contradicción definitivamente resuelta.

## 8. Riesgos u observaciones

- Sin repositorio Git no pueden comprobarse la rama, cambios respecto de HEAD, staged/unstaged ni el criterio de aceptación sobre `git diff`. El inventario y los hashes verifican conservación de archivos durante esta tarea, pero no reemplazan esa validación.
- El paquete original se conserva para no eliminar contenido entregado. Las copias canónicas para el desarrollo están en `docs/`; futuras revisiones deberían evitar que ambas ubicaciones diverjan.
- Los ADR aceptados y la especificación son consistentes en las decisiones arquitectónicas protegidas revisadas. Los hallazgos anteriores no se usaron para reinterpretarlas.
- Los tres JPEG iniciales se conservaron; este ticket no valida el diseño visual ni selecciona cuál imagen es el concepto aprobado.

## 9. Resultado final de BF-001

Baseline documental instalada: nueve documentos y quince ADR, todos idénticos al paquete entregado. Informe de revisión disponible. No corresponde declarar BF-001 completamente aceptado hasta poder validar Git y revisar los hallazgos registrados. BF-010 y los tickets posteriores no se iniciaron.

## Siguiente paso recomendado:

Revisar los hallazgos y completar la validación Git de BF-001 antes de aprobarlo y comenzar BF-010.
