import { useState, useEffect } from 'react';

// Leituras gravadas no InfluxDB nas últimas 24h, somando todas as bóias.
// Conta um campo (ph) por mensagem de /sensores — cada publicação do firmware
// é uma leitura. Mesmo proxy /influx do useInfluxHistory (token no servidor).

const ORG = import.meta.env.VITE_INFLUX_ORG;
const BUCKET = import.meta.env.VITE_INFLUX_BUCKET;

/** Extrai o `_value` da única linha de um count() agrupado (CSV anotado). */
export function parseCountCsv(csv) {
  const linhas = String(csv).trim().split('\n').filter(l => l && !l.startsWith('#'));
  if (linhas.length < 2) return 0; // sem série na janela = nenhuma leitura
  const header = linhas[0].split(',').map(h => h.trim());
  const iValue = header.indexOf('_value');
  if (iValue === -1) return null;
  const n = Number(linhas[1].split(',')[iValue]);
  return Number.isFinite(n) ? n : null;
}

/** @returns {{leituras: number|null, carregando: boolean}} null = falhou */
export function useLeiturasDia() {
  const [state, setState] = useState({ leituras: null, carregando: true });

  useEffect(() => {
    const ctrl = new AbortController();
    const flux = `
from(bucket: "${BUCKET}")
  |> range(start: -24h)
  |> filter(fn: (r) => r._measurement == "sensores" and r._field == "ph")
  |> group()
  |> count()`;

    (async () => {
      try {
        const res = await fetch(`/influx/api/v2/query?org=${encodeURIComponent(ORG)}`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/vnd.flux', Accept: 'application/csv' },
          body: flux,
        });
        if (!res.ok) throw new Error(`Influx ${res.status}`);
        setState({ leituras: parseCountCsv(await res.text()), carregando: false });
      } catch (err) {
        if (err.name !== 'AbortError') setState({ leituras: null, carregando: false });
      }
    })();
    return () => ctrl.abort();
  }, []);

  return state;
}
