$ErrorActionPreference = 'Stop'
$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$privateRoot = Join-Path $workspaceRoot '.codex-evals/BF-305'
$tool = Get-Content -LiteralPath (Join-Path $privateRoot 'native-toolchain.json') -Raw | ConvertFrom-Json
if ($env:E2E_ENVIRONMENT_ID -ne 'barberflow-e2e-bf305' -or $env:E2E_BASE_URL -ne 'http://127.0.0.1:8095' -or $env:E2E_ALLOW_DESTRUCTIVE_TESTS -ne 'true') { throw 'E2E guard refused' }
if (-not $tool.buildSdkRoot -or $tool.buildSdkRoot.Contains(' ')) { throw 'Use an isolated SDK build path without spaces' }
$env:JAVA_HOME = $tool.javaHome
$env:ANDROID_HOME = $tool.buildSdkRoot
$env:ANDROID_SDK_ROOT = $tool.buildSdkRoot
$env:ANDROID_USER_HOME = $tool.androidUserHome
$env:GRADLE_USER_HOME = Join-Path $privateRoot 'gradle-home'
$env:EXPO_NO_DOTENV = '1'
$env:EXPO_OFFLINE = '1'
$env:EXPO_NO_TELEMETRY = '1'
$env:CI = '1'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
Get-ChildItem Env: | Where-Object { $_.Name -match '^(EXPO_PUBLIC_|EXPO_TOKEN$|EAS_)' } | ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_.Name) }
New-Item -ItemType Directory -Path $env:GRADLE_USER_HOME -Force | Out-Null
$gradleConfig = Join-Path $env:GRADLE_USER_HOME 'gradle.properties'
$properties = if (Test-Path -LiteralPath $gradleConfig) { Get-Content -LiteralPath $gradleConfig -Raw } else { '' }
if ($properties -match '(?m)^android.cmakeVersion=') { $properties = $properties -replace '(?m)^android.cmakeVersion=.*$', 'android.cmakeVersion=3.31.6' }
else { $properties += "`nandroid.cmakeVersion=3.31.6`n" }
Set-Content -LiteralPath $gradleConfig -Value $properties
$androidRoot = (Resolve-Path -LiteralPath (Join-Path $privateRoot 'app/android')).Path
if (-not $androidRoot.StartsWith($privateRoot + '\')) { throw 'Build outside private workspace refused' }
Push-Location -LiteralPath $androidRoot
try {
  # Windows PowerShell otherwise treats native stderr warnings as terminating errors.
  $ErrorActionPreference = 'Continue'
  & .\gradlew.bat :app:assembleDebug '-PreactNativeArchitectures=x86_64' '-PreactNativeDevServerPort=8096' --no-daemon --max-workers=2 --console=plain *> (Join-Path $privateRoot 'android-build.log')
  $buildExit = $LASTEXITCODE
} finally { Pop-Location }
if ($buildExit -ne 0) { throw 'Android build failed; inspect private build log' }
Write-Output 'BF305 Android: debug APK built'
