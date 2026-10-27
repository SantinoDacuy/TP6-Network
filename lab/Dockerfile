FROM alpine:3.22
RUN apk add --no-cache net-snmp net-snmp-tools openssh iproute2 procps \
    && adduser -D tech \
    && mkdir -p /run/sshd
COPY snmpd.conf /etc/snmp/snmpd.conf
COPY sshd_config /etc/ssh/sshd_config
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 22/tcp 161/udp
ENTRYPOINT ["/entrypoint.sh"]
