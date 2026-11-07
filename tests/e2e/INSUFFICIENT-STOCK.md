# BF-308 — Insufficient stock E2E

The coordinator uses the existing exclusive BF-305 local Supabase stack and the
deterministic BF-306 checkout fixtures. Each scenario starts with one unit of the
product in each synthetic tenant, an empty financial history and no checkout debit.

```powershell
$env:E2E_ENVIRONMENT_ID = 'barberflow-e2e-bf305'
$env:E2E_BASE_URL = 'http://127.0.0.1:8095'
$env:E2E_ALLOW_DESTRUCTIVE_TESTS = 'true'
node scripts/e2e/run.cjs insufficient-stock
```

Web covers the last-unit control, excess demand, the same rejected key, a stale
cart with a new-intention recovery, a mixed appointment cart, and tenant, BARBER
and archived-product denials. The stale cart loads two units after a valid stock
adjustment. Another adjustment leaves one unit before submit. The test asserts the
actual HTTP 409 response with PostgreSQL code `PT409` and detail
`INSUFFICIENT_STOCK`. The database snapshot must remain identical across rejection.

The race submits two distinct operation IDs through the authenticated checkout
RPC. A separate test connection holds the fixture business row until PostgreSQL
shows both requests waiting. Each of five rounds requires one winner, one loser
and one new sale, line, payment and debit. Between rounds `adjust_stock` restores
one unit and prior history stays intact. The ledger check also catches a negative
intermediate balance that later replenishment could mask.

On the approved Android emulator with the private debug build and matching
source snapshot, run `node scripts/e2e/android-run.cjs insufficient-stock` with
the same environment. Maestro submits the stale quantity of two against one
unit and verifies the recoverable error. The coordinator checks rollback before
allowing the user flow to adjust quantity to one and complete one sale. The
five-round database race runs on Web.

The exclusive coordinator resets synthetic state on exit and records redacted
results outside Git. All targets are local. iOS remains post-V1.
