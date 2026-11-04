import { useEffect, useRef, useState } from 'react';
import { formatXno, isNonZeroRaw } from '@lib/format';
import { CopyButton } from './CopyButton';
import type { AccountState } from '@lib/api';

interface BalanceCellProps {
  state: AccountState | undefined;
  loading: boolean;
}

/**
 * Balance pill plus opened/unopened state. Balances are formatted from exact
 * raw integer strings, never floating point.
 */
export function BalanceCell({ state, loading }: BalanceCellProps) {
  const [flash, setFlash] = useState(false);
  const previous = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (state && previous.current !== undefined && previous.current !== state.balanceRaw) {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 1200);
      previous.current = state.balanceRaw;
      return () => clearTimeout(timer);
    }
    if (state) previous.current = state.balanceRaw;
  }, [state]);

  if (loading && !state) {
    return (
      <div className="cell">
        <span className="skeleton" style={{ width: 96 }} />
        <div className="state state--unopened">
          <span className="skeleton" style={{ width: 70, marginTop: 8 }} />
        </div>
      </div>
    );
  }

  if (!state || state.fetchedAt === null || state.balanceRaw === null || state.receivableRaw === null || state.opened === null) {
    return (
      <div className="cell">
        <span className="balance-pill balance-pill--zero">— XNO</span>
        <div className="state state--error">RPC Error</div>
      </div>
    );
  }

  const zero = !isNonZeroRaw(state.balanceRaw);
  const funded = !zero;

  return (
    <div className="cell">
      <div className="copy-field">
      <span
        className={`balance-pill${zero ? ' balance-pill--zero' : ' balance-pill--funded'}`}
        style={flash ? { outline: '2px solid var(--primary)', outlineOffset: 1 } : undefined}
        title={`${state.balanceRaw} raw`}
      >
        {formatXno(state.balanceRaw)} <span style={{ opacity: 0.65 }}>XNO</span>
      </span>
      <CopyButton value={formatXno(state.balanceRaw)} label="balance in XNO" />
      </div>
      {funded && !state.opened ? <div className="receivable">unopened (only receivable)</div> : null}
      {isNonZeroRaw(state.receivableRaw) ? (
        <div className="receivable copy-field">+ {formatXno(state.receivableRaw)} XNO receivable<CopyButton value={formatXno(state.receivableRaw)} label="receivable in XNO" /></div>
      ) : null}
      <div className={`state ${state.opened ? 'state--opened' : 'state--unopened'}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path d={state.opened ? 'M8 12.5 11 15.5 16.5 9.5' : 'M8.5 12h7'} strokeLinecap="round" />
        </svg>
        {state.opened ? 'Opened' : 'Unopened'}
        {state.stale ? <span className="state--stale"> · Cached</span> : null}
      </div>
    </div>
  );
}
