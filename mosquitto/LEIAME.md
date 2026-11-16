# Broker MQTT (Mosquitto)

Desde a revisão da US-29, a estação conecta **sem usuário, senha ou certificado**
e se identifica pelo **MAC** (12 hex minúsculos, sem separador, ex.: `aabbccddeeff`).

> **Atenção:** sem senha e sem ACL, qualquer cliente que alcance a porta 1883
> conecta, publica e assina. A 1883 deve ficar **só na rede da Prefeitura**,
> nunca exposta na internet.

## Subir

```bash
cp .env.example .env   # preencha ao menos VALKEY_PASSWORD
docker compose up -d --wait mosquitto
docker compose ps mosquitto   # STATUS: healthy
```

Uma porta só: `1883` (MQTT 3.1.1, sem TLS). A sessão persistente
(`clean_session=false`) sobrevive a reinício e expira após 30 dias offline.

## Conectar

| Quem | clientId | Tópico | QoS |
|---|---|---|---|
| Estação | `<mac>` | publica em `pulso/estacoes/<mac>/telemetria` | 1 |
| ingestao-dados | `ingestao-dados` (fixo, sessão persistente) | assina `pulso/estacoes/+/telemetria` | 1 |

```bash
# assinar (outro terminal)
mosquitto_sub -h localhost -p 1883 -t 'pulso/estacoes/+/telemetria' -v
# publicar como a estação aabbccddeeff
mosquitto_pub -h localhost -p 1883 -i aabbccddeeff -q 1 \
  -t pulso/estacoes/aabbccddeeff/telemetria -m '{"timestamp":"2026-11-16T12:00:00Z","leituras":[]}'
```

A ingestão e o simulador não precisam de `MQTT_USER`/`MQTT_PASSWORD`; se
existirem, a ingestão envia, mas o broker não pede.

## Por que não há ACL

Testado no `eclipse-mosquitto:2.1.2-alpine` com `allow_anonymous true`:
`pattern write pulso/estacoes/%c/telemetria` funciona para cliente anônimo
(publicar com `-i <mac A>` no tópico do `<mac B>` é negado), mas exige também
`topic read pulso/estacoes/+/telemetria` (ingestão) e `topic read $SYS/#`
(healthcheck). A negação é silenciosa (o publicador recebe PUBACK) e o
simulador, que publica várias estações com um clientId aleatório, tem tudo
descartado. Como o clientId é declarado pela própria placa, o ACL só evita
engano, não protege. Fica para a US do MAC, junto com o simulador.
