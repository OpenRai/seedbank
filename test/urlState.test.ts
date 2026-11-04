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
