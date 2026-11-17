# Teste contínuo do fluxo de ingestão (US-21)

Envia um lote de leituras pelo simulador, espera o fluxo terminar e confere que nenhuma se perdeu:

```
enviadas = gravadas (válida e inválida) + rejeitadas + ignoradas (duplicatas) + na DLQ
```

O balanço conta medidas, não mensagens: uma mensagem com 5 sensores conta como 5. Diferença diferente de zero encerra com erro.

Cada lote pode conter até 300 leituras por estação.

## Como rodar

Na raiz do backend, com o `.env` preenchido:

1. Suba o compose e aplique as migrations (o compose não aplica sozinho):

   ```bash
   docker compose up -d --build
   for s in gestao-usuarios gestao-estacoes alertas-notificacoes ingestao-dados servico-validacao; do
     docker compose exec -T "$s" npm run migrate -- up
   done
   ```

2. Rode o teste:

   ```bash
   scripts/teste-fluxo-ingestao.sh                       # um lote de 1.000 medidas
   scripts/teste-fluxo-ingestao.sh --continuo            # lotes seguidos até Ctrl+C
   scripts/teste-fluxo-ingestao.sh --continuo --lotes 5  # cinco lotes
   scripts/teste-fluxo-ingestao.sh --queda-banco 20      # PostgreSQL fora por 20 s durante o lote
   ```

No Windows, use o Git Bash. O script precisa de Docker e Node 24 na máquina.

## O que o script faz

1. Cadastra 10 estações de teste (TF-01 a TF-10, município "Teste Fluxo") com os 5 sensores do simulador, fator_conversao 1 e offset 0 (`semente-estacoes.sql`). Pode rodar mais de uma vez.
2. Roda o simulador em modo lote (`node dist/lote.js`), com horários únicos por estação. O simulador lê os sensores de cada estação no `gestao-estacoes` (rota interna, com o `INTERNAL_TOKEN`), não de uma lista fixa: cada mensagem tem uma leitura por sensor ativo da estação, com o valor bruto da calibração invertida. Com `--queda-banco`, o script lê os sensores antes de parar o PostgreSQL e os entrega ao simulador em `LOTE_SENSORES_JSON`. O lote tem uma mensagem de cada caso: duplicata, estação desconhecida, umidade 120,0 e sensor inexistente.
3. Copia o manifesto do lote para `tests/fluxo-ingestao/saida/`.
4. Confere o balanço (`npm run balanco`), lendo `staging_telemetria`, `medidas` e a `validacao.dlq` sem consumir os eventos da fila. Espera até o lote fechar, com limite de 120 s (`--tempo-limite`).
5. No modo contínuo, o lote seguinte começa depois do último horário do anterior.

## Limites conhecidos

- Leitura de sensor inativo não é gravada em lugar nenhum (só log e contador, US-18). Por isso as estações de teste só têm sensores ativos.
- As duplicatas são contadas pelo próprio teste, que sabe quantas cópias enviou. No banco, o teste confere que ficou uma linha no staging e uma medida por sensor.
- Rodar dois lotes simples com o mesmo `--inicio` repete os horários: o segundo lote vira duplicata e o balanço não fecha (a linha do staging só conta quando o conteúdo é o do manifesto). Sem `--inicio`, o lote começa depois do último horário das estações de teste no staging, ou no horário atual, se for maior.

## Teste da grandeza nova (US-39)

Coloca uma grandeza nova no ar, do cadastro à medida gravada, e confere cada passo. Também é o roteiro de "como colocar uma grandeza nova no ar":

```bash
scripts/teste-grandeza-nova.sh
```

Precisa do compose no ar (inclusive `gestao-estacoes`, `ingestao-dados`, `servico-validacao` e `nginx`) e das migrations aplicadas. Usa a estação TF-10 da semente e deixa tudo como estava ao terminar. É só para o ambiente de teste: o reenvio da DLQ reprocessa todas as mensagens que estiverem lá.

| Passo | O que acontece | O que o teste confere |
| --- | --- | --- |
| 1 | `GET /estacoes/tipos-sensor` | Direção do Vento, `°`, 0 a 360, agregação `media_circular` |
| 2 | A placa publica `{"sensor":"DIR-E2E","valor":270}` **antes** do sensor existir | A leitura vai para a `validacao.dlq` com "Sensor inexistente na estação" |
| 3 | O Administrador cadastra na estação o sensor `DIR-E2E` da grandeza Direção do Vento, com o **mesmo código** que a placa envia | `201`, unidade `°` |
| 4 | O Administrador reenvia a DLQ (`POST /validacao/dlq/reenviar`) | Uma linha em `medidas` com valor 270,00 e `valida = true` |
| 5 | A placa publica 400 | A medida é gravada com `valida = false` e não abre alarme |
| 6 | O sensor `TEMP-01` passa a enviar em Kelvin (`unidade_leitura` K, `fator_conversao` 1, `offset` -273,15) e publica 300 | A medida vale 26,85 e é válida |
| 7 | Cadastro de outro sensor com o código `TEMP-01` na mesma estação | `409` com o código na mensagem |
| 8 | Excluir a Direção do Vento (em uso) e uma grandeza criada e nunca usada | `409` com "usada por N sensor(es)" e `204` |

Se a leitura chegar mais de 10 minutos depois da hora da medição (por exemplo, num reenvio demorado), a medida é gravada, mas não avalia regras de alerta (US-28).

Para uma grandeza que **não** está no catálogo: o Administrador a cadastra em `POST /estacoes/tipos-sensor` (nome, unidade, faixa física e agregação) antes do sensor. O código do sensor precisa ser igual ao que a placa envia e é único na estação.

## Testes do conferidor

```bash
npm ci
npx tsc --noEmit
npm run lint
npm test
```
