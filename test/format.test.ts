import { test } from 'node:test';
import assert from 'node:assert/strict';
await import('./loader.mjs');
const { formatXno, isNonZeroRaw, sumRaw } = await import('../src/lib/format.ts');
const { formatBigInt, positionModulo, totalEntries } = await import('../src/lib/keyspace.ts');

test('raw balance arithmetic stays exact above floating point integer precision',()=>{
  const one=10n**30n;
  assert.equal(sumRaw([one.toString(),(one-1n).toString(),'1']),2n*one);
  assert.equal(formatXno(sumRaw([one.toString(),(one/4n).toString()])), '1.25');
  assert.equal(formatXno((123456789n*one+123456789012345678901234567890n).toString()),'123,456,789.123456');
  assert.equal(formatXno('999999999999999999999999999999'), '0.999999');
  assert.equal(formatXno(one),'1');
  assert.equal(formatXno('0'),'0');
  assert.equal(isNonZeroRaw('1'),true);
  assert.equal(isNonZeroRaw('0'),false);
  assert.equal(isNonZeroRaw(null),false);
});

test('integer display and maximum positions preserve the full namespace without floating point',()=>{
  assert.equal(formatBigInt(9007199254740993n),'9,007,199,254,740,993');
  for(const wordCount of [12,24] as const){
    const options={wordCount,method:'bip39Ledger' as const};
    assert.equal(positionModulo('mnemonic',options)+1n,totalEntries('mnemonic',options));
    assert.equal(positionModulo('privateKey',options),(1n<<256n)-1n);
  }
});
