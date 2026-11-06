import type { DerivedRow } from '@lib/keyspace';
import type { AccountState } from '@lib/api';
import { CopyButton } from '@components/CopyButton';
import { SensitiveValue } from '@components/SensitiveValue';
import { BalanceCell } from '@components/BalanceCell';
import { ExternalIcon, CoinsIcon, KeyIcon, SeedIcon } from '@components/Icons';
import { isNonZeroRaw } from '@lib/format';
import { downloadCsv } from '@lib/csv';

interface ResultsTableProps {
  kind: 'privateKey' | 'mnemonic';
  rows: DerivedRow[];
  states: Map<string, AccountState>;
  loading: boolean;
  deriving: boolean;
  selectedPosition?: bigint;
  permalink: (entry: bigint) => string;
  page: bigint;
}

export function ResultsTable({ kind, rows, states, loading, deriving, selectedPosition, permalink, page }: ResultsTableProps) {
  const placeholders = deriving ? Math.max(0, 20 - rows.length) : 0;

  return (
    <><div className="table-actions"><button className="btn" type="button" disabled={deriving} onClick={() => downloadCsv(`nano-${kind === 'privateKey' ? 'private-keys' : 'mnemonics'}-page-${page}`, [[kind === 'privateKey' ? 'Private key index' : 'Mnemonic index', kind === 'privateKey' ? 'Private key HEX' : 'Mnemonic', 'Account index', 'Private key HEX', 'Public key HEX', 'Account address', 'Balance raw', 'Receivable raw', 'Opened'], ...rows.map(row => { const state = states.get(row.address); return [row.position, kind === 'privateKey' ? row.privateKeyHex : row.mnemonic, row.accountIndex, row.privateKeyHex, row.publicKeyHex, row.address, state?.balanceRaw, state?.receivableRaw, state?.opened]; })])}>Export as .csv</button></div><div className="results" aria-busy={deriving || loading}>
      <div className="results__head">
        <span className="results__head--key">
          {kind === 'privateKey' ? <KeyIcon width={13} height={13} /> : <SeedIcon width={13} height={13} />}
          {kind === 'privateKey' ? 'Private key' : 'Mnemonic'}
        </span>
        <span className="results__head--address">
          <KeyIcon width={13} height={13} />
          Public key / Nano address
        </span>
        <span className="results__head--balance">
          <CoinsIcon width={13} height={13} />
          XNO balance
        </span>
      </div>

      {rows.length === 0 && !deriving ? <div className="empty-state">No entries to show for this page.</div> : null}

      {rows.map((row) => (
        <ResultRow
          key={`${row.address}-${row.position}`}
          kind={kind}
          row={row}
          permalink={permalink(row.position)}
          selected={row.position === selectedPosition}
          state={states.get(row.address)}
          loading={loading}
        />
      ))}

      {Array.from({ length: placeholders }).map((_, index) => (
        <div className="row row--unopened" key={`placeholder-${index}`}>
          <div className="cell">
            <span className="skeleton" style={{ width: '78%' }} />
          </div>
          <div className="cell">
            <span className="skeleton" style={{ width: '68%' }} />
          </div>
          <div className="cell">
            <span className="skeleton" style={{ width: 90 }} />
          </div>
        </div>
      ))}
    </div></>
  );
}

function ResultRow({
  kind,
  row,
  state,
  loading,
  selected,
  permalink,
}: {
  kind: 'privateKey' | 'mnemonic';
  row: DerivedRow;
  selected: boolean;
  permalink: string;
  state: AccountState | undefined;
  loading: boolean;
}) {
  const funded = state !== undefined && isNonZeroRaw(state.balanceRaw);
  // Left indicator semantics: golden for a positive balance, green for an
  // account that has seen transactions, neutral otherwise. Blue is reserved
  // for hover/focus.
  const rowClass = funded ? 'row--funded' : state?.opened ? 'row--opened' : 'row--unopened';

  return (
    <div id={`entry-${row.position}`} className={`row ${rowClass}${selected ? ' row--selected' : ''}`}>
      <div className="cell">
        <a className="seed-label row-permalink" href={permalink} aria-label={`Permalink to ${kind === 'privateKey' ? 'private key' : 'mnemonic'} ${row.position}`} aria-current={selected ? 'location' : undefined}>
          {kind === 'privateKey' ? 'Private key' : 'Mnemonic'}
          <span className="seed-label__index">#{row.position.toString()}</span>
        </a>
        <a className="detail-link" href={`${permalink}&detail=${kind === 'privateKey' ? 'key' : 'mnemonic'}`}>Details ↗</a>
        {kind === 'privateKey' ? (
          <SensitiveValue value={row.privateKeyHex} label="private key" />
        ) : (
          <SensitiveValue value={row.mnemonic ?? ''} label="mnemonic phrase" wordWrap />
        )}
        {row.path ? <div className="path">{row.path}</div> : null}
      </div>

      <div className="cell">
        <div className="seed-label">{kind === 'mnemonic' ? `Account ${row.accountIndex ?? 0} address` : 'Account address'}</div>
        <div className="keybox">
          <div className="address">{row.address}</div>
          <CopyButton value={row.address} label="address" />
          <a
            className="icon-btn"
            href={`https://blocklattice.io/account/${row.address}`}
            target="_blank"
            rel="noreferrer noopener"
            title="Open in blocklattice.io"
            aria-label="Open in blocklattice.io"
          >
            <ExternalIcon width={15} height={15} />
          </a>
        </div>
        <div className="path">public key {row.publicKeyHex.toUpperCase()}</div>
      </div>

      <BalanceCell state={state} loading={loading} />
    </div>
  );
}
