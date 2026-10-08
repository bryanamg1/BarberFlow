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
Get-Content supabase/tests/membership_helpers.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content supabase/tests/bf073_rls_policies.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content supabase/tests/bf074_clients_services_rls_policies.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content supabase/tests/bf075_appointments_rls_policies.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content supabase/tests/bf076_inventory_rls_policies.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
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

BF-050 dejó inicialmente el seed vacío; BF-080 agrega únicamente el negocio demo descrito abajo.
La prueba SQL verifica estructura, defaults, FK, unicidad,
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

## BF-080: negocio demo local

`supabase db reset --local` aplica las migraciones y ejecuta el `seed.sql` ya habilitado en
`config.toml`. BF-080 crea únicamente **BarberFlow Demo (local)**, con UUID fijo
`00000000-0000-4000-8000-000000000080`, moneda `ARS`, zona `America/Argentina/Buenos_Aires`
y `is_active=true`. Los timestamps sintéticos son `2026-01-01T00:00:00Z`; teléfono, email,
dirección y logo quedan NULL. No contiene datos reales, claves ni credenciales.

El alcance específico del BACKLOG es «demo business». No se crean usuarios Auth, profiles,
memberships, settings, horarios, catálogos ni operaciones transaccionales en BF-080. BF-081 añade
la vinculación OWNER descrita abajo. Este seed es exclusivamente local/dev,
no un bootstrap de producción ni un flujo de Auth. No cambia las 46 policies ni sus helpers.

El flujo soportado es reset limpio; ejecutar el INSERT de nuevo sobre una base poblada produce
una colisión de PK. No hace upsert ni sobrescribe datos existentes.

Después del reset, ejecutar la comprobación de contenido:

```powershell
Get-Content -Raw supabase/tests/bf080_seed_data.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

La prueba conserva todos los campos del negocio y las 12 tablas ajenas a BF-080–BF-085 vacías.
BF-081 valida exactamente Auth, profile y membership; sustituye la expectativa histórica de
ausencia de usuarios. Las suites DB usan fixtures que se revierten y preservan el seed.
Las referencias a BF-050/BF-070 de arriba describen sus baselines históricas.

## BF-081: OWNER demo — LOCAL DEVELOPMENT ONLY

El reset local mantiene el mismo negocio BF-080 y añade exactamente un usuario Auth, una
identidad email, su profile y una membership OWNER activa. No crea otro negocio, BARBER,
settings, horarios, catálogos ni operaciones transaccionales en BF-081; BF-082 añade los servicios
descritos abajo. Sigue usando únicamente
`migrations → seed.sql`; no es el bootstrap productivo ni un flujo de registro de clientes.

Credenciales públicas de fixture **LOCAL DEVELOPMENT ONLY**:

- Email: `owner@barberflow.local`
- Password: `BarberFlow-Local-Only-081!`
- Auth user / profile: `00000000-0000-4000-8000-000000000081`
- Email identity: `00000000-0000-4000-8000-000000000182`
- Membership: `00000000-0000-4000-8000-000000000181`

No reutilizar estas credenciales ni ejecutar este seed en producción o en un proyecto remoto.
No contiene claves API, service-role keys, tokens, PII ni secretos reales. El profile es
`Demo Owner`, sin teléfono ni avatar. Las filas tienen timestamps sintéticos fijos
`2026-01-01T00:00:00Z`; los IDs, relaciones y hash también son deterministas entre resets.

La fixture se verificó contra GoTrue local `v2.197.0`: `auth.users` con audience/role
`authenticated`, email confirmado y hash bcrypt de costo 10, más su fila `auth.identities`
con provider `email` y provider_id igual al UUID del usuario. El hash se generó una vez con
pgcrypto ya disponible y se conserva como literal para reproducibilidad; no se almacena
password en texto plano en `encrypted_password`. El hash/salt fijo pertenece exclusivamente
a esta fixture pública, no define la estrategia de contraseñas de usuarios reales.
La [documentación de identidades de Supabase](https://supabase.com/docs/guides/auth/identities)
describe ese vínculo; una fila Auth mínima que solo satisface una FK no prueba autenticación.

No se cambian Auth config, schema, triggers, helpers, permisos ni las 46 policies. OWNER se
resuelve por membership, sin rol privilegiado en el JWT ni policy de autoasignación. El seed
se aplica con los privilegios del CLI; un cliente `anon` no puede realizar este bootstrap.

Después de un reset limpio y antes de iniciar sesión, ejecutar:

```powershell
Get-Content -Raw supabase/tests/bf080_seed_data.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content -Raw supabase/tests/bf081_demo_owner.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

