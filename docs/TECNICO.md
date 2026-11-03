# Documento técnico

## Arquitectura y recorrido de datos

La interfaz React Native llama a servicios de aplicación. El núcleo SNMP y la máquina outbox son JavaScript independiente de Android; FieldKit implementa los efectos de plataforma. No se usa HTTP para descubrir equipos ni para SNMP/SSH. HTTP se limita al catálogo y al backend de sincronización.

El recorrido de una instalación es: seleccionar equipo → tomar evidencia GPS → obtener diagnósticos → generar PDF privado → confirmar snapshot y evento outbox en SQLite → enviar archivos → enviar reporte → recibir ACK coincidente → marcar el evento como enviado. Las fotos y el PDF se conservan localmente tras sincronizar.

## Descubrimiento: RF-01

Se combina mDNS/Bonjour con Android NSD (`_ssh._tcp`, `_http._tcp`, `_workstation._tcp`, `_ipp._tcp`) durante cinco segundos y sondeo TCP de los hosts .1 a .254 del /24 de la IPv4 privada local. El sondeo usa 16 trabajadores y puertos 22/80/443 con timeout por intento de 150 ms; un rechazo TCP también indica una respuesta del host. Se informa la fuente de descubrimiento.

No es un barrido ARP de capa 2. Las apps Android ordinarias no disponen de una enumeración ARP/MAC universal. Equipos silenciosos, filtrados o que no anuncian esos servicios pueden faltar. Se permite agregarlos por IP. El hostname se obtiene por mDNS o por `sysName`; no se inventa. La MAC se completa únicamente cuando SNMP devuelve un `ifPhysAddress` de seis bytes para el `ifIndex` elegido y se etiqueta su procedencia; puede corresponder a otra interfaz del mismo equipo. Si falta se muestra “no disponible”.

La red descubierta es el /24 que contiene la dirección local, incluso si la red usa otra máscara. No se recorren VLANs o subredes adicionales. IPv6 queda fuera del alcance. El dispositivo y el agente deben tener ruta LAN directa; el teléfono no necesita acceso a Internet.

## Subconjunto SNMP: RF-02

Se implementan mensajes SNMP v1 (version INTEGER 0) y v2c (INTEGER 1), GetRequest PDU 0xA0 y GetResponse PDU 0xA2. El cliente construye cada paquete desde sus TLV BER y lo envía por un DatagramSocket UDP conectado a la IP/161; ese socket filtra respuestas de otros remitentes. Hay dos intentos de dos segundos por consulta.

El mensaje incluye version, community, request-id, error-status, error-index y lista de variable bindings. El parser valida estructura, límites, longitud definida, PDU, correlación del request-id, community, versión, conjunto de OIDs y error-status. Rechaza datos truncados, longitudes indefinidas, basura al final y tipos no implementados. No guarda community en SQLite ni en reportes.

Tipos decodificados: INTEGER con signo; OCTET STRING UTF-8 con fallback binario; NULL; OBJECT IDENTIFIER base 128; IpAddress; Counter32; Gauge32; TimeTicks; excepciones noSuchObject/noSuchInstance/endOfMibView. Counter64 se conserva como hexadecimal, sin perder precisión al convertirlo a Number. No se consulta Counter64 en el flujo habitual.

OIDs consultados:

- `1.3.6.1.2.1.1.5.0`: sysName.
- `1.3.6.1.2.1.1.3.0`: sysUpTime, centésimas de segundo.
- `1.3.6.1.2.1.2.1.0`: ifNumber.
- `1.3.6.1.2.1.2.2.1.2.<ifIndex>`: ifDescr.
- `1.3.6.1.2.1.2.2.1.6.<ifIndex>`: ifPhysAddress.
- `1.3.6.1.2.1.2.2.1.10.<ifIndex>`: ifInOctets.
- `1.3.6.1.2.1.2.2.1.16.<ifIndex>`: ifOutOctets.

