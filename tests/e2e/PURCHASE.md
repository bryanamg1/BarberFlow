# BF-307 — Purchase E2E

Run only against the existing exclusive local Supabase test project. The harness
seeds two synthetic OWNER tenants, a BARBER in tenant A for Web, and deterministic
products, opening ledger entries and expense categories. Each Web case gets a
fresh database baseline and browser context. Both runners reset and stop the
isolated backend on exit.

```powershell
$env:E2E_ENVIRONMENT_ID = 'barberflow-e2e-bf305'
$env:E2E_BASE_URL = 'http://127.0.0.1:8095'
$env:E2E_ALLOW_DESTRUCTIVE_TESTS = 'true'
node scripts/e2e/run.cjs purchase
# With the approved emulator and private debug build for the current source:
node scripts/e2e/android-run.cjs purchase
```

Web exercises the real purchase form, persisted detail, Back to the existing
history, reopening the same purchase, and reload.
The database observations compare exact decimal strings, original ledger
entries, stock, current reference costs, the single linked expense, and
correction audit records. The real stock and financial RPCs verify the read
side. A response-delivery fault occurs only after the real purchase commits
and the UI must replay the same intention. Correction exercises the detail
workflow, same-key replay and rejection when one product would go negative.
Invalid lines, direct edits/deletes, foreign IDs and the BARBER use normal
authenticated boundaries. Privileged SQL is limited to synthetic setup and
read-only assertions inside the isolated harness.

Maestro covers the real single-line Android purchase, persisted stock, cost and
expense, and two Back-to-history and reopen cycles for the same persisted ID.
The coordinator checks that neither cycle creates duplicate effects.
Correction is exercised on Web and in the targeted database regressions.
