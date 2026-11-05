/**
 * Page-based keyspace model.
 *
 * Pages are one-based; entry positions are zero-based. Page p starts at
 * (p - 1) * PAGE_SIZE. The final page contains any remaining entries.
 *
 * Private key pages enumerate 256-bit integers directly.
 * Mnemonic pages enumerate their underlying entropy pools (128 or 256 bits).
 */

export const PAGE_SIZE = 20;

/** Longest page number accepted from a URL or the page field. The real
 *  maximum is 2^256 / PAGE_SIZE, a 76-digit number, so this leaves headroom
 *  while keeping pathological input bounded. */
export const MAX_PAGE_DIGITS = 100;

export type SeedKind = 'privateKey' | 'mnemonic';

/**
 * Mnemonic derivation methods, distinct in how the phrase becomes a key.
 *
 *  - `bip39Ledger`   BIP39 → SLIP-0010 Ed25519, path `m/44'/165'/i'`.
 *                     The path documented for the Ledger Nano S/X app and
 *                     reproduced by Magnum, Trust, Cake, and Ian Coleman.
 *  - `bip39Account`  The same SLIP-0010 chain with an extra change level,
 *                     `m/44'/165'/i'/0'`, used by wallets that mirror the
 *                     BIP44 account/change structure.
 *  - `legacyNano`    A 24-word mnemonic whose 256-bit entropy *is* the 32-byte
 *                     Nano seed; PrivK[i] = BLAKE2b-256(seed ‖ uint32BE(i)).
 *                     Natrium, Kalium, Exodus, Cannon.
 *  - `bip39Seed`     A BIP39 seed (12 or 24 words) whose first 32 bytes are
 *                     treated as a Nano seed, then put through the traditional
 *                     BLAKE2b rule. The "BIP39 seed as Nano seed" pattern.
 *
 * Subaccount support and the legal index range differ per method, so both are
 * described explicitly rather than assumed.
 */
export type MnemonicMethod = 'bip39Ledger' | 'bip39Account' | 'legacyNano' | 'bip39Seed';

export interface MnemonicOptions {
  /** Words per phrase: 12 (128-bit entropy) or 24 (256-bit entropy). */
  wordCount: 12 | 24;
  method: MnemonicMethod;
  /** BIP39 passphrase (the "25th word"), used by every BIP39-based method. */
  passphrase?: string;
}

/** Per-method facts the UI needs to render controls accurately. */
export interface MethodMeta {
  method: MnemonicMethod;
  label: string;
  /** Whether the method derives more than one key per phrase. */
  supportsSubaccounts: boolean;
  /** Highest legal account index (inclusive). */
  accountMax: number;
  /** Entropy sizes this method is meaningful for. */
  wordCounts: readonly (12 | 24)[];
  /** Whether a BIP39 passphrase changes the result. */
  passphrase: boolean;
}

function bip44Path(index: number): string {
  return `m/44'/165'/${index}'`;
}

/** The derivation formula a method applies, shown verbatim in the UI. */
export function methodFormula(method: MnemonicMethod, accountIndex: number): string {
  switch (method) {
    case 'bip39Ledger':
      return bip44Path(accountIndex);
    case 'bip39Account':
      return `${bip44Path(accountIndex)}/0'`;
    case 'legacyNano':
      return `blake2b(seed ‖ ${accountIndex})`;
    case 'bip39Seed':
      return `blake2b(bip39Seed[0:32] ‖ ${accountIndex})`;
  }
}

export const METHOD_META: Record<MnemonicMethod, MethodMeta> = {
  bip39Ledger: {
    method: 'bip39Ledger',
    label: 'BIP39 → SLIP-0010 (Ledger, Magnum, Trust)',
    supportsSubaccounts: true,
    accountMax: 0x7fffffff,
    wordCounts: [12, 24],
    passphrase: true,
  },
  bip39Account: {
    method: 'bip39Account',
    label: 'BIP39 → SLIP-0010 · m/44′/165′/i′/0′',
    supportsSubaccounts: true,
    accountMax: 0x7fffffff,
    wordCounts: [12, 24],
    passphrase: true,
  },
  legacyNano: {
    method: 'legacyNano',
    label: 'Legacy Nano seed (Natrium, Exodus)',
    supportsSubaccounts: true,
    accountMax: 0xffffffff,
    wordCounts: [24],
    passphrase: false,
  },
  bip39Seed: {
    method: 'bip39Seed',
    label: 'BIP39 seed → Nano seed (BLAKE2b)',
    supportsSubaccounts: true,
    accountMax: 0xffffffff,
    wordCounts: [12, 24],
    passphrase: true,
  },
};

