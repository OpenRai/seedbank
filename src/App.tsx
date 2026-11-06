import { clampPage as normalizePage, clampAccountIndex, pageStartPosition, pageForPosition, privateKeyPosition, pageLocationPercent } from '@lib/navigation';
import { randomPage } from '@lib/derivePage';
import { useEffect, useMemo, useState } from 'react';
import { PAGE_SIZE, type MnemonicMethod, type SeedKind, METHOD_META, methodForWordCount, methodFormula, wordCountForMethod, formatBigInt, totalEntries, totalPages } from '@lib/keyspace';
import { DEFAULT_OPTIONS, readUrlState, replaceUrl, writeUrlState } from '@lib/urlState';
import { useKeyspace } from '@hooks/useKeyspace';
import { useAccountStates } from '@hooks/useAccountStates';
import { ResultsTable } from '@components/ResultsTable';
import {
  CoinsIcon,
  DiceIcon,
  FirstIcon,
  KeyIcon,
  SeedKeyIcon,
  LastIcon,
  NextIcon,
  PrevIcon,
  RefreshIcon,
  SearchIcon,
  WarningIcon,
} from '@components/Icons';
import { formatXno, sumRaw } from '@lib/format';

const initial = readUrlState(window.location.search);

/** Compact word-count support hint shown next to each derivation method. */
function wordCountSupportLabel(wordCounts: readonly (12 | 24)[]): string {
  return wordCounts.length === 1 ? `${wordCounts[0]} words only` : `${wordCounts.join('/')} words`;
}

