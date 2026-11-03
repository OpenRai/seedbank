/**
 * Mnemonic phrase helpers.
 *
 * The BIP39 word list is bundled locally (`wordlist.ts`) so the browser can
 * convert entropy to a phrase without loading the whole `bip39` package or
 * needing a `Buffer` polyfill. Checksums follow BIP39: the first
 * `ENT/32` bits of `SHA-256(entropy)` are appended to the entropy bits.
 */

import { sha256 } from '@noble/hashes/sha256';
import { WORDLIST } from './wordlist';

/** Entropy sizes in bits that BIP39 allows. */
export const VALID_ENTROPY_BITS = [128, 160, 192, 224, 256] as const;

/**
 * Convert raw entropy bytes into a BIP39 mnemonic phrase.
 *
 * @param entropy 16, 20, 24, 28, or 32 bytes.
 */
export function entropyToMnemonic(entropy: Uint8Array): string {
  const bits = entropy.length * 8;
  if (!VALID_ENTROPY_BITS.includes(bits as (typeof VALID_ENTROPY_BITS)[number])) {
    throw new Error(`Invalid entropy length: ${entropy.length} bytes`);
  }

  const checksumBits = bits / 32;
  const digest = sha256(entropy);

  let bitString = '';
  for (const byte of entropy) bitString += byte.toString(2).padStart(8, '0');
  for (let i = 0; i < checksumBits; i++) {
    bitString += ((digest[i >> 3] >> (7 - (i & 7))) & 1).toString();
  }

  const words: string[] = [];
  for (let i = 0; i < bitString.length; i += 11) {
    const index = parseInt(bitString.slice(i, i + 11), 2);
    words.push(WORDLIST[index]);
  }
  return words.join(' ');
}

/** Number of words in a phrase of the given entropy size. */
export function wordCountForEntropyBits(bits: number): 12 | 15 | 18 | 21 | 24 {
  switch (bits) {
    case 128:
      return 12;
    case 160:
      return 15;
    case 192:
      return 18;
    case 224:
      return 21;
    case 256:
      return 24;
    default:
      throw new Error(`Invalid entropy size: ${bits} bits`);
  }
}
