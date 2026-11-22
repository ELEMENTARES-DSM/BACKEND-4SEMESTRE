# Instalação e deploy nos 4 servidores

Scripts para instalar o Pulso Urbano direto no **Ubuntu Server 24.04 LTS**, sem Docker. Cada componente vem do pacote do Ubuntu ou do repositório oficial dele, e cada serviço Node.js roda no systemd, que o religa sozinho se cair.

Cada servidor se instala sozinho, numa máquina física ou numa VM. O mesmo script roda de novo sem estragar nada: serve para corrigir uma configuração ou terminar uma instalação que parou no meio.

| Papel | O que instala | Quem alcança |
| --- | --- | --- |
| `s1` Aplicação | nginx (HTTPS), site, auth-service, gestao-usuarios, gestao-estacoes, analise-dados, servico-relatorios, Valkey | Internet na 443 |
| `s2` Recepção | Mosquitto, ingestao-dados, RabbitMQ, servico-validacao, alertas-notificacoes, Valkey | Estações na 1883; S1 nas 3002, 3005, 3007 e 6379 |
| `s3` Banco | PostgreSQL | S1, S2 e S4 na 5432 |
| `s4` Backup e monitoramento | Backup diário, Prometheus, Alertmanager, Grafana | Rede da VPN nas 3000, 9090 e 9093 |

Todos os servidores ganham também o node exporter (porta 9100, só para o S4). O S1 e o S2 ganham o coletor do Valkey (9121), o S2 publica as métricas do RabbitMQ (15692) e o S3 ganha o coletor do PostgreSQL (9187).

## Antes de começar

- **Ubuntu Server 24.04** instalado em cada servidor, com acesso SSH e `sudo`.
- **Saída para a internet durante a instalação**, direta ou por proxy (`PROXY_HTTP`). Os scripts baixam pacotes do apt, da NodeSource e da Grafana, as dependências do npm e o código do GitHub. Depois de instalado, o acesso pode ser cortado. Para atualizar a aplicação, o S1 e o S2 precisam dele de novo.
- **IPs fixos** na rede interna para os 4 servidores.
- **Certificado HTTPS** da Prefeitura para o S1 (`.crt` com a cadeia e `.key`). Sem ele, o instalador gera um autoassinado, que serve só para testar.
- **Relógio sincronizado** (NTP). Token, backup e alertas dependem da hora certa.

## Passo a passo

### 1. Gerar a configuração (uma vez)

Numa máquina qualquer com a repo:

```bash
cd BACKEND-4SEMESTRE/deploy
./instalar.sh gerar-config > pulso.conf
```

O arquivo já sai com senhas aleatórias. Preencha à mão:

- os IPs `S1_IP` a `S4_IP`, `REDE_ADMIN` (VPN) e `REDE_ESTACOES`;
- `DOMINIO` e as versões `REF_BACKEND` e `REF_FRONTEND`. Em produção, use a tag da release (ex.: `1.2.0`);
- `ADMIN_EMAIL`. A senha `ADMIN_SENHA` já vem gerada;
- o SMTP da Prefeitura (`SMTP_*`) e `ALERTA_EMAIL_PARA`.

Senhas só com letras e números, porque elas entram em URLs de conexão.

### 2. Copiar para os 4 servidores

O **mesmo arquivo** vai para todos, porque os segredos precisam ser iguais:

```bash
scp -r deploy pulso.conf usuario@<servidor>:~/
# no servidor:
sudo install -D -m 600 ~/pulso.conf /etc/pulso-urbano/pulso.conf
```

No S4, copie a repo inteira, não só a pasta `deploy`: o painel do Grafana vem de `monitoramento/grafana`. O jeito mais simples é dar `git clone` da repo em cada servidor e rodar de dentro dela.

### 3. Instalar, nesta ordem

```bash
sudo ./instalar.sh s3   # banco: o S1 e o S2 rodam as migrations nele
sudo ./instalar.sh s1   # aplicação: roda as migrations e troca o admin de teste
sudo ./instalar.sh s2   # recepção
sudo ./instalar.sh s4   # backup e monitoramento: faz o primeiro backup na hora
```

