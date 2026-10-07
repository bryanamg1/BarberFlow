# Base local de BarberFlow

BF-050 usa el CLI oficial de Supabase fijado en `devDependencies` y PostgreSQL 17.
Desde la raíz del proyecto, con Docker funcionando:

```powershell
npx supabase start
npx supabase db reset --local
Get-Content supabase/tests/foundation.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content supabase/tests/clients.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content supabase/tests/services.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content supabase/tests/appointments.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content supabase/tests/appointment_services.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content supabase/tests/product_categories.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content supabase/tests/products.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content supabase/tests/sales.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content supabase/tests/sale_items.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content supabase/tests/payments.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content supabase/tests/purchases.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content supabase/tests/purchase_items.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content supabase/tests/stock_movements.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content supabase/tests/expense_categories.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content supabase/tests/expenses.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content supabase/tests/database_indexes.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content supabase/tests/rls_enablement.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
npx supabase stop
```

El reset borra los datos del entorno **local de BarberFlow**. No usarlo sobre un entorno con datos
que deban conservarse. No hace falta login, un proyecto remoto ni `supabase link`.

Las seis migraciones crean una utilidad de timestamps y únicamente `profiles`, `businesses`,
`business_members`, `business_settings` y `business_hours`. `gen_random_uuid()` es nativo de
PostgreSQL 17; no se agregan extensiones. Todas las FK usan `ON DELETE RESTRICT` y el archivo de
negocios/membresías se hace mediante `is_active`.

`business_settings.business_id` es PK y FK, por lo que impide configuraciones duplicadas sin otro
UUID ni un índice redundante. El flujo futuro de creación del negocio deberá crear su configuración;
BF-050 no agrega triggers de negocio. Los roles `OWNER`/`BARBER` usan un CHECK sencillo y versionable.
Los horarios conservan horas explícitas incluso en días cerrados; los días abiertos exigen
`close_time > open_time`, sin intervalos nocturnos.

Las cinco tablas tienen RLS habilitado **sin policies**. Los clientes `anon` y `authenticated`
no pueden leer ni escribir sus filas hasta BF-070. Esto no restringe a los roles que evitan RLS,
como el administrador y `service_role`. No usar esas credenciales en el frontend.

El seed contiene solo comentarios. La prueba SQL verifica estructura, defaults, FK, unicidad,
CHECKs, triggers y denegación para ambos roles de cliente. Sus identidades de Auth son fixtures
SQL locales dentro de una transacción que siempre se revierte; no son usuarios de aplicación ni
seeds permanentes. Ejecutar esta prueba solo sobre una base local limpia después del reset.

BF-056 agrega una séptima migración para `clients`, con RLS habilitado sin policies y sin seed.
`last_name` y `preferences` son `text NULL`; las preferencias son texto libre en V1.
`clients.sql` prueba el contrato, los contactos compartidos, archivo lógico, timestamps y bloqueo
para ambos roles de cliente; sus datos también se revierten. `foundation.sql` sigue validando
exclusivamente sus cinco tablas de BF-050 y permite que existan otras tablas en el schema.

## BF-070: revisión de índices

Se auditaron los 50 índices anteriores: 19 de PRIMARY KEY, 5 de UNIQUE y 26 explícitos.
BF-070 añade únicamente tres B-tree no únicos, para un total de 53. No elimina índices,
modifica constraints ni cambia RLS, grants, funciones o policies.

Todas las tablas conservan su PK en `id`, excepto `business_settings`, cuya PK es `business_id`.
La siguiente tabla cubre las 19 tablas públicas; las columnas de cada índice aparecen en orden.
Los nombres completos y propiedades se verifican en `tests/database_indexes.sql`.

