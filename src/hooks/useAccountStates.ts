import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { fetchAccountStates, type AccountState } from '@lib/api';

interface UseAccountStatesResult {
  states: Map<string, AccountState>;
  loading: boolean;
  error: string | null;
  degraded: boolean;
  ttlMs: number;
  refresh: () => void;
}

/**
 * Fetches public ledger state for the supplied addresses. Requests are
 * debounced and superseded: only the most recent page's results are applied.
 */
export function useAccountStates(addresses: string[]): UseAccountStatesResult {
  const [states, setStates] = useState<Map<string, AccountState>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [ttlMs, setTtlMs] = useState(3_600_000);
  const [nonce, setNonce] = useState(0);
  const requestId = useRef(0);
  /** Make state updates visible to the browser in a single commit. */
  const key = addresses.join(',');

  useEffect(() => {
    if (addresses.length === 0) {
      setStates(new Map());
      setLoading(false);
      return;
    }

    const id = ++requestId.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const timer = setTimeout(() => {
      fetchAccountStates(addresses, controller.signal)
        .then((response) => {
          if (id !== requestId.current) return;
          // Commit balances and the loading flag together so the derived rows
          // never flash a "failed" or empty state between renders.
          flushSync(() => {
            setStates(new Map(response.results.map((entry) => [entry.address, entry])));
            setDegraded(response.degraded);
            setTtlMs(response.ttlMs);
            setLoading(false);
          });
        })
        .catch((err: unknown) => {
          if (id !== requestId.current) return;
          if (err instanceof Error && err.name === 'AbortError') return;
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });
    }, 120);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  return { states, loading, error, degraded, ttlMs, refresh };
}
