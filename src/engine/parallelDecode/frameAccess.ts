/**
 * Read-only buffered-frame access for parallel decode. Returns frames still
 * owned by the manager's ClipDecoder buffer — never closes or transfers them.
 */

import { Logger } from '../../services/logger';
const log = Logger.create('ParallelDecode');

import { isTimeInClipRange, timelineToSourceTime } from './clipWindow';
import { getFrameLookupResult, type ParallelDecodeFrameLookupOptions } from './frameLookup';
import type { ClipDecoder } from './clipDecoderState';

/**
 * Get the decoded frame for a clip at a specific timeline time
 * Returns null if frame isn't ready (shouldn't happen if prefetch was called)
 * Optimized: O(log n) binary search instead of O(n) linear scan
 */
export function getBufferedFrameForClip(
  clipDecoder: ClipDecoder,
  timelineTime: number,
  frameToleranceUs: number,
  options: ParallelDecodeFrameLookupOptions = {}
): VideoFrame | null {
  const clipInfo = clipDecoder.clipInfo;
  const lookupTolerance = frameToleranceUs * Math.max(1, options.toleranceMultiplier ?? 1);

  // Check if time is within clip range (handles nested clips too)
  if (!isTimeInClipRange(clipInfo, timelineTime)) {
    return null;
  }

  const targetSourceTime = timelineToSourceTime(clipInfo, timelineTime);
  const targetTimestamp = targetSourceTime * 1_000_000;  // Convert to microseconds

  const lookupResult = getFrameLookupResult({
    timestamps: clipDecoder.sortedTimestamps,
    oldestTimestamp: clipDecoder.oldestTimestamp,
    newestTimestamp: clipDecoder.newestTimestamp,
    targetTimestamp,
    tolerance: lookupTolerance,
  });

  // Quick bounds check - return first/last frame if target is outside buffer range
  // This handles videos where first frame isn't at exactly 0 or clip extends beyond video
  if (lookupResult.kind === 'empty') {
    log.warn(`${clipDecoder.clipName}: Buffer empty for target ${(targetTimestamp/1_000_000).toFixed(3)}s`);
    return null;
  }

  if (lookupResult.kind === 'after-newest') {
    const lastFrame = clipDecoder.frameBuffer.get(lookupResult.timestamp);
    log.warn(`${clipDecoder.clipName}: target ${(targetTimestamp/1_000_000).toFixed(3)}s is outside buffered range (last=${lastFrame ? (lookupResult.timestamp/1_000_000).toFixed(3) : 'none'}s)`);
    return null;
  }

  if (lookupResult.kind === 'before-oldest') {
    const firstFrame = clipDecoder.frameBuffer.get(lookupResult.timestamp);
    log.warn(`${clipDecoder.clipName}: target ${(targetTimestamp/1_000_000).toFixed(3)}s is outside buffered range (first=${firstFrame ? (lookupResult.timestamp/1_000_000).toFixed(3) : 'none'}s)`);
    return null;
  }

  const frameTimestamp = lookupResult.timestamp;
  const frameDiff = lookupResult.diff;
  const decodedFrame = clipDecoder.frameBuffer.get(frameTimestamp);
  if (decodedFrame) {
    if (frameDiff >= lookupTolerance) {
      log.warn(`${clipDecoder.clipName}: nearest frame at ${(frameTimestamp/1_000_000).toFixed(3)}s is outside tolerance for target ${(targetTimestamp/1_000_000).toFixed(3)}s (diff=${(frameDiff/1000).toFixed(1)}ms, tolerance=${(lookupTolerance/1000).toFixed(1)}ms)`);
      return null;
    }
    return decodedFrame.frame;
  }

  // No frame found at all
  log.warn(`${clipDecoder.clipName}: No frame available at ${(targetTimestamp/1_000_000).toFixed(3)}s - buffer=${clipDecoder.frameBuffer.size} frames`);
  return null;
}