Se toman dos muestras separadas por al menos un segundo. La tasa se calcula como `((C2 - C1 + 2^32) mod 2^32) * 8 / segundos`. Se comprueba que sysUpTime no haya disminuido. Un reinicio, reset independiente de interfaz, múltiples vueltas del Counter32 o una interfaz de mucha capacidad impiden interpretar de forma inequívoca la tasa; es una estimación de laboratorio. `ifNumber` no implica índices consecutivos: el usuario debe elegir un índice existente. No hay Walk, GetNext, GetBulk, Set, traps, SNMPv3 ni cifrado de community. Un agente v1 puede rechazar la consulta completa si el índice no existe.

SNMP v1/v2c expone la community en la LAN. El alcance es una red controlada de diagnóstico. Para otros escenarios corresponde SNMPv3; no se afirma que v2c provea confidencialidad o autenticación fuerte.

## SSH y credenciales: RF-03

El adaptador usa el fork mantenido JSch, fijado en Gradle. Los perfiles se enumeran también del lado nativo, de modo que JavaScript elige un identificador y no envía comandos arbitrarios.

- Linux: `uptime`, `ip -s link`, `ip route`.
- RouterOS: `/system resource print`, `/interface print stats`.
- Cisco: `show version`, `show interfaces`, `show ip route`.

Se requiere un servidor que permita canales SSH exec. Algunos equipos Cisco/otros vendors solo ofrecen shell interactiva o paginación: esos modelos necesitan un adaptador adicional y pueden devolver timeout. Se conserva stdout, stderr y exit code. El timeout de conexión es de 12 s, y el de cada comando 15 s. No se solicita PTY.

El flujo obtiene la huella SHA256 durante el intercambio de claves y aborta antes de autenticarse. El usuario la compara con una fuente confiable y confirma su guardado por IP/puerto. La ejecución posterior usa StrictHostKeyChecking y un HostKeyRepository que solo admite el pin exacto. Un cambio de clave bloquea la conexión; no hay aceptación silenciosa. La lectura inicial de huella no prueba por sí misma la identidad.

Usuario/contraseña se cifran mediante AES-GCM, IV aleatorio, AAD asociado al nombre del secreto y una clave no exportable de Android Keystore. SharedPreferences almacena solo IV y ciphertext. `allowBackup=false` evita copias automáticas del estado. También se cifra el token del backend. La contraseña se borra del campo React tras guardarla; el secreto se descifra en memoria al abrir SSH. No hay registro de secretos en logs, SQLite, PDF ni payload de sincronización. Se implementa eliminación de credenciales desde la UI. El módulo puede devolver el token a JavaScript para autenticar HTTP; no mantiene todos los secretos fuera de memoria JS.

## QR, evidencia y PDF: RF-04/05/06

La lectura de QR/barras se hace sobre una fotografía con el modelo ML Kit incluido en el APK; no necesita descargar el modelo al primer uso. Se usa la cámara instalada en el teléfono mediante intent, sin incrustar una vista CameraX. El resultado del código se asocia al equipo, se consulta el catálogo remoto y se cachea la ficha. Si no hay backend, el código queda guardado y se reutiliza la última ficha disponible; para una ficha aún no descargada se puede repetir la consulta al reconectar.

Las fotos se guardan en el directorio privado de la app, se corrige su orientación EXIF y se reducen/comprimen a JPEG. No se requiere acceso general a la galería. Cada evidencia referencia coordenadas, precisión y hora obtenidas por LocationManager después de la captura; no se escriben etiquetas GPS EXIF en el JPEG. La app reutiliza un fix de hasta 120 segundos o espera uno nuevo hasta 25 s. Se muestran precisión y timestamp, por lo que no se presenta una ubicación aproximada como exacta. El equipo necesita cámara instalada, ubicación habilitada y permisos concedidos. El GPS puede funcionar offline, pero obtener el primer fix puede ser lento.

El borrador (campos y fotos ya georreferenciadas) se persiste mediante el mismo repositorio local. Al guardar, PdfDocument compone encabezado, sitio, técnico, equipo, GPS, notas, diagnósticos y páginas fotográficas con coordenadas. Los reportes se comparten únicamente mediante FileProvider y permisos temporales. No hay llamadas a un servicio PDF externo. Si falla la generación no se confirma una instalación con PDF inexistente. Una foto capturada cuyo GPS falla puede quedar huérfana en almacenamiento privado; no se incorpora como evidencia georreferenciada.

## Persistencia y outbox: RF-07/08

