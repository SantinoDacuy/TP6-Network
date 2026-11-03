#!/bin/sh
set -eu
: "${LAB_PASSWORD:?Definir LAB_PASSWORD para el usuario tech}"
printf 'tech:%s\n' "$LAB_PASSWORD" | chpasswd
ssh-keygen -A
echo 'Comparar esta huella con la mostrada por la app:'
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256
ssh-keygen -lf /etc/ssh/ssh_host_rsa_key.pub -E sha256
/usr/sbin/snmpd -f -Lo -C -c /etc/snmp/snmpd.conf &
exec /usr/sbin/sshd -D -e
