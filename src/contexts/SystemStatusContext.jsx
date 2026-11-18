import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchRest, checkSupabaseAuth, buildSnapshot, createPollGuard, badgeState,
} from '../services/systemStatus';

// Um único laço de polling (30 s, pausado com a aba oculta), sem MQTT, compartilhado por
// quem usa o hook (selo do cabeçalho, página de status).

const POLL_MS = 30_000;
const INITIAL = { loading: true, supabase: null, rows: null, jobs: null };

const SystemStatusContext = createContext(null);

export function SystemStatusProvider({ children }) {
  const [state, setState] = useState(INITIAL);
  const refreshRef = useRef(() => {});

  useEffect(() => {
    let cancelled = false;
    const guard = createPollGuard();
    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      const token = guard.start();
      if (token === null) return; // rodada anterior ainda em andamento
      try {
        const [auth, rest] = await Promise.all([checkSupabaseAuth(), fetchRest()]);
        if (cancelled || !guard.isLatest(token)) return;
        setState({ ...buildSnapshot({ auth, rest, now: new Date() }), checkedAt: Date.now() });
      } catch (e) {
        if (cancelled || !guard.isLatest(token)) return;
        // Nunca derruba o layout: trata como Supabase em falha.
        setState({
          loading: false,
          supabase: { estado: 'falha', detalhe: String(e?.message ?? e).slice(0, 200) },
          rows: null,
          jobs: null,
          checkedAt: Date.now(),
        });
      } finally {
        guard.finish(token);
      }
    };
    refreshRef.current = load;
    load();
    const timer = setInterval(load, POLL_MS);
    document.addEventListener('visibilitychange', load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, []);

  const refresh = useCallback(() => refreshRef.current(), []);
  const value = useMemo(
    () => ({ ...state, badge: badgeState(state), refresh }),
    [state, refresh],
  );
  return <SystemStatusContext.Provider value={value}>{children}</SystemStatusContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSystemStatus() {
  const ctx = useContext(SystemStatusContext);
  if (!ctx) throw new Error('useSystemStatus deve ser usado dentro de <SystemStatusProvider>');
  return ctx;
}
