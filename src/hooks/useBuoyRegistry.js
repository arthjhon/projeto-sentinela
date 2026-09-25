import { useState, useEffect, useCallback } from 'react';
import { getBuoyRegistry } from '../services/buoyRegistry';

export function useBuoyRegistry() {
  const [buoys, setBuoys] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBuoys(await getBuoyRegistry());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { buoys, loading, reload: load };
}
