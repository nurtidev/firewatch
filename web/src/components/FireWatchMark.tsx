/* FireWatch brand mark (variant B1 — "flame under watch"): corner viewfinder
   brackets + wind-bent flame. Brackets inherit text color (currentColor);
   flame uses the brand accent token. Canonical viewBox 0 0 32 32 — keep in
   sync with the static favicon at web/src/app/icon.svg if paths ever change. */

export function FireWatchMark({
  className,
  size = 24,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="FireWatch"
    >
      <path
        d="M4 11 L4 4 L11 4"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M21 4 L28 4 L28 11"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M28 21 L28 28 L21 28"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11 28 L4 28 L4 21"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19.5 8.5 C17 11 12 13.5 12 18.5 A4.5 4.5 0 0 0 21 18.5 C21 16.5 20.2 14.8 19.2 13.2 C18.5 12 18.6 10.3 19.5 8.5 Z"
        className="fill-accent"
      />
    </svg>
  );
}