Cada papel instala sozinho. A ordem só importa porque o S1 e o S2 precisam do banco no ar para rodar as migrations. Se um servidor que o outro usa ainda não existe, a verificação do final avisa; depois de instalar todos, rode `sudo ./verificar.sh` em cada um.

Cada execução guarda o log em `/var/log/pulso-urbano/`.

### 4. Conferir

```bash
sudo ./verificar.sh        # todos os papéis desta máquina
```

Abra `https://<DOMINIO>` e entre com `ADMIN_EMAIL` e `ADMIN_SENHA`. O Grafana fica em `http://<S4_IP>:3000` (pela VPN).

## Deploy de uma versão nova

No S1 primeiro, depois no S2:

```bash
sudo ./deploy.sh s1 --ref-backend 1.3.0 --ref-frontend 1.3.0
sudo ./deploy.sh s2 --ref-backend 1.3.0
```

O deploy segue estes passos:

1. Baixa só o commit pedido.
2. Constrói cada serviço (`npm ci` e `npm run build`) e o site.
3. Roda as migrations.
4. Troca a versão ativa e reinicia os serviços.
5. Espera cada `/health` responder.

Se algum serviço não responder em 90 segundos, ele volta sozinho para a versão anterior. Sem `--ref-*`, usa o `REF_BACKEND`/`REF_FRONTEND` do `pulso.conf`. Depois do deploy, atualize esses valores nos 4 servidores.

Para voltar à versão anterior à mão:

```bash
sudo ./deploy.sh s1 --voltar
```

Ficam guardadas as últimas `RELEASES_GUARDADAS` versões (padrão 5). **As migrations não voltam**: se a versão nova mudou o banco, confira antes de voltar.

## Testar numa VM

- **Uma VM por servidor** (recomendado): é igual à produção. Use os IPs das VMs no `pulso.conf`.
- **Tudo numa VM só**, para um teste rápido:
  - `S1_IP` a `S4_IP` como `127.0.0.1`;
  - `VALKEY_S2_PORTA="6380"`, porque o Valkey do S1 já usa a 6379;
  - `FIREWALL="nao"`;
  - instale na ordem `s3`, `s1`, `s2`, `s4`.

  Limitação: só há um coletor do Valkey por máquina, então o segundo papel instalado substitui o primeiro no monitoramento.

## Onde fica cada coisa

| O quê | Onde |
| --- | --- |
| Configuração | `/etc/pulso-urbano/pulso.conf` |
| Variáveis de cada serviço | `/etc/pulso-urbano/servicos/<serviço>.env` |
| Versões construídas | `/opt/pulso-urbano/releases/<papel>-<data>-<commit>/` |
| Versão ativa de cada serviço | `/opt/pulso-urbano/servicos/<serviço>` (link) |
| Site | `/var/www/pulso-urbano/atual` (link) |
| Código baixado | `/opt/pulso-urbano/src/{backend,frontend}` |
| Valkey | `/etc/pulso-urbano/valkey-<s1\|s2>.conf` e `/var/lib/pulso-urbano/valkey-<s1\|s2>` |
| nginx | `/etc/nginx/sites-available/pulso-urbano` |
| Backups (S4) | `/var/backups/pulso-urbano/{diario,mensal}` |
| Logs da instalação | `/var/log/pulso-urbano/` |

Comandos do dia a dia:

```bash
systemctl status 'pulso@*'                 # serviços Node.js
journalctl -u pulso@ingestao-dados -f      # log de um serviço
systemctl restart pulso@analise-dados
systemctl status pulso-valkey@s2 mosquitto rabbitmq-server
systemctl list-timers pulso-backup.timer   # próximo backup (S4)
```

## Backup e restauração