BF-081 valida Auth/hash/confirmación, identidad, profile, relación OWNER, ausencia de datos
extra y acceso RLS activo/inactivo/reactivado/anon. Sus cambios se revierten. La validación
de entrega también usa el endpoint local normal de password y el JWT real para leer profile,
business y membership; no guarda tokens. Un login genera sesiones y timestamps operativos:
el determinismo se compara inmediatamente después de cada reset, antes de esas acciones.

## BF-082: servicios demo

El seed añade exactamente este catálogo ficticio al business BF-080
`00000000-0000-4000-8000-000000000080`, cuya moneda es ARS:

| UUID                                 | Nombre        | Precio ARS | Duración (min) |
| ------------------------------------ | ------------- | ---------- | -------------- |
| 00000000-0000-4000-8000-000000000821 | Corte clásico | 10000.00   | 30             |
| 00000000-0000-4000-8000-000000000822 | Barba         | 5000.00    | 15             |
| 00000000-0000-4000-8000-000000000823 | Corte + barba | 14000.00   | 45             |

Los tres tienen `is_active=true`, `description=NULL` y ambos timestamps fijos
`2026-01-01T00:00:00Z`. Usa el reset local normal; no sobrescribe datos existentes.
El business y todas las filas/credenciales BF-081 se conservan intactos. No agrega categorías,
productos, clientes, citas ni operaciones transaccionales, ni cambia schema, RLS o helpers.

```powershell
Get-Content -Raw supabase/tests/bf082_services.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

BF-082 comprueba exactamente las tres filas completas, su tenant y las 12 tablas ajenas vacías;
BF-083–BF-085 validan categorías/productos/clientes;
BF-080/BF-081 mantienen las assertions completas del negocio y OWNER. Dos resets de entrega
comparan los datos completos de servicios y de las entidades previas antes de ejecutar tests.

## BF-083: categorías de productos demo

BF-083 corresponde exclusivamente a `public.product_categories`. El reset local añade
estas tres categorías a BarberFlow Demo (`00000000-0000-4000-8000-000000000080`):

| UUID                                 | Nombre     |
| ------------------------------------ | ---------- |
| 00000000-0000-4000-8000-000000000831 | Cabello    |
| 00000000-0000-4000-8000-000000000832 | Barba      |
| 00000000-0000-4000-8000-000000000833 | Accesorios |

Todas tienen `is_active=true` y `created_at`/`updated_at` fijos en
`2026-01-01T00:00:00Z`. La tabla no tiene `description`; no se agrega ese campo.
No crea productos, categorías de gastos, gastos ni ninguna otra entidad. Conserva intactos
Business, Demo Owner, Auth, membership y los tres servicios BF-082, además del schema,
helpers, 46 policies y 19 tablas con RLS habilitado y FORCE RLS desactivado.

```powershell
Get-Content -Raw -Encoding utf8 supabase/tests/bf083_product_categories.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

La prueba consume las filas del seed y comprueba cantidad, seis campos completos, UUIDs,
tenant, estados y fechas, además de las 12 tablas ajenas vacías; BF-084/BF-085 validan productos/clientes. BF-080/BF-081/BF-082 conservan
sus validaciones exactas; dos resets de entrega comparan las categorías y todas las entidades
previas. Se mantiene el flujo normal `migrations → seed.sql`, sin upsert ni scripts especiales.

## BF-084: productos demo

El seed añade exclusivamente seis filas a `public.products`, del business BarberFlow Demo
`00000000-0000-4000-8000-000000000080`. Sus categorías son las filas BF-083 del mismo negocio:
Cabello (`…831`), Barba (`…832`) y Accesorios (`…833`).

