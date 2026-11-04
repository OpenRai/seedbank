import { clampPage, parsePageInput } from '@lib/navigation';
export { parsePageInput } from '@lib/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { derivePage, type DerivePageRequest } from '@lib/derivePage';
import { pageInfo, PAGE_SIZE, type DerivedRow } from '@lib/keyspace';

interface UseKeyspaceArgs {
  kind: DerivePageRequest['kind'];
  options: DerivePageRequest['options'];
  page: bigint;
  accountIndex?: number;
}

const PER_PAGE = BigInt(PAGE_SIZE);

/**
 * Derives the current page.
 *
 * Derivation is asynchronous for mnemonic pages (each phrase needs a PBKDF2
 * seed) and the effect below cancels stale work, so rapid paging never leaves
 * an outdated page on screen.
 */
export function useKeyspace({ kind, options, page, accountIndex = 0 }: UseKeyspaceArgs) {
  const [rows, setRows] = useState<DerivedRow[]>([]);
  const [deriving, setDeriving] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const info = useMemo(() => pageInfo(kind, options), [kind, options]);
  const pages = info.pages;

  useEffect(() => {
    const id = ++requestId.current;
    setDeriving(true);
    setError(null);

    let cancelled = false;
    // Yield once so the header and controls paint before derivation starts.
    const handle = setTimeout(() => {
      derivePage({ kind, page, options, accountIndex })
        .then((result) => {
          if (cancelled || id !== requestId.current) return;
          setRows(result);
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled || id !== requestId.current) return;
          setRows([]);
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled && id === requestId.current) setDeriving(false);
        });
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [kind, options, page, accountIndex]);

  const commitPage = useCallback((next: bigint) => clampPage(next, pages), [pages]);

  return {
    rows,
    deriving,
    error,
    pages,
    info,
    perPage: PER_PAGE,
    parsePageInput,
    clampPage,
    commitPage,
    isFirst: page <= 1n,
    isLast: page >= pages,
  };
}
