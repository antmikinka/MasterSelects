import type { GuidedPoint, GuidedRect } from '../../services/guidedActions';

interface GuidedCalloutProps {
  body?: string;
  targetRect: GuidedRect | null;
  title: string;
}

const CALLOUT_WIDTH = 280;
const CALLOUT_MARGIN = 12;

export function GuidedCallout({ body, targetRect, title }: GuidedCalloutProps) {
  const position = getCalloutPosition(targetRect);

  return (
    <div
      className="guided-callout"
      style={{
        left: position.x,
        top: position.y,
      }}
      role="status"
    >
      <div className="guided-callout-title">{title}</div>
      {body && <div className="guided-callout-body">{body}</div>}
    </div>
  );
}

function getCalloutPosition(targetRect: GuidedRect | null): GuidedPoint {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

  if (!targetRect) {
    return {
      x: Math.max(CALLOUT_MARGIN, (viewportWidth - CALLOUT_WIDTH) / 2),
      y: CALLOUT_MARGIN,
    };
  }

  const rightSideFits = targetRect.x + targetRect.width + CALLOUT_MARGIN + CALLOUT_WIDTH <= viewportWidth;
  const left = rightSideFits
    ? targetRect.x + targetRect.width + CALLOUT_MARGIN
    : Math.max(CALLOUT_MARGIN, targetRect.x - CALLOUT_WIDTH - CALLOUT_MARGIN);
  const top = Math.max(
    CALLOUT_MARGIN,
    Math.min(targetRect.y, viewportHeight - 120),
  );

  return { x: left, y: top };
}
