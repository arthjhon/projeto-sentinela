import { useCallback, useState } from 'react';
import { usePolling } from './usePolling';
import { fetchUltimasLeituras } from './useInfluxHistory';
import { criarFilaSerial } from '../utils/filaSerial';
import { deviceIdsOf } from '../utils/deviceIds';

/**
 * Últimas leituras gravadas (InfluxDB, até 30 dias) por bóia, só dos seriais dela:
 * a entrada que, junto do MQTT, define a conexão (conexaoDoRegistro). Uma consulta
 * por bóia, em sequência pela fila serial (limite de conexões do proxy), ao abrir e
 * a cada `pollMs`. `fila` pode ser repassada para dividir o limite com outras
 * consultas da tela (ex.: clima); sem ela, a tela ganha a sua.
 *
 * @returns {{ ultimas: Record<string, object[]>, erros: Record<string, string>,
 *   fila: Function, recarregar: (codigo: string) => Promise<void> }}
 *   `ultimas`: codigo -> linhas (mantém a última lida se uma rodada falha);
 *   `erros`: codigo -> mensagem da última falha (some no próximo sucesso).
 */
export function useUltimasLeituras(buoys, { pollMs = 60_000, fila: filaExterna } = {}) {
  const [filaPropria] = useState(criarFilaSerial);
  const fila = filaExterna ?? filaPropria;
  const [ultimas, setUltimas] = useState({});
  const [erros, setErros] = useState({});

  const carregar = useCallback(async (codigo, ids, { signal, isCurrent = () => true } = {}) => {
    try {
      const rows = await fila((sinal) => fetchUltimasLeituras(ids, { periodo: '30d', signal: sinal }), { signal });
      if (!isCurrent()) return;
      setUltimas((u) => ({ ...u, [codigo]: rows }));
      setErros((e) => { if (!(codigo in e)) return e; const { [codigo]: _drop, ...resto } = e; return resto; });
    } catch (err) {
      if (err.name === 'AbortError' || signal?.aborted || !isCurrent()) return;
      setErros((e) => ({ ...e, [codigo]: err.message }));
    }
  }, [fila]);

  const alvosKey = JSON.stringify(buoys.map((b) => [b.codigo, deviceIdsOf(b)]));
  usePolling(async ({ signal, isCurrent }) => {
    for (const [codigo, ids] of JSON.parse(alvosKey)) {
      if (!isCurrent()) return;
      await carregar(codigo, ids, { signal, isCurrent });
    }
  }, pollMs, [alvosKey]);

  const recarregar = useCallback((codigo) => {
    const alvo = buoys.find((b) => b.codigo === codigo);
    return alvo ? carregar(codigo, deviceIdsOf(alvo)) : Promise.resolve();
  }, [buoys, carregar]);

  return { ultimas, erros, fila, recarregar };
}
