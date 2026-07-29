import { PERIODS } from '../hooks/useInfluxHistory';

// Export do histórico do InfluxDB em CSV.
//
// Formato pt-BR de propósito: separador ';' e decimal ',', que é o que o Excel
// em português espera. Com vírgula/ponto o duplo clique jogaria tudo numa
// coluna só e os números viriam como texto. O BOM faz o Excel ler UTF-8 e não
// quebrar os acentos do cabeçalho.
//
// Ao contrário do gráfico, aqui NÃO há aggregateWindow: o gráfico agrega para
// conseguir renderizar 30d, mas um export deve entregar a leitura real gravada,
// não a média da janela.

const ORG = import.meta.env.VITE_INFLUX_ORG;
const BUCKET = import.meta.env.VITE_INFLUX_BUCKET;

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

/** CSV a partir das linhas pivotadas do Influx. */
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

/** Converte o CSV anotado do Influx (já pivotado) em objetos. */
function parsePivoted(csv) {
  const lines = csv.trim().split('\n').filter(l => l && !l.startsWith('#'));
  if (lines.length < 2) return [];

  const header = lines[0].split(',').map(h => h.trim());
  const iTime = header.indexOf('_time');
  if (iTime === -1) return [];
  const idx = Object.fromEntries(COLUMNS.map(c => [c, header.indexOf(c)]));

  const out = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const time = new Date(cols[iTime]);
    if (Number.isNaN(time.getTime())) continue;
    const row = { time };
    for (const c of COLUMNS) row[c] = idx[c] === -1 ? '' : cols[idx[c]];
    out.push(row);
  }
  return out;
}

/**
 * Busca o histórico bruto do período e devolve o CSV pronto.
 * @param {string} period    chave de PERIODS (mesma janela do gráfico)
 * @param {string} deviceId  deviceId da FLEET (ex: esp_sururu)
 * @param {string} boiaId    id da bóia para a coluna boia_id (ex: SM-01)
 */
export async function fetchHistoryCsv(period, deviceId, boiaId) {
  const cfg = PERIODS[period];
  if (!cfg) throw new Error(`Período desconhecido: ${period}`);

  // A coluna boia_id vem da FLEET, não da tag boia_id do Influx: a tag só
  // passou a ser gravada em 17/07, então o histórico anterior viria em branco.
  const flux = `
from(bucket: "${BUCKET}")
  |> range(start: ${cfg.start})
  |> filter(fn: (r) => r._measurement == "sensores")
  ${deviceId ? `|> filter(fn: (r) => r.topic == "${deviceId}/sensores")` : ''}
  |> filter(fn: (r) => ${COLUMNS.map(c => `r._field == "${c}"`).join(' or ')})
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> keep(columns: ["_time", ${COLUMNS.map(c => `"${c}"`).join(', ')}])
  |> sort(columns: ["_time"])`;

  const res = await fetch(`/influx/api/v2/query?org=${encodeURIComponent(ORG)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/vnd.flux',
      Accept: 'application/csv',
    },
    body: flux,
  });
  if (!res.ok) throw new Error(`Influx ${res.status}: ${await res.text()}`);

  const rows = parsePivoted(await res.text());
  return { csv: buildCsv(rows, boiaId), rows: rows.length };
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
