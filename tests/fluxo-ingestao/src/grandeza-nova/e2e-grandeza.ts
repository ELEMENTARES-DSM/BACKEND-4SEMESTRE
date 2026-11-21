// Teste ponta a ponta da US-39: coloca uma grandeza nova (Direção do Vento) no ar
// em uma estação de teste, do cadastro à medida gravada. É o roteiro da seção 10
// do plano da US-39, automatizado:
//
//   1. o catálogo traz Direção do Vento (°, 0 a 360, média circular);
//   2. leitura publicada ANTES do cadastro do sensor vai para a validacao.dlq;
//   3. o Administrador cadastra o sensor com o mesmo código que a placa envia;
//   4. o reenvio da DLQ grava a medida 270,00, válida;
//   5. valor 400 é gravado como inválido, sem alarme;
//   6. sensor em Kelvin (offset -273,15): bruto 300 vira 26,85 e fica válido;
//   7. código repetido na mesma estação responde 409;
//   8. grandeza em uso não sai do catálogo (409); grandeza nunca usada sai (204).
//
// Roda contra o Docker Compose no ar (scripts/teste-grandeza-nova.sh monta o
// ambiente). Variáveis: DATABASE_URL, RABBITMQ_URL, JWT_SECRET, SIMULADOR_USER,
// SIMULADOR_PASSWORD, BACKEND_RAIZ (pasta do compose) e, opcionais, GATEWAY_URL
// (padrão http://localhost) e E2E_ESTACAO (padrão TF-10, da semente do teste de fluxo).
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import amqp from "amqplib";
import pg from "pg";
import { espiarDlq } from "../destinos.js";
import {
  assinarJwt,
  esperarAte,
  eventoRecusadoDoSensor,
  payloadTelemetria,
  topicoTelemetria,
  type EventoDlqRecusado,
} from "./roteiro.js";

function exigir(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    console.error(`Defina ${nome}. Use scripts/teste-grandeza-nova.sh, que monta o ambiente.`);
    process.exit(2);
  }
  return valor;
}

const DATABASE_URL = exigir("DATABASE_URL");
const RABBITMQ_URL = exigir("RABBITMQ_URL");
const JWT_SECRET = exigir("JWT_SECRET");
const MQTT_USER = exigir("SIMULADOR_USER");
const MQTT_SENHA = exigir("SIMULADOR_PASSWORD");
const RAIZ = exigir("BACKEND_RAIZ");
const GATEWAY = (process.env.GATEWAY_URL ?? "http://localhost").replace(/\/+$/, "");
const ESTACAO = process.env.E2E_ESTACAO ?? "f1000000-0000-4000-8000-000000000010";
// MAC da estação de teste: o tópico da placa usa o MAC. Carregado no início do teste.
let macDaEstacao = "";

const GRANDEZA = "Direção do Vento";
const CODIGO_NOVO = "DIR-E2E";
const CODIGO_TEMPERATURA = "TEMP-01"; // da semente do teste de fluxo
const GRANDEZA_DESCARTAVEL = "E2E Grandeza Descartável";

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
pool.on("error", () => undefined);

const token = (): string =>
  assinarJwt({ id: randomUUID(), papel: "ADMINISTRADOR", municipio: "Teste Fluxo" }, JWT_SECRET);

