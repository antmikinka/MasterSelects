import type { GuidedPoint } from '../../services/guidedActions';

interface GuidedCursorProps {
  clicking: boolean;
  position: GuidedPoint | null;
  visible: boolean;
}

export function GuidedCursor({ clicking, position, visible }: GuidedCursorProps) {
  if (!visible || !position) {
    return null;
  }

  return (
    <div
      className={`guided-cursor ${clicking ? 'guided-cursor--clicking' : ''}`}
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
      }}
      aria-hidden="true"
    >
      <svg className="guided-cursor-shape" viewBox="0 0 32 32" focusable="false">
        <path d="M6 3l18 17-8 1.2 4.5 7.2-3.7 2.2-4.4-7.1-5.2 6.2L6 3z" />
      </svg>
      {clicking && <span className="guided-click-ripple" />}
    </div>
  );
}
