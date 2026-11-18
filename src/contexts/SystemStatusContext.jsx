import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchSystemStatus, fetchWorkerJobs, checkSupabaseAuth, classifySupabaseHealth,
  applyStaleness, jobsToStatus, worstState, badgeState,
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
    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const [auth, rest] = await Promise.all([
          checkSupabaseAuth(),
          Promise.all([fetchSystemStatus(), fetchWorkerJobs()]).then(
            ([rows, jobs]) => ({ rows, jobs }),
            (e) => ({ error: e }),
          ),
        ]);
        if (cancelled) return;
        const now = new Date();
        const authState = classifySupabaseHealth(auth);
        const restFailed = Boolean(rest.error);
        const supabase = {
          auth: authState,
          rest: restFailed
            ? { estado: 'falha', detalhe: String(rest.error?.message ?? rest.error).slice(0, 200) }
            : { estado: 'ok', detalhe: null },
        };
        supabase.estado = worstState([supabase.auth.estado, supabase.rest.estado]);
        setState({
          loading: false,
          supabase,
          rows: restFailed ? null : applyStaleness(rest.rows, now),
          jobs: restFailed ? null : jobsToStatus(rest.jobs, now),
        });
      } catch (e) {
        if (cancelled) return;
        // Nunca derruba o layout: trata como Supabase em falha.
        setState({
          loading: false,
          supabase: { estado: 'falha', detalhe: String(e?.message ?? e).slice(0, 200) },
          rows: null,
          jobs: null,
        });
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
