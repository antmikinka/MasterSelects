import { describe, expect, it } from 'vitest';
import {
  resolveAnalysisCoveragePercent,
  resolveTranscriptCoveragePercent,
} from '../../src/components/timeline/utils/clipCoverageBadges';

describe('clip coverage badges', () => {
  it('calculates transcript coverage from transcribed media ranges', () => {
    expect(resolveTranscriptCoveragePercent({
      inPoint: 2,
      outPoint: 6,
      duration: 10,
      transcript: [{ start: 2, end: 6 }],
      transcribedRanges: [[0, 3], [4, 10]],
    })).toBe(75);
  });

  it('falls back to transcript word envelope when no media ranges exist', () => {
    expect(resolveTranscriptCoveragePercent({
      inPoint: 1,
      outPoint: 5,
      duration: 10,
      transcript: [
        { start: 0, end: 1.5 },
        { start: 2, end: 4 },
        { start: 6, end: 7 },
      ],
      transcribedRanges: [],
    })).toBe(75);
  });

  it('reports zero transcript coverage for invalid or empty ranges', () => {
    expect(resolveTranscriptCoveragePercent({
      inPoint: 4,
      outPoint: 4,
      duration: 10,
      transcript: [{ start: 0, end: 1 }],
    })).toBe(0);
    expect(resolveTranscriptCoveragePercent({
      inPoint: 1,
      outPoint: 5,
      duration: 10,
      transcript: [],
    })).toBe(0);
  });

  it('calculates analysis coverage from frame timestamps and sample interval', () => {
    expect(resolveAnalysisCoveragePercent({
      inPoint: 0,
      outPoint: 4,
      duration: 4,
      frames: [{ timestamp: 0 }, { timestamp: 1 }, { timestamp: 2 }],
      sampleIntervalMs: 500,
    })).toBe(38);
  });

  it('keeps legacy analysis coverage full when no frame list exists', () => {
    expect(resolveAnalysisCoveragePercent({
      inPoint: 0,
      outPoint: 4,
      duration: 4,
      frames: [],
      sampleIntervalMs: 500,
    })).toBe(100);
  });
});