| UUID                                 | Producto           | Categoría  | SKU        | Precio ARS | Costo referencia ARS | Stock mínimo |
| ------------------------------------ | ------------------ | ---------- | ---------- | ---------- | -------------------- | ------------ |
| 00000000-0000-4000-8000-000000000841 | Cera mate          | Cabello    | BF-CAB-001 | 12000.00   | 6500.00              | 3            |
| 00000000-0000-4000-8000-000000000842 | Shampoo            | Cabello    | BF-CAB-002 | 10000.00   | 5500.00              | 3            |
| 00000000-0000-4000-8000-000000000843 | Aceite para barba  | Barba      | BF-BAR-001 | 11000.00   | 6000.00              | 2            |
| 00000000-0000-4000-8000-000000000844 | Bálsamo para barba | Barba      | BF-BAR-002 | 13000.00   | 7000.00              | 2            |
| 00000000-0000-4000-8000-000000000845 | Peine profesional  | Accesorios | BF-ACC-001 | 6000.00    | 3000.00              | 4            |
| 00000000-0000-4000-8000-000000000846 | Cepillo para barba | Accesorios | BF-ACC-002 | 9000.00    | 4500.00              | 3            |

Todos están activos, con `description=NULL` y `created_at`/`updated_at` fijos en
`2026-01-01T00:00:00Z`. Los seis SKU son distintos dentro del negocio; la tabla existente no
posee un UNIQUE de SKU y BF-084 no agrega esa restricción. Los precios y costos son los valores
ficticios aprobados; no generan COGS, compras, gastos ni snapshots de venta.

`minimum_stock` es un umbral, no inventario inicial. No crea movimientos ni stock persistido:
el stock sigue derivándose de `SUM(stock_movements.quantity_delta)`. No añade categorías ni
ninguna otra entidad y preserva BF-080–BF-083, schema, RLS, policies, helpers y skills.

```powershell
Get-Content -Raw -Encoding utf8 supabase/tests/bf084_products.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

La suite consume el seed y comprueba las seis filas completas, categorías del mismo tenant,
SKU distintos y 12 tablas ajenas vacías. BF-080–BF-083 conservan sus oracles de datos exactos.
Dos resets normales de entrega comparan productos y entidades previas; no hay scripts de seed
paralelos ni upsert. Las pruebas deben ejecutarse sobre el baseline de reset local limpio.

## BF-085: clientes demo

El seed añade exclusivamente cuatro clientes ficticios a `public.clients`, del business
BarberFlow Demo (`00000000-0000-4000-8000-000000000080`):

| UUID                                 | first_name | last_name | is_active |
| ------------------------------------ | ---------- | --------- | --------- |
| 00000000-0000-4000-8000-000000000851 | Martín     | Pérez     | true      |
| 00000000-0000-4000-8000-000000000852 | Lucía      | Gómez     | true      |
| 00000000-0000-4000-8000-000000000853 | Diego      | NULL      | true      |
| 00000000-0000-4000-8000-000000000854 | Valentina  | Ríos      | false     |

Los cuatro tienen `phone`, `email`, `instagram`, `birth_date`, `notes` y `preferences` en NULL.
`created_at` y `updated_at` son `2026-01-01T00:00:00Z`. Cubren clientes activos con apellido,
un cliente activo sin apellido y una cliente archivada/inactiva, sin inventar datos de contacto.
Son fixtures aprobadas, no personas reales ni cuentas Auth.

No crea citas, ventas, mensajes ni historial transaccional. Conserva BF-080–BF-084 y sus UUIDs,
credenciales, precios/costos, estados y timestamps, además del schema, RLS, policies, helpers y
skills. No añade estadísticas persistidas como gasto total, cantidad de visitas o última visita.

```powershell
Get-Content -Raw -Encoding utf8 supabase/tests/bf085_clients.sql | docker exec -i supabase_db_barberflow psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

La suite consume el seed real y valida las cuatro filas completas, sus 13 campos, tenant y
12 tablas ajenas vacías. BF-080–BF-084 mantienen sus validaciones exactas y delegan solo los
clientes a BF-085. Dos resets locales normales de entrega comparan los clientes y todas las
entidades previas; ejecutar las pruebas sobre el baseline limpio, sin scripts paralelos ni upsert.
