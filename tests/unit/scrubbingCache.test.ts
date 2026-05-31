import { describe, it, expect } from 'vitest';
import { ScrubbingCache } from '../../src/engine/texture/ScrubbingCache';

// The constructor only stores the device reference (no GPU calls), so a stub
// device is enough to exercise the pure resolution-aware downscale helper.
type ScrubbingCacheTestAccess = {
  computeScrubCacheSize(width: number, height: number): { width: number; height: number };
  SCRUB_CACHE_MAX_DIMENSION: number;
};

const createCache = (): ScrubbingCacheTestAccess =>
  new ScrubbingCache({} as unknown as GPUDevice) as unknown as ScrubbingCacheTestAccess;

describe('ScrubbingCache.computeScrubCacheSize', () => {
  it('downscales a 4K frame to the 960px longest-side cap, preserving aspect ratio', () => {
    const cache = createCache();
    const size = cache.computeScrubCacheSize(3840, 2160);
    expect(Math.max(size.width, size.height)).toBe(960);
    // 16:9 preserved
    expect(size.width / size.height).toBeCloseTo(3840 / 2160, 2);
  });

  it('downscales 1080p so coverage matches 4K (resolution-independent budget)', () => {
    const cache = createCache();
    const hd = cache.computeScrubCacheSize(1920, 1080);
    const uhd = cache.computeScrubCacheSize(3840, 2160);
    // Same downscaled dimensions => same VRAM per frame regardless of source res.
    expect(hd).toEqual(uhd);
  });

  it('never upscales frames already within the cap', () => {
    const cache = createCache();
    expect(cache.computeScrubCacheSize(640, 360)).toEqual({ width: 640, height: 360 });
    expect(cache.computeScrubCacheSize(960, 540)).toEqual({ width: 960, height: 540 });
  });

  it('handles portrait orientation by capping the longest (height) side', () => {
    const cache = createCache();
    const size = cache.computeScrubCacheSize(1080, 1920);
    expect(Math.max(size.width, size.height)).toBe(960);
    expect(size.height).toBe(960);
  });

  it('returns even dimensions for clean texture sizing', () => {
    const cache = createCache();
    const size = cache.computeScrubCacheSize(1280, 720);
    expect(size.width % 2).toBe(0);
    expect(size.height % 2).toBe(0);
  });
});
