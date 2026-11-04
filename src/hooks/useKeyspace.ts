import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { derivePage, type DerivePageRequest } from '@lib/derivePage';
import { pageInfo, MAX_PAGE_DIGITS, type DerivedRow } from '@lib/keyspace';

interface UseKeyspaceArgs {
  kind: DerivePageRequest['kind'];
  options: DerivePageRequest['options'];
  page: bigint;
  accountIndex?: number;
}

const PER_PAGE = 20n;

function clampPage(page: bigint, pages: bigint): bigint {
  if (page < 1n) return 1n;
  if (page > pages) return pages;
  return page;
}

/** Parse a user-entered page number, tolerating separators and empty input. */
export function parsePageInput(input: string): bigint | null {
  const normalized = input.replace(/[,\s_]/g, '');
  if (normalized === '') return null;
  if (!/^\d+$/.test(normalized)) return null;
  if (normalized.length > MAX_PAGE_DIGITS) return null;
  return BigInt(normalized);
}

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
