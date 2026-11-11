import { test as base, expect } from '@playwright/test';
import { rpcReplay } from './rpc-cassette';
import { NanoRpcClient } from '../shared/nanoRpc.js';
export type LookupMode = 'proxy' | 'nano-rpc' | 'json-rpc';
export interface LookupOptions { lookupMode: LookupMode }
export const test = base.extend<LookupOptions & { appUrl: (query: string) => string }>({
 lookupMode: ['proxy', { option: true }],
 appUrl: async ({ lookupMode }, use) => {
  await use(query => {
   const params = new URLSearchParams(query.replace(/^\/?\?/, ''));
   params.set('lookups', lookupMode);
   return '/?' + params;
  });
 },
 page: async ({ page, context, baseURL, lookupMode }, use) => {
 const errors: string[] = [];
 let lookupRequests = 0;
 const pending = new Set<Promise<unknown>>();
 const track = <T>(promise: Promise<T>): Promise<T> => {
  pending.add(promise);
  promise.then(() => pending.delete(promise), () => pending.delete(promise));
  return promise;
 };
 const replayClient = new NanoRpcClient({nodes:[{name:'recording',url:'https://recorded.invalid'}], fetchImpl:async (_url, init) => {
  const { action, ...params } = JSON.parse(String(init?.body));
  const {envelope} = await rpcReplay(action, params);
  return Response.json(envelope.result);
 }});
 await context.route('**/*', async route => {
  try {
   const url = new URL(route.request().url());
   if(url.origin === new URL(baseURL!).origin && ['GET', 'HEAD'].includes(route.request().method())) return route.continue();
   if(route.request().method() !== 'POST') throw new Error('Unexpected external request: '+url.href);
   const body = route.request().postDataJSON();
   if(url.origin === new URL(baseURL!).origin && url.pathname === '/api/account-state') {
    if (lookupMode !== 'proxy') throw new Error('Unexpected proxy fallback from '+lookupMode);
    lookupRequests++;
    const states = await track(replayClient.fetchState(body.addresses));
    return route.fulfill({json:{ttlMs:3600000,servedAt:Date.now(),degraded:false,results:states.map(state=>({...state,stale:false,fetchedAt:Date.now()}))}});
   }
   if (lookupMode === 'proxy') throw new Error('Proxy lookup unexpectedly contacted an RPC node');
   if ((body.jsonrpc === '2.0') !== (lookupMode === 'json-rpc')) throw new Error('Incorrect wire format for '+lookupMode);
   lookupRequests++;
   const {action, jsonrpc, id, method, ...params} = body;
   const {cassette,envelope} = await track(rpcReplay(action ?? method, jsonrpc ? body.params : params));
   await route.fulfill({status:cassette.response.status,contentType:cassette.response.contentType,body:JSON.stringify(jsonrpc ? {...envelope,id} : envelope.result)});
  } catch (error) {
   errors.push(String(error));
   await route.abort('blockedbyclient').catch(()=>{});
  }
 });
 page.on('pageerror', error => errors.push(error.message));
 page.on('console', message => {if(message.type()==='error') errors.push(message.text());});
 await use(page);
 await Promise.allSettled([...pending]);
 expect(errors).toEqual([]);
 expect(lookupRequests, `Expected ${lookupMode} lookup adapter to be exercised`).toBeGreaterThan(0);
}});

export { expect };
