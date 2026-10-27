# Network Diagnostics Suite

Aplicación Android en React Native para el TP6 de Desarrollo de Aplicaciones Móviles. Descubrimiento LAN, SNMP v1/v2c con BER propio, SSH, QR/barras por fotografía, evidencia GPS, PDF y sincronización diferida.

## Estado de entrega

Se incluye el código de la app, proyecto nativo Android, backend ejecutable, pruebas, documentación técnica, laboratorio opcional y flujo de CI para generar un APK de prueba. La verificación del código JavaScript y del backend se registra en `docs/VERIFICACION.md`.

**El APK y la demo con un equipo físico requieren completar la compilación y las pruebas en Android.** No se presenta una captura simulada como prueba de funcionamiento real. Este equipo de trabajo no dispone del JDK/SDK de Android necesarios para compilar ni de un teléfono conectado. La carpeta iOS proviene de la plantilla oficial; FieldKit está implementado únicamente para Android.

## Inicio rápido del backend

Requisito: Node.js 22.13 o superior. El backend usa módulos incluidos con Node; no requiere `npm install`.

Desde esta carpeta:

```powershell
npm run backend:demo
```

La demo escucha en el puerto 8787 y usa el token público de laboratorio `tp6-demo-local-2026`. Guardá ese token en **Ajustes** de la app. Para una configuración propia:

```powershell
Copy-Item backend/.env.example backend/.env
# Editar SYNC_TOKEN y, si hace falta, HOST/PORT/DATA_DIR.
npm run backend
```

El backend conserva reportes e IDs de reintento en `backend/data/store.json` y archivos en `backend/data/blobs/`. Iniciá una sola instancia por directorio de datos. La ficha remota de ejemplo corresponde al código **ONT-DEMO-001**. Para cargar el inventario real, detené el servidor y editá el objeto `catalog` de `store.json`; después reinicialo.

## Ejecutar la app Android

Instalá Node 22.13+, JDK 17 y Android Studio. En SDK Manager instalá Android SDK Platform 37, Build Tools 37.0.0, Platform Tools, NDK 27.1.12297006 y CMake 3.22.1. Configurá `JAVA_HOME` y `ANDROID_HOME` para esas instalaciones. La app usa React Native 0.88.1, minSdk 24 y targetSdk 36, según la plantilla fijada.

```powershell
cd mobile
npm ci
npm start
```

En otra terminal, dentro de `mobile`, con un teléfono conectado por USB y depuración activada:

```powershell
npm run android
```

Expo Go no carga el módulo nativo FieldKit. Para la LAN, cámara y GPS se recomienda un teléfono físico conectado al mismo Wi-Fi que el equipo de red. Un emulador no reproduce el descubrimiento de la LAN física de forma equivalente.

## Conectar el backend

- Emulador Android: `http://10.0.2.2:8787`.
- Teléfono físico: `http://IP-DEL-PC:8787`, con ambos equipos en la misma LAN. El servidor de demo escucha en todas las interfaces. Habilitá el puerto en el firewall si corresponde a tu laboratorio.
- Alternativa USB: `adb reverse tcp:8787 tcp:8787` y URL `http://127.0.0.1:8787`.
- Servidor remoto: usá HTTPS con certificado válido.

Android permite HTTP únicamente para las direcciones explícitas en `mobile/android/app/src/main/res/xml/network_security_config.xml`: `10.0.2.2`, `127.0.0.1`, `localhost` y la dirección de ejemplo `192.168.1.10`. **Si el PC tiene otra IP, reemplazá la dirección de ejemplo y recompilá.** La validación de la app también impide HTTP hacia hosts públicos. El token de laboratorio viaja sin cifrado si elegís HTTP; esa excepción está limitada al entorno de pruebas. Las conexiones SSH y los sockets SNMP no usan HTTP.

## Flujo de uso

1. En **Red**, explorá el /24 local o agregá una IPv4 privada. Elegí el equipo.
2. Ingresá su community, versión SNMP e `ifIndex` válido. Consultá estado y tráfico. El agente SNMP del equipo debe estar habilitado y permitir UDP/161 desde el teléfono.
3. Para SSH, elegí puerto y perfil; compará la huella con la consola del equipo antes de guardarla. Guardá usuario/contraseña y ejecutá el conjunto fijo de comandos.
4. Leé un QR/código de barras fotografiándolo. La lectura se hace en el dispositivo; la ficha remota se guarda en caché si está disponible.
5. En **Instalación**, completá sitio/notas/técnico y agregá fotos. Se solicitan cámara y ubicación. Cada foto conserva coordenadas, precisión y fecha. El borrador se persiste localmente.
6. Guardá la instalación. Se genera el PDF y se guardan instalación y outbox en una misma transacción. Consultá o compartí el PDF desde **Historial**.
7. Si no hay backend accesible, el reporte sigue disponible localmente. Al reconectar con la app activa o al reabrirla, se reintenta. **Cola → Sincronizar ahora** permite forzar un intento.

## APK para probar sin Metro

Con el entorno Android preparado:

```powershell
cd mobile/android
.\gradlew.bat assembleRelease
```

Resultado: `mobile/android/app/build/outputs/apk/release/app-release.apk`. Esta variante incluye el bundle JavaScript y funciona sin Metro. Se firma con la **clave de depuración de la plantilla**, exclusivamente para la entrega académica. No es una firma para publicar en una tienda. La compilación inicial descarga Gradle, Maven y componentes nativos.

El workflow `.github/workflows/verify.yml` ejecuta pruebas/lint y tiene un trabajo de compilación que publica el APK como artefacto de CI cuando se sube el repositorio a GitHub. El proyecto no fue publicado en ningún servicio desde esta entrega.

## Pruebas

```powershell
# Desde la raíz: codec, persistencia/outbox y HTTP real contra el backend local.
npm test

cd mobile
npm run lint
```

Las pruebas automatizadas usan fixtures y puertos loopback temporales. No reemplazan las comprobaciones físicas de SNMP/SSH/cámara/GPS/PDF detalladas en `docs/DEMO.md`.

## Organización

- `mobile/App.jsx`: interfaz y navegación por pestañas.
- `mobile/src/core/snmp.mjs`: construcción/parsing BER y PDUs SNMP.
- `mobile/src/core/store.mjs`: repositorio local y máquina de sincronización.
- `mobile/src/services.js`: casos de uso e integración del transporte.
- `mobile/android/.../FieldKitModule.kt`: sockets, mDNS, SQLite, Keystore, SSH, cámara, GPS y archivos.
- `mobile/android/.../ReportPdf.kt`: composición nativa del reporte.
- `backend/`: HTTP, archivos, catálogo y deduplicación persistente.
- `tests/`: pruebas ejecutables con Node.
- `docs/TECNICO.md`: decisiones, protocolo y límites.
- `docs/DEMO.md`: laboratorio y guion de validación/grabación.

## Decisiones frente al stack sugerido

La consigna presenta un stack sugerido. Esta implementación conserva React Native y los requisitos de protocolos binarios/offline, pero concentra los adaptadores Android en FieldKit: SQLite en lugar de WatermelonDB, Keystore directo en lugar de react-native-keychain, NSD/sockets nativos, JSch para SSH, ML Kit embebido para lectura por foto, LocationManager y PdfDocument. No se incluyeron wrappers sin integración. El documento técnico explica las diferencias y sus límites.

Si la cátedra exige nominalmente WatermelonDB o los paquetes sugeridos, hay que sustituir esos adaptadores antes de la entrega. El parser SNMP y la máquina outbox están separados de esas dependencias.
