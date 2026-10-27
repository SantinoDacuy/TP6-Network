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

## Pendiente en un entorno Android

No se ejecutó Gradle ni se generó un APK: no se encontró Android SDK, JDK 17 o Android Studio en las ubicaciones habituales ni variables de SDK configuradas. El Java localizado corresponde a una instalación Java 8. La validación XML/Metro no demuestra que el código Kotlin compile.

No hubo teléfono/emulador disponible. Por tanto quedan sin confirmar en dispositivo: carga del módulo FieldKit, navegación visual, descubrimiento LAN, intercambio SNMP contra agente real, conexión SSH, permisos, captura/lectura QR, GPS, generación/render visual del PDF y subida de archivos mediante el adaptador nativo. Los fixtures de las pruebas HTTP son contenido binario mínimo; no son fotografías o PDFs de una instalación real.

Tampoco se ejecutaron Docker ni el workflow de GitHub Actions, ni se grabó la demo. `docs/DEMO.md` proporciona la secuencia para completar esas comprobaciones. El workflow de CI incluye un trabajo de compilación que podrá detectar problemas nativos al ejecutarse en un SDK completo. No se afirma que ese trabajo ya haya pasado.

## Alcance y diferencias que revisar con la cátedra

La implementación cubre los flujos de RF-01 a RF-08 en código, con alcance Android y adaptadores nativos propios. Se usa SQLite en lugar de WatermelonDB y las APIs nativas en lugar de varios wrappers sugeridos. QR/barras se lee por fotografía y la sincronización automática requiere la app activa o reabierta. La MAC solo está disponible cuando la expone SNMP. Estas diferencias están explicadas en `TECNICO.md`.

La entrega incluye un repositorio Git local y un ZIP de sus fuentes. No se publicó un remoto ni se configuró una cuenta externa.
