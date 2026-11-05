# BF-305 Android coordinator

Run these **phases only through `scripts/e2e/android-run.cjs`**, never as a standalone Maestro
folder suite. They deliberately contain no credentials or `inputText` commands. Android coverage
does not certify iOS, real expiry/refresh/recovery, a production build, or BF-305 overall completion.

## Isolated target

- Owned AVD `bf305_api36`, serial `emulator-5556`, Android API 36, x86_64.
- Debug package `dev.barberflow.e2e.bf305`, built from a private CNG snapshot of current source.
- Supabase project `barberflow-e2e-bf305`, `http://127.0.0.1:55431`, never development/remote DB.
- `adb reverse` forwards exactly 55431 and native Metro 8096. No LAN address or physical device.
- Native callback remains `barberflow://auth/recovery`; Web recovery configuration is not reused.

The runner refuses another package, AVD, API/ABI, stale source SHA, changed source/assets,
dependency mismatch, EAS project/owner, occupied ports, missing destructive flag, or failed Auth
health probe. It verifies the APK package/debug flag and records its SHA-256 privately.

## Portable prerequisites

Validated toolchain: Temurin JDK 17.0.21+9, Android command-line tools 15859902, adb 37.0.1,
emulator 37.2.13, API/build-tools 36, NDK 27.1.12297006, CMake 3.31.6/Ninja 1.12.1, Maestro 2.12.1.
Use official vendor distributions and verify published download hashes. No global PATH or SDK
configuration is required. Windows hypervisor/firmware changes and restarts require approval.

Create ignored `.codex-evals/BF-305/native-toolchain.json` with absolute local tool paths:
`javaHome`, `sdkRoot`, `adb`, `maestro`, `androidUserHome`, `avdHome`, `buildSdkRoot`, plus the fixed
`serial` and `avd` above. `javaHome`, `sdkRoot`, `adb`, and `maestro` must resolve beneath
`.codex-evals/BF-305/toolchain/`. `buildSdkRoot` is a separate, test-owned portable SDK path **without
spaces**; no production SDK configuration is changed. Keep tools, AVDs, APKs, credentials and logs
out of Git.

On Windows, the SDK's older Ninja cannot handle long C++ paths. Follow the
[Expo Windows guide](https://docs.expo.dev/troubleshooting/windows-long-paths/): use CMake 3.31.6
in this runner's private Gradle home. Windows long-path support must already be enabled; the
scripts do not modify the registry. A no-spaces SDK path also avoids a Clang short-name alias
that drops C++ runtime linking with the NDK's `-no-canonical-prefixes` option.

## Prepare and run

Set only the three harness inputs from `tests/e2e/.env.e2e.example` in the calling process.
Do not load the application's normal `.env`. Docker must already be running. Start the owned
AVD explicitly; the coordinator does not choose or boot an arbitrary connected device.

```powershell
npm run e2e:android:prepare
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e/android-build.ps1
node scripts/e2e/android-run.cjs canary
npm run e2e:android
```

Preparation archives only an existing test-owned snapshot, copies unchanged `src/`/`assets/`,
and uses the installed Expo template with `--no-install`. It generates native code only under
the ignored snapshot; product `android/`, `ios/`, app identifiers and dependencies stay untouched.
Reprepare/rebuild after HEAD or product source changes. The debug APK uses the coordinator's
local Metro and is not a release candidate.

## Privacy and assertions

Before creating accounts, the runner types a noncredential canary, verifies the native password
flag and exact masked length, and checks Maestro artifacts for disclosure. Actual synthetic
passwords are generated in memory and typed by adb **stdin**, never arguments, environment,
YAML, session injection or serialized storage. Waits allow Android's temporary character reveal
to expire before Maestro captures artifacts. The Java launcher uses structured arguments.

Maestro command reports, device logs and failure screenshots remain private and synthetic.
Credential/JWT detection fails the run; failed runs are not automatically retried. Never publish
those raw artifacts. Auth/session SDK logging is not enabled. No trace, video, HAR or storageState
is produced by this coordinator.

Smoke uses real login/logout. Persistence verifies a changed app process and unchanged server
session count plus restored tenant data. Foreground verifies the same process/session. Back and
an explicitly packaged private deep link must not restore private content. A→B checks real client
sentinels and server session ownership. There is no fake expiry, refresh or recovery PASS.

Warm resume uses the APK-attested explicit launcher component, without `am start -W`: that startup
wait was observed to hang on an already resumed activity. The runner independently observes
Home focus, app focus, unchanged PID and tenant UI. `E2E_NATIVE_DIAGNOSE_BACKGROUND=1` with
`canary` exercises those primitives only on the public screen, without creating accounts or
submitting a login. Failures record operation/exit code/stack locations, never stdin or raw errors.

The validated emulator profile is API 36/x86_64, 4096 MiB RAM, four cores, SwiftShader, no snapshots.
An earlier 3072 MiB/two-core profile produced a System UI ANR and an adb transport interruption;
those failures remain in private evidence. Do not dismiss OS error dialogs or retry failed Auth
scenarios automatically to obtain a PASS.

Cleanup independently clears the test app, stops Metro, revokes accounts through isolated reset,
verifies the canonical DB baseline, stops the exclusive stack, removes owned forwards and checks
ports/artifacts. A cleanup failure blocks delivery. The existing Web coordinator remains unchanged.
