# Network Diagnostics Suite

Toolkit móvil **offline-first** para técnicos de campo que instalan y mantienen infraestructura de telecomunicaciones (ONTs, routers, switches). Descubre equipos en la LAN, los consulta por **SNMP v1/v2c con un codec BER propio**, ejecuta diagnósticos por **SSH** con verificación de huella, identifica equipos por **QR/código de barras**, documenta instalaciones con **fotos georreferenciadas y PDF**, y sincroniza todo con un backend mediante una **cola outbox** cuando vuelve la conectividad.

TP6 · Desarrollo de Aplicaciones Móviles 2026 · Licenciatura en Sistemas de Información · React Native.

## Entrega

| Entregable (consigna §07) | Dónde está |
|---|---|
| Código fuente completo en Git | Este repositorio |
| Build de prueba (APK) | [**Releases → `NetworkDiagnostics-release.apk`**](https://github.com/SantinoDacuy/TP6-Network/releases/latest) · también se genera con `npm run apk:build` y en cada push como artefacto de GitHub Actions |
| Documento técnico: subset SNMP, credenciales SSH y cola offline | [`docs/TECNICO.md`](docs/TECNICO.md) |
| Backend mínimo de sincronización | [`backend/`](backend/) (`npm run backend:demo`) |
| Video demo: descubrimiento, SNMP, PDF con foto y GPS, sincronización | Entregado por separado; guion en [`docs/DEMO.md`](docs/DEMO.md) |
| Registro de lo verificado | [`docs/VERIFICACION.md`](docs/VERIFICACION.md) |

El APK instala la versión Android nativa (`mobile/`) en cualquier teléfono Android 7+: abrir el archivo y aceptar "instalar apps de origen desconocido". En iPhone y en el navegador se usa la versión Expo (`expo-app/`, ver [Puesta en marcha](#puesta-en-marcha)).

## Requisitos funcionales

| RF | Requisito | Implementación |
|---|---|---|
| RF-01 | Escanear la LAN y listar equipos (IP, MAC, hostname) | Barrido TCP del /24 + tabla ARP (Expo) · mDNS/NSD + sondeo TCP (Android nativo) |
| RF-02 | SNMP: uptime, sysName, tráfico de interfaces | GetRequest/GetResponse v1/v2c armado y parseado con BER propio (`mobile/src/core/snmp.mjs`), dos muestras para calcular bits/s |
| RF-03 | SSH con comandos predefinidos | Perfiles fijos `linux` / `routeros` / `cisco`, huella SHA256 fijada por el técnico, credenciales en Keychain/Keystore |
| RF-04 | QR/barras asociado a ficha técnica remota | Cámara en vivo (`expo-camera`) o ML Kit (Android), ficha del backend con caché local |
| RF-05 | Instalación con fotos, GPS y notas | Cada foto guarda coordenadas, precisión y hora; el borrador persiste localmente |
| RF-06 | Reporte PDF de instalación | Generador PDF propio con fotos embebidas (Expo) · `PdfDocument` (Android) |
| RF-07 | Operación offline y cola de sincronización | Outbox persistente con reintentos y backoff, disparo por NetInfo, deduplicación por `eventId` en el backend |
| RF-08 | Historial consultable sin conexión | Historial de diagnósticos y reportes desde la base local |

## Arquitectura

El repositorio tiene **dos clientes** sobre el mismo núcleo JavaScript, más un backend:

```
                    ┌──────────────── núcleo compartido (mobile/src/core) ────────────────┐
                    │  snmp.mjs  codec BER / PDUs SNMP      store.mjs  repositorio + outbox │
                    └──────────────────────────────────────────────────────────────────────┘
expo-app/  ── Expo Go (iOS / Android) y navegador ──► backend/ gateway de campo ──► LAN (UDP/161, TCP, SSH)
mobile/    ── React Native nativo Android (APK) ───────────── sockets propios ─────► LAN
                        └────────────── sincronización HTTP ──────────────► backend/ (reportes, fotos, PDF, catálogo)
```

- **`expo-app/`** corre en **Expo Go** y en el navegador. Expo Go no permite sockets UDP/TCP crudos ni SSH, así que esas operaciones las ejecuta un **gateway de campo** (`backend/gateway.mjs`) dentro de la misma LAN. El teléfono sigue armando y decodificando las PDUs SNMP: el gateway solo reenvía bytes a UDP/161.
- **`mobile/`** es la versión **Android nativa** (módulo Kotlin propio, FieldKit). Abre los sockets desde el propio teléfono, sin gateway; se instala como APK.
- **`backend/`** recibe la cola de sincronización (archivos con checksum SHA-256 + reporte idempotente), sirve el catálogo de fichas técnicas y expone el gateway. Exige token Bearer y solo admite destinos IPv4 privados.

El detalle del subconjunto SNMP implementado, el manejo de credenciales SSH, el diseño de la cola offline y los límites de seguridad está en [`docs/TECNICO.md`](docs/TECNICO.md).

## Tecnologías utilizadas

| Capa | Versión Expo (`expo-app/`) | Versión Android nativa (`mobile/`) |
|---|---|---|
| Framework | Expo SDK 58 · React Native 0.88 · React 19.3 · react-native-web | React Native 0.88.1 · Kotlin 2.2 · minSdk 24 / targetSdk 36 |
| Descubrimiento | Gateway: barrido TCP + tabla ARP (`node:net`) | Android NSD (mDNS) + sockets TCP |
| SNMP v1/v2c | Codec BER propio (`snmp.mjs`) + relay UDP del gateway (`node:dgram`) | Codec BER propio (`snmp.mjs`) + `DatagramSocket` |
| SSH | Gateway con `ssh2` 1.17 | JSch 2.28.7 (mwiede) |
| Credenciales | `expo-secure-store` (Keychain / Keystore) | Android Keystore (AES-GCM) |
| QR / barras | `expo-camera` (lectura en vivo) | ML Kit Barcode Scanning 17.3 |
| Fotos y GPS | `expo-image-picker`, `expo-image-manipulator`, `expo-location` | Intent de cámara, ExifInterface, `LocationManager` |
| Base local | `expo-sqlite` (web: `localStorage`) | SQLite de Android |
| Archivos | `expo-file-system`, `expo-sharing` | FileProvider |
| PDF | Generador PDF 1.4 propio en JS (`pdf.mjs`) | `android.graphics.pdf.PdfDocument` |
| Sincronización | `@react-native-community/netinfo` + outbox propia (`store.mjs`) | `ConnectivityManager` + outbox propia (`store.mjs`) |

Backend y herramientas: Node.js 22 (`node:http`, sin framework), `node:test`, Docker (Net-SNMP 5.9 + OpenSSH en `lab/`, JDK 17 + Android SDK 37 en `docker/`), GitHub Actions.

## Puesta en marcha

Requisitos: **Node.js 22.13+** y **Docker Desktop** (para el equipo SNMP/SSH de laboratorio).

```powershell
git clone https://github.com/SantinoDacuy/TP6-Network.git
cd TP6-Network
npm install                     # dependencias del backend/gateway (ssh2)
npm run app:install             # dependencias de expo-app
docker build -t tp6-agent lab   # equipo de laboratorio: Net-SNMP + OpenSSH
```

Cada vez, en terminales separadas:

```powershell
npm run backend:demo   # backend + gateway en :8787 (token de laboratorio tp6-demo-local-2026)
npm run lab            # equipo de laboratorio: SNMP en UDP/161, SSH en TCP/2222
npm run dev            # Expo; muestra un QR para Expo Go. Tecla w = versión web
```

- **Teléfono:** escaneá el QR con la cámara (iPhone) o desde Expo Go (Android), en el mismo Wi-Fi que la PC. `npm run dev` anuncia la IP del Wi-Fi y descarta adaptadores virtuales (VirtualBox/WSL).
- **Navegador:** tecla `w`, o abrí `http://localhost:8081`.
- La primera vez la app configura sola la URL del backend y el token de laboratorio (se pueden cambiar en **Ajustes**).

Si el teléfono no llega a la PC, permití los puertos en Windows (PowerShell como administrador):

```powershell
Set-NetConnectionProfile -InterfaceAlias "Wi-Fi" -NetworkCategory Private
New-NetFirewallRule -DisplayName "TP6 TCP" -Direction Inbound -Protocol TCP -LocalPort 8081,8787,8788,2222 -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "TP6 SNMP" -Direction Inbound -Protocol UDP -LocalPort 161 -Action Allow -Profile Private
```

## Uso

| Pestaña | Qué se hace |
|---|---|
| **Red** | *Explorar red local* lista los equipos con IP, MAC y origen. *Agregar por IP* suma uno manualmente. Con un equipo seleccionado: **Diagnóstico SNMP** (community, ifIndex, v1/v2c), **Acceso SSH** (verificar huella → guardar credenciales → ejecutar comandos) y **Identificar equipo** (QR/barras). |
| **Instalación** | Sitio, técnico, notas y fotos con GPS. *Guardar instalación y generar PDF* guarda el reporte y lo encola en una misma transacción. |
| **Historial** | Reportes y diagnósticos sin conexión; ver/compartir el PDF. |
| **Cola** | Estado de cada envío (PENDIENTE, ENVIANDO, REINTENTO, ENVIADO), último error y próximo intento. *Sincronizar ahora* fuerza un intento. |
| **Ajustes** | URL del backend y token. |

Valores del equipo de laboratorio (`lab/`), que la app trae precargados: IP de la PC (por ejemplo `192.168.18.171`), community `tp6lab`, ifIndex `2` (eth0), SNMP v2c, SSH puerto `2222`, usuario `tech`, contraseña `Tp6Lab2026`, perfil `linux`. La huella SSH a comparar la imprime el contenedor al arrancar (`docker logs tp6-agent`). El código de ejemplo para la ficha remota es `ONT-DEMO-001` ([QR](docs/qr-ONT-DEMO-001.png)).

### Probar el flujo offline

1. Con el backend activo: descubrir equipos y consultar SNMP/SSH.
2. Detener el backend (`Ctrl+C` en su terminal).
3. Registrar una instalación con foto y GPS y abrir el PDF: todo funciona sin backend.
4. En **Cola**, el reporte queda en **REINTENTO**.
5. Volver a iniciar `npm run backend:demo` y tocar *Sincronizar ahora* (o esperar el reintento automático): pasa a **ENVIADO**.
6. Verificar del lado servidor:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/installations -Headers @{ Authorization = 'Bearer tp6-demo-local-2026' }
```

## Versión Android nativa (APK)

```powershell
npm run apk:build   # compila el APK dentro de Docker (JDK 17 + Android SDK 37); no requiere Android Studio
npm run apk:share   # sirve el APK en la LAN y muestra un QR para descargarlo desde el teléfono
```

Resultado: `dist/NetworkDiagnostics-release.apk` (arm64-v8a y x86_64), firmado con la clave de depuración de la plantilla, solo para la entrega académica. Con Android Studio instalado también se puede usar `cd mobile && npm ci && npm run android`. La configuración de red, firma y alcance de esta variante está en [`docs/TECNICO.md`](docs/TECNICO.md).

## Pruebas

```powershell
npm test               # codec SNMP, repositorio/outbox, backend HTTP real, generador PDF
cd mobile; npm run lint
```

Las pruebas usan fixtures y puertos loopback temporales. Lo verificado en equipos reales y lo que queda pendiente se registra en [`docs/VERIFICACION.md`](docs/VERIFICACION.md).

## Estructura

```
backend/          servidor de sincronización (server.mjs) y gateway de campo (gateway.mjs)
expo-app/         cliente Expo Go / web: App.js, src/services.js, src/platform.{native,web}.js, src/core/pdf.mjs
mobile/           cliente Android nativo: App.jsx, src/services.js, android/.../FieldKitModule.kt, ReportPdf.kt
mobile/src/core/  núcleo compartido: snmp.mjs (BER/SNMP), store.mjs (repositorio + outbox), backend.mjs
lab/              contenedor con Net-SNMP y OpenSSH para pruebas
docker/           compilación del APK en contenedor
scripts/          dev.mjs (backend + Expo con la IP correcta), share-apk.mjs
tests/            pruebas con node:test
docs/             TECNICO.md (diseño y límites), DEMO.md (guion de validación), VERIFICACION.md
```

## Decisiones frente al stack sugerido

La consigna propone un stack orientativo. Se conservaron React Native, los protocolos binarios propios y el diseño offline-first, con estas sustituciones (justificadas en `docs/TECNICO.md`):

- **SQLite** (`expo-sqlite` / SQLite de Android) con una máquina outbox propia en lugar de WatermelonDB.
- **Keychain/Keystore** vía `expo-secure-store` o Android Keystore directo en lugar de `react-native-keychain`.
- **Generador PDF propio / PdfDocument** en lugar de `react-native-html-to-pdf`.
- En la versión Expo, **gateway de campo** para los sockets que Expo Go no expone; la consigna advierte que el planteo original no es compatible con Expo Go, y la versión `mobile/` cubre ese caso sin gateway.

SNMP se limita a GetRequest v1/v2c sin SNMPv3: la community viaja en claro por la LAN, por lo que el alcance es una red de diagnóstico controlada.
