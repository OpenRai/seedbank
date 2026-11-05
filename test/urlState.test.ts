/**
 * URL state tests for seedbank.
 *
 * Shared links must resolve to a valid method/word-count pair. These tests
 * cover the normalisation that keeps a hand-edited query string consistent
 * with the derivation controls.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('./loader.mjs');

const { readUrlState } = await import('../src/lib/urlState.ts');

test('an empty query leaves every option at its default', () => {
  assert.deepEqual(readUrlState(''), {});
});

test('a 12-word legacy Nano link is normalised to 24 words', () => {
  const state = readUrlState('?view=mnemonics&words=12&method=legacyNano');
  assert.equal(state.kind, 'mnemonic');
  assert.equal(state.options?.method, 'legacyNano');
  assert.equal(state.options?.wordCount, 24);
});

test('a legacy Nano link without a word count defaults to 24 words', () => {
  const state = readUrlState('?method=legacyNano');
  assert.equal(state.options?.method, 'legacyNano');
  assert.equal(state.options?.wordCount, 24);
});

test('methods that support both word counts keep the requested one', () => {
  const twelve = readUrlState('?words=12&method=bip39Seed');
  assert.equal(twelve.options?.wordCount, 12);
  assert.equal(twelve.options?.method, 'bip39Seed');

  const twentyFour = readUrlState('?words=24&method=bip39Ledger');
  assert.equal(twentyFour.options?.wordCount, 24);
  assert.equal(twentyFour.options?.method, 'bip39Ledger');
});

test('unknown methods and malformed pages are ignored', () => {
  const state = readUrlState('?method=notARealMethod&page=abc');
  assert.equal(state.options, undefined);
  assert.equal(state.page, undefined);
});

test('an account index is parsed independently of the view', () => {
  assert.equal(readUrlState('?account=42').accountIndex, 42);
});

test('shared links exclude passphrases', async () => {
  const { writeUrlState } = await import('../src/lib/urlState.ts');
  const query = writeUrlState({ kind: 'mnemonic', page: 42n, accountIndex: 0,
    options: { wordCount: 12, method: 'bip39Ledger', passphrase: 'secret' } });
  assert.equal(query.includes('secret'), false);
  assert.equal(query.includes('passphrase'), false);
  assert.equal(readUrlState(query).page, 42n);
});

test('shareable page and account indices round-trip without floating point loss', async () => {
  const { writeUrlState }=await import('../src/lib/urlState.ts');
  for(const method of ['bip39Ledger','bip39Account','legacyNano','bip39Seed'] as const){
    for(const wordCount of [12,24] as const){
      if(method==='legacyNano' && wordCount===12)continue;
      const state={kind:'mnemonic' as const,page:9007199254740993n,options:{wordCount,method},accountIndex:method.startsWith('bip39') && method!=='bip39Seed'?0x7fffffff:0xffffffff};
      assert.deepEqual(readUrlState(writeUrlState(state)),state);
    }
  }
});

test('URL rewrites preserve debug lookup selection while excluding passphrases', async()=>{
  const {replaceUrl}=await import('../src/lib/urlState.ts');
  const original=Object.getOwnPropertyDescriptor(globalThis,'window');
  let written='';
  Object.defineProperty(globalThis,'window',{configurable:true,value:{
    location:{pathname:'/',search:'?lookups=json-rpc&page=1'},
    history:{replaceState(_state:unknown,_title:string,url:string){written=url;}},
  }});
  try{
    replaceUrl({kind:'mnemonic',page:2n,options:{wordCount:24,method:'bip39Ledger',passphrase:'secret'},accountIndex:0});
    const params=new URL(written,'https://example.test').searchParams;
    assert.equal(params.get('lookups'),'json-rpc');
    assert.equal(params.get('page'),'2');
    assert.equal(params.has('passphrase'),false);
  }finally{
    if(original)Object.defineProperty(globalThis,'window',original);
    else Reflect.deleteProperty(globalThis,'window');
  }
});

const { writeUrlState, DEFAULT_OPTIONS } = await import('../src/lib/urlState.ts');
const { totalEntries, totalPages } = await import('../src/lib/keyspace.ts');
const { derivePage } = await import('../src/lib/derivePage.ts');

const entrySpaces = [
  { kind: 'privateKey' as const, options: DEFAULT_OPTIONS },
  { kind: 'mnemonic' as const, options: { wordCount: 12 as const, method: 'bip39Ledger' as const } },
  { kind: 'mnemonic' as const, options: { wordCount: 24 as const, method: 'bip39Ledger' as const } },
];

for (const { kind, options } of entrySpaces) {
  test(`${kind} ${options.wordCount} entry permalinks resolve exact boundary rows, including the final partial page`, async () => {
    const count = totalEntries(kind, options);
    const lastPage = totalPages(kind, options);
    const finalStart = count - 16n;
    const cases = [
      [0n, 1n, 0], [19n, 1n, 19], [20n, 2n, 0], [39n, 2n, 19], [40n, 3n, 0],
      [1961n, 99n, 1],
      [finalStart - 1n, lastPage - 1n, 19],
      [finalStart, lastPage, 0], [count - 1n, lastPage, 15],
    ] as const;
    for (const [entry, expectedPage, offset] of cases) {
      const url = writeUrlState({ kind, options, page: 999n, entry, accountIndex: 3 });
      const params = new URLSearchParams(url);
      assert.equal(params.has('page'), false);
      assert.equal(params.get('entry'), entry.toString());
      assert.equal(url.includes('#'), false);
      const parsed = readUrlState(url);
      assert.equal(parsed.entry, entry);
      assert.equal(parsed.page, expectedPage);
      if (kind === 'mnemonic') {
        assert.deepEqual(parsed.options, options);
        assert.equal(parsed.accountIndex, 3);
      }
      const rows = await derivePage({ kind, options, page: parsed.page!, accountIndex: parsed.accountIndex ?? 0 });
      assert.equal(rows[offset].position, entry);
      assert.equal(rows.length, expectedPage === lastPage ? 16 : 20);
    }
  });

  test(`${kind} ${options.wordCount} entry bounds reject one past the maximum and negative indices`, () => {
    const count = totalEntries(kind, options);
    const base = { kind, options, page: 2n, accountIndex: 0 };
    const query = writeUrlState(base);
    for (const invalid of ['-1', count.toString(), (count + 1n).toString(), '1.5', '1e2', 'abc', '', '9'.repeat(101)]) {
      const state = readUrlState(`${query}&entry=${invalid}`);
      assert.equal(state.entry, undefined);
      assert.equal(state.page, 2n);
    }
    assert.throws(() => writeUrlState({ ...base, entry: -1n }), RangeError);
    assert.throws(() => writeUrlState({ ...base, entry: count }), RangeError);
  });
}

test('entry takes precedence over conflicting page and canonicalization removes page', () => {
  const parsed = readUrlState('?view=keys&page=999&entry=20');
  assert.equal(parsed.page, 2n);
  assert.equal(parsed.entry, 20n);
  assert.equal(writeUrlState({ kind: 'privateKey', page: parsed.page!, entry: parsed.entry, options: DEFAULT_OPTIONS, accountIndex: 0 }), '?view=keys&entry=20');
});

test('legacy normalization is applied before checking the mnemonic entry bound', () => {
  const entry = (1n << 256n) - 1n;
  const parsed = readUrlState(`?view=mnemonics&words=12&method=legacyNano&entry=${entry}`);
  assert.equal(parsed.options?.wordCount, 24);
  assert.equal(parsed.entry, entry);
  assert.equal(parsed.page, totalPages('mnemonic', parsed.options!));
});

test('entry zero, lookup override and account settings survive URL rewrites without a page or fragment', () => {
  const url = writeUrlState({ kind: 'mnemonic', page: 40n, entry: 0n, options: DEFAULT_OPTIONS, accountIndex: 7 }, '?lookups=nano-rpc');
  assert.equal(url, '?view=mnemonics&entry=0&words=12&method=bip39Ledger&account=7&lookups=nano-rpc');
  assert.equal(readUrlState(url).page, 1n);
});
