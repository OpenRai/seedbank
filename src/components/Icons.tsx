import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base = (props: IconProps) => ({
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
});

export const KeyIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="7.5" cy="15.5" r="4" />
    <path d="M10.5 12.5 20 3m-3 0h3v3" />
  </svg>
);

export const DiceIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const FirstIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M6 5v14M18 6l-8 6 8 6z" />
  </svg>
);

export const PrevIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M15 6l-7 6 7 6z" />
  </svg>
);

export const NextIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M9 6l7 6-7 6z" />
  </svg>
);

export const LastIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M18 5v14M6 6l8 6-8 6z" />
  </svg>
);

export const CopyIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M5 15V6a2 2 0 0 1 2-2h8" />
  </svg>
);

export const CheckIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 12.5 9 18 20 6.5" />
  </svg>
);

export const EyeIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3.2" />
  </svg>
);

export const EyeOffIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 4l16 16" />
    <path d="M9.5 6.2A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.2 3.9" />
    <path d="M6.4 8.1A16.7 16.7 0 0 0 2.5 12S6 18 12 18a9.4 9.4 0 0 0 3.9-.8" />
  </svg>
);

export const SearchIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
);

export const RefreshIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20 4v4.5h-4.5" />
  </svg>
);

export const SeedIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 3c3.5 2 6 5.6 6 9.8C18 17.3 15.3 21 12 21s-6-3.7-6-8.2C6 8.6 8.5 5 12 3Z" />
    <path d="M12 8v9" />
  </svg>
);

export const CoinsIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <ellipse cx="12" cy="6.5" rx="7" ry="3" />
    <path d="M5 6.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
    <path d="M5 11.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
  </svg>
);

export const LockIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="4.5" y="10" width="15" height="10.5" rx="2.5" />
    <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
  </svg>
);

export const InfoIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6" />
    <circle cx="12" cy="7.8" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const WarningIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 4.5 21 19.5H3z" />
    <path d="M12 10v4.2" />
    <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const ExternalIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M14 4h6v6" />
    <path d="M20 4 11 13" />
    <path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
  </svg>
);

export const HashIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" />
  </svg>
);

export const OpenIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.5 11 15.5 16.5 9.5" />
  </svg>
);

export const ClosedIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 12h7" />
  </svg>
);
