interface GuidedCalloutProps {
  body?: string;
  title: string;
}

export function GuidedCallout({ body, title }: GuidedCalloutProps) {
  return (
    <div
      className="guided-callout"
      aria-live="polite"
      role="status"
    >
      <div className="guided-callout-title">{title}</div>
      {body && <div className="guided-callout-body">{body}</div>}
    </div>
  );
}
