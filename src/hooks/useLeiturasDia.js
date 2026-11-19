import { useState, useEffect } from 'react';
import { fetchNamed } from '../services/influxql';

// Leituras gravadas no InfluxDB nas últimas 24h, somando todas as bóias.
// Conta um campo (ph) por mensagem de /sensores — cada publicação do firmware
// é uma leitura. Consulta nomeada /influx/q/leituras-24h (token no servidor).

/**
 * Lê o count da consulta leituras-24h ([time, count]). Sem série na janela
 * = nenhuma leitura (0); formato inesperado = null (falha, não zero).
 */
export function parseCount(series) {
  if (!series.length) return 0;
  const iCount = series[0].columns.indexOf('count');
  const raw = series[0].values[0]?.[iCount];
  if (iCount === -1 || raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** @returns {{leituras: number|null, carregando: boolean}} null = falhou */
export function useLeiturasDia() {
  const [state, setState] = useState({ leituras: null, carregando: true });

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const series = await fetchNamed('leituras-24h', {}, { signal: ctrl.signal });
        setState({ leituras: parseCount(series), carregando: false });
      } catch (err) {
        if (err.name !== 'AbortError') setState({ leituras: null, carregando: false });
      }
    })();
    return () => ctrl.abort();
  }, []);

  return state;
}
