# Verificación de la entrega

Fecha: 27 de octubre de 2026. Entorno de preparación: Windows, Node.js 22.14.0, npm 10.9.2.

## Comprobado

- `npm test` desde la raíz: **15 pruebas aprobadas, 0 fallidas**.
- Prueba de bytes BER de un GetRequest contra un fixture independiente y parsing de respuestas v1/v2c.
- Rechazo de PDUs truncadas, request-id/community/versión/OIDs no coincidentes y errores SNMP.
- Conversión de Counter32 con una vuelta, excepciones SNMP y OCTET STRING binario.
- Atomicidad de instalación+outbox ante fallo de disco simulado, escrituras concurrentes y recuperación tras reiniciar el repositorio.
- Recuperación del borrador y limpieza atómica al finalizar el reporte.
- Reintentos con backoff, supresión de workers duplicados y validación del ACK.
- Integración HTTP con servidor local real: autenticación, archivos, checksum, catálogo, persistencia de IDs tras reiniciar y conflictos 409.
- Flujo conjunto outbox+HTTP con pérdida simulada del ACK después de que el servidor confirma: el reintento tras reiniciar no duplica la instalación.
- Validación de URL de backend, incluidos hosts que aparentan ser privados por su prefijo.
- `npm run lint` en `mobile`: **0 errores y 0 advertencias** en el código de la app.
- Instalación de dependencias y generación de `mobile/package-lock.json`.
- Bundle Android de producción generado por Metro con `react-native bundle --platform android --dev false`; salida temporal fuera del paquete fuente.
- Parsing XML correcto de los siete archivos XML de `android/app/src/main`, incluidos manifiesto, permisos, FileProvider, red e icono.
- Revisión de las interfaces de React Native instaladas para registrar el módulo Android y recibir resultados de actividad.

Las pruebas HTTP corrieron fuera de la restricción de red del sandbox, usando solo puertos temporales de loopback. Los primeros intentos dentro del sandbox fallaron al conectar a localhost; no se ocultaron errores de aplicación para obtener el resultado aprobado.

## Compilación Android (28 de octubre de 2026)

- `docker/build-apk.ps1` (JDK 17, Node 22.14, SDK Platform 37.0, Build Tools 37.0.0, NDK 27.1.12297006): `gradlew assembleRelease` → **BUILD SUCCESSFUL**. El código Kotlin de FieldKit y ReportPdf compila (solo advertencias de deprecación).
- `aapt2 dump badging`: paquete `com.networkdiagnostics`, compileSdk 37, targetSdk 36, los siete permisos declarados, ABIs `arm64-v8a` y `x86_64`.
- El APK contiene `assets/index.android.bundle` (funciona sin Metro) y `apksigner verify` lo acepta (firma de depuración de la plantilla).
- Se corrigió el nombre del paquete del SDK (`platforms;android-37.0`) en el workflow de CI.
- `network_security_config.xml` ya no depende de una IP fija del PC: la restricción de HTTP a LAN/loopback la aplican `validateBackend` y `uploadFile`.

- Agente de laboratorio (`lab/`): se corrigió `entrypoint.sh` (snmpd cargaba dos veces su configuración y fallaba al abrir UDP/161). Con el contenedor activo, el codec propio `mobile/src/core/snmp.mjs`, enviando por UDP desde Windows a `127.0.0.1:161`, decodificó respuestas reales de Net-SNMP en v1 y v2c: sysName `tp6-network-agent`, sysUpTime, ifNumber 2, ifDescr.2 `eth0`, ifInOctets/ifOutOctets.

## Versión Expo Go (28 de octubre de 2026)

- `expo-app/` en Expo SDK 58: `npx expo export` genera los bundles de **iOS** (721 módulos) y **web** sin errores; `expo-doctor` 20/20 checks.
- Con `npm run dev`, el manifiesto de Expo anuncia `192.168.18.171` (Wi-Fi) y el bundle de iOS se descarga por esa IP (HTTP 200).
- Gateway contra la LAN real y el agente `lab/`: descubrimiento de 6 equipos reales con IP+MAC (incluido el router 192.168.18.1) en 7,5 s; SNMP v2c con el codec propio a través del relay (sysName, uptime, ifDescr, octetos); huella SSH idéntica a la del contenedor, ejecución del perfil linux (3 comandos, exit 0), rechazo de pin incorrecto y de destino UDP público.
- PDF propio: validado con PyMuPDF (sin reparaciones, 3 páginas, 2 imágenes DCTDecode) y revisado visualmente; `npm test` 18/18 (incluye `tests/pdf.test.mjs`).
- No se probó en un iPhone desde esta sesión: cámara/QR en vivo, GPS, Keychain, `expo-file-system` upload y compartir PDF quedan para la prueba en el dispositivo.

## Pendiente en un dispositivo

No hubo teléfono/emulador disponible. Por tanto quedan sin confirmar en dispositivo: carga del módulo FieldKit, navegación visual, descubrimiento LAN, intercambio SNMP contra agente real, conexión SSH, permisos, captura/lectura QR, GPS, generación/render visual del PDF y subida de archivos mediante el adaptador nativo. Los fixtures de las pruebas HTTP son contenido binario mínimo; no son fotografías o PDFs de una instalación real.

Tampoco se ejecutaron Docker ni el workflow de GitHub Actions, ni se grabó la demo. `docs/DEMO.md` proporciona la secuencia para completar esas comprobaciones. El workflow de CI incluye un trabajo de compilación que podrá detectar problemas nativos al ejecutarse en un SDK completo. No se afirma que ese trabajo ya haya pasado.

## Alcance y diferencias que revisar con la cátedra

La implementación cubre los flujos de RF-01 a RF-08 en código, con alcance Android y adaptadores nativos propios. Se usa SQLite en lugar de WatermelonDB y las APIs nativas en lugar de varios wrappers sugeridos. QR/barras se lee por fotografía y la sincronización automática requiere la app activa o reabierta. La MAC solo está disponible cuando la expone SNMP. Estas diferencias están explicadas en `TECNICO.md`.

La entrega incluye un repositorio Git local y un ZIP de sus fuentes. No se publicó un remoto ni se configuró una cuenta externa.
