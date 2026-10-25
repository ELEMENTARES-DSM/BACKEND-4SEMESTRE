# Teste contínuo do fluxo de ingestão (US-21)

Envia um lote de leituras pelo simulador, espera o fluxo terminar e confere que nenhuma se perdeu:

```
enviadas = gravadas (válida e inválida) + rejeitadas + ignoradas (duplicatas) + na DLQ
```

O balanço conta medidas, não mensagens: uma mensagem com 5 sensores conta como 5. Diferença diferente de zero encerra com erro.

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

1. Cadastra 10 estações de teste (TF-01 a TF-10, município "Teste Fluxo") com os 5 sensores do simulador, fator 1 e ganho 0 (`semente-estacoes.sql`). Pode rodar mais de uma vez.
2. Roda o simulador em modo lote (`node dist/lote.js`), com horários únicos por estação. O lote tem uma mensagem de cada caso: duplicata, estação desconhecida, umidade 120,0 e sensor inexistente.
3. Copia o manifesto do lote para `tests/fluxo-ingestao/saida/`.
4. Confere o balanço (`npm run balanco`), lendo `staging_telemetria`, `medidas` e a `validacao.dlq` sem consumir os eventos da fila. Espera até o lote fechar, com limite de 120 s (`--tempo-limite`).
5. No modo contínuo, o lote seguinte começa depois do último horário do anterior.

## Limites conhecidos

- Leitura de sensor inativo não é gravada em lugar nenhum (só log e contador, US-18). Por isso as estações de teste só têm sensores ativos.
- As duplicatas são contadas pelo próprio teste, que sabe quantas cópias enviou. No banco, o teste confere que ficou uma linha no staging e uma medida por sensor.
- Rodar dois lotes simples com o mesmo `--inicio` repete os horários: o segundo lote vira duplicata e o balanço não fecha (a linha do staging só conta quando o conteúdo é o do manifesto). Sem `--inicio`, o lote começa depois do último horário das estações de teste no staging, ou no horário atual, se for maior.

## Testes do conferidor

```bash
npm ci
npx tsc --noEmit
npm run lint
npm test
```
