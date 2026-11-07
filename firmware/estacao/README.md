# Firmware da estação (ESP32)

Firmware das estações de monitoramento: lê os sensores e publica a telemetria no broker MQTT (porta 8883, TLS, QoS 1).

## Estrutura

```
firmware/estacao/
├── platformio.ini
├── include/config.example.h   # modelo; o config.h real fica fora do Git
├── src/main.cpp               # só liga os módulos; sem lógica
├── lib/                       # um módulo por pasta
│   ├── relogio/               # lógica pura: relógio válido, próximo ciclo
│   ├── reconexao/             # lógica pura: espera crescente
│   ├── telemetria/            # lógica pura: monta o JSON (ArduinoJson)
│   ├── fila/                  # fila em anel sobre uma interface de arquivo
│   ├── conexao/               # Wi-Fi, NTP e MQTT (só esp32)
│   └── sensores/              # drivers (só esp32)
└── test/                      # testes no computador (ambiente native)
```

**Regra:** os módulos de lógica pura (`relogio`, `reconexao`, `telemetria`, `fila`) não incluem `Arduino.h`, para rodarem no ambiente `native` (no computador e no CI).

## 1. Instalar o PlatformIO

Escolha uma das opções:

- **VS Code:** instale a extensão **PlatformIO IDE** e abra a pasta `firmware/estacao`.
- **Linha de comando:** `pip install platformio`

## 2. Configurar a estação

```bash
cd firmware/estacao
cp include/config.example.h include/config.h
```

Edite o `include/config.h` e preencha:

| Campo | O que colocar |
| ----- | ------------- |
| `ESTACAO_UUID` | UUID da estação cadastrada na plataforma |
| `WIFI_SSID`, `WIFI_SENHA` | Rede Wi-Fi da estação |
| `MQTT_HOST`, `MQTT_PORTA` | IP e porta do broker (8883) |
| `MQTT_USUARIO`, `MQTT_SENHA` | Usuário e senha MQTT desta estação |
| `NTP_SERVIDOR` | Servidor de horário |
| `INTERVALO_LEITURA_S` | Intervalo entre leituras, em segundos |
| `CODIGO_TEMPERATURA`, `CODIGO_UMIDADE` | Códigos dos sensores cadastrados na plataforma |
| `CA_CERT`, `CLIENT_CERT`, `CLIENT_KEY` | Certificados PEM desta estação, dentro das aspas do texto bruto `R"( ... )"` |

O usuário, a senha e os certificados de cada estação são gerados com os scripts em `scripts/mqtt/` do repositório (`gerar-certificados.sh` e `nova-estacao.sh`).

> **Nunca versione o `config.h`, chaves (`*.key`) ou certificados (`*.crt`).** O `.gitignore` já os ignora. Confira com:
> `git ls-files firmware | grep -E 'config\.h$|\.key$|\.crt$'` (não deve listar nada).

## 3. Compilar, gravar e acompanhar

Com a placa conectada por USB:

```bash
pio run -e esp32 -t upload     # compila e grava
pio device monitor             # acompanha a saída serial (115200)
```

Para só compilar: `pio run -e esp32`.

## 4. Testar

Os testes rodam no computador, sem a placa:

```bash
pio test -e native
```

O mesmo comando e `pio run -e esp32` rodam no CI (workflow `Firmware`) a cada PR que altera `firmware/**`.

## Problemas comuns

- **`config.h: No such file or directory`:** falta o passo 2 (`cp include/config.example.h include/config.h`).
- **Placa não aparece na gravação:** instale o driver USB da placa (CP210x ou CH340) e confira o cabo (alguns só carregam).
- **A placa do cliente não é a `esp32dev`:** troque o campo `board` em `platformio.ini`.
