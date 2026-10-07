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
