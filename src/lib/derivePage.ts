/**
 * Turns a page index into a pageful of derived accounts, using the keyspace
 * model in `keyspace.ts`. Everything is computed at view-time.
 *
 * Mnemonic derivation is asynchronous because the BIP39 seed uses PBKDF2; the
 * native implementation (WebCrypto or node:crypto) makes a full page fast.
 */

import {
  addressFromPrivateKey,
  bytesToHex,
  privateKeyFromBip39Seed,
  privateKeyFromSeed,
  nanoBip44Path,
  nanoBip44AccountPath,
  publicKeyFromPrivate,
} from './nano';
import { entropyToMnemonic } from './mnemonic';
import { bip39Seed } from './seed';
import {
  PAGE_SIZE,
  type DerivedRow,
  type MnemonicMethod,
  type MnemonicOptions,
  type SeedKind,
  entryBitsFor,
  positionModulo,
  totalPages,
} from './keyspace';

export interface DerivePageRequest {
  kind: SeedKind;
  /** 1-based page number. */
  page: bigint;
  options: MnemonicOptions;
  /** Account index used within the derivation path or seed. */
  accountIndex?: number;
}

/** Base-10 friendly label for the method that produced a row. */
export const METHOD_LABELS: Record<MnemonicMethod, string> = {
  bip39Ledger: 'BIP39 → SLIP-0010',
  bip39Account: 'BIP39 → SLIP-0010 (account)',
  legacyNano: 'Legacy Nano seed',
  bip39Seed: 'BIP39 seed → Nano seed',
};

/** Derivation formula shown on each row, e.g. `m/44'/165'/5'/0'`. */
export function rowPathLabel(options: MnemonicOptions, accountIndex = 0): string {
  switch (options.method) {
    case 'bip39Ledger':
      return nanoBip44Path(accountIndex);
    case 'bip39Account':
      return `${nanoBip44Path(accountIndex)}/0'`;
    case 'legacyNano':
      return `blake2b(seed ‖ ${accountIndex})`;
    case 'bip39Seed':
      return `blake2b(bip39Seed[0:32] ‖ ${accountIndex})`;
  }
}

function bigIntToFixedBytes(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function privateKeyRow(position: bigint, value: bigint): DerivedRow {
  const privateKey = bigIntToFixedBytes(value, 32);
  return {
    position,
    privateKey,
    privateKeyHex: bytesToHex(privateKey),
    publicKeyHex: bytesToHex(publicKeyFromPrivate(privateKey)).toUpperCase(),
    address: addressFromPrivateKey(privateKey),
  };
}

/**
 * Derive the `PAGE_SIZE` rows belonging to a page.
 *
 * Private key pages are pure arithmetic. Mnemonic pages need a PBKDF2 seed per
 * phrase, so those pages resolve asynchronously.
 */
export async function derivePage(request: DerivePageRequest): Promise<DerivedRow[]> {
  const { kind, options } = request;
  const bits = entryBitsFor(kind, options);
  const perPage = (BigInt(1) << BigInt(bits)) < BigInt(PAGE_SIZE) ? 1 : PAGE_SIZE;
  const pages = totalPages(kind, options);
  if (request.page < 1n || request.page > pages) throw new Error('Page out of range');

  const start = (request.page - 1n) * BigInt(perPage);
  const modulus = positionModulo(kind, options) + 1n;
  const accountIndex = request.accountIndex ?? 0;

  if (kind === 'privateKey') {
    const rows: DerivedRow[] = [];
    for (let i = 0; i < perPage; i++) {
      const position = (start + BigInt(i)) % modulus;
      rows.push(privateKeyRow(position, position & ((1n << 256n) - 1n)));
    }
    return rows;
  }

  const rows: DerivedRow[] = [];
  for (let i = 0; i < perPage; i++) {
    const position = (start + BigInt(i)) % modulus;
    const mask = bits === 128 ? (1n << 128n) - 1n : (1n << 256n) - 1n;
    const entropy = bigIntToFixedBytes(position & mask, bits / 8);
    const mnemonic = entropyToMnemonic(entropy);

    let privateKey: Uint8Array;
    switch (options.method) {
      case 'legacyNano':
        // The phrase's 256-bit entropy is the Nano seed itself.
        privateKey = privateKeyFromSeed(entropy, accountIndex);
        break;
      case 'bip39Seed': {
        // A BIP39 seed whose first 32 bytes are used as a Nano seed.
        const seed = await bip39Seed(mnemonic, options.passphrase ?? '');
        privateKey = privateKeyFromSeed(seed.slice(0, 32), accountIndex);
        break;
      }
      case 'bip39Account': {
        const seed = await bip39Seed(mnemonic, options.passphrase ?? '');
        privateKey = privateKeyFromBip39Seed(seed, nanoBip44AccountPath(accountIndex));
        break;
      }
      case 'bip39Ledger':
      default: {
        const seed = await bip39Seed(mnemonic, options.passphrase ?? '');
        privateKey = privateKeyFromBip39Seed(seed, nanoBip44Path(accountIndex));
        break;
      }
    }

    rows.push({
      position,
      privateKey,
      privateKeyHex: bytesToHex(privateKey),
      publicKeyHex: bytesToHex(publicKeyFromPrivate(privateKey)).toUpperCase(),
      address: addressFromPrivateKey(privateKey),
      mnemonic,
      path: rowPathLabel(options, accountIndex),
    });
  }
  return rows;
}

/** The position of the first entry of a page, used for display. */
export function pageStartPosition(page: bigint): bigint {
  return (page - 1n) * BigInt(PAGE_SIZE);
}

/**
 * Random page sampler across the permitted integer range for a keyspace.
 * Uses raw random bytes so sampling stays uniform without float conversion.
 */
export function randomPage(
  kind: SeedKind,
  options: MnemonicOptions,
  randomBytes: (n: number) => Uint8Array,
): bigint {
  const pages = totalPages(kind, options);
  if (pages <= 1n) return 1n;
  const bitWidth = pages.toString(2).length;
  const byteLength = Math.ceil(bitWidth / 8);
  const range = 1n << BigInt(byteLength * 8);
  // Rejection-sample to avoid modulo bias.
  const limit = range - (range % pages);
  for (let attempt = 0; attempt < 64; attempt++) {
    let candidate = 0n;
    for (const byte of randomBytes(byteLength)) candidate = (candidate << 8n) | BigInt(byte);
    if (candidate < limit) return (candidate % pages) + 1n;
  }
  return 1n;
}
