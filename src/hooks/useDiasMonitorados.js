import { useState, useEffect } from 'react';
import { fetchNamed, rowsOf } from '../services/influxql';

// "Dias monitorados" (5.3): dias desde a PRIMEIRA leitura real gravada no InfluxDB.
// Antes, com o modo simulado ligado, contava desde uma "data de instalação" fixa em
// fleet.js (dado inventado); agora o número é sempre o real, ou "—" sem leitura.

const UM_DIA = 86_400_000;

function diasDesde(date) {
  if (!date || Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / UM_DIA));
}

/** Data da leitura mais antiga em uma série de first() ([time, first]); null se vazia. */
export function parsePrimeira(series) {
  let earliest = null;
  for (const row of rowsOf(series)) {
    const t = new Date(row.time);
    if (!Number.isNaN(t.getTime()) && (!earliest || t < earliest)) earliest = t;
  }
  return earliest;
}

/** Primeira leitura real gravada, via a consulta nomeada /influx/q/primeira. */
async function fetchPrimeiraLeitura(signal) {
  return parsePrimeira(await fetchNamed('primeira', {}, { signal }));
}

/**
 * @returns {{dias: number|null, carregando: boolean}}
 */
export function useDiasMonitorados() {
  const [real, setReal] = useState(null);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const primeira = await fetchPrimeiraLeitura(ctrl.signal);
        setReal(diasDesde(primeira));
      } catch (err) {
        if (err.name !== 'AbortError') setReal(null);
      }
    })();
    return () => ctrl.abort();
  }, []);

  return { dias: real, carregando: real === null };
}