export function App() {
  const [kind, setKind] = useState<SeedKind>(initial.kind ?? 'privateKey');
  const [requestedPage, setPage] = useState<bigint>(initial.page ?? 1n);
  const [options, setOptions] = useState(initial.options ?? DEFAULT_OPTIONS);
  const [accountIndex, setAccountIndex] = useState(initial.accountIndex ?? 0);
  const [accountInput, setAccountInput] = useState(String(initial.accountIndex ?? 0));
  const [pageInput, setPageInput] = useState((initial.page ?? 1n).toString());
  const [keyInput, setKeyInput] = useState('');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<bigint | undefined>(initial.entry);
  const [pending, setPending] = useState(false);

  const effectiveOptions = useMemo(
    () => (kind === 'mnemonic' ? options : DEFAULT_OPTIONS),
    [kind, options],
  );

  const pageLimit = totalPages(kind, effectiveOptions);
  const page = normalizePage(requestedPage, pageLimit);
  useEffect(() => { if (requestedPage !== page) setPage(page); }, [requestedPage, page]);

  const methodMeta = kind === 'mnemonic' ? METHOD_META[effectiveOptions.method] : null;

  /**
   * Account index bounds, by derivation method:
   *  - SLIP-0010 hardened path segments reserve the top bit, so 2^31-1.
   *  - The traditional Nano seed rule takes a full uint32.
   */
  const accountMax = methodMeta?.accountMax ?? 0x7fffffff;

  function commitAccountIndex(next: number) {
    const clamped = clampAccountIndex(next, accountMax);
    setAccountIndex(clamped);
    setAccountInput(String(clamped));
  }

  /** Free typing is allowed; only valid in-range digits change the index. */
  function onAccountInputChange(raw: string) {
    setAccountInput(raw);
    if (!/^\d+$/.test(raw)) return;
    const value = Number(raw);
    if (Number.isSafeInteger(value) && value <= accountMax) setAccountIndex(value);
  }

  /** Blur/Enter normalises the field back onto a valid, clamped value. */
  function normaliseAccountInput() {
    const parsed = /^\d+$/.test(accountInput) ? Number(accountInput) : accountIndex;
    commitAccountIndex(Number.isSafeInteger(parsed) ? parsed : accountIndex);
  }

  const {
    rows,
    deriving,
    error: deriveError,
    pages,
    info,
    parsePageInput,
    clampPage,
    isFirst,
    isLast,
  } = useKeyspace({ kind, options: effectiveOptions, page, accountIndex: clampAccountIndex(accountIndex, accountMax) });

  const pagePercent = pageLocationPercent(page, pages);
  const pagePercentLabel = `${pagePercent.toFixed(4)}% through the keyspace`;

  const addresses = useMemo(() => rows.map((row) => row.address), [rows]);
  const { states, loading, error: stateError, degraded, refresh } = useAccountStates(addresses);

  useEffect(() => {
    if (selectedPosition !== undefined && rows.some((row) => row.position === selectedPosition)) {
      document.getElementById(`entry-${selectedPosition}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [rows, selectedPosition]);

  /* Keep the URL in sync so any page is shareable and reproducible. */
  useEffect(() => {
    const entry = selectedPosition !== undefined && selectedPosition < totalEntries(kind, effectiveOptions)
      && pageForPosition(selectedPosition) === page ? selectedPosition : undefined;
    replaceUrl({ kind, page, options: effectiveOptions, accountIndex, entry });
  }, [kind, page, effectiveOptions, accountIndex, selectedPosition]);

  useEffect(() => {
    setPageInput(page.toString());
  }, [page]);

  /* Switching derivation method can shrink the permitted index range. */
  useEffect(() => {
    if (accountIndex > accountMax) commitAccountIndex(accountMax);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountMax]);

  const totalsKnown = !loading && !deriving && rows.length > 0 && rows.every((row) => {
    const state = states.get(row.address);
    return state && state.fetchedAt !== null && state.balanceRaw !== null && state.receivableRaw !== null && state.opened !== null;
  });

  const totals = useMemo(() => {
    const balance = sumRaw(rows.map((row) => states.get(row.address)?.balanceRaw ?? '0'));
    const receivable = sumRaw(
      rows
        .filter((row) => !(states.get(row.address)?.opened ?? false))
        .map((row) => states.get(row.address)?.receivableRaw ?? '0'),
    );
    const opened = rows.filter((row) => states.get(row.address)?.opened).length;
    const funded = rows.filter((row) => states.get(row.address)?.balanceRaw && states.get(row.address)!.balanceRaw !== '0').length;
    return { balance, receivable, opened, funded };
  }, [rows, states]);

  function go(next: bigint) {
    setSelectedPosition(undefined);
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    const clamped = clampPage(next, pages);
    setPending(true);
    setPage(clamped);
    setPageInput(clamped.toString());
    window.setTimeout(() => setPending(false), 0);
  }

  function jumpToKey(event: React.FormEvent) {
    event.preventDefault();
    const position = privateKeyPosition(keyInput);
    if (position === null) {
      setKeyError('Enter a 64-character hexadecimal private key.');
      return;
    }
    setKeyError(null);
    go(pageForPosition(position));
    setSelectedPosition(position);
  }

  function jump() {
    const parsed = parsePageInput(pageInput);
    if (parsed === null) {
      setPageInput(page.toString());
      return;
    }
    go(parsed);
  }

  return (
    <div className="app">
      <header className="site-header">
        <div className="container site-header__inner">
          <a className="brand" href="/">
            <span className="brand__mark" aria-hidden="true">
              <SeedKeyIcon width={17} height={17} />
            </span>
            <span>seed<span className="brand__accent">bank</span><span className="brand__domain">.openrai.org</span></span>
          </a>
          <nav className="site-nav" aria-label="Keyspace view">
            <button
              type="button"
              className={`site-nav__link${kind === 'privateKey' ? ' site-nav__link--active' : ''}`}
              aria-pressed={kind === 'privateKey'}
              onClick={() => {
                setKind('privateKey');
                go(1n);
              }}
            >
              Private keys
            </button>
            <button
              type="button"
              className={`site-nav__link${kind === 'mnemonic' ? ' site-nav__link--active' : ''}`}
              aria-pressed={kind === 'mnemonic'}
              onClick={() => {
                setKind('mnemonic');
                go(1n);
              }}
            >
              Mnemonic seeds
            </button>
          </nav>
        </div>
      </header>

      <main className="container main">
        <section className="card">
          <div className="card__body summary">
            <div className="summary__text">
              <h1 className="summary__title">
                Nano {kind === 'privateKey' ? 'private keys' : 'mnemonic seeds'} page{' '}
                <strong>#{formatBigInt(page)}</strong> out of <strong>#{info.pagesDisplay}</strong>
              </h1>
              <div className="summary__progress" role="progressbar" aria-label="Page location within keyspace" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pagePercent}>
                <div className="summary__progress-fill" style={{ width: `${pagePercent}%` }} />
                <span className="summary__progress-value">{pagePercentLabel}</span>
              </div>
              <div className="summary__meta">
                Showing {rows.length || PAGE_SIZE} Nano {kind === 'privateKey' ? 'private keys' : 'seed phrases'} per page · this page starts at {kind === 'privateKey' ? 'key' : 'seed phrase'} position{' '}
                {formatBigInt(pageStartPosition(page))}
              </div>
            </div>
          </div>
          <div className="pagination-controls">
          <div className="card__section controls__row">
            <button type="button" className="btn" onClick={() => go(1n)} disabled={isFirst || pending}>
              <FirstIcon width={15} height={15} /> First
            </button>
            <button type="button" className="btn" onClick={() => go(page - 1n)} disabled={isFirst || pending}>
              <PrevIcon width={15} height={15} /> Previous
            </button>
            <button
              type="button"
              className="btn btn--dice"
              onClick={() => go(randomPage(kind, effectiveOptions, (length) => crypto.getRandomValues(new Uint8Array(length))))}
              disabled={pending}
            >
              <DiceIcon width={15} height={15} /> Random
            </button>
            <button type="button" className="btn" onClick={() => go(page + 1n)} disabled={isLast || pending}>
              Next <NextIcon width={15} height={15} />
            </button>
            <button type="button" className="btn" onClick={() => go(pages)} disabled={isLast || pending}>
              Last <LastIcon width={15} height={15} />
            </button>
          </div>

          <div className="card__section controls__row">
            <div className="page-field" style={{ flex: 1 }}>
              <label htmlFor="page-input">Page:</label>
              <input
                id="page-input"
                className="input input--page"
                value={pageInput}
                onChange={(event) => setPageInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') jump();
                }}
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
                title="Re-request balances (cached entries are served until they expire)"
              >
                <RefreshIcon width={15} height={15} /> Refresh balances
              </button>
            </div>
          </div>

          </div>
        </section>

        {kind === 'mnemonic' ? (
          <section className="card">
            <div className="card__section">
              <div className="settings__grid">
                <div className="field">
                  <label className="field__label" htmlFor="word-count">
                    Word count
                  </label>
                  <select
                    id="word-count"
                    className="select"
                    value={options.wordCount}
                    onChange={(event) => {
                      const wordCount = Number(event.target.value) as 12 | 24;
                      setOptions((current) => ({
                        ...current,
                        wordCount,
                        method: methodForWordCount(wordCount, current.method),
                      }));
                    }}
                  >
                    {([12, 24] as const).map((wc) => (
                      <option key={wc} value={wc}>
                        {wc} words ({wc === 12 ? '128' : '256'} bits)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="method">
                    Derivation method
                  </label>
                  <select
                    id="method"
                    className="select"
                    value={options.method}
                    onChange={(event) => {
                      const method = event.target.value as MnemonicMethod;
                      setOptions((current) => ({
                        ...current,
                        method,
                        wordCount: wordCountForMethod(method, current.wordCount),
                      }));
                    }}
                  >
                    {Object.values(METHOD_META).map((meta) => (
                      <option key={meta.method} value={meta.method}>
                        {meta.label} · {wordCountSupportLabel(meta.wordCounts)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="passphrase">
                    BIP39 passphrase
                    {methodMeta && !methodMeta.passphrase ? (
                      <span className="field__hint" style={{ marginLeft: 8 }}>
                        unused by this method
                      </span>
                    ) : null}
                  </label>
                  <input
                    id="passphrase"
                    className="input"
                    type="text"
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={methodMeta && !methodMeta.passphrase ? 'n/a for this method' : 'optional BIP39 passphrase'}
                    value={options.passphrase ?? ''}
                    onChange={(event) =>
                      setOptions((current) => ({ ...current, passphrase: event.target.value || undefined }))
                    }
                  />
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="account">
                    Account index
                  </label>
                  <div className="stepper">
                    <button
                      type="button"
                      className="stepper__btn"
                      onClick={() => commitAccountIndex(accountIndex - 1)}
                      disabled={accountIndex <= 0}
                      aria-label="Previous account index"
                      title="Decrease account index"
                    >
                      <PrevIcon width={13} height={13} />
                    </button>
                    <span className="stepper__field">
                      <span className="stepper__prefix" aria-hidden="true">
                        #
                      </span>
                      <input
                        id="account"
                        className="input stepper__input"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="off"
                        spellCheck={false}
                        value={accountInput}
                        onChange={(event) => onAccountInputChange(event.target.value)}
                        onBlur={normaliseAccountInput}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') normaliseAccountInput();
                          if (event.key === 'ArrowUp') {
                            event.preventDefault();
                            commitAccountIndex(accountIndex + 1);
                          }
                          if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            commitAccountIndex(accountIndex - 1);
                          }
                        }}
                        aria-describedby="account-range"
                      />
                    </span>
                    <button
                      type="button"
                      className="stepper__btn"
                      onClick={() => commitAccountIndex(accountIndex + 1)}
                      disabled={accountIndex >= accountMax}
                      aria-label="Next account index"
                      title="Increase account index"
                    >
                      <NextIcon width={13} height={13} />
                    </button>
                  </div>
                  <span className="field__hint" id="account-range">
                    0 – {accountMax.toLocaleString('en-US')}
                  </span>
                </div>
              </div>

              <div className="settings__paths">
                <span className="chip chip--label">Derivation</span>
                {methodMeta ? (
                  <>
                    <span className="chip chip--active">
                      {methodMeta.supportsSubaccounts
                        ? methodFormula(effectiveOptions.method, accountIndex)
                        : methodMeta.label}
                    </span>
                    <span
                      className={`chip${methodMeta.supportsSubaccounts ? ' chip--active' : ' chip--disabled'}`}
                      title={methodMeta.supportsSubaccounts
                        ? `Each phrase yields ${methodMeta.accountMax.toLocaleString('en-US')}+1 subaccounts`
                        : 'This method derives a single key per phrase'}
                    >
                      {methodMeta.supportsSubaccounts
                        ? `${(methodMeta.accountMax + 1).toLocaleString('en-US')} subaccounts`
                        : 'single key'}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {kind === 'privateKey' ? (
          <section className="card">
            <form className="card__section controls__row" onSubmit={jumpToKey}>
              <SearchIcon width={20} height={20} />
              <input
                className="input key-search"
                aria-label="Jump to Nano private key"
                aria-invalid={Boolean(keyError)}
                aria-describedby={keyError ? 'key-search-error' : undefined}
                placeholder="64-character HEX private key"
                value={keyInput}
                onChange={(event) => { setKeyInput(event.target.value); setKeyError(null); }}
                autoComplete="off"
                spellCheck={false}
              />
              <button className="btn btn--primary" type="submit"><SearchIcon width={15} height={15} /> Search</button>
              {keyError ? <span id="key-search-error" role="alert">{keyError}</span> : null}
            </form>
          </section>
        ) : null}

        <section className={`stats${loading || deriving ? ' stats--loading' : ''}`} aria-busy={loading || deriving}>
          <div className="stat">
            <div className="stat__label stat__label--balance">
              <CoinsIcon width={13} height={13} /> Total balance
            </div>
            <div className="stat__value stat__value--balance">
              {totalsKnown ? formatXno(totals.balance) : '—'}
              <span className="stat__suffix">XNO</span>
            </div>
            <div className="stat__hint">
              {totalsKnown ? `${totals.funded} of ${rows.length} entries funded on this page` : loading || deriving ? 'Loading balances…' : 'Balance data unavailable'}
            </div>
          </div>
          <div className="stat">
            <div className="stat__label stat__label--opened">
              <KeyIcon width={13} height={13} /> Opened accounts
            </div>
            <div className="stat__value stat__value--opened">
              {totalsKnown ? totals.opened : '—'}
              <span className="stat__suffix">/ {rows.length || PAGE_SIZE}</span>
            </div>
          </div>
          <div className="stat">
            <div className="stat__label stat__label--receivable">
              <CoinsIcon width={13} height={13} /> Receivable
            </div>
            <div className="stat__value stat__value--balance">
              {totalsKnown ? formatXno(totals.receivable) : '—'}
              <span className="stat__suffix">XNO</span>
            </div>
          </div>
        </section>

        {deriveError ? (
          <div className="banner banner--error">
            <WarningIcon width={16} height={16} /> Derivation failed: {deriveError}
          </div>
        ) : null}

        {stateError ? (
          <div className="banner banner--warn">
            <WarningIcon width={16} height={16} /> Balance lookup failed: {stateError}.
          </div>
        ) : null}

        {degraded && !stateError ? (
          <div className="banner banner--warn">
            <WarningIcon width={16} height={16} /> RPC lookup failed. Cached values are marked; unavailable values show —.
          </div>
        ) : null}

        <ResultsTable page={page} selectedPosition={selectedPosition} permalink={(entry) => writeUrlState({ kind, page, options: effectiveOptions, accountIndex, entry }, window.location.search)} kind={kind} rows={rows} states={states} loading={loading} deriving={deriving} />

      </main>

      <footer className="site-footer">
        <div className="container site-footer__grid">
          <div>
            <strong><span className="about-label">About </span><span className="about-seed">seed</span><span className="brand__accent">bank</span></strong>
            <p style={{ margin: '6px 0 0' }}>
              A deterministic browser over the <a href="https://nano.org/">Nano cryptocurrency</a> keyspace. Every private key and seed phrase is derived at view-time
              from its position in the 2<sup>256</sup> range — nothing is stored, indexed, or pregenerated.
            </p>
          </div>
          <div>
            © 2026 The OpenRai Initiative
          </div>
        </div>
      </footer>
    </div>
  );
}
