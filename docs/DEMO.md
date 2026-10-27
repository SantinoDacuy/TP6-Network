# Prueba de campo y guion del video

## Preparación real

Necesitás un teléfono Android 7+ con ubicación/cámara, una LAN propia de laboratorio, un equipo con SNMP v1/v2c y SSH habilitados y el PC del backend. Probá primero desde una PC que el equipo responda a `snmpget` con la community/índice elegidos y que el perfil SSH funcione. La app no activa servicios de administración del router por sí sola.

Conectá teléfono, equipo y backend a la misma LAN. Verificá que el Wi-Fi no tenga aislamiento entre clientes. No apagues el Wi-Fi para simular ausencia del backend mientras necesites SNMP/SSH: detener el proceso backend preserva la conectividad LAN. Para la prueba offline tampoco hace falta quitar el GPS.

Para un equipo de laboratorio opcional con Docker, ver `lab/README.md`. Un contenedor no sustituye la prueba de descubrimiento con un equipo físico pedida por la consigna.

## Secuencia de aceptación

1. Compilá e instalá el APK. Anotá modelo/versión Android y las IP del teléfono, agente y backend.
2. Abrí Red → Explorar. Mostrá un equipo real detectado, seleccioná y registrá su IP. Si aparece por ingreso manual, eso no prueba descubrimiento automático.
3. Consultá SNMP. Mostrá sysName, uptime, ifDescr, octetos y tasas. Si ifIndex 1 corresponde a loopback, elegí la interfaz de red correcta. Compará sysName/uptime con `snmpget` desde PC.
4. Compará la huella SSH con la consola, guardá credenciales y ejecutá el perfil. Comprobá el contenido y códigos de salida en Historial. Cambiar la clave del servidor debe bloquear su ejecución hasta volver a verificarla.
5. Fotografiá un QR/barcode. Usá un código que contenga ONT-DEMO-001 para comprobar la ficha de ejemplo con el backend activo. Consultala otra vez con el backend detenido para demostrar la caché.
6. Detené el backend. Completá sitio, notas, técnico y una foto con ubicación. Guardá el reporte.
7. Abrí/compartí el PDF y revisá que contenga la foto, sitio, coordenadas, precisión, fecha y diagnósticos legibles. Este paso es la revisión visual del PDF real generado en Android.
8. Cerrá y reabrí la app sin backend: el reporte, borrador si corresponde, historial y cola deben seguir disponibles. Mostrá el error de reintento y que el reporte local sigue intacto.
9. Iniciá el backend. Con la app activa, esperá el reintento o pulsá Sincronizar ahora. Mostrá estado ENVIADO y el registro del backend.
10. Forzá otro intento: no debe aparecer una segunda instalación en el servidor para el mismo evento. La prueba automatizada comprueba también la pérdida de ACK mediante deduplicación tras reinicio.

El video puede durar entre 4 y 6 minutos. Filmá resultados reales y evitá mostrar contraseñas/token. No se incluye un video pregrabado ni resultados de campo inventados.

## Consultar el backend desde PowerShell

Con la demo levantada:

```powershell
$tp6Headers = @{ Authorization = 'Bearer tp6-demo-local-2026' }
Invoke-RestMethod http://127.0.0.1:8787/health
Invoke-RestMethod http://127.0.0.1:8787/api/installations -Headers $tp6Headers
```

El manifiesto del reporte contiene IDs de archivo y hashes. Se pueden descargar desde `/api/blobs/<id>` con el mismo header para comparar PDF/foto con el original. Los archivos del backend se conservan al reiniciarlo.

## Casos que deben comprobarse en el teléfono

- Cámara/GPS denegados: mensaje claro y sin instalación confirmada incompleta.
- Ubicación apagada o sin fix: mensaje y posibilidad de repetir, sin coordenadas ficticias.
- Agente SNMP sin respuesta: timeout, sin éxito simulado.
- Community/ifIndex incorrectos: error SNMP visible.
- Equipo filtrado/no anunciando servicios: puede faltar en descubrimiento; agregar por IP.
- Credenciales SSH incorrectas, clave cambiada o exec no soportado: error visible.
- Backend apagado/token incorrecto: archivo local conservado, job failed y reintento.
- Cierre durante sincronización: recuperación de sending como pending al abrir.
- Borrador guardado: recuperar campos y fotos ya georreferenciadas al reabrir.
- PDF con notas largas/varias fotos: revisar paginación, orientación y legibilidad.
