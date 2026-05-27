import type { GuidedRect } from '../../services/guidedActions';

interface GuidedSpotlightProps {
  rect: GuidedRect | null;
}

export function GuidedSpotlight({ rect }: GuidedSpotlightProps) {
  if (!rect) {
    return <div className="guided-spotlight guided-spotlight--full" aria-hidden="true" />;
  }

  return (
    <div
      className="guided-spotlight"
      style={{
        height: rect.height,
        left: rect.x,
        top: rect.y,
        width: rect.width,
      }}
      aria-hidden="true"
    />
  );
}