/** Pick a method that supports the requested word count, preferring the
 *  current method when it already does. */
export function methodForWordCount(wordCount: 12 | 24, current: MnemonicMethod): MnemonicMethod {
  if (METHOD_META[current].wordCounts.includes(wordCount)) return current;
  for (const meta of Object.values(METHOD_META)) {
    if (meta.wordCounts.includes(wordCount)) return meta.method;
  }
  return current;
}

/** Pick a word count the method supports, preferring the current one. */
export function wordCountForMethod(method: MnemonicMethod, current: 12 | 24): 12 | 24 {
  const wordCounts = METHOD_META[method].wordCounts;
  return wordCounts.includes(current) ? current : wordCounts[0];
}

export const ENTRY_BITS: Record<SeedKind, number> = {
  privateKey: 256,
  mnemonic: 128,
};

export function entryBitsFor(kind: SeedKind, options: MnemonicOptions): number {
  if (kind === 'mnemonic') return options.wordCount === 24 ? 256 : 128;
  return ENTRY_BITS.privateKey;
}

/** Number of entries in the whole keyspace. */
export function totalEntries(kind: SeedKind, options: MnemonicOptions): bigint {
  return 1n << BigInt(entryBitsFor(kind, options));
}

export function totalPages(kind: SeedKind, options: MnemonicOptions): bigint {
  const count = totalEntries(kind, options);
  return (count + BigInt(PAGE_SIZE) - 1n) / BigInt(PAGE_SIZE);
}

export interface PageInfo {
  /** Total number of pages in the keyspace. */
  pages: bigint;
  /** Human readable page count, with thousands separators. */
  pagesDisplay: string;
  /** Coverage of one page, e.g. `0.00000%`. */
  coverageDisplay: string;
  /** Whether `pages` is the exact total. */
  exact: boolean;
  /** Log10 of the page count, used to scale the decorative progress bar. */
  pagesLog10: number;
}

/** Decimal places shown for page coverage, matching the reference explorer. */
const COVERAGE_DECIMALS = 5;

/**
 * Coverage of a single page as a percentage, expressed as one part in the
 * number of pages. For a 2^256 keyspace this is 0.00000%, which is the honest
 * answer; the exact fraction is exposed separately for anyone who wants it.
 */
export function pageInfo(kind: SeedKind, options: MnemonicOptions): PageInfo {
  const pages = totalPages(kind, options);

  const scale = 10n ** BigInt(COVERAGE_DECIMALS);
  const scaled = (100n * scale) / (pages > 1n ? pages : 1n);
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(COVERAGE_DECIMALS, '0');
  const coverageDisplay = `${whole}.${fraction}%`;

  return {
    pages,
    pagesDisplay: formatBigInt(pages),
    coverageDisplay,
    exact: true,
    pagesLog10: pages.toString().length - 1,
  };
}

/** The exact, non-rounded coverage fraction, for tooltips and detail views. */
export function coverageFraction(kind: SeedKind, options: MnemonicOptions): string {
  const pages = totalPages(kind, options);
  return `1 / ${formatBigInt(pages > 1n ? pages : 1n)}`;
}

/** Format a non-negative integer with thousands separators. */
export function formatBigInt(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Whether the keyspace is small enough to expose an exact "last page" number. */
export function isPageCountExact(kind: SeedKind, options: MnemonicOptions): boolean {
  return pageInfo(kind, options).exact;
}

export interface DerivedRow {
  /** Absolute position of this entry in the keyspace. */
  position: bigint;
  /** Private key bytes for this entry. */
  privateKey: Uint8Array;
  /** mnano_ address derived from the private key. */
  address: string;
  /** Public key hex for display. */
  publicKeyHex: string;
  /** Private key hex for display. */
  privateKeyHex: string;
  /** Mnemonic phrase, when this row came from a mnemonic page. */
  mnemonic?: string;
  /** Account index used to derive this mnemonic's account. */
  accountIndex?: number;
  /** Derivation path, when this row came from a mnemonic page. */
  path?: string;
}

const MAX_UINT256 = (1n << 256n) - 1n;

/** Highest representable keyspace position for the given entry width. */
export function positionModulo(kind: SeedKind, options: MnemonicOptions): bigint {
  return entryBitsFor(kind, options) === 128 ? (1n << 128n) - 1n : MAX_UINT256;
}
