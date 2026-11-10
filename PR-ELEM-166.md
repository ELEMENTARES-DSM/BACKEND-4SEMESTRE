## Rejeitar leituras com timestamp fora da faixa

### Descrição

Adiciona validação do timestamp na ingestão. Leituras anteriores ao cadastro da estação ou mais de 5 minutos à frente do horário de recebimento são rejeitadas com o motivo `Timestamp fora da faixa`.

A validação mantém a ordem existente: payload, estação e faixa do timestamp. Também atualiza os testes, o exemplo do OpenAPI e o README do fluxo de ingestão.

### Link da Tarefa

- [ELEM-166](https://elementares-4sem.atlassian.net/browse/ELEM-166)

### Tipo de Mudança

- [x] Nova funcionalidade
- [ ] Correção de bug
- [ ] Refatoração
- [x] Documentação
- [ ] Configuração / Infraestrutura

### Como Testar

Na raiz do repositório:

1. Rode o lint e o build do serviço:

   ```bash
   cd services/ingestao-dados
   npm run lint
   npm run build
   ```

2. Rode os testes unitários relacionados à mudança:

   ```bash
   npx jest --runInBand \
     src/tests/services/validar-estacao.service.test.ts \
     src/tests/services/processar-mensagem.service.test.ts \
     src/tests/repositories/estacao.repository.test.ts
   ```

3. Para executar a integração com PostgreSQL, configure `STAGING_TEST_DATABASE_URL` apontando para um banco de teste e rode:

   ```bash
   npx jest --runInBand src/tests/integration/staging.integration.test.ts
   ```

4. Para validar a regressão da US-21, configure o ambiente Docker conforme `tests/fluxo-ingestao/README.md` e execute, na raiz:

   ```bash
   scripts/teste-fluxo-ingestao.sh
   ```

   O teste deve terminar com diferença `0`.

### Checklist

- [x] Código testado localmente
- [x] Sem erros de lint ou build
- [x] Testes unitários focados passando (42 testes)
- [x] Documentação atualizada (OpenAPI e README do fluxo)

> A integração PostgreSQL e a regressão ponta a ponta da US-21 ainda não foram executadas neste ambiente.
