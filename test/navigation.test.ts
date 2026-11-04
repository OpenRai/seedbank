import { test } from 'node:test';
import assert from 'node:assert/strict';
await import('./loader.mjs');
const { clampPage, parsePageInput, pageStartPosition, pageForPosition, privateKeyPosition, pageLocationPercent, clampAccountIndex } = await import('../src/lib/navigation.ts');
const { totalEntries, totalPages, PAGE_SIZE, METHOD_META, methodForWordCount, wordCountForMethod, methodFormula } = await import('../src/lib/keyspace.ts');
const { derivePage, randomPage, rowPathLabel } = await import('../src/lib/derivePage.ts');
const { entropyToMnemonic } = await import('../src/lib/mnemonic.ts');
import type { MnemonicOptions, SeedKind } from '../src/lib/keyspace.ts';
const spaces: {kind:SeedKind;options:MnemonicOptions;bits:number}[]=[
  {kind:'privateKey',options:{wordCount:12,method:'bip39Ledger'},bits:256},
  {kind:'mnemonic',options:{wordCount:12,method:'bip39Ledger'},bits:128},
  {kind:'mnemonic',options:{wordCount:24,method:'legacyNano'},bits:256},
];

for(const {kind,options,bits} of spaces){
  test(`${kind} ${bits}-bit page count includes every entry and only one partial final page`,()=>{
    const entries=1n<<BigInt(bits), pages=totalPages(kind,options);
    assert.equal(totalEntries(kind,options),entries);
    assert.ok((pages-1n)*20n < entries);
    assert.ok(pages*20n >= entries);
    assert.equal(entries-pageStartPosition(pages),16n);
    assert.equal(pageForPosition(entries-1n),pages);
  });
  test(`${kind} ${bits}-bit row labels continue from #19 to #20 and preserve huge indices`,async()=>{
    for(const page of [1n,2n,9007199254740993n]){
      const rows=await derivePage({kind,options,page});
      assert.equal(rows.length,PAGE_SIZE);
      for(const [offset,row] of rows.entries()) assert.equal(row.position,(page-1n)*20n+BigInt(offset));
    }
  });
  test(`${kind} ${bits}-bit final page ends at the maximum entropy without wrapping`,async()=>{
    const page=totalPages(kind,options), rows=await derivePage({kind,options,page});
    assert.equal(rows.length,16);
    assert.equal(rows.at(-1)!.position,(1n<<BigInt(bits))-1n);
    assert.equal(new Set(rows.map(row=>row.address)).size,rows.length);
    if(kind==='privateKey')assert.equal(rows.at(-1)!.privateKeyHex.toLowerCase(),'f'.repeat(64));
    else assert.equal(rows.at(-1)!.mnemonic,entropyToMnemonic(new Uint8Array(bits/8).fill(255)));
    await assert.rejects(derivePage({kind,options,page:page+1n}),/out of range/);
  });
}

test('page and position conversion round-trips at page boundaries and uint256 maximum',()=>{
  for(const position of [0n,19n,20n,39n,40n,1n<<128n,(1n<<256n)-1n]){
    const page=pageForPosition(position), start=pageStartPosition(page);
    assert.ok(start<=position && position-start<20n);
    assert.equal(pageForPosition(start),page);
  }
  assert.throws(()=>pageForPosition(-1n));
});

test('page input accepts separators without losing bigint precision and rejects malformed input',()=>{
  assert.equal(parsePageInput(' 9,007_199 254,740,993 '),9007199254740993n);
  assert.equal(parsePageInput('00020'),20n);
  for(const bad of ['', ' ', '-1','1.5','1e20','0x20','9'.repeat(101)]) assert.equal(parsePageInput(bad),null);
});

test('clamping handles first/last pages and shrinking from 256 to 128 bits',()=>{
  const options:MnemonicOptions={wordCount:12,method:'bip39Ledger'};
  const small=totalPages('mnemonic',options), large=totalPages('privateKey',options);
  assert.equal(clampPage(0n,large),1n);
  assert.equal(clampPage(-1n,large),1n);
  assert.equal(clampPage(large+1n,large),large);
  assert.equal(clampPage(large,small),small);
  assert.equal(clampPage(2n,large),2n);
});

test('private key search accepts exact hexadecimal keys and reaches the final partial page',()=>{
  assert.equal(privateKeyPosition(' 0X'+'0'.repeat(63)+'A '),10n);
  assert.equal(privateKeyPosition('f'.repeat(64)),(1n<<256n)-1n);
  for(const bad of ['', 'f'.repeat(63),'f'.repeat(65),'g'.repeat(64),'-'+'0'.repeat(64)])assert.equal(privateKeyPosition(bad),null);
});

test('page location is based on page count, including huge values',()=>{
  const pages=10n**75n;
  assert.equal(pageLocationPercent(1n,pages),0);
  assert.equal(pageLocationPercent(pages/4n,pages),25);
  assert.equal(pageLocationPercent(pages*3n/4n,pages),75);
  assert.equal(pageLocationPercent(pages,pages),100);
  assert.equal(pageLocationPercent(pages+1n,pages),100);
});

test('all derivation methods respect their account bounds and produce matching path labels',async()=>{
  for(const meta of Object.values(METHOD_META)){
    const options:MnemonicOptions={method:meta.method,wordCount:meta.wordCounts[0]};
    assert.equal(clampAccountIndex(meta.accountMax+1,meta.accountMax),meta.accountMax);
    assert.equal(clampAccountIndex(-1,meta.accountMax),0);
    assert.equal(clampAccountIndex(1.9,meta.accountMax),1);
    const rows=await derivePage({kind:'mnemonic',options,page:1n,accountIndex:meta.accountMax});
    assert.equal(rows[0].path,methodFormula(meta.method,meta.accountMax));
    assert.equal(rowPathLabel(options,meta.accountMax),rows[0].path);
    for(const index of [-1,0.5,NaN,Infinity,meta.accountMax+1]){
      await assert.rejects(derivePage({kind:'mnemonic',options,page:1n,accountIndex:index}),/Account index out of range/);
    }
    for(const words of [12,24] as const){
      assert.ok(meta.wordCounts.includes(wordCountForMethod(meta.method,words)));
      assert.ok(METHOD_META[methodForWordCount(words,meta.method)].wordCounts.includes(words));
    }
  }
});

test('random page rejection sampling reaches endpoints and rejects the biased tail',()=>{
  const {kind,options}=spaces[0], pages=totalPages(kind,options);
  function bytes(value:bigint,size:number){return Uint8Array.from(value.toString(16).padStart(size*2,'0').match(/../g)!.map(pair=>parseInt(pair,16)));}
  assert.equal(randomPage(kind,options,size=>bytes(0n,size)),1n);
  assert.equal(randomPage(kind,options,size=>bytes(pages-1n,size)),pages);
  let calls=0;
  assert.equal(randomPage(kind,options,size=>++calls===1?new Uint8Array(size).fill(255):bytes(19n,size)),20n);
  assert.equal(calls,2);
});
