import { useState, useEffect, useCallback, useRef } from 'react';
import { getBuoyRegistry, SEED_BUOYS } from '../services/buoyRegistry';

/**
 * Registro de bóias (`map_buoys`) para a UI: `{ buoys, loading, error, reload }`.
 *
 * - Antes da primeira leitura: `buoys = []` com `loading = true` — "ainda não
 *   carregou" nunca se confunde com "registro vazio" (`[]`, `loading = false`,
 *   `error = null`).
 * - Leitura falhou (rede/Supabase fora): `error` = mensagem e `buoys` cai na
 *   última lista lida com sucesso nesta montagem, ou na semente se nenhuma
 *   leitura deu certo — sem isso o mapa público ficava sem bóias e os seletores
 *   vazios. Com `error` preenchido, `buoys` NÃO é o registro: não reconciliar
 *   nem apagar nada a partir dela; escritas releem com getBuoyRegistry(), que
 *   lança erro nesse caso.
 * - `reload()` refaz a leitura; só a resposta da chamada mais recente é aplicada.
 */
export function useBuoyRegistry() {
  const [buoys, setBuoys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const lastLoadedRef = useRef(null); // última lista lida com sucesso
  const requestRef = useRef(0);       // descarta respostas de leituras superadas

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const list = await getBuoyRegistry();
      if (request !== requestRef.current) return;
      lastLoadedRef.current = list;
      setBuoys(list);
      setError(null);
    } catch (err) {
      if (request !== requestRef.current) return;
      console.warn('useBuoyRegistry: falha ao ler o registro, usando fallback', err);
      setError(err?.message || String(err));
      setBuoys(lastLoadedRef.current ?? SEED_BUOYS);
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { buoys, loading, error, reload: load };
}