interface Resposta {
  status: number;
  corpo: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function api(metodo: string, caminho: string, corpo?: unknown): Promise<Resposta> {
  const resposta = await fetch(`${GATEWAY}${caminho}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token()}`,
      ...(corpo === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await resposta.text();
  return { status: resposta.status, corpo: texto ? JSON.parse(texto) : undefined };
}

function esperar(condicao: boolean, mensagem: string): void {
  if (!condicao) {
    throw new Error(mensagem);
  }
}

/** Publica como a placa: mosquitto_pub dentro do contêiner do broker, na porta interna. */
function publicarMqtt(sensor: string, valor: number, unixtime: number): void {
  const resultado = spawnSync(
    "docker",
    [
      "compose", "--project-directory", RAIZ, "exec", "-T", "mosquitto",
      "mosquitto_pub", "-h", "127.0.0.1", "-p", "1883", "-u", MQTT_USER, "-P", MQTT_SENHA,
      "-t", topicoTelemetria(macDaEstacao), "-q", "1", "-m", payloadTelemetria(sensor, valor, unixtime),
    ],
    { encoding: "utf-8" },
  );
  if (resultado.status !== 0) {
    throw new Error(`mosquitto_pub falhou: ${resultado.stderr || resultado.stdout}`);
  }
}

async function dlq(): Promise<EventoDlqRecusado[]> {
  const conexao = await amqp.connect(RABBITMQ_URL);
  try {
    return (await espiarDlq(conexao)) as unknown as EventoDlqRecusado[];
  } finally {
    await conexao.close().catch(() => undefined);
  }
}

async function sensorId(codigo: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM sensores WHERE estacao_id = $1 AND codigo = $2",
    [ESTACAO, codigo],
  );
  return rows[0]?.id;
}

interface MedidaLida {
  valor: string;
  valida: boolean;
}

async function medida(codigo: string, unixtime: number): Promise<MedidaLida | undefined> {
  const { rows } = await pool.query<MedidaLida>(
    `SELECT m.valor::text AS valor, m.valida
     FROM medidas m JOIN sensores s ON s.id = m.sensor_id
     WHERE s.estacao_id = $1 AND s.codigo = $2 AND m.unixtime = $3`,
    [ESTACAO, codigo, unixtime],
  );
  return rows[0];
}

/** Deixa a estação como a semente a criou e tira o que o teste cadastrou. Pode rodar sempre. */
async function limpar(): Promise<void> {
  await pool.query(
    "DELETE FROM alarmes WHERE sensor_id IN (SELECT id FROM sensores WHERE estacao_id = $1 AND codigo = $2)",
    [ESTACAO, CODIGO_NOVO],
  );
  await pool.query(
    "DELETE FROM medidas WHERE sensor_id IN (SELECT id FROM sensores WHERE estacao_id = $1 AND codigo = $2)",
    [ESTACAO, CODIGO_NOVO],
  );
  await pool.query("DELETE FROM sensores WHERE estacao_id = $1 AND codigo = $2", [ESTACAO, CODIGO_NOVO]);
  await pool.query(
    `UPDATE sensores SET fator_conversao = 1, offset_calibracao = 0, unidade_leitura = NULL
     WHERE estacao_id = $1 AND codigo = $2`,
    [ESTACAO, CODIGO_TEMPERATURA],
  );
  await pool.query("DELETE FROM tipos_sensor WHERE nome = $1", [GRANDEZA_DESCARTAVEL]);
}

// Horários únicos por execução: estação e horário repetidos viram duplicata na ingestão.
const inicio = Math.floor(Date.now() / 1000);
let idDaGrandeza = "";

const passos: Array<[string, () => Promise<void>]> = [
  [
    "1. o catálogo traz Direção do Vento (°, 0 a 360, média circular)",
    async () => {
      const { status, corpo } = await api("GET", "/estacoes/tipos-sensor");
      esperar(status === 200, `GET tipos-sensor respondeu ${status}`);
      const grandeza = corpo.find((g: { nome: string }) => g.nome === GRANDEZA);
      esperar(grandeza !== undefined, `${GRANDEZA} não está no catálogo (as migrations rodaram?)`);
      esperar(
        grandeza.unidade === "°" && Number(grandeza.faixa_min) === 0 && Number(grandeza.faixa_max) === 360,
        `faixa inesperada: ${JSON.stringify(grandeza)}`,
      );
      esperar(grandeza.agregacao === "media_circular", `agregação inesperada: ${grandeza.agregacao}`);
      idDaGrandeza = grandeza.id;
    },
  ],
  [
    `2. leitura de ${CODIGO_NOVO} antes do cadastro do sensor vai para a DLQ`,
    async () => {
      publicarMqtt(CODIGO_NOVO, 270, inicio);
      const evento = await esperarAte(
        async () => eventoRecusadoDoSensor(await dlq(), ESTACAO, CODIGO_NOVO),
        `a leitura de ${CODIGO_NOVO} na validacao.dlq (Sensor inexistente na estação)`,
      );
      esperar(evento.motivo === "Sensor inexistente na estação", `motivo: ${evento.motivo}`);
      esperar((await sensorId(CODIGO_NOVO)) === undefined, "o sensor não deveria existir ainda");
    },
  ],
  [
    "3. o Administrador cadastra o sensor com o mesmo código da placa",
    async () => {
      const { status, corpo } = await api("POST", `/estacoes/estacoes/${ESTACAO}/sensores`, {
        codigo: CODIGO_NOVO,
        tipo: GRANDEZA,
      });
      esperar(status === 201, `cadastro do sensor respondeu ${status}: ${JSON.stringify(corpo)}`);
      esperar(corpo.unidade_medida === "°", `unidade do sensor: ${corpo.unidade_medida}`);
    },
  ],
  [
    "4. o reenvio da DLQ grava a medida 270,00, válida",
    async () => {
      const { status } = await api("POST", "/validacao/dlq/reenviar", {});
      esperar(status === 200, `reenvio da DLQ respondeu ${status}`);
      const gravada = await esperarAte(() => medida(CODIGO_NOVO, inicio), "a medida 270 do sensor novo em medidas");
      esperar(Number(gravada.valor) === 270 && gravada.valida, `medida: ${JSON.stringify(gravada)}`);
    },
  ],
  [
    "5. valor 400 é gravado como inválido, sem alarme",
    async () => {
      publicarMqtt(CODIGO_NOVO, 400, inicio + 1);
      const gravada = await esperarAte(() => medida(CODIGO_NOVO, inicio + 1), "a medida 400 em medidas");
      esperar(Number(gravada.valor) === 400 && !gravada.valida, `medida: ${JSON.stringify(gravada)}`);
      const id = await sensorId(CODIGO_NOVO);
      const { rows } = await pool.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM alarmes WHERE sensor_id = $1",
        [id],
      );
      esperar(rows[0].total === 0, `medida inválida abriu ${rows[0].total} alarme(s)`);
    },
  ],
  [
    "6. sensor em Kelvin: bruto 300 vira 26,85 e fica válido",
    async () => {
      const id = await sensorId(CODIGO_TEMPERATURA);
      esperar(id !== undefined, `a estação não tem o sensor ${CODIGO_TEMPERATURA} (rodou a semente?)`);
      const { status, corpo } = await api("PUT", `/estacoes/sensores/${id}`, {
        tipo: "Temperatura",
        unidade_leitura: "K",
        fator_conversao: 1,
        offset: -273.15,
      });
      esperar(status === 200, `PUT do sensor respondeu ${status}: ${JSON.stringify(corpo)}`);
      esperar(corpo.unidade_leitura === "K" && corpo.unidade_medida === "°C", `sensor: ${JSON.stringify(corpo)}`);

      publicarMqtt(CODIGO_TEMPERATURA, 300, inicio + 2);
      const gravada = await esperarAte(() => medida(CODIGO_TEMPERATURA, inicio + 2), "a medida em Kelvin em medidas");
      esperar(Number(gravada.valor) === 26.85 && gravada.valida, `medida: ${JSON.stringify(gravada)}`);
    },
  ],
  [
    "7. código repetido na mesma estação responde 409",
    async () => {
      const { status, corpo } = await api("POST", `/estacoes/estacoes/${ESTACAO}/sensores`, {
        codigo: CODIGO_TEMPERATURA,
        tipo: "Precipitação",
      });
      esperar(status === 409, `esperava 409, veio ${status}: ${JSON.stringify(corpo)}`);
      esperar(String(corpo.message).includes(CODIGO_TEMPERATURA), `mensagem: ${corpo.message}`);
    },
  ],
  [
    "8. grandeza em uso não sai do catálogo (409); grandeza nunca usada sai (204)",
    async () => {
      const emUso = await api("DELETE", `/estacoes/tipos-sensor/${idDaGrandeza}`);
      esperar(emUso.status === 409, `esperava 409, veio ${emUso.status}`);
      esperar(/usada por \d+ sensor/.test(String(emUso.corpo.message)), `mensagem: ${emUso.corpo.message}`);

      const criada = await api("POST", "/estacoes/tipos-sensor", {
        nome: GRANDEZA_DESCARTAVEL,
        unidade: "u",
        faixa_min: 0,
        faixa_max: 10,
      });
      esperar(criada.status === 201, `criação da grandeza respondeu ${criada.status}`);
      const apagada = await api("DELETE", `/estacoes/tipos-sensor/${criada.corpo.id}`);
      esperar(apagada.status === 204, `esperava 204, veio ${apagada.status}`);
    },
  ],
];

async function main(): Promise<number> {
  const { rows: macs } = await pool.query<{ mac_address: string | null }>(
    "SELECT mac_address FROM estacoes WHERE id = $1",
    [ESTACAO],
  );
  if (!macs[0]?.mac_address) {
    throw new Error(`Estação ${ESTACAO} sem MAC cadastrado: o tópico da placa não tem como ser montado.`);
  }
  macDaEstacao = macs[0].mac_address;

  await limpar();
  let falhou = false;

  try {
    for (const [titulo, passo] of passos) {
      try {
        await passo();
        console.log(`  ✔ ${titulo}`);
      } catch (erro) {
        falhou = true;
        console.error(`  ✖ ${titulo}\n      ${erro instanceof Error ? erro.message : String(erro)}`);
        break;
      }
    }
  } finally {
    await limpar().catch((erro) => console.error(`[limpeza] ${erro instanceof Error ? erro.message : erro}`));
    await pool.end();
  }

  console.log(falhou ? "== Teste da grandeza nova FALHOU." : "== Teste da grandeza nova passou.");
  return falhou ? 1 : 0;
}

process.exit(await main());
