// Consultas InfluxQL NOMEADAS do histórico. O proxy público (/influx/q/<nome>,
// infra/nginx/sentinela-influx-proxy.conf) não aceita `q` livre: cada endpoint é
// um modelo fixo preenchido só com parâmetros validados. Este módulo espelha
// esses modelos para o proxy de desenvolvimento do Vite (vite.config.js); se um
// mudar, o outro muda junto (o teste influxQueries.parity.test.js falha se divergirem). Sem dependências do navegador: roda no Node do Vite.

const CAMPOS = ['ph', 'turbidez', 'temperatura'];
// every = janela do GROUP BY time(); fonte única das janelas: PERIODS (useInfluxHistory.js) deriva daqui
export const EVERY = { '1h': '30s', '24h': '10m', '7d': '1h', '30d': '6h' };
const PERIODOS_ULTIMAS = ['24h', '30d'];
// sem aspas, barra nem contrabarra: dispensa escape no modelo
// 30 dias a 5 s = 518 mil linhas; o teto protege o InfluxDB de um topic inflado de fora
export const EXPORT_LIMIT = 600000;
// últimas leituras brutas por device (consulta ultimas)
export const ULTIMAS_LIMIT = 50;
export const DEVICE_RE = /^[A-Za-z0-9_-]{1,40}$/;
// Janelas por data (ana, turbidez-janela): `inicio` é a data local de Maceió (UTC-3, sem DST)
// e vira o literal 'AAAA-MM-DDT03:00:00Z'; `duracao` => intervalo do GROUP BY time().
// 180d usa time(6h,3h): o offset alinha os baldes de 6 h ao dia local (00h, 06h, 12h, 18h).
export const DURACOES = { '7d': '15m', '30d': '1h', '90d': '3h', '180d': '6h,3h' };
export const ESTACOES_ANA = ['39770000', '39760000', '39740000', '39700000', '39800100'];
export const INICIO_RE = /^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
// banco InfluxQL (db=) de cada consulta; o nginx fixa o mesmo db em cada proxy_pass
export const QUERY_DB = {
  history: 'iot', ultimas: 'iot', 'leituras-24h': 'iot', primeira: 'iot', export: 'iot',
  ana: 'externos', 'turbidez-janela': 'iot',
};

function pick(value, allowed, name) {
  if (!allowed.includes(value)) throw new Error(`parâmetro inválido: ${name}`);
  return value;
}

function deviceTopic(device) {
  if (typeof device !== 'string' || !DEVICE_RE.test(device)) {
    throw new Error('parâmetro inválido: device');
  }
  return `'${device}/sensores'`;
}

function janela(params) {
  const { inicio } = params;
  if (typeof inicio !== 'string' || !INICIO_RE.test(inicio)) throw new Error('parâmetro inválido: inicio');
  const duracao = pick(params.duracao, Object.keys(DURACOES), 'duracao');
  const t0 = `'${inicio}T03:00:00Z'`;
  return { cond: `time >= ${t0} AND time < ${t0} + ${duracao}`, every: DURACOES[duracao] };
}

/** Nomes aceitos por buildNamedQuery. */
export const QUERY_NAMES = ['history', 'ultimas', 'leituras-24h', 'primeira', 'export', 'ana', 'turbidez-janela'];

/**
 * Monta o InfluxQL de uma consulta nomeada.
 * @param {string} name   um de QUERY_NAMES
 * @param {object} params history: {campo, periodo, device?}; ultimas: {device, periodo};
 *                        export: {device, periodo}; leituras-24h e primeira: {};
 *                        ana: {estacao, inicio, duracao}; turbidez-janela: {device, inicio, duracao}
 * @returns {string} InfluxQL
 * @throws {Error} nome ou parâmetro inválido
 */
export function buildNamedQuery(name, params = {}) {
  switch (name) {
    case 'history': {
      const campo = pick(params.campo, CAMPOS, 'campo');
      const periodo = pick(params.periodo, Object.keys(EVERY), 'periodo');
      const dev = params.device == null || params.device === ''
        ? ''
        : ` AND "topic" = ${deviceTopic(params.device)}`;
      return `SELECT mean("${campo}") FROM "sensores" WHERE time > now() - ${periodo}${dev} ` +
        `GROUP BY time(${EVERY[periodo]}) fill(none)`;
    }
    case 'ultimas': {
      const topic = deviceTopic(params.device);
      const periodo = pick(params.periodo, PERIODOS_ULTIMAS, 'periodo');
      return `SELECT "turbidez","ph","temperatura" FROM "sensores" WHERE "topic" = ${topic} ` +
        `AND time > now() - ${periodo} ORDER BY time DESC LIMIT ${ULTIMAS_LIMIT}`;
    }
    case 'leituras-24h':
      return 'SELECT count("ph") FROM "sensores" WHERE time > now() - 24h';
    case 'primeira':
      return 'SELECT first("ph") FROM "sensores"';
    case 'export': {
      const topic = deviceTopic(params.device);
      const periodo = pick(params.periodo, Object.keys(EVERY), 'periodo');
      return `SELECT "temperatura","ph","turbidez" FROM "sensores" WHERE "topic" = ${topic} ` +
        `AND time > now() - ${periodo} ORDER BY time DESC LIMIT ${EXPORT_LIMIT}`;
    }
    case 'ana': {
      const estacao = pick(params.estacao, ESTACOES_ANA, 'estacao');
      const { cond, every } = janela(params);
      return 'SELECT sum("chuva") AS "chuva", mean("vazao") AS "vazao", mean("nivel") AS "nivel" ' +
        `FROM "ana_telemetria" WHERE "estacao" = '${estacao}' AND ${cond} GROUP BY time(${every}) fill(none)`;
    }
    case 'turbidez-janela': {
      const topic = deviceTopic(params.device);
      const { cond, every } = janela(params);
      return `SELECT mean("turbidez") FROM "sensores" WHERE "topic" = ${topic} AND ${cond} ` +
        `GROUP BY time(${every}) fill(none)`;
    }
    default:
      throw new Error(`consulta desconhecida: ${name}`);
  }
}
