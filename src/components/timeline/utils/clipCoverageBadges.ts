interface TimelineClipCoverageRangeInput {
  inPoint?: number;
  outPoint?: number;
  duration: number;
}

interface TimelineTranscriptWordRef {
  start: number;
  end: number;
}

interface TimelineAnalysisFrameRef {
  timestamp: number;
}

function resolveCoverageRange(input: TimelineClipCoverageRangeInput): {
  clipIn: number;
  clipOut: number;
  clipDuration: number;
} | null {
  const clipIn = input.inPoint ?? 0;
  const clipOut = input.outPoint ?? input.duration;
  const clipDuration = clipOut - clipIn;
  if (!Number.isFinite(clipDuration) || clipDuration <= 0) return null;
  return { clipIn, clipOut, clipDuration };
}

export function resolveTranscriptCoveragePercent(
  input: TimelineClipCoverageRangeInput & {
    transcript?: readonly TimelineTranscriptWordRef[] | null;
    transcribedRanges?: readonly (readonly [number, number])[] | null;
  },
): number {
  const range = resolveCoverageRange(input);
  if (!range) return 0;
  const { clipIn, clipOut, clipDuration } = range;

  if (input.transcribedRanges && input.transcribedRanges.length > 0) {
    let covered = 0;
    for (const [rangeStart, rangeEnd] of input.transcribedRanges) {
      const start = Math.max(rangeStart, clipIn);
      const end = Math.min(rangeEnd, clipOut);
      if (start < end) covered += end - start;
    }
    return Math.min(100, Math.round((covered / clipDuration) * 100));
  }

  const wordsInRange = input.transcript?.filter((word) => word.end > clipIn && word.start < clipOut) ?? [];
  if (wordsInRange.length === 0) return 0;

  const minStart = Math.max(clipIn, Math.min(...wordsInRange.map((word) => word.start)));
  const maxEnd = Math.min(clipOut, Math.max(...wordsInRange.map((word) => word.end)));
  return Math.min(100, Math.round(((maxEnd - minStart) / clipDuration) * 100));
}

export function resolveAnalysisCoveragePercent(
  input: TimelineClipCoverageRangeInput & {
    frames?: readonly TimelineAnalysisFrameRef[] | null;
    sampleIntervalMs?: number | null;
  },
): number {
  const range = resolveCoverageRange(input);
  if (!range) return 0;
  const { clipIn, clipOut, clipDuration } = range;
  if (!input.frames || input.frames.length === 0) return 100;

  const interval = (input.sampleIntervalMs || 500) / 1000;
  const framesInRange = input.frames.filter((frame) => frame.timestamp >= clipIn && frame.timestamp < clipOut);
  const coveredTime = framesInRange.length * interval;
  return Math.min(100, Math.round((coveredTime / clipDuration) * 100));
}
