import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';

/**
 * Minimal data hook: loads once (or when deps change), exposes reload.
 * Deliberately no global client-side cache for medical data.
 */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(path));
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const id = (seq.current += 1);
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<T>(path);
      if (id === seq.current) setData(r);
    } catch (e) {
      if (id === seq.current) setError(e);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

/** Prevents double submission (important on slow networks). */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const run = useCallback(async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setBusy(true);
    try {
      return await fn();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, run };
}

/** Poll while the tab is visible (saves data on metered rural connections). */
export function useVisiblePolling(fn: () => void, intervalMs: number, enabled = true) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!enabled) return undefined;
    const tick = () => {
      if (document.visibilityState === 'visible') saved.current();
    };
    const id = window.setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [intervalMs, enabled]);
}
