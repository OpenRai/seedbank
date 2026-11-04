/**
 * Derivation tests for seedbank.
 *
 * Runs the real browser derivation modules directly under Node's TypeScript
 * stripping, so these vectors exercise exactly the code shipped to users.
 * The `@lib/*` specifiers used by the app are mapped to `src/lib/*` by
 * `test/loader.mjs`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('./loader.mjs');

const { blake2b } = await import('@noble/hashes/blake2b');
const nano = await import('../src/lib/nano.ts');
const { derivePage } = await import('../src/lib/derivePage.ts');
const { pageInfo, totalPages } = await import('../src/lib/keyspace.ts');
const { entropyToMnemonic } = await import('../src/lib/mnemonic.ts');
const { bip39Seed } = await import('../src/lib/seed.ts');

const hex = (bytes) => nano.bytesToHex(bytes).toUpperCase();

test('public key of the zero private key matches the Nano docs', () => {
  const pub = nano.publicKeyFromPrivate(new Uint8Array(32));
  assert.equal(hex(pub), '19D3D919475DEED4696B5D13018151D1AF88B2BD3BCFF048B45031C1F36D1858');
});

test('address encoding matches the Nano key_expand vector', () => {
  const priv = nano.hexToBytes('781186FB9EF17DB6E3D1056550D9FAE5D5BBADA6A6BC370E4CBB938B1DC71DA3');
  assert.equal(
    hex(nano.publicKeyFromPrivate(priv)),
    '3068BB1CA04525BB0E416C485FE6A67FD52540227D267CC8B6E8DA958A7FA039',
  );
  assert.equal(
    nano.addressFromPrivateKey(priv),
    'nano_1e5aqegc1jb7qe964u4adzmcezyo6o146zb8hm6dft8tkp79za3sxwjym5rx',
  );
});

test('addresses round-trip back to their public key', () => {
  for (let i = 1; i <= 25; i++) {
    const priv = new Uint8Array(32);
    priv[31] = i;
    priv[0] = i * 7;
    const address = nano.addressFromPrivateKey(priv);
    assert.ok(nano.isValidAddress(address), address);
    const pub = nano.publicKeyFromAddress(address);
    assert.equal(hex(pub), hex(nano.publicKeyFromPrivate(priv)));
    assert.equal(nano.addressFromPublicKey(pub), address);
    assert.equal(nano.addressFromPublicKey(pub, 'xrb_'), address.replace('nano_', 'xrb_'));
  }
});

test('tampered addresses fail checksum validation', () => {
  const address = nano.addressFromPrivateKey(new Uint8Array(32).fill(7));
  const tampered = address.slice(0, -1) + (address.endsWith('1') ? '3' : '1');
  assert.equal(nano.isValidAddress(tampered), false);
});

test('traditional Nano seed derivation is BLAKE2b(seed || uint32BE(index))', () => {
  const seed = nano.hexToBytes('0000000000000000000000000000000000000000000000000000000000000000');
  const expected = blake2b(Uint8Array.from([...seed, 0, 0, 0, 0]), { dkLen: 32 });
  assert.equal(hex(nano.privateKeyFromSeed(seed, 0)), hex(expected));
  assert.notEqual(hex(nano.privateKeyFromSeed(seed, 0)), hex(nano.privateKeyFromSeed(seed, 1)));
});

test('BIP39 mnemonic -> SLIP-0010 matches the official Nano test vector', () => {
  const seed = nano.hexToBytes(
    '924a962cae64448812be28a514093ebfeeed537d61a44318eb35f902961d21b2fccd30008d33c8d1d5327a34b9b73281c4b27a0a3d004c1c2e85e8dbb234cba8',
  );
  const priv = nano.privateKeyFromBip39Seed(seed, "m/44'/165'/0'");
  assert.equal(hex(priv), '6F73D61CA0B56FCDB79D69D437F102348AD75CA971433EB92B2B003F8C99B48D');
});

test('the documented 12-word vector produces its reported BIP39 seed', async () => {
  const mnemonic = 'company public remove bread fashion tortoise ahead shrimp onion prefer waste blade';
  const seed = await bip39Seed(mnemonic, '');
  assert.equal(
    hex(seed),
    '924A962CAE64448812BE28A514093EBFEEED537D61A44318EB35F902961D21B2FCCD30008D33C8D1D5327A34B9B73281C4B27A0A3D004C1C2E85E8DBB234CBA8',
  );
});

test('the standard 12-word vector matches the BIP39 reference seed', async () => {
  const mnemonic = `${'abandon '.repeat(11)}about`;
  const seed = await bip39Seed(mnemonic, '');
  assert.equal(
    hex(seed),
    '5EB00BBDDCF069084889A8AB9155568165F5C453CCB85E70811AAED6F6DA5FC19A5AC40B389CD370D086206DEC8AA6C43DAEA6690F20AD3D8D48B2D2CE9E38E4',
  );
});

test('BIP39 entropy converts to the expected phrase', () => {
  const entropy = nano.hexToBytes('00000000000000000000000000000000');
  assert.equal(entropyToMnemonic(entropy), `${'abandon '.repeat(11)}about`);
});

test('a BIP39 passphrase changes the seed', async () => {
  const mnemonic = `${'abandon '.repeat(11)}about`;
  const plain = await bip39Seed(mnemonic, '');
  const withPassphrase = await bip39Seed(mnemonic, 'TREZOR');
  assert.notEqual(hex(plain), hex(withPassphrase));
});

test('rejects unhardened path segments for Ed25519', () => {
  assert.throws(() => nano.parseDerivationPath("m/44'/165/0'"), /must be hardened/);
});

test('private key pages derive deterministic, unique entries', async () => {
  const options = { wordCount: 12, method: 'bip39Ledger' };
  const page = await derivePage({ kind: 'privateKey', page: 1n, options });
  assert.equal(page.length, 20);
  assert.equal(new Set(page.map((row) => row.address)).size, 20);
  for (const row of page) {
    assert.match(row.address, /^nano_[13-9a-z]+$/);
    assert.equal(row.privateKeyHex.length, 64);
    assert.equal(row.publicKeyHex.length, 64);
  }
});

test('page N starts where page N-1 ended', async () => {
  const options = { wordCount: 12, method: 'bip39Ledger' };
  const first = await derivePage({ kind: 'privateKey', page: 1n, options });
  const second = await derivePage({ kind: 'privateKey', page: 2n, options });
  assert.equal(first[19].position + 1n, second[0].position);
  assert.notEqual(first[0].address, second[0].address);
});

test('mnemonic pages produce valid, distinct phrases for both word counts', async () => {
  for (const wordCount of [12, 24]) {
    const options = { wordCount, method: 'bip39Ledger' };
    const rows = await derivePage({ kind: 'mnemonic', page: 1n, options });
    assert.equal(rows.length, 20);
    assert.equal(new Set(rows.map((row) => row.mnemonic)).size, 20);
    for (const row of rows) {
      assert.equal(row.mnemonic.split(' ').length, wordCount);
      assert.ok(row.address.startsWith('nano_'));
      assert.equal(row.path, "m/44'/165'/0'");
    }
  }
});

test('legacy Nano mnemonics derive through the Nano seed rule', async () => {
  const options = { wordCount: 24, method: 'legacyNano' };
  const rows = await derivePage({ kind: 'mnemonic', page: 2n, options, accountIndex: 0 });
  assert.equal(rows.length, 20);
  for (const row of rows) assert.match(row.path, /^blake2b/);
});

test('bip39Seed treats the BIP39 seed as a Nano seed', async () => {
  const options = { wordCount: 12, method: 'bip39Seed' };
  const rows = await derivePage({ kind: 'mnemonic', page: 1n, options, accountIndex: 0 });
  assert.equal(rows.length, 20);
  for (const row of rows) assert.match(row.path, /^blake2b\(bip39Seed/);
});

test('bip39Account appends a fixed change segment', async () => {
  const options = { wordCount: 12, method: 'bip39Account' };
  const rows = await derivePage({ kind: 'mnemonic', page: 1n, options, accountIndex: 3 });
  assert.equal(rows[0].path, "m/44'/165'/3'/0'");
});

test('the bip39Account and bip39Ledger paths differ for the same phrase', async () => {
  const ledger = await derivePage({ kind: 'mnemonic', page: 1n, options: { wordCount: 12, method: 'bip39Ledger' }, accountIndex: 0 });
  const account = await derivePage({ kind: 'mnemonic', page: 1n, options: { wordCount: 12, method: 'bip39Account' }, accountIndex: 0 });
  assert.equal(ledger[0].mnemonic, account[0].mnemonic);
  assert.notEqual(ledger[0].address, account[0].address);
});

test('legacy Nano accepts the full uint32 index range', async () => {
  const options = { wordCount: 24, method: 'legacyNano' };
  const rows = await derivePage({ kind: 'mnemonic', page: 1n, options, accountIndex: 0xffffffff });
  assert.equal(rows.length, 20);
  assert.match(rows[0].path, /4294967295/);
});

test('a BIP39 passphrase changes the derived account', async () => {
  const base = { wordCount: 12, method: 'bip39Ledger' };
  const plain = await derivePage({ kind: 'mnemonic', page: 1n, options: base });
  const withPassphrase = await derivePage({
    kind: 'mnemonic',
    page: 1n,
    options: { ...base, passphrase: 'some password' },
  });
  assert.equal(plain[0].mnemonic, withPassphrase[0].mnemonic);
  assert.notEqual(plain[0].address, withPassphrase[0].address);
});

test('the bip39Seed passphrase changes the Nano seed', async () => {
  const base = { wordCount: 12, method: 'bip39Seed' };
  const plain = await derivePage({ kind: 'mnemonic', page: 1n, options: base });
  const withPassphrase = await derivePage({
    kind: 'mnemonic',
    page: 1n,
    options: { ...base, passphrase: 'salt' },
  });
  assert.equal(plain[0].mnemonic, withPassphrase[0].mnemonic);
  assert.notEqual(plain[0].address, withPassphrase[0].address);
});

test('legacy Nano ignores the passphrase', async () => {
  const base = { wordCount: 24, method: 'legacyNano' };
  const plain = await derivePage({ kind: 'mnemonic', page: 1n, options: base });
  const withPassphrase = await derivePage({
    kind: 'mnemonic',
    page: 1n,
    options: { ...base, passphrase: 'ignored' },
  });
  assert.equal(plain[0].address, withPassphrase[0].address);
});

test('account index changes the derived address but not the phrase', async () => {
  const options = { wordCount: 12, method: 'bip39Ledger' };
  const accountZero = await derivePage({ kind: 'mnemonic', page: 1n, options, accountIndex: 0 });
  const accountFive = await derivePage({ kind: 'mnemonic', page: 1n, options, accountIndex: 5 });
  assert.equal(accountZero[0].mnemonic, accountFive[0].mnemonic);
  assert.notEqual(accountZero[0].address, accountFive[0].address);
  assert.equal(accountFive[0].path, "m/44'/165'/5'");
});

test('out-of-range pages are rejected', async () => {
  const options = { wordCount: 12, method: 'bip39Ledger' };
  await assert.rejects(() => derivePage({ kind: 'privateKey', page: 0n, options }), /out of range/);
  const pages = totalPages('privateKey', options);
  await assert.rejects(
    () => derivePage({ kind: 'privateKey', page: pages + 1n, options }),
    /out of range/,
  );
});

test('keyspace metadata reports the full page count and honest coverage', () => {
  const info = pageInfo('privateKey', { wordCount: 12, method: 'bip39Ledger' });
  assert.equal(info.exact, true);
  assert.equal(info.pages, ((1n << 256n) + 19n) / 20n);
  assert.equal(
    info.pagesDisplay,
    '5,789,604,461,865,809,771,178,549,250,434,395,392,663,499,233,282,028,201,972,879,200,395,656,481,997',
  );
  assert.equal(info.coverageDisplay, '0.00000%');
});
