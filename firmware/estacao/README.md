# Firmware da estação (ESP32)

Firmware das estações de monitoramento: lê o sensor de partículas (PM2.5) e publica a telemetria no broker MQTT (porta 8883, TLS, QoS 1, confirmada pelo PUBACK).

## Estrutura

```
firmware/estacao/
├── platformio.ini
├── include/config.example.h   # modelo; o config.h real fica fora do Git
├── src/main.cpp               # só liga os módulos; sem lógica
├── lib/                       # um módulo por pasta
│   ├── relogio/               # lógica pura: relógio válido, ISO 8601, próximo ciclo
│   ├── reconexao/             # lógica pura: espera crescente
│   ├── telemetria/            # lógica pura: monta o JSON (ArduinoJson)
│   ├── fila/                  # fila em anel sobre uma interface de arquivo
│   ├── conexao/               # Wi-Fi, NTP e MQTT/TLS (só esp32)
│   └── sensores/              # drivers (só esp32): PMS5003/PMS7003
└── test/                      # testes no computador (ambiente native)
    ├── test_relogio/
    ├── test_telemetria/
    └── contrato/telemetria.json   # exemplo gerado pelo teste de telemetria
```

**Regra:** os módulos de lógica pura (`relogio`, `reconexao`, `telemetria`, `fila`) não incluem `Arduino.h`, para rodarem no ambiente `native` (no computador e no CI).

## O que o firmware faz

1. Liga o sensor de PM (o aquecimento de 30 s roda junto com a conexão).
2. Conecta no Wi-Fi, ajusta o relógio por NTP e conecta no broker (TLS com certificado de cliente, usuário e senha).
3. Lê o sensor, monta o JSON e publica em `pulso/estacoes/<ESTACAO_UUID>/telemetria` (QoS 1), esperando o PUBACK. A primeira leitura sai logo depois do boot.
4. Repete a cada `INTERVALO_LEITURA_S`, alinhado ao relógio (com 300 s: :00, :05, :10...).

Payload (o servidor `ingestao-dados` rejeita fora deste formato):

```json
{"timestamp":"2026-10-08T21:42:00Z","nivel_bateria":80,"leituras":[{"sensor":"PM25-01","valor":12}]}
```

- `timestamp`: **texto** ISO 8601 em UTC (número é rejeitado).
- `leituras`: lista não vazia, cada item com `sensor` (texto) e `valor` (número).
- `nivel_bateria`: opcional, inteiro de 0 a 100. Esta estação não mede a bateria, então o campo é omitido.

## 1. Instalar o PlatformIO

Escolha uma das opções:

- **VS Code:** instale a extensão **PlatformIO IDE** e abra a pasta `firmware/estacao`.
- **Linha de comando:** `pip install platformio`

## 2. Ligar o sensor

Sensor PMS5003 ou PMS7003 (Plantower), em modo ativo (padrão de fábrica):

| Sensor | ESP32 |
| ------ | ----- |
| VCC (5 V) | 5 V (VIN) |
| GND | GND |
| TX | `PM_PINO_RX` (padrão: GPIO 16) |
| RX | `PM_PINO_TX` (padrão: GPIO 17) |
| SET | livre ou em nível alto (em nível baixo o sensor dorme e não envia dados) |

O sensor é alimentado com 5 V, mas a comunicação é em 3,3 V.

## 3. Configurar a estação

```bash
cd firmware/estacao
cp include/config.example.h include/config.h
```

Edite o `include/config.h` e preencha:

| Campo | O que colocar |
| ----- | ------------- |
| `ESTACAO_UUID` | UUID da estação **cadastrada e ativa** na plataforma |
| `WIFI_SSID`, `WIFI_SENHA` | Rede Wi-Fi da estação |
| `MQTT_HOST`, `MQTT_PORTA` | IP e porta do broker (8883) |
| `MQTT_USUARIO`, `MQTT_SENHA` | Usuário e senha MQTT desta estação |
| `NTP_SERVIDOR` | Servidor de horário |
| `INTERVALO_LEITURA_S` | Intervalo entre leituras, em segundos (use 30 para testar) |
| `CODIGO_PM25` | Código do sensor de PM2.5 **cadastrado para esta estação** na plataforma |
| `PM_PINO_RX`, `PM_PINO_TX` | Pinos da ESP32 ligados ao sensor (ver seção 2) |
| `CA_CERT`, `CLIENT_CERT`, `CLIENT_KEY` | Certificados PEM desta estação, dentro das aspas do texto bruto `R"( ... )"` |

`CODIGO_TEMPERATURA` e `CODIGO_UMIDADE` não são usados enquanto a estação não tiver esses sensores.

O usuário, a senha e os certificados de cada estação são gerados com os scripts em `scripts/mqtt/` do repositório (`gerar-certificados.sh` e `nova-estacao.sh`).

> **Nunca versione o `config.h`, chaves (`*.key`) ou certificados (`*.crt`).** O `.gitignore` já os ignora.

## 4. Compilar, gravar e acompanhar

Com a placa conectada por USB:

```bash
pio device list                                    # descobre a porta (ex.: /dev/ttyUSB0 ou /dev/ttyACM0)
pio run -e esp32 -t upload                         # compila e grava
pio device monitor                                 # acompanha a saída serial (115200)
```

Para só compilar: `pio run -e esp32`.

Saída esperada a cada ciclo:

```
[ciclo] PM1.0=5 PM2.5=12 PM10=18 ug/m3
[ciclo] payload: {"timestamp":"2026-10-08T21:42:00Z","leituras":[{"sensor":"PM25-01","valor":12}]}
[ciclo] PUBACK recebido (msg_id=...) em 36 ms
[ciclo] proxima leitura em 247 s
```

## 5. Testar

Os testes rodam no computador, sem a placa:

```bash
pio test -e native
```

O mesmo comando e `pio run -e esp32` rodam no CI (workflow `Firmware`) a cada PR que altera `firmware/**`. O teste de telemetria regrava `test/contrato/telemetria.json`; se o arquivo mudar, o contrato mudou.

## Problemas comuns

- **`config.h: No such file or directory`:** falta o passo 3 (`cp include/config.example.h include/config.h`).
- **Placa não aparece na gravação:** instale o driver USB da placa (CP210x ou CH340), confira o cabo (alguns só carregam) e, no Linux, o grupo `dialout`. Se aparecer `Wrong boot mode`, segure o botão BOOT durante a gravação.
- **`sensor de PM sem resposta`:** confira a fiação (TX do sensor no `PM_PINO_RX`), o pino SET e a alimentação de 5 V.
- **A mensagem chega ao broker mas não aparece na plataforma:** o `ESTACAO_UUID` precisa estar cadastrado e ativo, e o `CODIGO_PM25` precisa existir para essa estação.
- **A placa não é a `esp32dev`:** troque o campo `board` em `platformio.ini`.
