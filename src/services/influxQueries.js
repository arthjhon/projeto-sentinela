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

/** Nomes aceitos por buildNamedQuery. */
export const QUERY_NAMES = ['history', 'ultimas', 'leituras-24h', 'primeira', 'export'];

/**
 * Monta o InfluxQL de uma consulta nomeada.
 * @param {string} name   um de QUERY_NAMES
 * @param {object} params history: {campo, periodo, device?}; ultimas: {device, periodo};
 *                        export: {device, periodo}; leituras-24h e primeira: {}
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
    default:
      throw new Error(`consulta desconhecida: ${name}`);
  }
}
