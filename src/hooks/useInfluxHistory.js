import { useState, useEffect } from 'react';

// Histórico persistido no InfluxDB. Complementa (não substitui) o useMqtt:
// o MQTT segue entregando o tempo real; este hook traz o que já foi gravado.
//
// As chamadas vão para /influx/* — um proxy (vite.config.js em dev,
// nginx.conf em prod) que injeta o token só-leitura no lado servidor. O
// navegador nunca vê a credencial.

const ORG = import.meta.env.VITE_INFLUX_ORG;
const BUCKET = import.meta.env.VITE_INFLUX_BUCKET;

// Janelas do seletor. `every` controla a agregação: sem ela, 30d traria
// centenas de milhares de pontos e travaria o gráfico.
export const PERIODS = {
  '1h':  { label: '1h',  start: '-1h',  every: '30s' },
  '24h': { label: '24h', start: '-24h', every: '10m' },
  '7d':  { label: '7d',  start: '-7d',  every: '1h'  },
  '30d': { label: '30d', start: '-30d', every: '6h'  },
};

/** Converte o CSV anotado do Influx em linhas {time, value}. */
function parseCsv(csv) {
  const lines = csv.trim().split('\n').filter(l => l && !l.startsWith('#'));
  if (lines.length < 2) return [];

  const header = lines[0].split(',').map(h => h.trim());
  const iTime = header.indexOf('_time');
  const iValue = header.indexOf('_value');
  if (iTime === -1 || iValue === -1) return [];

  const out = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const raw = cols[iValue];
    // aggregateWindow com createEmpty:false ainda pode devolver célula vazia
    if (raw == null || raw === '') continue;
    const value = Number(raw);
    if (Number.isNaN(value)) continue;
    out.push({ time: new Date(cols[iTime]), value });
  }
  return out;
}

/**
 * Filtra por `topic`, e não pela tag `boia_id`, de propósito: boia_id só passou
 * a ser gravada quando foi adicionada ao telegraf.conf, então o histórico
 * anterior não a tem e sumiria do gráfico. `topic` existe em todo o histórico
 * (o mqtt_consumer sempre a grava) e é 1:1 com a bóia.
 *
 * @param {string} field     temperatura | ph | turbidez
 * @param {string} period    chave de PERIODS
 * @param {string} deviceId  deviceId da FLEET (ex: esp_sururu)
 */
export function useInfluxHistory(field, period, deviceId) {
  // Estado único: data/loading/error mudam sempre juntos, e agrupá-los evita
  // três renders por transição.
  const [state, setState] = useState({ data: [], loading: false, error: null });

  useEffect(() => {
    const cfg = PERIODS[period];
    if (!cfg || !field) return;

    const controller = new AbortController();

    const flux = `
from(bucket: "${BUCKET}")
  |> range(start: ${cfg.start})
  |> filter(fn: (r) => r._measurement == "sensores")
  |> filter(fn: (r) => r._field == "${field}")
  ${deviceId ? `|> filter(fn: (r) => r.topic == "${deviceId}/sensores")` : ''}
  |> aggregateWindow(every: ${cfg.every}, fn: mean, createEmpty: false)
  |> keep(columns: ["_time", "_value"])
  |> sort(columns: ["_time"])`;

    // A busca vive dentro desta função: setState no corpo do effect dispara
    // render em cascata (react-hooks/set-state-in-effect).
    async function run() {
      setState(s => ({ ...s, loading: true, error: null }));
      try {
        const res = await fetch(`/influx/api/v2/query?org=${encodeURIComponent(ORG)}`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/vnd.flux',
            Accept: 'application/csv',
          },
          body: flux,
        });
        if (!res.ok) throw new Error(`Influx ${res.status}: ${await res.text()}`);
        const csv = await res.text();
        setState({ data: parseCsv(csv), loading: false, error: null });
      } catch (err) {
        // abort é troca de período/desmontagem, não falha: o efeito seguinte
        // já está buscando a janela nova
        if (err.name === 'AbortError') return;
        setState(s => ({ ...s, loading: false, error: err.message }));
      }
    }
    run();

    return () => controller.abort();
  }, [field, period, deviceId]);

  return state;
}
