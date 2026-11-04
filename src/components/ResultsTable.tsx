import type { DerivedRow } from '@lib/keyspace';
import type { AccountState } from '@lib/api';
import { CopyButton } from '@components/CopyButton';
import { SensitiveValue } from '@components/SensitiveValue';
import { BalanceCell } from '@components/BalanceCell';
import { ExternalIcon, CoinsIcon, KeyIcon, SeedIcon } from '@components/Icons';
import { isNonZeroRaw } from '@lib/format';

interface ResultsTableProps {
  kind: 'privateKey' | 'mnemonic';
  rows: DerivedRow[];
  states: Map<string, AccountState>;
  loading: boolean;
  deriving: boolean;
  selectedPosition?: bigint;
}

export function ResultsTable({ kind, rows, states, loading, deriving, selectedPosition }: ResultsTableProps) {
  const placeholders = deriving ? Math.max(0, 20 - rows.length) : 0;

  return (
    <div className="results" aria-busy={deriving || loading}>
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
    </div>
  );
}

function ResultRow({
  kind,
  row,
  state,
  loading,
  selected,
}: {
  kind: 'privateKey' | 'mnemonic';
  row: DerivedRow;
  selected: boolean;
  state: AccountState | undefined;
  loading: boolean;
}) {
  const funded = state !== undefined && isNonZeroRaw(state.balanceRaw);
  // Left indicator semantics: golden for a positive balance, green for an
  // account that has seen transactions, neutral otherwise. Blue is reserved
  // for hover/focus.
  const rowClass = funded ? 'row--funded' : state?.opened ? 'row--opened' : 'row--unopened';

  return (
    <div className={`row ${rowClass}${selected ? ' row--selected' : ''}`}>
      <div className="cell">
        <div className="seed-label">
          {kind === 'privateKey' ? 'Private key' : 'Mnemonic'}
          <span className="seed-label__index">#{row.position.toString()}</span>
        </div>
        {kind === 'privateKey' ? (
          <SensitiveValue value={row.privateKeyHex} label="private key" />
        ) : (
          <SensitiveValue value={row.mnemonic ?? ''} label="mnemonic phrase" wordWrap />
        )}
        {row.path ? <div className="path">{row.path}</div> : null}
      </div>

      <div className="cell">
        <div className="seed-label">Account address</div>
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
        <div className="path keybox"><span>public key {row.publicKeyHex.toUpperCase()}</span><CopyButton value={row.publicKeyHex.toUpperCase()} label="public key" /></div>
      </div>

      <BalanceCell state={state} loading={loading} />
    </div>
  );
}
