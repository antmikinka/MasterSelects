import { describe, expect, it } from 'vitest';
import { getTimelineZoomWheelMultiplier } from '../../src/components/timeline/hooks/useTimelineZoom';

describe('getTimelineZoomWheelMultiplier', () => {
  it('uses larger zoom steps for larger wheel deltas', () => {
    const normal = getTimelineZoomWheelMultiplier(100, 120);
    const fast = getTimelineZoomWheelMultiplier(400, 120);

    expect(fast).toBeGreaterThan(normal);
  });

  it('boosts very rapid repeated wheel gestures', () => {
    const separated = getTimelineZoomWheelMultiplier(100, 120);
    const rapid = getTimelineZoomWheelMultiplier(100, 20);

    expect(rapid).toBeGreaterThan(separated);
  });

  it('does not zoom for a zero delta', () => {
    expect(getTimelineZoomWheelMultiplier(0, 20)).toBe(1);
  });
});
