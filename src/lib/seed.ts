/**
 * Fast BIP39 seed derivation.
 *
 * The reference `bip39` package derives seeds with a pure-JavaScript PBKDF2,
 * which costs roughly 150 ms per phrase — far too slow for a page of twenty.
 * WebCrypto's native PBKDF2 does the same work in about 3 ms, and is present
 * in every modern browser as well as in Node 18+. The JavaScript
 * implementation is kept only as a fallback.
 */

import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha512 } from '@noble/hashes/sha512';

/** BIP39 requires NFKD normalisation of both mnemonic and passphrase. */
function normalise(value: string): string {
  return value.normalize('NFKD');
}

/** WebCrypto PBKDF2, available in browsers and in modern Node. */
async function webCryptoPbkdf2(password: string, salt: string): Promise<Uint8Array | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const key = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
      'deriveBits',
    ]);
    const bits = await subtle.deriveBits(
      { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 2048, hash: 'SHA-512' },
      key,
      512,
    );
    return new Uint8Array(bits);
  } catch {
    return null;
  }
}

/**
 * Derive the 64-byte BIP39 seed for a mnemonic phrase.
 *
 * @param mnemonic    Space-separated BIP39 words.
 * @param passphrase  Optional BIP39 passphrase (the "25th word").
 */
export async function bip39Seed(mnemonic: string, passphrase = ''): Promise<Uint8Array> {
  const password = normalise(mnemonic);
  const salt = normalise(`mnemonic${passphrase}`);

  const native = await webCryptoPbkdf2(password, salt);
  if (native) return native;

  // Pure-JavaScript fallback.
  return pbkdf2(sha512, password, salt, { c: 2048, dkLen: 64 });
}
