import { useEffect, useMemo, useState } from 'react';
import { derivePrivateKey } from '@lib/derivePage';
import { formatBigInt, totalEntries } from '@lib/keyspace';
import { DEFAULT_OPTIONS, writeUrlState } from '@lib/urlState';
import { useAccountStates } from '@hooks/useAccountStates';
import { CopyButton } from '@components/CopyButton';
import { KeyIcon, CoinsIcon, WarningIcon } from '@components/Icons';
import { formatXno } from '@lib/format';

function valueRow(label: string, value: string, copy = true) {
  return <div className="detail-value"><strong>{label}</strong><code>{value}</code>{copy ? <CopyButton value={value} label={label.toLowerCase()} /> : null}</div>;
}

export function PrivateKeyDetail() {
  const params = new URLSearchParams(window.location.search);
  const rawEntry = params.get('entry') ?? '';
  const validEntry = /^\d{1,78}$/.test(rawEntry) && BigInt(rawEntry) < totalEntries('privateKey', DEFAULT_OPTIONS);
  const entry = validEntry ? BigInt(rawEntry) : null;
  const row = useMemo(() => entry === null ? null : derivePrivateKey(entry), [rawEntry]);
  const { states, loading, error, degraded } = useAccountStates(row ? [row.address] : []);
  const account = row ? states.get(row.address) : undefined;
  const [decimal, setDecimal] = useState('');
  useEffect(() => { if (entry !== null) setDecimal(entry.toString(10)); }, [entry]);

  if (!row || entry === null) return <main className="container detail-page"><p>Invalid private key position.</p><a href="/">Return to keyspace</a></main>;
  const back = writeUrlState({ kind: 'privateKey', page: (entry / 20n) + 1n, options: DEFAULT_OPTIONS, accountIndex: 0, entry }, window.location.search);
  const balance = account?.balanceRaw === null || account?.balanceRaw === undefined ? '—' : `${formatXno(account.balanceRaw)} XNO`;

  return <main className="container detail-page">
    <div className="breadcrumb"><a href="/">Home</a><span>/</span><span>Nano private key</span></div>
    <h1 className="detail-title"><span>{row.privateKeyHex}</span><span className="chip chip--active">HEX</span></h1>
    <section className="stats detail-stats" aria-busy={loading}>
      <div className="stat"><div className="stat__label stat__label--balance"><CoinsIcon width={13} height={13}/> Balance</div><div className="stat__value stat__value--balance">{balance}</div></div>
      <div className="stat"><div className="stat__label stat__label--opened"><KeyIcon width={13} height={13}/> Account</div><div className="stat__value">{account?.opened === null || account?.opened === undefined ? '—' : account.opened ? 'Opened' : 'Unopened'}</div></div>
      <div className="stat"><div className="stat__label">Position</div><div className="stat__value">#{formatBigInt(entry)}</div></div>
    </section>
    {error || degraded ? <div className="banner banner--warn"><WarningIcon width={16} height={16}/>{error ? `Balance lookup failed: ${error}` : 'RPC lookup degraded; cached data may be shown.'}</div> : null}
    <section className="card detail-card"><h2><KeyIcon width={15} height={15}/> Keys</h2>
      {valueRow('HEX', row.privateKeyHex)}{valueRow('DECIMAL', decimal)}{valueRow('PUBLIC KEY', row.publicKeyHex, false)}
    </section>
    <section className="card detail-card"><h2><CoinsIcon width={15} height={15}/> Nano account</h2>
      {valueRow('ACCOUNT ADDRESS', row.address)}
      <div className="detail-value"><strong>XNO BALANCE</strong><span>{balance}</span>{account?.balanceRaw != null ? <CopyButton value={formatXno(account.balanceRaw)} label="balance"/> : null}</div>
      <div className="detail-value"><strong>STATUS</strong><span>{loading ? 'Loading…' : account?.opened ? 'Opened' : account ? 'Unopened' : '—'}</span></div>
    </section>
    <p className="detail-back"><a className="btn" href={back}>← View in keyspace browser</a></p>
  </main>;
}
