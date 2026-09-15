# Documentação das APIs Elementares

O Swagger UI reúne os sete microsserviços em uma página. Cada serviço mantém seu contrato OpenAPI em `src/docs/openapi.json` e o publica em `GET /openapi.json`.

## Estrutura analisada

Comparação feita em 14/09/2026, nos commits abaixo:

| Branch | Commit | Situação da infraestrutura |
| --- | --- | --- |
| `develop` | [90a4bf3](https://github.com/ELEMENTARES-DSM/BACKEND-4SEMESTRE/tree/90a4bf3353c1bb14ae8c5d9576e5c8c47152408a) | Dev Container configurado; Compose, Nginx e Dockerfiles vazios. |
| `feature/QA` | [2552196](https://github.com/ELEMENTARES-DSM/BACKEND-4SEMESTRE/tree/25521960c659f9289be6f0e82b33353b38c037bf) | Mesma estrutura de `develop`; acrescenta `sonar-project.properties`. |
| `feature/deploy-automatico` | [a28d913](https://github.com/ELEMENTARES-DSM/BACKEND-4SEMESTRE/tree/a28d913035d6c33975d788d2e0407047c729038c) | Compose de desenvolvimento e produção, Dockerfiles, gateway Nginx e workflow de deploy implementados. Não contém o Dev Container. |

Esta integração usa **`feature/deploy-automatico` como base**. Para levá-la a `develop`, integre também a infraestrutura dessa branch pelo fluxo de revisão do projeto. Ao reconciliar as branches, revise a remoção de `.devcontainer/` e do template de pull request presente na branch de deploy.

`feature/QA` configura análise de código; os arquivos atuais não definem um ambiente de homologação separado. Se houver uma implantação de homologação, ela pode usar o mesmo caminho `/docs/` em seu próprio domínio.

## Onde cada arquivo fica

| Arquivo | Responsabilidade |
| --- | --- |
| `docker-compose.yml` | Executa o Swagger UI em `localhost:8080` junto aos serviços de desenvolvimento. |
| `docker-compose.prod.yml` | Executa o Swagger UI na rede interna `app-network`. |
| `nginx.conf` | Encaminha `/docs/` ao Swagger UI e mantém os prefixos das APIs. |
| `services/<serviço>/src/docs/openapi.json` | Descreve as operações, respostas e exemplos daquele serviço. |
| `services/<serviço>/src/app.ts` | Publica o contrato e habilita CORS quando configurado para desenvolvimento. |

A imagem utilizada é `swaggerapi/swagger-ui:v5.32.15`, com o seletor oficial de múltiplos contratos (`URLS`).

## Executar localmente

Na raiz do repositório, prepare o `.env` a partir de `.env.example` caso ele ainda não exista. Preencha as variáveis de PostgreSQL, RabbitMQ e JWT conforme a configuração do projeto. `DOCKERHUB_USER` é usado no Compose de produção.

```bash
docker compose config --quiet
docker compose up -d --build
```

Abra **http://localhost:8080**. Selecione **Autenticação**, abra **GET /health** e clique em **Try it out → Execute**.

O Swagger enviará `GET http://localhost:3001/health`. A resposta esperada é HTTP `200` com:

```json
{ "status": "ok" }
```

O bloco **Example Value** mostra o exemplo escrito no contrato. O bloco **Server response**, exibido após a execução, mostra a resposta da API em funcionamento.

Em **Gestão de estações**, a mesma operação usa `http://localhost:3004/health`. Isso demonstra a troca de serviço pelo seletor mantendo a documentação centralizada.

## Portas e caminhos reais

| Serviço | Porta publicada localmente | Base pública em produção | Contrato em produção |
| --- | --- | --- | --- |
| `auth-service` | `3001` | `/auth` | `/auth/openapi.json` |
| `alertas-notificacoes` | `3002` | `/alertas` | `/alertas/openapi.json` |
| `analise-dados` | `3003` | `/analise` | `/analise/openapi.json` |
| `gestao-estacoes` | `3004` | `/estacoes` | `/estacoes/openapi.json` |
| `ingestao-dados` | `3005` | `/ingestao` | `/ingestao/openapi.json` |
| `servico-relatorios` | `3006` | `/relatorios` | `/relatorios/openapi.json` |
| `servico-validacao` | `3007` | `/validacao` | `/validacao/openapi.json` |

Todos os microsserviços escutam na porta **3000 dentro dos containers**. O Swagger UI escuta em **8080**. No desenvolvimento, essa porta é publicada no host; em produção, o navegador acessa **http://seu-dominio/docs/** pelo Nginx já publicado na porta **80**. Se a infraestrutura oferecer HTTPS, o mesmo caminho funciona sob esse endereço.

O Nginx remove o prefixo ao encaminhar a requisição: `/auth/health` chega ao serviço como `/health`. Por isso os contratos mantêm `/health` em `paths`, e `PUBLIC_API_URL` define a base pública de cada ambiente.

| Configuração nas APIs | Desenvolvimento | Produção |
| --- | --- | --- |
| `PUBLIC_API_URL` | Ex.: `http://localhost:3001` | Ex.: `/auth` |
| `SWAGGER_UI_ORIGIN` | `http://localhost:8080` | Não é necessária para o acesso pelo mesmo Nginx. |

Os endereços usados pelo Swagger precisam ser acessíveis **pelo navegador**. Os nomes como `auth-service:3000` são usados pelo Nginx dentro da rede Docker. Se mudar o acesso local para outro host ou porta, ajuste `URLS`, `PUBLIC_API_URL` e `SWAGGER_UI_ORIGIN` em conjunto.

## Publicação no fluxo existente

O workflow atual de deploy constrói as sete imagens, envia `docker-compose.prod.yml` e `nginx.conf` ao servidor e executa `pull` seguido de `up -d`. Ele é acionado por push em `main` ou manualmente; um push na branch da funcionalidade não aciona automaticamente a publicação.

Os contratos ficam dentro de `src/`, são importados pelo TypeScript e passam para `dist/docs/` no build. Assim, os Dockerfiles atuais já os incluem nas imagens. A implantação deve conter **as imagens reconstruídas e os dois arquivos de infraestrutura atualizados**. Atualizar somente o Compose deixaria `/openapi.json` ausente nas imagens antigas.

## Manter a documentação

O arquivo de autenticação já contém um exemplo completo para a rota existente: descrição, `operationId`, resposta `200`, schema e exemplo `{ "status": "ok" }`.

Para documentar uma nova rota implementada, edite `services/<serviço>/src/docs/openapi.json`: acrescente a operação em `paths`, seus parâmetros ou `requestBody` quando houver, e os status realmente retornados em `responses`. Os schemas compartilhados ficam em `components.schemas`. Registre o caminho interno do serviço; o prefixo do gateway é definido por `PUBLIC_API_URL`.

A documentação é mantida explicitamente no contrato. Adicionar uma rota ao Express não a adiciona automaticamente ao Swagger. Em desenvolvimento, reinicie o serviço após alterar o JSON e atualize a página; em produção, reconstrua e publique a imagem.

Para validar os sete contratos, com Node.js 24 ou superior:

```bash
npm ci --prefix docs
npm run validate --prefix docs
```

Nas três branches analisadas, `GET /health` é a única operação de aplicação implementada por serviço. Ela confirma que o processo HTTP responde; não verifica PostgreSQL ou RabbitMQ. Esta integração também acrescenta `GET /openapi.json` para publicar a documentação. Rotas de negócio devem ser acrescentadas aos contratos conforme forem implementadas.

## Usar com Postman e Insomnia

Você pode importar a URL `http://localhost:3001/openapi.json` ou o arquivo `services/auth-service/src/docs/openapi.json` como OpenAPI. Pelo servidor de produção, use o endereço completo, como `https://seu-dominio/auth/openapi.json`, e confira a base da API após a importação. Os caminhos de produção são relativos ao domínio.

O contrato é a descrição compartilhada; Swagger UI, Postman e Insomnia podem consumi-lo. Reimporte a especificação quando precisar atualizar uma cópia importada.

## Referências

- [Branch develop no commit analisado](https://github.com/ELEMENTARES-DSM/BACKEND-4SEMESTRE/tree/90a4bf3353c1bb14ae8c5d9576e5c8c47152408a)
- [Branch QA no commit analisado](https://github.com/ELEMENTARES-DSM/BACKEND-4SEMESTRE/tree/25521960c659f9289be6f0e82b33353b38c037bf)
- [Branch de deploy no commit usado como base](https://github.com/ELEMENTARES-DSM/BACKEND-4SEMESTRE/tree/a28d913035d6c33975d788d2e0407047c729038c)
- [Swagger UI: imagem Docker e instalação](https://swagger.io/docs/open-source-tools/swagger-ui/usage/installation/)
- [Swagger UI: múltiplos contratos e configuração](https://swagger.io/docs/open-source-tools/swagger-ui/usage/configuration/)
- [Swagger UI: CORS](https://swagger.io/docs/open-source-tools/swagger-ui/usage/cors/)
- [Nginx: comportamento de proxy_pass](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass)
- [TypeScript: resolveJsonModule](https://www.typescriptlang.org/tsconfig/resolveJsonModule.html)
- [Postman: importar uma especificação](https://learning.postman.com/docs/design-apis/specifications/import-a-specification/)
- [Insomnia: importar e exportar](https://developer.konghq.com/insomnia/import-export/)
