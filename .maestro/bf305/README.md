# BF-305 native preparation — NOT EXECUTED

These are unverified starter flows, not native PASS evidence. Run only after the Web harness
is reviewed and an isolated native target is available. Maestro installation is a prerequisite;
this change does not install a global CLI or create an EAS/release build.

Before running, attest the compiled app's SHA, app identifier, explicit E2E environment ID,
Supabase backend and reachable device address. The production build is forbidden. The fixed
loopback Web manifest cannot be assumed reachable from a physical device. A native target
manifest and runner guard must be reviewed before these skeletons become executable evidence.

Inject `E2E_NATIVE_APP_ID`, `E2E_OWNER_EMAIL` and `E2E_OWNER_PASSWORD` through the controlled runner
environment, never YAML literals, command history or checked-in files. Disable raw command logs,
screenshots/video that expose entered credentials, and store only sanitized private results.
Do not invoke these flows against an arbitrary application ID.

Order: login, persistence, logout. Foreground, protected deep links and two-tenant isolation
still need native implementation/validation. Auth data uses SQLite/localStorage, not SecureStore.
After the client is closed, use the same exclusive coordinator/reset lifecycle. No local reset
may run concurrently with a device still using its accounts.