SQLite tiene una fila `state` con revisión y snapshot JSON. Cada modificación usa transacción SQL con comparación de revisión y una cola de escritura en JS. La instalación y su evento outbox se agregan juntos, además de limpiar el borrador en esa misma confirmación. No existe una escritura separada que deje un reporte confirmado sin evento. Un fallo de disco no publica un estado nuevo a la UI.

El snapshot incluye inventario, historial de diagnósticos, instalaciones inmutables, fichas cacheadas, ajustes y borrador. Fotos/PDF se almacenan como archivos privados y se referencian desde el snapshot. Solo se guardan datos no secretos; el token y credenciales van al almacén cifrado.

Estados de cola: pending → sending → done. Un fallo produce failed con contador, error y próximo intento persistidos. Backoff: 2 s, 4 s, 8 s... con tope base de 300 s y jitter de 0–999 ms. Se suprime la ejecución concurrente del worker. Al abrir la app se recuperan como pending los eventos que quedaron en sending tras una interrupción. No hay borrado de un evento antes de obtener un ACK cuyo eventId e installationId coincidan.

El worker se activa al abrir/volver a la app, al recibir cambios de ConnectivityManager y cada 30 segundos mientras JS está ejecutándose. También existe reintento manual. No usa WorkManager y **no promete sincronización con la app cerrada**. La disponibilidad real del backend se comprueba al enviar; Internet validado por Android no es requisito cuando el backend está en la LAN.

Se suben JPEG/PDF con IDs estables y SHA256 antes de publicar el reporte. El backend deduplica archivo por ID+hash y evento por ID+digest persistido. Si se pierde la respuesta tras confirmar el servidor, repetir el mismo evento devuelve el mismo ACK. IDs reutilizados con contenido distinto reciben 409. Los reportes finalizados son inmutables: una corrección se registra como otra instalación. Esto evita fusiones ambiguas de evidencia. La UI conserva el estado local frente a un 409 y permite revisar el error, sin sobrescribir un reporte remoto.

El backend usa un archivo JSON con reemplazo por rename y serializa escrituras dentro de un proceso. No es una base multiusuario ni admite procesos simultáneos sobre el mismo directorio. No implementa autenticación de usuarios, rotación de tokens, cuotas, cifrado de evidencia en reposo, limpieza de blobs huérfanos o sincronización bidireccional. SQLite snapshot completo también limita la escala: para muchos registros se recomienda migrar a tablas normalizadas/WatermelonDB con migraciones y consultas paginadas. El inventario/historial del teléfono no se replica por separado; viaja el snapshot pertinente dentro de cada instalación.

## API mínima

`GET /health`: estado sin token. Las demás rutas requieren `Authorization: Bearer <SYNC_TOKEN>`.

- `GET /api/catalog/<codigo>`: ficha técnica, 404 si no existe.
- `PUT /api/blobs/<id>`: binario JPEG/PDF, Content-Type y X-Content-SHA256; máximo 20 MiB; acepta reenvío idéntico.
- `GET /api/blobs/<id>`: recupera evidencia con autenticación.
- `POST /api/sync`: `{ eventId, installation }`, con manifiesto `files`, IDs de fotos/PDF y GPS; máximo 2 MiB JSON.
- `GET /api/installations`: reportes confirmados, para validar el backend.

El servidor valida coordenadas, fechas, referencias, checksums y tipos básicos. Rechaza claves privadas como password/community/token/uri en el documento de transporte. Los reportes transmitidos no incluyen rutas privadas locales. El token de ejemplo es deliberadamente público y debe sustituirse fuera del laboratorio. Android y el cliente restringen HTTP a excepciones de laboratorio; para un backend remoto se usa HTTPS.

## Dependencias y referencia

React Native 0.88.1 y React 19.3.0 provienen de la plantilla oficial, con package-lock generado. El módulo FieldKit adapta directamente las APIs Android. NSD, SQLite, LocationManager y PdfDocument forman parte de Android; ML Kit y JSch son las dependencias nativas adicionales, junto con ExifInterface para orientación.

Referencias primarias consultadas:

