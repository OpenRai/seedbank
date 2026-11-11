import { useEffect, useMemo, useRef, useState } from 'react';
import { useAccountStates } from '@hooks/useAccountStates';
import { SiteHeader } from '@components/SiteHeader';
import { SiteFooter } from '@components/SiteFooter';
import { ResultsTable } from '@components/ResultsTable';
import { formatXno } from '@lib/format';
import { formatBigInt, PAGE_SIZE, type DerivedRow } from '@lib/keyspace';
import {
  CoinsIcon,
  DiceIcon,
  FirstIcon,
  InfoIcon,
  KeyIcon,
  LastIcon,
  NextIcon,
  PrevIcon,
  RefreshIcon,
  SearchIcon,
  WarningIcon,
} from '@components/Icons';
import {
  ILLNAN_BITS,
  ILLNAN_TOTAL,
  illnanClampPage,
  illnanDerivePrivateKey,
  illnanPageForPosition,
  illnanPageLocationPercent,
  illnanPageStartPosition,
  illnanTotalPages,
} from '@lib/illnan';

const FULL_BITS = 256n;

/** 2^47 / 2^256 = 2^-209. */
const COVERAGE_EXPONENT = Number(FULL_BITS) - ILLNAN_BITS;
const COVERAGE_LOG10 = -COVERAGE_EXPONENT * Math.log10(2);
const COVERAGE_MANTISSA = 10 ** (COVERAGE_LOG10 - Math.floor(COVERAGE_LOG10));

function readInitialEntry(): bigint | undefined {
  if (typeof window === 'undefined') return undefined;
  const raw = new URLSearchParams(window.location.search).get('entry');
  if (!raw || raw.length > 100 || !/^\d+$/.test(raw)) return undefined;
  const position = BigInt(raw);
  return position < ILLNAN_TOTAL ? position : undefined;
}

const INITIAL_ENTRY = readInitialEntry();

