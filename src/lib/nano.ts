/**
 * Nano key derivation primitives.
 *
 * All Nano-specific rules live here so they can be unit-tested against the
 * vectors published in the Nano documentation:
 *  - Public key from private key: Ed25519 with BLAKE2b-512 (not SHA-512).
 *  - Address encoding: 260-bit base32 with a 5-byte BLAKE2b-40 checksum.
 *  - Seed derivation: PrivK[i] = BLAKE2b-256(seed || uint32BE(i)).
 *  - Mnemonic derivation: BIP39 -> SLIP-0010 Ed25519 -> m/44'/165'/i'.
 *
 * This module has no dependencies beyond the noble primitives, so it runs
 * unchanged in the browser, in a worker, and under Node.
 */

import { blake2b } from '@noble/hashes/blake2b';
import { ed25519 } from '@noble/curves/ed25519';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha512';

/** Nano address alphabet (no 0, l, v, or i). */
export const NANO_ALPHABET = '13456789abcdefghijkmnopqrstuwxyz';

const CURVE_ORDER = ed25519.CURVE.n;
const HARDENED = 0x80000000;

/* ------------------------------------------------------------------ */
/* Byte helpers                                                        */
/* ------------------------------------------------------------------ */

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, '');
  if (clean.length % 2 !== 0) throw new Error('Hex string must have an even length');
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error('Invalid hex characters');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToNumberLE(bytes: Uint8Array): bigint {
  let x = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) x = (x << 8n) | BigInt(bytes[i]);
  return x;
}

export function bigintToBytes(value: bigint, length: number, littleEndian = false): Uint8Array {
  if (value < 0n) throw new Error('Cannot serialise a negative integer');
  const out = new Uint8Array(length);
  let v = value;
  for (let i = 0; i < length; i++) {
    const index = littleEndian ? i : length - 1 - i;
    out[index] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) throw new Error(`Value does not fit in ${length} bytes`);
  return out;
}

export function bytesToBigint(bytes: Uint8Array, littleEndian = false): bigint {
  const ordered = littleEndian ? Uint8Array.from(bytes).reverse() : bytes;
  let x = 0n;
  for (const b of ordered) x = (x << 8n) | BigInt(b);
  return x;
}

/* ------------------------------------------------------------------ */
/* Keys and addresses                                                  */
/* ------------------------------------------------------------------ */

/**
 * Derive the 32-byte Ed25519 public key from a 32-byte private key, using
 * BLAKE2b-512 as the internal hash (Nano's ED25519-BLAKE2b variant).
 */
export function publicKeyFromPrivate(privateKey: Uint8Array): Uint8Array {
  if (privateKey.length !== 32) throw new Error('Private key must be 32 bytes');
  const hash = blake2b(privateKey, { dkLen: 64 });
  const scalar = hash.slice(0, 32);
  scalar[0] &= 248;
  scalar[31] &= 127;
  scalar[31] |= 64;
  const reduced = bytesToNumberLE(scalar) % CURVE_ORDER;
  const point = ed25519.Point.BASE.multiply(reduced === 0n ? 1n : reduced);
  return point.toRawBytes();
}

