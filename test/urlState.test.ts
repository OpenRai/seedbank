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
