import { CopyButton } from './CopyButton';

interface SensitiveValueProps {
  value: string;
  /** Kept for call-site compatibility; values are always shown in the clear. */
  concealByDefault?: boolean;
  label: string;
  /** Render as a numbered BIP39 phrase rather than a hex string. */
  wordWrap?: boolean;
}

/**
 * A derived key or mnemonic, shown in the clear.
 *
 * Every value on this page is public, deterministic keyspace data — there is
 * nothing secret to conceal, so the field is plain text with a copy affordance
 * and no reveal interaction.
 */
export function SensitiveValue({ value, label, wordWrap = false }: SensitiveValueProps) {
  const words = wordWrap ? value.split(' ') : null;

  return (
    <div className="keybox keybox--sensitive">
      <div className="keybox__value">
        {words
          ? words.map((word, index) => (
              <span key={`${word}-${index}`} className="mnemonic">
                <span className="mnemonic__index">{String(index + 1).padStart(2, '0')}</span>
                {word}
                {index < words.length - 1 ? ' ' : ''}
              </span>
            ))
          : value}
      </div>
      <CopyButton value={value} label={label} />
    </div>
  );
}
