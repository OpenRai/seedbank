import { resolveLookupStrategy } from './lookupStrategy';
export type { LookupStrategy } from './lookupStrategy';

export const lookups = resolveLookupStrategy(import.meta.env.VITE_LOOKUPS, window.location.search);
