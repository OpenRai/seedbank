import { useEffect, useState } from 'react';
import { CopyIcon, CheckIcon } from '@components/Icons';

interface CopyButtonProps {
  value: string;
  label?: string;
  title?: string;
}

/** Small copy-to-clipboard affordance used throughout the result rows. */
export function CopyButton({ value, label, title }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard permissions can be denied; fall back to a manual selection.
      const area = document.createElement('textarea');
      area.value = value;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      setCopied(true);
    }
  }

  return (
    <button
      type="button"
      className={`icon-btn${copied ? ' icon-btn--on' : ''}`}
      onClick={copy}
      title={title ?? `Copy ${label ?? 'value'}`}
      aria-label={title ?? `Copy ${label ?? 'value'}`}
    >
      {copied ? <CheckIcon width={15} height={15} /> : <CopyIcon width={15} height={15} />}
    </button>
  );
}
