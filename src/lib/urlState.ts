import { pageForPosition } from './navigation';
import { MAX_PAGE_DIGITS, totalEntries, wordCountForMethod, type SeedKind, type MnemonicMethod, type MnemonicOptions } from '@lib/keyspace';

export interface KeyspaceUrlState {
  kind: SeedKind;
  page: bigint;
  options: MnemonicOptions;
  accountIndex: number;
  entry?: bigint;
}

export const DEFAULT_OPTIONS: MnemonicOptions = {
  wordCount: 12,
  method: 'bip39Ledger',
};

export function readUrlState(search: string): Partial<KeyspaceUrlState> {
  const params = new URLSearchParams(search);
  const state: Partial<KeyspaceUrlState> = {};

  const view = params.get('view');
  if (view === 'keys' || view === 'mnemonics') state.kind = view === 'keys' ? 'privateKey' : 'mnemonic';

  const page = params.get('page');
  if (page && page.length <= MAX_PAGE_DIGITS && /^\d+$/.test(page)) state.page = BigInt(page);

  const words = params.get('words');
  if (words === '12' || words === '24') state.options = { ...DEFAULT_OPTIONS, wordCount: Number(words) as 12 | 24 };

  const method = params.get('method');
  if (
    method === 'bip39Ledger' ||
    method === 'bip39Account' ||
    method === 'legacyNano' ||
    method === 'bip39Seed'
  ) {
    state.options = {
      ...(state.options ?? DEFAULT_OPTIONS),
      method: method as MnemonicMethod,
    };
  }

  const account = params.get('account');
  if (account && /^\d{1,10}$/.test(account)) state.accountIndex = Number(account);

  /* A shared URL may pair a method with an unsupported word count, e.g.
   * `?words=12&method=legacyNano`. Normalise it the same way the controls do
   * so the selected method and phrase length always agree. */
  if (state.options) {
    state.options = {
      ...state.options,
      wordCount: wordCountForMethod(state.options.method, state.options.wordCount),
    };
  }

  const entry = params.get('entry');
  if (entry && entry.length <= MAX_PAGE_DIGITS && /^\d+$/.test(entry)) {
    const position = BigInt(entry);
    if (position < totalEntries(state.kind ?? 'privateKey', state.options ?? DEFAULT_OPTIONS)) {
      state.entry = position;
      state.page = pageForPosition(position);
    }
  }

  return state;
}

export function writeUrlState(state: KeyspaceUrlState, search = ''): string {
  const params = new URLSearchParams();
  params.set('view', state.kind === 'privateKey' ? 'keys' : 'mnemonics');
  if (state.entry !== undefined) {
    if (state.entry < 0n || state.entry >= totalEntries(state.kind, state.options)) {
      throw new RangeError('Entry out of range');
    }
    params.set('entry', state.entry.toString());
  } else if (state.page > 1n) params.set('page', state.page.toString());
  if (state.kind === 'mnemonic') {
    params.set('words', String(state.options.wordCount));
    params.set('method', state.options.method);
    if (state.accountIndex !== 0) params.set('account', String(state.accountIndex));
  }
  const lookups = new URLSearchParams(search).get('lookups');
  if (lookups) params.set('lookups', lookups);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function replaceUrl(state: KeyspaceUrlState): void {
  const next = `${window.location.pathname}${writeUrlState(state, window.location.search)}`;
  window.history.replaceState(null, '', next);
}
