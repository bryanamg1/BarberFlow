// Transactional upgrade probes against the real local engine, including the
// exact migration body. No remote DB, permanent fixtures or history repair.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const args = [
  'exec',
  '-i',
  'supabase_db_barberflow',
  'psql',
  '-X',
  '-q',
  '-At',
  '-U',
  'postgres',
  '-d',
  'postgres',
  '-v',
  'ON_ERROR_STOP=1',
];
const query = (sql) =>
  execFileSync('docker', args, { input: sql, encoding: 'utf8', timeout: 20000 }).trim();
const body = (path) =>
  readFileSync(path, 'utf8')
    .replace(/^BEGIN;\s*/, '')
    .replace(/\s*COMMIT;\s*$/, '');
const migration = body('supabase/migrations/20261018220000_purchase_generated_expense.sql');
const oldProducer = body('supabase/migrations/20261018180000_purchase_persistence.sql').replace(
  'CREATE FUNCTION private.persist_purchase(',
  'CREATE OR REPLACE FUNCTION private.persist_purchase(',
);
assert.equal(
  query('SELECT count(*) FROM public.expenses;'),
  '0',
  'run on clean reset before concurrency fixtures',
);
assert.equal(
  query('SELECT count(*) FROM public.purchases;'),
  '0',
  'run on clean reset before concurrency fixtures',
);
const restore = `SET LOCAL client_min_messages=warning;
  DROP FUNCTION IF EXISTS private.persist_purchase_expense(uuid,uuid,boolean);
  ALTER TABLE public.purchases DROP COLUMN IF EXISTS expense_category_id,DROP COLUMN IF EXISTS payment_method;
  ${oldProducer}
  ALTER TABLE public.expenses DROP CONSTRAINT expenses_payment_method_check;
  ALTER TABLE public.expenses ADD CONSTRAINT expenses_payment_method_check
    CHECK(payment_method IN ('CASH','TRANSFER','DEBIT','CREDIT','OTHER'));`;
let groups = 0;
for (const method of ['TRANSFER', 'DEBIT', 'CREDIT', 'OTHER', 'CASH']) {
  const b = randomUUID(),
    u = randomUUID(),
    c = randomUUID(),
    op = randomUUID();
  const fixtures = `INSERT INTO auth.users(id) VALUES('${u}');
    INSERT INTO public.businesses(id,name) VALUES('${b}','BF215 upgrade');
    INSERT INTO public.expense_categories(id,business_id,name) VALUES('${c}','${b}','Upgrade');
    INSERT INTO public.purchases(business_id,operation_id,supplier,status,total,created_by,purchased_at,notes)
      VALUES('${b}','${op}','Legacy supplier','COMPLETED',12.34,'${u}','2020-01-01Z','Legacy notes');
    INSERT INTO public.expenses(business_id,category_id,source_type,description,amount,payment_method,expense_date,created_by)
      VALUES('${b}','${c}','MANUAL','Legacy expense',12.34,'${method}','2020-01-01','${u}');
    CREATE TEMP TABLE bf215_before AS SELECT
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.purchases p) AS purchases,
      (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.expenses e) AS expenses,
      pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid='public.expenses'::regclass
        AND conname='expenses_payment_method_check')) AS old_check,
      pg_get_functiondef('private.persist_purchase(uuid,uuid,text,uuid,text,timestamptz,text,jsonb)'::regprocedure) AS producer;`;
  let sql = `BEGIN;${restore}${fixtures}`;
  if (method !== 'CASH') {
    sql += `DO $probe$ DECLARE d text; BEGIN
      BEGIN EXECUTE $migration$${migration}$migration$;RAISE EXCEPTION 'Expected legacy rejection';
      EXCEPTION WHEN SQLSTATE '22023' THEN GET STACKED DIAGNOSTICS d=PG_EXCEPTION_DETAIL;
        IF d IS DISTINCT FROM 'PAYMENT_METHOD_ALIGNMENT_REQUIRED' THEN RAISE EXCEPTION 'Wrong alignment signal';END IF;
      END;
      IF (SELECT purchases FROM bf215_before) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.purchases p)
        OR (SELECT expenses FROM bf215_before) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.expenses e)
        OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='purchases' AND column_name='expense_category_id')
        OR to_regprocedure('private.persist_purchase_expense(uuid,uuid,boolean)') IS NOT NULL
        OR (SELECT old_check FROM bf215_before) IS DISTINCT FROM pg_get_constraintdef((SELECT oid FROM pg_constraint
          WHERE conrelid='public.expenses'::regclass AND conname='expenses_payment_method_check'))
        OR (SELECT producer FROM bf215_before) IS DISTINCT FROM pg_get_functiondef('private.persist_purchase(uuid,uuid,text,uuid,text,timestamptz,text,jsonb)'::regprocedure)
      THEN RAISE EXCEPTION 'Alignment failure left schema/data/producer changes';END IF;
      IF NOT (SELECT convalidated FROM pg_constraint WHERE conrelid='public.expenses'::regclass AND conname='expenses_payment_method_check')
      THEN RAISE EXCEPTION 'Old CHECK lost validation';END IF;
    END $probe$;`;
  } else {
    sql += `${migration}DO $probe$ DECLARE method text; constraint_name text; BEGIN
      IF (SELECT purchases FROM bf215_before) IS DISTINCT FROM
          (SELECT jsonb_agg(to_jsonb(p)-'expense_category_id'-'payment_method' ORDER BY id) FROM public.purchases p)
        OR EXISTS(SELECT 1 FROM public.purchases WHERE expense_category_id IS NOT NULL OR payment_method IS NOT NULL)
        OR (SELECT expenses FROM bf215_before) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.expenses e)
        OR NOT (SELECT convalidated FROM pg_constraint WHERE conrelid='public.expenses'::regclass AND conname='expenses_payment_method_check')
      THEN RAISE EXCEPTION 'Compatible upgrade rewrote data/backfilled context';END IF;
      FOREACH method IN ARRAY ARRAY['CASH','BANK_TRANSFER','DEBIT_CARD','CREDIT_CARD','DIGITAL_WALLET'] LOOP
        INSERT INTO public.expenses(business_id,category_id,source_type,description,amount,payment_method,expense_date,created_by)
          VALUES('${b}','${c}','MANUAL','New method',0,method,'2020-01-01','${u}');
      END LOOP;
      FOREACH method IN ARRAY ARRAY['TRANSFER','DEBIT','CREDIT','OTHER','CARD','cash',''] LOOP
        BEGIN
          INSERT INTO public.expenses(business_id,category_id,source_type,description,amount,payment_method,expense_date,created_by)
            VALUES('${b}','${c}','MANUAL','Invalid method',0,method,'2020-01-01','${u}');
          RAISE EXCEPTION 'Legacy alias unexpectedly accepted';
        EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
          IF constraint_name<>'expenses_payment_method_check' THEN RAISE EXCEPTION 'Wrong CHECK';END IF;
        END;
      END LOOP;
    END $probe$;`;
  }
  query(`${sql}ROLLBACK;`);
  groups++;
  console.log(
    `PASS migration ${method === 'CASH' ? 'compatible history preserved, NULL snapshots, exact HD006 and alias denial' : method + ' aborts atomically without translation'}`,
  );
}
console.log(`BF215 migration ${groups}/${groups} PASS; all probes rolled back.`);
