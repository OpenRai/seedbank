/**
 * Exact-unit formatting for XNO.
 *
 * Nano has 30 decimal places and balances arrive as raw integer strings, so
 * every conversion here uses BigInt (never floating point).
 */

const RAW_PER_XNO = 10n ** 30n;

/** Format a raw string as an XNO decimal string, trimming trailing zeros. */
export function formatXno(raw: string | bigint, maxDecimals = 6): string {
  let value: bigint;
  try {
    value = typeof raw === 'bigint' ? raw : BigInt(raw || '0');
  } catch {
    return '0';
  }
  const negative = value < 0n;
  if (negative) value = -value;

  const whole = value / RAW_PER_XNO;
  const fraction = value % RAW_PER_XNO;
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  if (fraction === 0n) return `${negative ? '-' : ''}${wholeText}`;

  let fractionText = fraction.toString().padStart(30, '0').slice(0, maxDecimals);
  fractionText = fractionText.replace(/0+$/, '');
  if (fractionText === '') return `${negative ? '-' : ''}${wholeText}`;
  return `${negative ? '-' : ''}${wholeText}.${fractionText}`;
}

/** True when a raw string is non-zero. */
export function isNonZeroRaw(raw: string | undefined | null): boolean {
  if (!raw) return false;
  try {
    return BigInt(raw) !== 0n;
  } catch {
    return false;
  }
}

/** Sum a list of raw strings. */
export function sumRaw(values: string[]): bigint {
  return values.reduce((acc, value) => {
    try {
      return acc + BigInt(value || '0');
    } catch {
      return acc;
    }
  }, 0n);
}