O S4 faz um `pg_dump` do S3 todo dia às `BACKUP_HORARIO`. Antes de aceitar a cópia, confere se o arquivo abre (`pg_restore --list`). Guarda `BACKUP_DIAS` cópias diárias e a primeira de cada mês por `BACKUP_MESES` meses. Se o backup falhar ou atrasar mais de 26 horas, o Prometheus dispara o alerta `BackupAtrasado`. Para rodar um backup na hora: `sudo systemctl start pulso-backup`.

Para testar a restauração num banco separado, no S3:

```bash
scp <S4>:/var/backups/pulso-urbano/diario/pulso_AAAA-MM-DD_HHMM.dump /tmp/
sudo -u postgres createdb -O pulso pulso_restaurado
sudo -u postgres pg_restore -d pulso_restaurado --no-owner --role=pulso /tmp/pulso_*.dump
```

Para restaurar o banco de produção: pare os serviços (`systemctl stop 'pulso@*'` no S1 e no S2), renomeie o banco atual, restaure como acima com o nome `pulso` e suba os serviços de novo.

A cópia fora do prédio (disco externo ou outro prédio da Prefeitura) não é feita por estes scripts.

## Monitoramento

O Prometheus do S4 lê os 4 servidores e guarda `PROMETHEUS_RETENCAO` (35 dias). As regras ficam em `/etc/prometheus/pulso-alertas.yml` e seguem a governança e a arquitetura física:

- serviço fora do ar (pelo `/health` ou pelo systemd);
- CPU acima de 50%, memória acima de 80% e disco acima de 60%;
- memória do S2 acima de 35%, porque em 40% o RabbitMQ recusa leituras;
- Valkey do S2 acima de 80%;
- fila do RabbitMQ acumulando;
- conexões do banco perto do limite;
- backup atrasado.

Com `ALERTA_EMAIL_PARA` e `SMTP_HOST` preenchidos, o Alertmanager manda e-mail. Sem eles, os alertas aparecem só na tela.

O painel "Saúde da Plataforma" vem de `monitoramento/grafana`. Os quadros de contêiner (cAdvisor) ficam vazios, porque em produção não há contêiner. Os de máquina, RabbitMQ, PostgreSQL e Valkey funcionam.

## O que o instalador muda em relação ao desenvolvimento

- **Portas fixas por serviço.** São as padrão do `server.ts`, exceto o gestao-usuarios, que sai da 3001 (já usada pelo auth-service) para a 3008.
- **Rota interna fechada.** A rota `/api/v1/internal/` do gestao-estacoes responde 404 pelo nginx: ela não sai para a internet.
- **Sem Swagger.** O Swagger UI não é instalado (task 32.6).
- **Admin de teste trocado.** A migration cria `admin@exemplo.com` com a senha de teste da repo. Na primeira instalação, o S1 troca o e-mail e a senha pelos do `pulso.conf`.
- **RabbitMQ só local.** Ele escuta apenas na própria máquina e sem o usuário `guest`. O painel dele abre por túnel: `ssh -L 15672:127.0.0.1:15672 <S2>`.
- **Versões do Ubuntu.** Os componentes vêm do Ubuntu 24.04: PostgreSQL 16, RabbitMQ 3.12, Mosquitto 2.0 e Valkey 7.2. No desenvolvimento, as imagens Docker usam Mosquitto 2.1 e Valkey 9.1. Os comandos que a aplicação usa existem nas duas versões.

## Problemas comuns

- **"O PostgreSQL do S3 não responde"** ao instalar o S1 ou o S2: instale o S3 antes ou confira o firewall dele (`sudo ufw status` no S3).
- **Um serviço não sobe:** veja o motivo com `journalctl -u pulso@<serviço> -n 50`. Na maioria das vezes, falta uma variável no `pulso.conf` ou o banco está fora.
- **O `ingestao-dados` responde 503** no `/health`: ele está sem conexão com o Mosquitto ou com o RabbitMQ (`systemctl status mosquitto rabbitmq-server`).
- **"Formulário Adicionar sensor" sem códigos:** o S1 não alcança o Valkey do S2. Confira com `nc -zv <S2_IP> 6379` no S1.
- **Instalação parou no meio:** corrija o que o erro aponta e rode o mesmo comando de novo.
