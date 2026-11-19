import { PERIODS } from '../hooks/useInfluxHistory';
import { EXPORT_LIMIT } from '../services/influxQueries';
import { fetchNamedPerDevice, rowsOf } from '../services/influxql';

// Export do histórico do InfluxDB em CSV.
//
// Formato pt-BR de propósito: separador ';' e decimal ',', que é o que o Excel
// em português espera. Com vírgula/ponto o duplo clique jogaria tudo numa
// coluna só e os números viriam como texto. O BOM faz o Excel ler UTF-8 e não
// quebrar os acentos do cabeçalho.
//
// Ao contrário do gráfico, aqui NÃO há agregação (GROUP BY time): o gráfico agrega para
// conseguir renderizar 30d, mas um export deve entregar a leitura real gravada,
// não a média da janela.

const COLUMNS = ['temperatura', 'ph', 'turbidez'];

/** Número no padrão pt-BR (decimal com vírgula), vazio se ausente. */
function num(value) {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (Number.isNaN(n)) return '';
  return String(n).replace('.', ',');
}

/** Escapa campo de CSV: aspas se contiver ';', aspas ou quebra de linha. */
function field(value) {
  const s = String(value ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * dd/MM/yyyy HH:mm:ss montado à mão, e não via toLocaleString('pt-BR'):
 * o locale insere vírgula entre data e hora ("17/07/2026, 06:16:47") e o
 * Excel deixa de reconhecer o campo como data/hora — que é justamente o
 * motivo de usarmos formato pt-BR aqui.
 */
function timestampBr(date) {
  const p = n => String(n).padStart(2, '0');
  return `${p(date.getDate())}/${p(date.getMonth() + 1)}/${date.getFullYear()} ` +
         `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

/** CSV a partir das linhas do Influx ({time, temperatura, ph, turbidez}). */
export function buildCsv(rows, boiaId) {
  const header = ['timestamp', 'boia_id', ...COLUMNS];
  const lines = [header.join(';')];

  for (const r of rows) {
    // pt-BR (17/07/2026 06:16:47) e não ISO: o Excel pt-BR reconhece este
    // formato como data/hora; o ISO com Z ele trata como texto.
    lines.push([
      field(timestampBr(r.time)),
      field(boiaId ?? ''),
      ...COLUMNS.map(c => num(r[c])),
    ].join(';'));
  }
  return lines.join('\r\n');
}

/** Série de export -> linhas {time: Date, temperatura, ph, turbidez} (vazio se ausente). */
export function mapExportSeries(series) {
  return rowsOf(series)
    .map(r => ({
      time: new Date(r.time),
      temperatura: r.temperatura ?? '',
      ph: r.ph ?? '',
      turbidez: r.turbidez ?? '',
    }))
    .filter(r => !Number.isNaN(r.time.getTime()));
}

/**
 * Junta as linhas de export de vários seriais (cada lista do mais novo para o
 * mais antigo, como o servidor devolve) em ordem cronológica.
 */
export function mergeExportRows(lists) {
  return lists.flat().sort((a, b) => a.time - b.time);
}

/**
 * Busca o histórico bruto do período e devolve o CSV pronto.
 * Uma consulta `export` por serial válido da bóia (atual + anteriores), em
 * sequência (o nginx atende 1 export por vez); linhas unidas em ordem
 * cronológica. `truncated` = o servidor atingiu EXPORT_LIMIT em ALGUM serial:
 * há leituras mais ANTIGAS dele fora do arquivo (o servidor entrega as mais recentes).
 * Não há export da frota: `null` (sem bóia) é erro; bóia sem serial válido = 0 linhas, sem consulta.
 * @param {string} period    chave de PERIODS (mesma janela do gráfico)
 * @param {string|string[]|null} deviceIds  deviceId atual (+ anteriores, ver deviceIdsOf)
 * @param {string} boiaId    id da bóia para a coluna boia_id (ex: SM-01)
 * @returns {Promise<{csv: string, rows: number, truncated: boolean}>}
 */
export async function fetchHistoryCsv(period, deviceIds, boiaId) {
  if (!PERIODS[period]) throw new Error(`Período desconhecido: ${period}`);
  if (deviceIds == null) throw new Error('Selecione uma bóia para exportar.');

  // A coluna boia_id vem da FLEET, não da tag boia_id do Influx: a tag só
  // passou a ser gravada em 17/07, então o histórico anterior viria em branco.
  // O servidor devolve do mais novo para o mais antigo (ORDER BY time DESC, para que o
  // LIMIT corte as leituras antigas); o CSV sai em ordem cronológica.
  const perId = (await fetchNamedPerDevice('export', { periodo: period }, deviceIds)).map(mapExportSeries);
  const rows = mergeExportRows(perId);
  const truncated = perId.some(list => list.length >= EXPORT_LIMIT);
  return { csv: buildCsv(rows, boiaId), rows: rows.length, truncated };
}

// Byte order mark. Escapado (e não o caractere literal, que é invisível no
// editor): sem ele o Excel abre o arquivo como latin-1 e quebra os acentos.
const BOM = '\uFEFF';

/** Dispara o download no navegador. */
export function downloadCsv(csv, filename) {
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
