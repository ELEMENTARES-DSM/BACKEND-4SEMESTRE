# Monitoramento do Pulso Urbano

Prometheus (coleta e alertas) + Grafana (painéis) + coletores, em um compose separado do da aplicação.

## Como subir

1. Suba o backend antes: `docker compose up -d --build` (na raiz).
2. No `.env` da raiz, preencha `GRAFANA_PASSWORD` (e, se quiser, `GRAFANA_USER`). Se a pasta do projeto não se chamar `BACKEND-4SEMESTRE`, ajuste também `APP_NETWORK` (`<pasta-em-minusculas>_app-network`; confira com `docker network ls`).
3. Na raiz do repositório:
   ```
   docker compose -f monitoramento/docker-compose.monitoring.yml --env-file .env up -d
   ```

Para parar: o mesmo comando com `down` no lugar de `up -d` (sem `-v`, para não perder o histórico).

## URLs

| O que | Endereço |
| --- | --- |
| Grafana (painel "Pulso Urbano - Saúde da Plataforma") | http://localhost:3001 |
| Prometheus (alvos) | http://localhost:9090/targets |
| Prometheus (alertas) | http://localhost:9090/alerts |

## Testar o alerta

```
docker stop backend-4semestre-servico-relatorios-1
# ~1,5 min depois: o painel mostra 7/8 serviços e o alerta ServicoFora fica Firing
docker start backend-4semestre-servico-relatorios-1
# o painel volta a 8/8 e o alerta some
```

## Painéis "por container" vazios?

Se o Docker Desktop usa o "containerd image store", o cAdvisor não informa o nome dos containers.
Esses painéis ficam vazios e o alerta `ContainerReiniciando` não dispara.
Solução: Docker Desktop > Settings > General > desmarcar "Use containerd for pulling and storing images" > Apply & restart.
Depois, as imagens precisam ser baixadas/construídas de novo (`docker compose up -d --build`); os volumes de dados continuam.
