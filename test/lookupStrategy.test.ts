import { test } from 'node:test';
import assert from 'node:assert/strict';
await import('./loader.mjs');
const { resolveLookupStrategy }=await import('../src/lib/lookupStrategy.ts');

test('build defaults and debug overrides select every strategy without changing the fallback',()=>{
  const strategies=['proxy','nano-rpc','json-rpc'] as const;
  for(const configured of strategies){
    assert.equal(resolveLookupStrategy(configured,''),configured);
    for(const override of strategies)assert.equal(resolveLookupStrategy(configured,`?view=keys&lookups=${override}`),override);
    assert.equal(resolveLookupStrategy(configured,'?lookups=invalid'),configured);
    assert.equal(resolveLookupStrategy(configured,'?lookups='),configured);
  }
  assert.equal(resolveLookupStrategy(undefined,''),'proxy');
  assert.equal(resolveLookupStrategy('', ''),'proxy');
  assert.throws(()=>resolveLookupStrategy('invalid',''),/Invalid VITE_LOOKUPS/);
});