| Tabla                | UNIQUE adicional a la PK      | Índices de consulta reutilizados o añadidos                                                                                                                                   |
| -------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| profiles             | —                             | PK para el perfil por usuario                                                                                                                                                 |
| businesses           | —                             | PK para el negocio seleccionado                                                                                                                                               |
| business_members     | `(business_id, user_id)`      | `(user_id)`; UNIQUE cubre negocio y membership exacta                                                                                                                         |
| business_settings    | —                             | PK cubre configuración por negocio                                                                                                                                            |
| business_hours       | `(business_id, day_of_week)`  | UNIQUE cubre horarios por negocio/día                                                                                                                                         |
| clients              | —                             | `(business_id, is_active)`, `(business_id, phone)`                                                                                                                            |
| services             | —                             | `(business_id, is_active)`                                                                                                                                                    |
| appointments         | —                             | `(business_id, start_at)`, `(business_id, barber_member_id, start_at)`, `(business_id, client_id, start_at)`; nuevos `(barber_member_id, start_at)` y `(client_id, start_at)` |
| appointment_services | —                             | `(appointment_id)`, `(service_id)`                                                                                                                                            |
| product_categories   | —                             | `(business_id, is_active)`                                                                                                                                                    |
| products             | —                             | `(business_id, is_active)`, `(category_id)`                                                                                                                                   |
| sales                | `(business_id, operation_id)` | `(business_id, sold_at)`, `(client_id, sold_at)`, `(appointment_id)`                                                                                                          |
| sale_items           | —                             | `(sale_id)`, `(service_id)`, `(product_id)`                                                                                                                                   |
| payments             | —                             | `(sale_id)`                                                                                                                                                                   |
| purchases            | `(business_id, operation_id)` | `(business_id, purchased_at)`                                                                                                                                                 |
| purchase_items       | —                             | `(purchase_id)`, `(product_id)`                                                                                                                                               |
| stock_movements      | —                             | `(business_id, product_id, occurred_at)`, `(product_id, occurred_at)`                                                                                                         |
| expense_categories   | —                             | `(business_id, is_active)`                                                                                                                                                    |
| expenses             | `(purchase_id)`               | `(business_id, expense_date)`; nuevo `(category_id)`                                                                                                                          |

### Tres accesos faltantes

- `appointments_barber_member_id_start_at_idx`: agenda por referencia de barbero y rango/orden
  temporal, además de búsquedas de la FK de barbero sin un filtro de negocio.
- `appointments_client_id_start_at_idx`: historial por referencia de cliente y rango/orden
  temporal, además de búsquedas de la FK de cliente sin un filtro de negocio.
- `expenses_category_id_idx`: gastos asociados a una categoría y búsquedas de su FK restrictiva;
  el índice existente de negocio/fecha no comienza por categoría.

Los dos accesos temporales de citas están recomendados en `docs/DATABASE_SCHEMA.md`.
Los índices existentes con prefijo `business_id` se conservan para consultas que especifican ese
prefijo. Hay solapamiento de columnas, pero no equivalencia de prefijos: un B-tree de PostgreSQL 17
sin condición sobre sus primeras columnas puede tener que recorrer el índice completo.
No se considera ese solapamiento evidencia suficiente para eliminar índices aprobados.
Referencia: [índices multicolumna de PostgreSQL 17](https://www.postgresql.org/docs/17/indexes-multicolumn.html).

### Índices descartados

- Copias de PK, de `(business_id, operation_id)` o de `expenses(purchase_id)`: ya los crean las constraints.
- Índices aislados en `business_id` para catálogos, agenda, ventas, compras, ledger y gastos:
  ya existe cobertura por el primer campo de sus índices compuestos. Configuración usa su PK;
  en `businesses`, el identificador es la propia PK. Pagos se consulta por venta, con el índice
  existente en `sale_id`; no se añade un índice de negocio sin otro patrón documentado.
- Otros índices de membership por rol/activo: la búsqueda exacta negocio/usuario ya es única;
  no hay evidencia que justifique más índices para esos filtros en V1.
- Teléfono global: las búsquedas de clientes son por negocio y teléfono; se reutiliza el índice existente.
- Índices aislados en las referencias de citas o en `stock_movements(product_id)`: los prefijos de
  los índices temporales ya los cubren. El SUM del ledger sigue derivándose de sus filas.
- Índices adicionales por status: las agendas y reportes previstos ya acotan negocio y fecha;
  sin evidencia de selectividad adicional se pospone `(business_id, status)`, recomendado pero opcional.
- SKU, expresiones, partial indexes, full-text y métricas materializadas: sin patrón aprobado que
  justifique su costo. No se persiste stock ni se crean índices para columnas inexistentes.

No se detectaron índices exactamente duplicados comparando claves, método, opclasses,
collations, orden, predicado y expresiones. No hubo drops.

### Verificación local

Antes del reset se comparó `EXPLAIN (COSTS OFF)` antes/después dentro de una transacción revertida,
con 5.000 citas y 5.000 gastos sintéticos, distribuidos entre 100 referencias por tabla, y ANALYZE.
Con el planner normal, ambos accesos temporales de citas pasaron de Seq Scan + Sort a Index Scan
Backward por los índices nuevos. Gastos por categoría pasó de Seq Scan a Bitmap Index/Heap Scan;
conserva el Sort por fecha. No se midieron tiempos ni se afirma un benchmark de producción.

`database_indexes.sql` verifica los 53 índices esperados: nombre, tabla, claves ordenadas, B-tree,
validez, unicidad y vínculo con PK/UNIQUE, además de detectar copias exactas bajo otros nombres.
Los tests de citas y gastos conservan sus índices mínimos originales; la auditoría de BF-070
valida los adicionales sin cambiar sus pruebas de integridad, timestamps o RLS.