- [RFC 1157, SNMP](https://www.rfc-editor.org/rfc/rfc1157).
- [RFC 1213, MIB-II](https://www.rfc-editor.org/rfc/rfc1213).
- [RFC 1905, operaciones SNMPv2](https://www.rfc-editor.org/rfc/rfc1905).
- [Configuración del entorno React Native](https://reactnative.dev/docs/set-up-your-environment).
- [ML Kit Barcode Scanning para Android](https://developers.google.com/ml-kit/vision/barcode-scanning/android).
- [JSch mantenido](https://github.com/mwiede/jsch).
- [Permisos de red local de Android](https://developer.android.com/privacy-and-security/local-network-permission).

Target SDK 36 conserva el acceso LAN bajo INTERNET en el modelo normal. Si se eleva targetSdk a 37, hay que adaptar el permiso runtime ACCESS_LOCAL_NETWORK conforme a la documentación Android; esta entrega no hace esa migración.

## Versión Expo Go (iOS/Android/web) y gateway de campo

`expo-app/` es una segunda interfaz de la misma suite, pensada para dispositivos donde no se puede instalar el APK (iPhone sin Mac/Xcode ni cuenta de Apple Developer). Expo Go solo incluye sus módulos nativos precompilados: no expone sockets UDP/TCP crudos ni SSH, y en iOS el multicast/mDNS requiere además un entitlement de Apple. Por eso la consigna advierte que el proyecto, tal como se plantea, no es compatible con Expo Go.

La solución separa responsabilidades:

- **En el teléfono** (igual que en Android): construcción y parsing de las PDUs SNMP con el codec BER propio (`mobile/src/core/snmp.mjs`, compartido vía `watchFolders` de Metro), cola outbox y repositorio (`store.mjs`), verificación de huella SSH por el técnico, credenciales en Keychain/Keystore (`expo-secure-store`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`), cámara para QR/barras en vivo (`expo-camera`), fotos (`expo-image-picker` + `expo-image-manipulator`, que normaliza la orientación EXIF), GPS (`expo-location`), SQLite transaccional (`expo-sqlite`), disparo de sincronización con `@react-native-community/netinfo` y PDF.
- **En el gateway de campo** (`backend/gateway.mjs`, el mismo proceso del backend, corriendo en una laptop/Raspberry dentro de la LAN del sitio): solo las operaciones de socket. `POST /api/gateway/discover` barre el /24 de la interfaz por la que llegó el pedido (TCP 22/23/80/443/8080, 64 conexiones en paralelo, un RST cuenta como host vivo) y luego lee la tabla ARP del sistema (`arp -a` / `ip neigh`): devuelve IP, **MAC real** y hostname por DNS inverso cuando existe. `POST /api/gateway/udp` reenvía bytes a UDP/161 de una IPv4 privada y devuelve los bytes de la respuesta sin interpretarlos. `POST /api/gateway/ssh/fingerprint` y `/ssh/exec` usan `ssh2` con el mismo conjunto fijo de comandos por perfil y verifican la huella SHA256 fijada por el técnico; si no coincide, no se autentica.

Límites y seguridad: todo el gateway exige el token Bearer y solo admite destinos IPv4 privados; el relay UDP solo admite el puerto 161. Las credenciales SSH viajan del teléfono al gateway en cada ejecución por la LAN del laboratorio (HTTP con token); en un despliegue real el gateway debe servirse por HTTPS. El gateway no persiste credenciales ni communities. Sin gateway alcanzable, la app sigue operando offline (historial, fichas en caché, borradores, instalaciones, PDF y cola); descubrimiento, SNMP y SSH requieren el gateway en la misma red.

PDF: `expo-print` en web solo abre el diálogo de impresión, así que `expo-app/src/core/pdf.mjs` genera un PDF 1.4 propio (Helvetica WinAnsi en cadenas hexadecimales, paginación y fotos JPEG embebidas con DCTDecode sin recomprimir). Es JavaScript puro: el mismo código corre en Expo Go y en el navegador, y lo cubren pruebas con Node (`tests/pdf.test.mjs`).

Modo navegador: misma UI con `react-native-web`; el estado y los secretos van en `localStorage` (el navegador no tiene Keychain) y los archivos como data URIs, así que admite pocas fotos. Es un modo de demostración desde el PC del laboratorio, no la plataforma objetivo.
