# Agente de laboratorio opcional

Este contenedor ofrece un agente Net-SNMP real y un servidor OpenSSH. No se ejecutó Docker durante la preparación de la entrega. Requiere Docker instalado y configuración de red que permita llegar a UDP/161 del host desde el teléfono.

```powershell
docker build -t tp6-agent lab
docker run --rm --name tp6-agent -e LAB_PASSWORD=UnaClaveSoloParaElLaboratorio -p 2222:22 -p 161:161/udp tp6-agent
```

En la app: IP LAN del host, community `tp6lab`, SNMP v2c, ifIndex de una interfaz existente y SSH puerto 2222, usuario `tech`, contraseña de LAB_PASSWORD, perfil linux. El contenedor imprime sus huellas SSH al arrancar. Comparalas antes de guardar el pin. El host/firewall puede bloquear UDP/161 o tener ya un agente ocupando el puerto. En Docker Desktop, la red del contenedor pasa por una VM; no se garantiza mDNS ni visibilidad de capa 2.

El escaneo TCP puede detectar la IP del PC por otros servicios, pero el puerto SSH 2222 del contenedor no forma parte de los puertos sondeados. Agregarlo por IP permite probar SNMP/SSH y **no demuestra por sí solo descubrimiento automático**. Para la demo exigida usá también un router/ONT/switch físico de laboratorio con mDNS o respuesta TCP a 22/80/443.

El índice SNMP puede ser 1 para loopback y 2 para eth0. Verificalo desde el propio contenedor:

```powershell
docker exec tp6-agent snmpwalk -v2c -c tp6lab 127.0.0.1 1.3.6.1.2.1.2.2.1.2
```

Detené el contenedor al terminar. Las contraseñas y communities de este ejemplo son de laboratorio.
