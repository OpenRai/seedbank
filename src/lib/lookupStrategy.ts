export type LookupStrategy = 'nano-rpc' | 'proxy' | 'json-rpc';
function isStrategy(value: unknown): value is LookupStrategy {
  return value === 'nano-rpc' || value === 'proxy' || value === 'json-rpc';
}

export function resolveLookupStrategy(configured: unknown, search: string): LookupStrategy {
  if (configured && !isStrategy(configured)) throw new Error(`Invalid VITE_LOOKUPS: ${String(configured)}`);
  const override = new URLSearchParams(search).get('lookups');
  if (isStrategy(override)) return override;
  return isStrategy(configured) ? configured : 'proxy';
}
