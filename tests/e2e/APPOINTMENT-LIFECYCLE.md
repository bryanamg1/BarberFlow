# BF-304A — Client, service and appointment lifecycle E2E

Use the existing exclusive Supabase test stack, which accepts only loopback
targets and synthetic identities. The fixture creates a second active member in
tenant A with the BARBER role and keeps OWNER_B in tenant B. The calendar runs in
`America/Argentina/Buenos_Aires`. Seeded appointments use a fixed civil date.
The create flow uses the business day reported by PostgreSQL and checks that
09:00 and 10:00 local persist as 12:00 and 13:00 UTC.

```powershell
$env:E2E_ENVIRONMENT_ID = 'barberflow-e2e-bf305'
$env:E2E_BASE_URL = 'http://127.0.0.1:8095'
$env:E2E_ALLOW_DESTRUCTIVE_TESTS = 'true'
node scripts/e2e/run.cjs appointment-lifecycle
```

Web verifies client and service create/edit/archive, a real appointment using
those records, the agenda, historical snapshots, terminal states, notes and
rescheduling. OWNER may reassign a nonterminal appointment to an active member
of the same business. An assigned BARBER may act on their own appointment and
may start it directly from PENDING. The tests exercise transitions without a
visible action through the real authenticated RPC and reopen the detail to
verify presentation. COMPLETED stays exclusive to checkout.

On the approved Android emulator with the private debug build and matching
source snapshot, run `node scripts/e2e/android-run.cjs appointment-lifecycle`
with the same environment. Maestro creates an appointment using the fixture
client and service, reschedules it, cancels it and opens the protected edit
route to verify the terminal guard. The coordinator compares persisted rows and
snapshots after each action. Both runners reset synthetic state on exit and keep
redacted evidence outside Git.
