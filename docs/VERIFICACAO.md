# Verificação da integração Swagger

Data: 14/09/2026. Base: `feature/deploy-automatico`, commit `a28d913035d6c33975d788d2e0407047c729038c`.

| Verificação executada | Resultado |
| --- | --- |
| Comparação entre `develop` e `feature/QA` | Apenas `sonar-project.properties` acrescentado na QA. |
| Instalação do validador com `npm ci --prefix docs` | Concluída a partir do lockfile; scripts de instalação desativados nesta verificação. |
| `npm run validate --prefix docs` | Sete contratos OpenAPI válidos, com uma operação de aplicação por serviço. |
| TypeScript 5.9.3 com o `tsconfig.json` de cada serviço | Compilação dos sete serviços concluída. |
| Conteúdo de `dist/docs/openapi.json` | Os sete JSONs foram incluídos no build e conferem com os arquivos de origem. |
| Requisições HTTP às aplicações compiladas | `/health` e `/openapi.json` retornaram `200` nos sete serviços. |
| Resposta documentada de `/health` | O exemplo `{ "status": "ok" }` corresponde à resposta real. |
| CORS no desenvolvimento | Cabeçalhos presentes no contrato e em `/health`; preflight com `Authorization` retornou `204`. |
| Base da API por ambiente | URLs locais, prefixos de produção e fallback de `PORT` conferidos. |
| Arquivos Compose | YAML válido; sete entradas em `URLS`, portas e rede conferidas. Configurações anteriores preservadas ao descontar as adições do Swagger. |
| Nginx | Revisão estática dos prefixos existentes e do novo encaminhamento `/docs/`. |
| Swagger UI 5.32.15 | Assets oficiais usam caminhos relativos, compatíveis com o proxy que remove `/docs/`. Tag da imagem confirmada no registro público. |
| `git diff --check` | Sem erros de whitespace. |

O manifesto público consultado para `swaggerapi/swagger-ui:v5.32.15` retornou o digest `sha256:9ae209e3791e6fa78e1426769bf54562a043caa969287bfd3779428ece4930e5`.

As verificações HTTP executaram as aplicações Express reais em Node.js 24, usando portas temporárias. Para a compilação, foram utilizadas as dependências necessárias aos fontes atuais em um diretório temporário: TypeScript 5.9.3, Express 5.2.1, CORS 2.8.6 e suas tipagens. As dependências dos microsserviços e seus lockfiles não foram alterados.

**Docker e Nginx não estão instalados no ambiente desta verificação.** Portanto, o build das imagens, `docker compose config`, a inicialização completa dos containers e o acesso ao Swagger pelo gateway não foram executados aqui. A compilação realizada usou Node.js 24; os Dockerfiles do projeto usam Node.js 22.

## Conferência no ambiente do projeto

Com o `.env` configurado, na raiz do repositório:

```bash
docker compose config --quiet
docker compose up -d --build
curl --fail http://localhost:3001/openapi.json
curl --fail http://localhost:3001/health
```

Abra `http://localhost:8080`, selecione **Autenticação** e execute **GET /health**. Confirme a URL da requisição e a resposta `200`. Troque para **Gestão de estações** e confirme que a URL usa a porta `3004`.

Após a implantação pelo fluxo do projeto, a conferência do gateway no servidor pode ser feita com:

```bash
docker compose -f docker-compose.prod.yml exec nginx nginx -t
```

No navegador, abra `/docs/` pelo endereço público e execute `/health` de cada serviço. Em autenticação, a URL deve terminar em `/auth/health`; o contrato deve estar em `/auth/openapi.json`. Essa etapa confirma o funcionamento conjunto das imagens e do proxy no ambiente de destino.
