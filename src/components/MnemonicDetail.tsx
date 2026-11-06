import { useEffect, useMemo, useState } from 'react';
import { readUrlState, DEFAULT_OPTIONS, writeUrlState } from '@lib/urlState';
import { METHOD_META, totalEntries, type DerivedRow, type MnemonicMethod } from '@lib/keyspace';
import { entropyToMnemonic } from '@lib/mnemonic';
import { bip39Seed } from '@lib/seed';
import { privateKeyFromSeed, privateKeyFromBip39Seed, nanoBip44Path, nanoBip44AccountPath, bytesToHex, addressFromPrivateKey, publicKeyFromPrivate } from '@lib/nano';
import { rowPathLabel } from '@lib/derivePage';
import { useAccountStates } from '@hooks/useAccountStates';
import { SensitiveValue } from './SensitiveValue';
import { BalanceCell } from './BalanceCell';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import { downloadCsv } from '@lib/csv';

const query = new URLSearchParams(window.location.search);
const initial = readUrlState(window.location.search);
export function MnemonicDetail() {
 const [options, setOptions] = useState(initial.options ?? DEFAULT_OPTIONS);
 const [page, setPage] = useState(() => /^\d{1,10}$/.test(query.get('page') ?? '') ? Math.max(1, Number(query.get('page'))) : 1);
 const [rows, setRows] = useState<DerivedRow[]>([]);
 const [deriving, setDeriving] = useState(true);
 const [error, setError] = useState('');
 const pages = Math.ceil((METHOD_META[options.method].accountMax + 1) / 20);
 const current = Math.min(page, pages);
 const entry = initial.entry;
 const phrase = useMemo(() => {
  if (entry === undefined || entry >= totalEntries('mnemonic', options)) return null;
  const hex = entry.toString(16).padStart(options.wordCount === 12 ? 32 : 64, '0');
  const entropy = Uint8Array.from(hex.match(/../g)!, x => parseInt(x, 16));
  return { entropy, words: entropyToMnemonic(entropy) };
 }, [entry, options.wordCount]);
 const seed = useMemo(() => phrase ? bip39Seed(phrase.words, options.passphrase ?? '') : null, [phrase, options.passphrase]);
 useEffect(() => {
  let active = true; setDeriving(true); setError(''); setRows([]);
  async function derive() {
   if (!phrase || entry === undefined || !seed) return [];
   const master = await seed;
   return Array.from({length: Math.min(20, METHOD_META[options.method].accountMax + 1 - (current - 1) * 20)}, (_, offset) => {
    const accountIndex = (current - 1) * 20 + offset;
    const key = options.method === 'legacyNano' ? privateKeyFromSeed(phrase.entropy, accountIndex) : options.method === 'bip39Seed' ? privateKeyFromSeed(master.slice(0,32), accountIndex) : privateKeyFromBip39Seed(master, options.method === 'bip39Account' ? nanoBip44AccountPath(accountIndex) : nanoBip44Path(accountIndex));
    return { position: entry, accountIndex, privateKey: key, privateKeyHex: bytesToHex(key), publicKeyHex: bytesToHex(publicKeyFromPrivate(key)), address: addressFromPrivateKey(key), path: rowPathLabel(options, accountIndex) };
   });
  }
  derive().then(value => {if(active) {setRows(value); setDeriving(false);}}).catch(e => {if(active) {setError(String(e)); setDeriving(false);}});
  return () => {active = false;};
 }, [phrase, seed, options.method, current, entry]);
 useEffect(() => {
  if(entry === undefined) return;
  const params = new URLSearchParams(writeUrlState({kind:'mnemonic', page:1n, entry, options, accountIndex:0}, window.location.search));
  params.set('detail','mnemonic'); if(current > 1) params.set('page',String(current));
  window.history.replaceState(null,'',`?${params}`);
 }, [current, options, entry]);
 const addresses = useMemo(() => rows.map(row => row.address), [rows]);
 const {states, loading, error: rpcError} = useAccountStates(addresses);
 if(!phrase || entry === undefined) return <><SiteHeader active="mnemonics"/><main className="container detail-page">Invalid mnemonic position. <a href="/">Home</a></main><SiteFooter/></>;
 return <><SiteHeader active="mnemonics"/><main className="container detail-page">
 <div className="breadcrumb"><a href="/">Home</a> / Nano mnemonic</div>
 <section className="card card__section"><h1>Mnemonic #{entry.toString()}</h1><SensitiveValue value={phrase.words} label="mnemonic" wordWrap/><p>Entropy: <code>{bytesToHex(phrase.entropy)}</code></p></section>
 <section className="card card__section"><label>Derivation method <select className="select" value={options.method} onChange={e => {setOptions({...options,method:e.target.value as MnemonicMethod});setPage(1);}}>{Object.values(METHOD_META).map(meta => <option key={meta.method} value={meta.method} disabled={!meta.wordCounts.includes(options.wordCount)}>{meta.label}</option>)}</select></label>
 {METHOD_META[options.method].passphrase && <label>BIP39 passphrase<input className="input" autoComplete="off" value={options.passphrase ?? ''} onChange={e => {setOptions({...options,passphrase:e.target.value});setPage(1);}}/></label>}</section>
 <section className="card card__section controls__row"><button className="btn" onClick={()=>setPage(1)} disabled={current===1}>First</button><button className="btn" onClick={()=>setPage(current-1)} disabled={current===1}>Previous</button><span>Account page {current} / {pages}</span><input className="input" aria-label="Account page" type="number" min={1} max={pages} value={current} onChange={e=>setPage(Math.max(1,Number(e.target.value)||1))}/><button className="btn" onClick={()=>setPage(current+1)} disabled={current===pages}>Next</button><button className="btn" onClick={()=>setPage(pages)} disabled={current===pages}>Last</button></section>
 {error || rpcError ? <p role="alert">{error || rpcError}</p> : null}
 <div className="table-actions"><button className="btn" disabled={deriving} onClick={() => downloadCsv(`nano-mnemonic-${entry}-accounts-page-${current}`, [['Mnemonic index', 'Mnemonic', 'Account index', 'Derivation', 'Private key HEX', 'Public key HEX', 'Account address', 'Balance raw', 'Receivable raw', 'Opened'], ...rows.map(row => { const state=states.get(row.address); return [entry, phrase.words, row.accountIndex, row.path, row.privateKeyHex, row.publicKeyHex, row.address, state?.balanceRaw, state?.receivableRaw, state?.opened]; })])}>Export as .csv</button></div>
 <div className="results" aria-busy={deriving || loading}>{rows.map(row => <div className="row" key={row.accountIndex}><div className="cell"><a href={`?view=keys&entry=${BigInt('0x'+row.privateKeyHex)}&detail=key`}>Account #{row.accountIndex}</a><div className="seed-label">Private key</div><SensitiveValue value={row.privateKeyHex} label="private key"/><div className="path">{row.path}</div></div><div className="cell"><div className="seed-label">Account {row.accountIndex} address</div><SensitiveValue value={row.address} label="account address"/><div className="seed-label">Public key</div><div className="path">{row.publicKeyHex}</div></div><BalanceCell state={states.get(row.address)} loading={loading}/></div>)}</div>
 </main><SiteFooter/></>;
}