function base32Encode(bits: string): string {
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    out += NANO_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function toBits(bytes: Uint8Array): string {
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  return bits;
}

/** Encode a 32-byte public key as a `nano_` address (checksum included). */
export function addressFromPublicKey(publicKey: Uint8Array, prefix = 'nano_'): string {
  if (publicKey.length !== 32) throw new Error('Public key must be 32 bytes');
  const body = base32Encode('0000' + toBits(publicKey));
  const checksumBytes = Uint8Array.from(blake2b(publicKey, { dkLen: 5 })).reverse();
  return prefix + body + base32Encode(toBits(checksumBytes));
}

export function addressFromPrivateKey(privateKey: Uint8Array, prefix = 'nano_'): string {
  return addressFromPublicKey(publicKeyFromPrivate(privateKey), prefix);
}

/** Decode a `nano_`/`xrb_` address back into its 32-byte public key. */
export function publicKeyFromAddress(address: string): Uint8Array {
  const trimmed = address.trim();
  const match = /^(nano_|xrb_)([0-9a-z]+)$/.exec(trimmed);
  if (!match) throw new Error('Address must start with nano_ or xrb_');
  const body = match[2];
  if (body.length !== 60) throw new Error('Address has an invalid length');
  for (const ch of body) {
    if (NANO_ALPHABET.indexOf(ch) === -1) throw new Error(`Invalid character "${ch}" in address`);
  }
  let bits = '';
  for (const ch of body) bits += NANO_ALPHABET.indexOf(ch).toString(2).padStart(5, '0');

  const keyBits = bits.slice(0, 260);
  const checksumBits = bits.slice(260);
  const keyBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) keyBytes[i] = parseInt(keyBits.slice(i * 8 + 4, i * 8 + 12), 2);

  const checksumBytes = new Uint8Array(5);
  for (let i = 0; i < 5; i++) checksumBytes[i] = parseInt(checksumBits.slice(i * 8, i * 8 + 8), 2);

  const expected = Uint8Array.from(blake2b(keyBytes, { dkLen: 5 })).reverse();
  if (bytesToHex(expected) !== bytesToHex(checksumBytes)) throw new Error('Address checksum mismatch');
  return keyBytes;
}

export function isValidAddress(address: string): boolean {
  try {
    publicKeyFromAddress(address);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Traditional Nano seed derivation                                    */
/* ------------------------------------------------------------------ */

/** PrivK[i] = BLAKE2b-256(seed || uint32BE(i)). */
export function privateKeyFromSeed(seed: Uint8Array, index: number): Uint8Array {
  if (seed.length !== 32) throw new Error('Nano seed must be 32 bytes');
  if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) {
    throw new Error('Index must be a uint32');
  }
  const input = new Uint8Array(36);
  input.set(seed, 0);
  input.set(bigintToBytes(BigInt(index), 4), 32);
  return blake2b(input, { dkLen: 32 });
}

/* ------------------------------------------------------------------ */
/* SLIP-0010 Ed25519 derivation (for BIP39 mnemonics)                  */
/* ------------------------------------------------------------------ */

export interface Slip10Node {
  key: Uint8Array;
  chainCode: Uint8Array;
}

const ED25519_SEED_KEY = new TextEncoder().encode('ed25519 seed');

export function slip10MasterKey(seed: Uint8Array): Slip10Node {
  const I = hmac(sha512, ED25519_SEED_KEY, seed);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

export function slip10DeriveChild(node: Slip10Node, index: number): Slip10Node {
  if (index < HARDENED) throw new Error('Ed25519 (SLIP-0010) supports hardened derivation only');
  const data = new Uint8Array(37);
  data[0] = 0;
  data.set(node.key, 1);
  data.set(bigintToBytes(BigInt(index), 4), 33);
  const I = hmac(sha512, node.chainCode, data);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

/** Parse units of a `m/44'/165'/0'` style path into hardened uint32 indices. */
export function parseDerivationPath(path: string): number[] {
  const parts = path.trim().replace(/^m\/?/i, '').split('/').filter(Boolean);
  return parts.map((segment) => {
    const hardened = segment.endsWith("'") || segment.endsWith('h') || segment.endsWith('H');
    const value = parseInt(segment.replace(/['hH]/g, ''), 10);
    if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid path segment "${segment}"`);
    if (!hardened) throw new Error(`Segment "${segment}" must be hardened for Ed25519`);
    if (value >= HARDENED) throw new Error(`Path segment "${segment}" is out of range`);
    return HARDENED + value;
  });
}

/** Derive a private key from a BIP39 seed along a hardened path. */
export function privateKeyFromBip39Seed(seed: Uint8Array, path: string): Uint8Array {
  let node = slip10MasterKey(seed);
  for (const index of parseDerivationPath(path)) node = slip10DeriveChild(node, index);
  return node.key;
}

export const NANO_COIN_PATH = "m/44'/165'";
export function nanoBip44Path(index: number): string {
  return `${NANO_COIN_PATH}/${index}'`;
}

/** The BIP44 account-level path with a fixed change segment, used by wallets
 *  that mirror the account/change structure (m/44'/165'/i'/0'). */
export function nanoBip44AccountPath(index: number): string {
  return `${nanoBip44Path(index)}/0'`;
}