export function IllnanPage() {
  const [page, setPage] = useState<bigint>(
    INITIAL_ENTRY !== undefined ? illnanPageForPosition(INITIAL_ENTRY) : 1n,
  );
  const [pageInput, setPageInput] = useState(page.toString());
  const [candidateInput, setCandidateInput] = useState('');
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<bigint | undefined>(INITIAL_ENTRY);
  const [pending, setPending] = useState(false);

  const pages = illnanTotalPages();
  const clamped = illnanClampPage(page, pages);

  const [rows, setRows] = useState<DerivedRow[]>([]);
  const [deriving, setDeriving] = useState(true);
  const [deriveError, setDeriveError] = useState<string | null>(null);
  const requestId = useRef(0);

  const addresses = useMemo(() => rows.map((row) => row.address), [rows]);
  const { states, loading, error: stateError, refresh } = useAccountStates(addresses);

  const pagePercent = illnanPageLocationPercent(clamped, pages);
  const pagePercentLabel = `${pagePercent.toFixed(4)}% through the 2⁴⁷ space`;

  useEffect(() => { if (page !== clamped) setPage(clamped); }, [page, clamped]);
  useEffect(() => { setPageInput(clamped.toString()); }, [clamped]);

  useEffect(() => {
    const id = ++requestId.current;
    let cancelled = false;
    setDeriving(true);
    setDeriveError(null);

    const start = illnanPageStartPosition(clamped);
    const positions: bigint[] = [];
    for (let i = 0; i < PAGE_SIZE; i++) {
      const position = start + BigInt(i);
      if (position >= ILLNAN_TOTAL) break;
      positions.push(position);
    }

    Promise.all(positions.map((position) => illnanDerivePrivateKey(position)))
      .then((result) => {
        if (cancelled || id !== requestId.current) return;
        setRows(result);
      })
      .catch((error: unknown) => {
        if (cancelled || id !== requestId.current) return;
        setRows([]);
        setDeriveError(error instanceof Error ? error.message : 'Candidate derivation failed.');
      })
      .finally(() => {
        if (!cancelled && id === requestId.current) setDeriving(false);
      });

    return () => { cancelled = true; };
  }, [clamped]);

  /* Anchor the page controls ("First") just below the sticky header. Forced
     when a candidate is selected; otherwise only when they have scrolled out
     of view, so paging from the top does not yank the page downward. */
  const controlsRef = useRef<HTMLDivElement>(null);
  function anchorToControls(force = false) {
    const element = controlsRef.current;
    if (!element) return;
    const margin = Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
    if (force || element.getBoundingClientRect().top < margin) {
      element.scrollIntoView({ block: 'start' });
    }
  }

  useEffect(() => {
    if (selectedPosition !== undefined && rows.some((row) => row.position === selectedPosition)) {
      anchorToControls(true);
    }
  }, [rows, selectedPosition]);

  /* Keep the address bar shareable without disturbing the lookup mode. */
  useEffect(() => {
    const params = new URLSearchParams();
    params.set('view', 'ill-nan');
    if (selectedPosition !== undefined && illnanPageForPosition(selectedPosition) === clamped) {
      params.set('entry', selectedPosition.toString());
    } else if (clamped > 1n) {
      params.set('page', clamped.toString());
    }
    const lookups = new URLSearchParams(window.location.search).get('lookups');
    if (lookups) params.set('lookups', lookups);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }, [clamped, selectedPosition]);

  const totalsKnown = !loading && !deriving && rows.length > 0 && rows.every((row) => {
    const state = states.get(row.address);
    return state && state.fetchedAt !== null && state.balanceRaw !== null && state.receivableRaw !== null && state.opened !== null;
  });

  const totals = useMemo(() => {
    const balance = rows.reduce((acc, row) => {
      const state = states.get(row.address);
      try { return acc + BigInt(state?.balanceRaw ?? '0'); } catch { return acc; }
    }, 0n);
    const receivable = rows
      .filter((row) => !(states.get(row.address)?.opened ?? false))
      .reduce((acc, row) => {
        const state = states.get(row.address);
        try { return acc + BigInt(state?.receivableRaw ?? '0'); } catch { return acc; }
      }, 0n);
    const opened = rows.filter((row) => states.get(row.address)?.opened).length;
    const funded = rows.filter((row) => {
      const state = states.get(row.address);
      return state && state.balanceRaw && state.balanceRaw !== '0';
    }).length;
    return { balance, receivable, opened, funded };
  }, [rows, states]);

  function go(next: bigint) {
    setSelectedPosition(undefined);
    const clampedNext = illnanClampPage(next, pages);
    setPage(clampedNext);
    setPageInput(clampedNext.toString());
    anchorToControls();
    setPending(true);
    window.setTimeout(() => setPending(false), 0);
  }

  function jump() {
    const cleaned = pageInput.replace(/[,\s_]/g, '');
    if (/^\d+$/.test(cleaned) && cleaned.length <= 100) go(BigInt(cleaned));
    else setPageInput(clamped.toString());
  }

  function jumpToCandidate(event: React.FormEvent) {
    event.preventDefault();
    const cleaned = candidateInput.replace(/[,\s_]/g, '');
    if (!/^\d+$/.test(cleaned) || cleaned.length > 100) {
      setCandidateError(`Enter a candidate number from 0 to ${formatBigInt(ILLNAN_TOTAL - 1n)}.`);
      return;
    }
    const position = BigInt(cleaned);
    if (position >= ILLNAN_TOTAL) {
      setCandidateError(`Candidate must be below ${formatBigInt(ILLNAN_TOTAL)}.`);
      return;
    }
    setCandidateError(null);
    go(illnanPageForPosition(position));
    setSelectedPosition(position);
  }

  function randomCandidate() {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    let candidate = 0n;
    for (const byte of bytes) candidate = (candidate << 8n) | BigInt(byte);
    candidate %= ILLNAN_TOTAL;
    go(illnanPageForPosition(candidate));
    setSelectedPosition(candidate);
  }

  return (
    <div className="app">
      <SiteHeader active="keys" />
      <main className="container main">
        <section className="card">
          <div className="card__body summary">
            <div className="summary__text">
              <h1 className="summary__title">
                Vulnerable phrase page <strong>#{formatBigInt(clamped)}</strong> of{' '}
                <strong>#{formatBigInt(pages)}</strong>
              </h1>

              {/* Same 2^256 scale as the main browser. The whole vulnerable
                  subset is the red sliver at the far left. */}
              <div
                className="summary__progress summary__progress--full"
                role="img"
                aria-label="The full 2^256 Nano keyspace, with the 2^47 vulnerable subset marked in red at the far left"
              >
                <div className="summary__progress-fill" style={{ width: '100%' }} />
                <span
                  className="summary__progress-subset"
                  title={`The entire 2^47 CryptoJS keyspace (${formatBigInt(ILLNAN_TOTAL)} candidates)`}
                />
                <span className="summary__progress-value">
                  Full 2²⁵⁶ keyspace — the red sliver is all 2⁴⁷ vulnerable phrases
                </span>
              </div>
              <div className="summary__comparison-note">
                Red segment = the entire vulnerable keyspace: 2⁴⁷ ={' '}
                {formatBigInt(ILLNAN_TOTAL)} candidates, versus 2²⁵⁶ ≈ 1.16 × 10⁷⁷. The segment
                is 2⁻²⁰⁹ of the bar ({COVERAGE_MANTISSA.toFixed(1)} × 10
                <sup>{Math.floor(COVERAGE_LOG10)}</sup>), so it is drawn at minimum width rather
                than to scale. The zoomed bar below navigates that subset.
              </div>

              <div className="summary__zoom">
                <div className="summary__zoom-label">
                  Vulnerable subset, zoomed: 2⁴⁷ candidates
                </div>
                <div
                  className="summary__progress summary__progress--vulnerable"
                  role="progressbar"
                  aria-label="Page location within the 2^47 vulnerable keyspace"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pagePercent}
                >
                  <div className="summary__progress-fill" style={{ width: `${pagePercent}%` }} />
                  <span className="summary__progress-value">{pagePercentLabel}</span>
                </div>
              </div>

              <div className="summary__meta">
                Showing {rows.length || PAGE_SIZE} candidate phrases per page · this page starts
                at candidate {formatBigInt(illnanPageStartPosition(clamped))}
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card__section">
            <div className="notice-list">
              <div className="banner banner--warn">
                <WarningIcon width={16} height={16} />
                <div>
                  <strong>2⁴⁷ possible phrases, not 2²⁵⁶.</strong> Before v1.3.0, NanChat generated
                  wallet entropy with CryptoJS 3.1.9-1&apos;s <code>WordArray.random()</code>. That
                  generator is seeded from a single 32-bit <code>Math.random()</code> value, and
                  each 4-byte word adds a sign bit; the final sign bit is discarded. The result is
                  at most 2⁴⁷ distinct 32-byte entropies, each a valid 24-word BIP39 phrase.
                </div>
              </div>
              <div className="banner banner--info">
                <InfoIcon width={16} height={16} />
                <div>
                  <strong>One shared space, not one per user.</strong> Every vulnerable wallet —
                  from every user, browser, and session — is a point in this same 2⁴⁷ space. It is a
                  collapse, not a reordering: the buggy generator cannot emit most of the 2²⁵⁶
                  keyspace at all, and it always samples from the same fixed subset. A different{' '}
                  <code>Math.random()</code> stream only selects a different point; it adds no new
                  entropy and creates no new space. An attacker who sweeps these candidates once
                  covers the entire affected population, and a partial sweep finds a proportional
                  share of it. That is why this is worse for users, not better.
                </div>
              </div>
              <div className="banner banner--info">
                <InfoIcon width={16} height={16} />
                <div>
                  <strong>How the sweep works.</strong> An attacker enumerates the 2⁴⁷ candidates,
                  derives each phrase&apos;s key at <code>m/44&apos;/165&apos;/0&apos;</code>, and
                  checks the resulting address against funded accounts. This page replays the exact
                  CryptoJS transform with a controlled seed/sign sequence, so each row is one
                  genuinely reachable wallet.
                </div>
              </div>
              <div className="banner banner--info">
                <InfoIcon width={16} height={16} />
                <div>
                  <strong>Why 2⁴⁷?</strong> 32 bits of MWC seed plus 15 effective sign bits, giving
                  each wallet at most 47 bits of entropy. The same bug reached about 2³⁹ for 128-bit
                  (12-word) phrases; this page models NanChat&apos;s 256-bit, 24-word path. 2⁴⁷ ≈
                  1.4 × 10¹⁴ is large in absolute terms but not cryptographic — the disclosure
                  describes it as computationally feasible to enumerate, so the cost is bounded by
                  hardware, not by cryptography.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div id="illnan-page-controls" ref={controlsRef} className="card__section controls__row">
            <button type="button" className="btn" onClick={() => go(1n)} disabled={clamped === 1n || pending}>
              <FirstIcon width={15} height={15} /> First
            </button>
            <button type="button" className="btn" onClick={() => go(clamped - 1n)} disabled={clamped === 1n || pending}>
              <PrevIcon width={15} height={15} /> Previous
            </button>
            <button type="button" className="btn btn--dice" onClick={randomCandidate} disabled={pending}>
              <DiceIcon width={15} height={15} /> Random
            </button>
            <button type="button" className="btn" onClick={() => go(clamped + 1n)} disabled={clamped >= pages || pending}>
              <NextIcon width={15} height={15} /> Next
            </button>
            <button type="button" className="btn" onClick={() => go(pages)} disabled={clamped >= pages || pending}>
              <LastIcon width={15} height={15} /> Last
            </button>
          </div>

          <div className="card__section controls__row">
            <div className="page-field" style={{ flex: 1 }}>
              <label htmlFor="illnan-page-input">Page:</label>
              <input
                id="illnan-page-input"
                className="input input--page"
                value={pageInput}
                onChange={(event) => setPageInput(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') jump(); }}
                inputMode="numeric"
                spellCheck={false}
                aria-label="Page number"
              />
            </div>
            <button type="button" className="btn btn--primary" onClick={jump} disabled={pending}>
              <SearchIcon width={15} height={15} /> Jump
            </button>
            <div className="toolbar-right">
              <button
                type="button"
                className="btn btn--icon"
                onClick={refresh}
                disabled={loading || rows.length === 0}
                title="Re-request balances"
              >
                <RefreshIcon width={15} height={15} /> Refresh balances
              </button>
            </div>
          </div>
        </section>

        <section className="card">
          <form className="card__section controls__row" onSubmit={jumpToCandidate}>
            <SearchIcon width={20} height={20} />
            <input
              className="input key-search"
              aria-label="Jump to a vulnerable candidate number"
              aria-invalid={Boolean(candidateError)}
              aria-describedby={candidateError ? 'illnan-candidate-error' : undefined}
              placeholder={`Candidate # (0 – ${formatBigInt(ILLNAN_TOTAL - 1n)})`}
              value={candidateInput}
              onChange={(event) => { setCandidateInput(event.target.value); setCandidateError(null); }}
              autoComplete="off"
              spellCheck={false}
            />
            <button className="btn btn--primary" type="submit">
              <SearchIcon width={15} height={15} /> Search
            </button>
            {candidateError ? <span id="illnan-candidate-error" role="alert">{candidateError}</span> : null}
          </form>
          <div className="card__section summary__meta" style={{ marginTop: 0 }}>
            A candidate is one 32-bit MWC seed plus 15 sign bits. The page derives its 24-word BIP39
            phrase, BIP39 seed, and private key exactly as the vulnerable library did. The candidate
            number is an ascending index over those 47 effective input bits — 32 for the seed and 15
            for the signs — not the raw <code>Math.random()</code> floats. Candidate #0 is the
            paper&apos;s first phrase, “illness blossom…”; candidate #2⁴⁷−1 is the last.
          </div>
        </section>

        <section className={`stats${loading ? ' stats--loading' : ''}`} aria-busy={loading}>
          <div className="stat">
            <div className="stat__label stat__label--balance"><CoinsIcon width={13} height={13} /> Total balance</div>
            <div className="stat__value stat__value--balance">
              {totalsKnown ? formatXno(totals.balance) : '—'}
              <span className="stat__suffix"> XNO</span>
            </div>
            <div className="stat__hint">
              {totalsKnown ? `${totals.funded} of ${rows.length} candidates funded on this page` : loading ? 'Loading balances…' : 'Balance data unavailable'}
            </div>
          </div>
          <div className="stat">
            <div className="stat__label stat__label--opened"><KeyIcon width={13} height={13} /> Opened accounts</div>
            <div className="stat__value stat__value--opened">
              {totalsKnown ? totals.opened : '—'}
              <span className="stat__suffix">/ {rows.length || PAGE_SIZE}</span>
            </div>
          </div>
          <div className="stat">
            <div className="stat__label stat__label--receivable"><CoinsIcon width={13} height={13} /> Receivable</div>
            <div className="stat__value stat__value--balance">
              {totalsKnown ? formatXno(totals.receivable) : '—'}
              <span className="stat__suffix">XNO</span>
            </div>
          </div>
        </section>

        {stateError ? (
          <div className="banner banner--warn">
            <WarningIcon width={16} height={16} /> Balance lookup failed: {stateError}.
          </div>
        ) : null}

        {deriveError ? (
          <div className="banner banner--warn">
            <WarningIcon width={16} height={16} /> Candidate derivation failed: {deriveError}.
          </div>
        ) : null}

        <ResultsTable
          page={clamped}
          selectedPosition={selectedPosition}
          permalink={(entry) => `/?view=ill-nan&entry=${entry}`}
          kind="mnemonic"
          showPrivateKey
          showDetailLink={false}
          rows={rows}
          states={states}
          loading={loading}
          deriving={deriving}
        />
      </main>

      <SiteFooter />
    </div>
  );
}
