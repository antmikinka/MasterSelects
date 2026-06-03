export type StaticClipIconKind = 'camera' | 'gaussian-splat' | 'model';

export function TrimHandleArrows({ directions }: { directions: Array<'left' | 'right'> }) {
  return (
    <span className="trim-handle-arrows" aria-hidden="true">
      {directions.includes('left') && <span className="trim-handle-arrow left" />}
      {directions.includes('right') && <span className="trim-handle-arrow right" />}
    </span>
  );
}

export function StaticClipIcon({
  kind,
  className,
}: {
  kind: StaticClipIconKind;
  className?: string;
}) {
  if (kind === 'camera') {
    return (
      <svg
        viewBox="0 0 48 48"
        className={className}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M15 12h18l3 5h4a4 4 0 0 1 4 4v11a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V21a4 4 0 0 1 4-4h4l3-5Z" />
        <circle cx="24" cy="26" r="7" />
        <path d="M37 21h3" />
      </svg>
    );
  }

  if (kind === 'gaussian-splat') {
    return (
      <svg
        viewBox="0 0 48 48"
        className={className}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M24 11v26M11 24h26M15 15l18 18M33 15 15 33" opacity="0.5" />
        <circle cx="24" cy="24" r="6" fill="currentColor" stroke="none" />
        <circle cx="24" cy="10" r="3.5" fill="currentColor" stroke="none" />
        <circle cx="38" cy="24" r="3.5" fill="currentColor" stroke="none" />
        <circle cx="24" cy="38" r="3.5" fill="currentColor" stroke="none" />
        <circle cx="10" cy="24" r="3.5" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="14.5" r="2.5" fill="currentColor" stroke="none" />
        <circle cx="33.5" cy="14.5" r="2.5" fill="currentColor" stroke="none" />
        <circle cx="33.5" cy="33.5" r="2.5" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="33.5" r="2.5" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M24 6 38 14v20L24 42 10 34V14z" />
      <path d="M24 6v16m14-8-14 8-14-8m14 8v20" />
    </svg>
  );
}
