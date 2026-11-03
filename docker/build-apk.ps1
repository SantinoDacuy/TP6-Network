# Compila el APK de prueba dentro de Docker. Requiere solo Docker Desktop en ejecución.
# Uso, desde la raíz del repo:  powershell -ExecutionPolicy Bypass -File docker/build-apk.ps1
# Resultado: dist/NetworkDiagnostics-release.apk
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

docker build -t nds-android-build -f "$root/docker/android-build.Dockerfile" "$root/docker"
if ($LASTEXITCODE) { exit $LASTEXITCODE }

New-Item -ItemType Directory -Force "$root/dist" | Out-Null
# Se copia el proyecto al disco del contenedor: evita rutas con espacios/acentos y node_modules de Windows.
docker run --rm `
  -v "${root}:/src:ro" `
  -v "${root}/dist:/out" `
  -v nds-gradle-cache:/gradle `
  nds-android-build bash -c @'
set -e
rsync -a --exclude node_modules --exclude android/build --exclude android/app/build --exclude android/.gradle /src/mobile/ /work/
npm ci --no-audit --no-fund
cd android
./gradlew assembleRelease --no-daemon -PreactNativeArchitectures=arm64-v8a,x86_64
cp app/build/outputs/apk/release/app-release.apk /out/NetworkDiagnostics-release.apk
'@
if ($LASTEXITCODE) { exit $LASTEXITCODE }
Write-Host "APK: $root/dist/NetworkDiagnostics-release.apk"
