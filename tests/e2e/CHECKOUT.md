# BF-306 — Checkout E2E

These tests use the BF-305 exclusive local-only environment. They never target a
linked Supabase project. Docker must already be running; the coordinator owns only
the `barberflow-e2e-bf305` stack and port range 554xx.

From the repository root in PowerShell:

```powershell
$env:E2E_ENVIRONMENT_ID = 'barberflow-e2e-bf305'
$env:E2E_BASE_URL = 'http://127.0.0.1:8095'
$env:E2E_ALLOW_DESTRUCTIVE_TESTS = 'true'
node scripts/e2e/run.cjs checkout
```

The coordinator creates ephemeral synthetic OWNER accounts. Playwright uses real
UI login, mobile viewport, one worker and zero retries. Each critical case starts
with an isolated reset, no previous sales or sessions, and stock 20. Cases cover:

- Service sale, persisted detail, replace/Back safety and history.
- Direct no-client product sale, quantity, historical cost and append-only debit.
- Mixed sale, discount cents and stable-order analytic allocation.
- Zero total with no payment and no inferred debt.
- Appointment client derivation, explicit empty initial lines and atomic completion.
- Double submit and explicit same-operation retry after a real committed response
  is dropped at the transport boundary. Persistence is never mocked.
- Tenant isolation through UI and normal caller REST access.
- BARBER UI/router/backend denial.
- Catalog archived after review: safe rejection, rollback and preserved input.

Money assertions use decimal text/BigInt. The local database helper verifies
sale/items/payments/ledger/appointment effects independently of browser display.
Browser requests always use the normal authenticated caller; no service-role key
or privileged function bypass is injected.

Android uses the existing approved BF-305 toolchain, emulator and private debug
package. On the exact BF-306 branch, prepare and build the private source snapshot,
then run the essential real checkout:

```powershell
node scripts/e2e/android-prepare.cjs
& ./scripts/e2e/android-build.ps1
node scripts/e2e/android-run.cjs checkout
```

The approved emulator must already be booted. The native coordinator verifies its
identity, APK provenance, source bytes and a password privacy canary before using
ephemeral credentials. The Maestro flow covers quick action, service, payment,
submit and persisted detail. A second independently reset native case opens the
protected appointment detail and uses its real checkout action for a mixed sale:
derived client, initially empty selections, exact discount, product debit and
appointment completion. Both cases check persisted totals, historical line prices
and the payment amount in the rendered sale detail. Retry/access permutations run
on Web against the same actual transaction.
iOS remains post-V1.

Artifacts are ignored under `.codex-evals/BF-305/runs` and `native-runs`; no
storageState, tokens or credentials are serialized. Cleanup revokes synthetic
sessions, resets transactions/stock/appointments, clears app state, stops owned
servers and releases their ports/reverse mappings. Never publish private evidence.

Focused harness regression:

```powershell
node --test tests/bf306-checkout-harness.test.cjs tests/bf305-e2e-guards.test.cjs tests/bf305-e2e-lifecycle.test.cjs tests/e2e/native/guards.test.cjs
```

A real product failure stops BF-306. These tests do not authorize changing product
behavior or implementing BF-308.
