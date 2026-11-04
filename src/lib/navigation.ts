import { MAX_PAGE_DIGITS, PAGE_SIZE } from './keyspace';

export function clampPage(page: bigint, pages: bigint): bigint {
  return page < 1n ? 1n : page > pages ? pages : page;
}

export function parsePageInput(input: string): bigint | null {
  const value = input.replace(/[,\s_]/g, '');
  return /^\d+$/.test(value) && value.length <= MAX_PAGE_DIGITS ? BigInt(value) : null;
}

export function pageStartPosition(page: bigint): bigint {
  return (page - 1n) * BigInt(PAGE_SIZE);
}

export function pageForPosition(position: bigint): bigint {
  if (position < 0n) throw new Error('Position must be nonnegative');
  return position / BigInt(PAGE_SIZE) + 1n;
}

export function privateKeyPosition(input: string): bigint | null {
  const hex = input.trim().replace(/^0x/i, '');
  return /^[0-9a-fA-F]{64}$/.test(hex) ? BigInt(`0x${hex}`) : null;
}

/** Percentage with four decimal places, without converting huge integers to floats. */
export function pageLocationPercent(page: bigint, pages: bigint): number {
  return Number((clampPage(page, pages) * 1_000_000n) / pages) / 10_000;
}

export function clampAccountIndex(index: number, maximum: number): number {
  return Number.isFinite(index) ? Math.min(maximum, Math.max(0, Math.trunc(index))) : 0;
}
