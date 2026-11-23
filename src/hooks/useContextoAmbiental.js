import { useState, useEffect } from 'react';
import { carregarContexto, podeBuscar, ANA_VAZIO } from '../services/contextoAmbiental';

const INICIAL = {
  turbidez: { data: [], loading: false, error: null },
  ana: { data: ANA_VAZIO, loading: false, error: null },
};

/**
 * Turbidez da bóia + chuva/vazão/nível da estação ANA para a janela
 * (inicio = YYYY-MM-DD de Maceió, duracao = 7d|30d|90d|180d). Qualquer mudança
 * de entrada aborta a busca anterior e recomeça. `atualizadoEm` (ms) muda a
 * cada escolha de janela e a cada refresh automático: busca de novo, até o novo "agora".
 * `registroCarregado` false adia a busca até o cadastro de bóias chegar.
 * @returns {{turbidez: {data, loading, error}, ana: {data, loading, error}}}
 */
export function useContextoAmbiental({ deviceIds, estacao, inicio, duracao, atualizadoEm, registroCarregado = true }) {
  // chave estável: o array novo a cada render não pode refazer a busca
  const idsKey = JSON.stringify(deviceIds ?? []);
  const [state, setState] = useState(INICIAL);

  useEffect(() => {
    // sem o cadastro carregado a busca sairia com deviceIds vazio (e de novo ao carregar)
    if (!podeBuscar({ registroCarregado, estacao, inicio, duracao })) return;
    const controller = new AbortController();
    const emit = (chave, patch) => {
      if (controller.signal.aborted) return;
      setState(s => ({ ...s, [chave]: { ...s[chave], ...patch } }));
    };
    carregarContexto(
      { deviceIds: JSON.parse(idsKey), estacao, inicio, duracao }, controller.signal, emit,
    );
    return () => controller.abort();
  }, [idsKey, estacao, inicio, duracao, atualizadoEm, registroCarregado]);

  return state;
}
