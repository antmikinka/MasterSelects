/**
 * ParallelDecodeManager - Parallel video decoding for multi-clip exports
 *
 * Problem: Sequential decoding of multiple videos is slow because each video
 * waits for the previous one to decode before proceeding.
 *
 * Solution: Pre-decode frames in parallel using separate VideoDecoder instances
 * per clip, with a frame buffer that stays ahead of the render position.
 */

import { Logger } from '../services/logger';
const log = Logger.create('ParallelDecode');

import * as MP4BoxModule from 'mp4box';
import {
  createBaseDecoderConfig,
  createHardwareDecoderConfig,
  extractCodecDescription,
  getCodecString,
  HARDWARE_ACCELERATION_MODES,
  type MP4DataStreamConstructor,
  type MP4TrackDetails,
  type MP4VideoTrack,
} from './parallelDecode/decoderConfig';
import { isDecoderResetAbort } from './parallelDecode/decoderErrors';
import {
  getClipMainTimelineStart,
  getPrefetchTargetForClip,
  isTimeInClipRange,
  timelineToSourceTime,
  type ParallelDecodeClipInfo as ClipInfo,
} from './parallelDecode/clipWindow';
import {
  getFrameLookupResult,
  type ParallelDecodeFrameLookupOptions,
} from './parallelDecode/frameLookup';
import {
  getNormalizedSampleSourceTime,
  getNormalizedSampleTimestampMicroseconds,
  getPresentationOffsetSeconds,
} from './parallelDecode/sampleTiming';
import {
  BUFFER_AHEAD_FRAMES,
  MAX_BUFFER_SIZE,
  MAX_PREWARM_CLIP_STARTS,
  SLOW_BLOCKING_PREFETCH_WARN_MS,
  UPCOMING_CLIP_PREFETCH_SECONDS,
  binarySearchInsertPosition,
  collectPresentationKeyframeCandidates,
  createDecodeSchedulingPlan,
  findKeyframeAtOrBeforeSample,
  findSampleIndexForSourceTime,
  getBufferedTimeRangeForLog,
  getDecodeBatchSize,
  getDecodeSeekState,
  getSeekTargetSampleIndex,
  hasDecodeSeekDistance,
  hasUsableBufferedFrame,
} from './parallelDecode/scheduling';
import {
  createParallelDecodeRuntimeSnapshot,
  estimateDecodedFrameBytes,
  secondsFromTimestamp,
  type ParallelDecodeClipRuntimeSnapshot,
  type ParallelDecodeRuntimeSnapshot,
} from './parallelDecode/runtimeSnapshot';

export type { ParallelDecodeClipInfo } from './parallelDecode/clipWindow';
export type { ParallelDecodeFrameLookupOptions } from './parallelDecode/frameLookup';
export type { SamplePresentationTiming } from './parallelDecode/sampleTiming';
export {
  getNormalizedSampleSourceTime,
  getNormalizedSampleTimestampMicroseconds,
  getPresentationOffsetSeconds,
} from './parallelDecode/sampleTiming';
export type {
  ParallelDecodeClipRuntimeSnapshot,
  ParallelDecodeRuntimeSnapshot,
} from './parallelDecode/runtimeSnapshot';

const MP4Box = MP4BoxModule as unknown as {
  createFile: typeof MP4BoxModule.createFile;
  DataStream: MP4DataStreamConstructor;
};

// MP4Box types
interface MP4ArrayBuffer extends ArrayBuffer {
  fileStart: number;
}

interface Sample {
  number: number;
  track_id: number;
  data: ArrayBuffer;
  size: number;
  cts: number;
  dts: number;
  duration: number;
  is_sync: boolean;
  timescale: number;
}

interface MP4File {
  onReady: (info: { videoTracks: MP4VideoTrack[] }) => void;
  onSamples: (trackId: number, ref: unknown, samples: Sample[]) => void;
  onError: (error: string) => void;
  appendBuffer: (buffer: MP4ArrayBuffer) => number;
  start: () => void;
  flush: () => void;
  setExtractionOptions: (trackId: number, user: unknown, options: { nbSamples: number }) => void;
  getTrackById: (id: number) => MP4TrackDetails | undefined;
}

interface DecodedFrame {
  frame: VideoFrame;
  sourceTime: number;     // Normalized time in source video (seconds)
  timestamp: number;      // Normalized timestamp from VideoFrame (microseconds)
}

interface ClipDecoder {
  clipId: string;
  clipName: string;
  decoder: VideoDecoder;
  samples: Sample[];
  sampleIndex: number;
  videoTrack: MP4VideoTrack;
  codecConfig: VideoDecoderConfig;
  presentationOffsetSeconds: number;
  frameBuffer: Map<number, DecodedFrame>;  // timestamp (μs) -> decoded frame
  sortedTimestamps: number[];              // Sorted list for O(log n) lookup
  oldestTimestamp: number;                 // Track bounds for quick rejection
  newestTimestamp: number;                 // Track bounds for quick rejection
  lastDecodedTimestamp: number;            // Track last decoded timestamp
  clipInfo: ClipInfo;
  isDecoding: boolean;
  pendingDecode: Promise<void> | null;
  needsKeyframe: boolean;                  // True after flush - must start from keyframe
}

export class ParallelDecodeManager {
  private clipDecoders: Map<string, ClipDecoder> = new Map();
  private isActive = false;
  private decodePromises: Map<string, Promise<void>> = new Map();
  private frameTolerance = 50_000;  // Default 50ms in microseconds

  /**
   * Initialize the manager with clips to decode
   */
  async initialize(clips: ClipInfo[], exportFps: number): Promise<void> {
    const endInit = log.time('initialize');
    this.isActive = true;
    // FPS-based tolerance: 1.5 frame duration
    this.frameTolerance = Math.round((1_000_000 / exportFps) * 1.5);

    log.info(`Initializing ${clips.length} clips:`, clips.map(c => c.clipName));

    // Parse all clips in parallel
    const initPromises = clips.map(clip => this.initializeClip(clip));
    await Promise.all(initPromises);

    log.info(`All ${clips.length} clips initialized`);
    endInit();
  }

  /**
   * Initialize a single clip decoder - LAZY MODE
   * Phase 1: Parse MP4 synchronously (onReady must be sync to not break MP4Box pipeline)
   * Phase 2: Async hwAccel probing
   * Phase 3: Configure decoder and start sample extraction
   */
  private async initializeClip(clipInfo: ClipInfo): Promise<void> {
    // Phase 1: Parse MP4 and extract track info (sync onReady)
    const parseResult = await this.parseMP4TrackInfo(clipInfo);

    // Phase 2: Async hardware acceleration probing
    const hwAccel = await this.findSupportedHwAccel(parseResult.baseConfig, clipInfo.clipName);

    const codecConfig = createHardwareDecoderConfig(parseResult.baseConfig, hwAccel);

    // Phase 3: Configure decoder
    const decoder = new VideoDecoder({
      output: (frame) => {
        if (!this.isActive) {
          frame.close();
          return;
        }
        const clipDecoder = this.clipDecoders.get(clipInfo.clipId);
        if (clipDecoder) {
          this.handleDecodedFrame(clipDecoder, frame);
        } else {
          log.warn(`Frame output for unknown clip ${clipInfo.clipId}`);
          frame.close();
        }
      },
      error: (e) => {
        if (!this.isActive) {
          if (isDecoderResetAbort(e)) {
            log.debug(`Decoder reset cancelled pending work for ${clipInfo.clipName}`);
          }
          return;
        }
        log.error(`Decoder error for ${clipInfo.clipName}: ${e.message || e}`);
      },
    });

    try {
      decoder.configure(codecConfig);
      log.info(`Decoder configured for "${clipInfo.clipName}": ${codecConfig.codec} ${parseResult.videoTrack.video.width}x${parseResult.videoTrack.video.height} (hwAccel=${hwAccel})`);
    } catch (e) {
      log.error(`Failed to configure decoder for "${clipInfo.clipName}":`, e);
      throw e;
    }

    const presentationOffsetSeconds = getPresentationOffsetSeconds(parseResult.samples);
    if (Math.abs(presentationOffsetSeconds) > 0.0005) {
      log.info(`"${clipInfo.clipName}": normalizing MP4 presentation offset ${presentationOffsetSeconds.toFixed(3)}s so source starts at 0.000s`);
    }

    const clipDecoder: ClipDecoder = {
      clipId: clipInfo.clipId,
      clipName: clipInfo.clipName,
      decoder,
      samples: parseResult.samples,
      sampleIndex: 0,
      videoTrack: parseResult.videoTrack,
      codecConfig,
      presentationOffsetSeconds,
      frameBuffer: new Map(),
      sortedTimestamps: [],
      oldestTimestamp: Infinity,
      newestTimestamp: -Infinity,
      lastDecodedTimestamp: 0,
      clipInfo,
      isDecoding: false,
      pendingDecode: null,
      needsKeyframe: true, // Decoder was just configure()'d — first chunk must be a keyframe
    };

    this.clipDecoders.set(clipInfo.clipId, clipDecoder);
    log.info(`Clip "${clipInfo.clipName}" initialized: ${parseResult.videoTrack.video.width}x${parseResult.videoTrack.video.height} (${parseResult.samples.length} samples ready)`);
  }

  /**
   * Parse MP4 file and extract track info + samples synchronously.
   * onReady MUST be sync — MP4Box calls it during appendBuffer, and an async
   * callback would yield control before setExtractionOptions/start/flush,
   * causing MP4Box to never deliver samples.
   */
  private parseMP4TrackInfo(clipInfo: ClipInfo): Promise<{
    videoTrack: MP4VideoTrack;
    baseConfig: VideoDecoderConfig;
    samples: Sample[];
  }> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`MP4 parsing timeout for clip "${clipInfo.clipName}"`));
      }, 5000);

      const mp4File = MP4Box.createFile() as unknown as MP4File;
      const collectedSamples: Sample[] = [];

      // SYNC onReady — no await allowed here!
      mp4File.onReady = (info) => {
        const videoTrack = info.videoTracks[0];
        if (!videoTrack) {
          clearTimeout(timeout);
          reject(new Error(`No video track in clip "${clipInfo.clipName}"`));
          return;
        }

        // Build codec config
        const codec = getCodecString(videoTrack);
        let description: ArrayBuffer | undefined;

        try {
          const trak = mp4File.getTrackById(videoTrack.id);
          description = extractCodecDescription(trak, MP4Box.DataStream);
        } catch (e) {
          log.warn(`Failed to extract codec description for ${clipInfo.clipName}: ${e}`);
        }

        const baseConfig = createBaseDecoderConfig(videoTrack, description);

        // Start sample extraction SYNCHRONOUSLY before appendBuffer returns
        mp4File.setExtractionOptions(videoTrack.id, null, { nbSamples: Infinity });
        mp4File.start();

        // Resolve will happen after appendBuffer+flush complete (samples collected via onSamples)
        // Use setTimeout(0) to resolve after the synchronous appendBuffer+flush chain completes
        setTimeout(() => {
          clearTimeout(timeout);
          log.info(`"${clipInfo.clipName}" parsed: ${codec} ${videoTrack.video.width}x${videoTrack.video.height}, ${collectedSamples.length} samples`);
          resolve({ videoTrack, baseConfig, samples: collectedSamples });
        }, 0);
      };

      mp4File.onSamples = (_trackId, _ref, newSamples) => {
        collectedSamples.push(...newSamples);
      };

      mp4File.onError = (e) => {
        clearTimeout(timeout);
        reject(new Error(`MP4 parsing error for "${clipInfo.clipName}": ${e}`));
      };

      // Feed entire buffer — onReady fires sync during appendBuffer,
      // which sets up extraction before flush() signals end-of-data
      const mp4Buffer = clipInfo.fileData as MP4ArrayBuffer;
      mp4Buffer.fileStart = 0;
      try {
        mp4File.appendBuffer(mp4Buffer);
        mp4File.flush();
      } catch (e) {
        clearTimeout(timeout);
        reject(new Error(`MP4Box appendBuffer failed for "${clipInfo.clipName}": ${e}`));
      }
    });
  }

  /**
   * Handle a decoded frame from VideoDecoder output callback
   * Uses the frame's timestamp directly for accurate time mapping
   * Optimized: maintains sorted timestamp list for O(log n) lookups
   */
  private handleDecodedFrame(clipDecoder: ClipDecoder, frame: VideoFrame): void {
    // If cleanup has started, immediately close the frame
    if (!this.isActive) {
      frame.close();
      return;
    }

    const timestamp = frame.timestamp;  // microseconds
    const sourceTime = timestamp / 1_000_000;  // convert to seconds

    const existingFrame = clipDecoder.frameBuffer.get(timestamp);
    if (existingFrame) {
      this.closeDecodedFrame(existingFrame);
      clipDecoder.frameBuffer.delete(timestamp);
      clipDecoder.sortedTimestamps = clipDecoder.sortedTimestamps.filter(ts => ts !== timestamp);
      this.refreshBufferedTimestampBounds(clipDecoder);
    }

    // Log first 5 frames for debugging
    if (clipDecoder.frameBuffer.size < 5) {
      log.debug(`"${clipDecoder.clipName}": Frame ${clipDecoder.frameBuffer.size + 1} decoded at ${sourceTime.toFixed(3)}s (timestamp=${timestamp}µs)`);
    }

    // Store frame by its timestamp
    clipDecoder.frameBuffer.set(timestamp, {
      frame,
      sourceTime,
      timestamp,
    });

    // Maintain sorted timestamp list with binary insertion - O(log n)
    const insertIdx = binarySearchInsertPosition(clipDecoder.sortedTimestamps, timestamp);
    clipDecoder.sortedTimestamps.splice(insertIdx, 0, timestamp);

    // Update bounds - O(1)
    if (timestamp < clipDecoder.oldestTimestamp) {
      clipDecoder.oldestTimestamp = timestamp;
    }
    if (timestamp > clipDecoder.newestTimestamp) {
      clipDecoder.newestTimestamp = timestamp;
    }

    clipDecoder.lastDecodedTimestamp = timestamp;

    // Cleanup if buffer too large - remove oldest (no sorting needed)
    while (clipDecoder.frameBuffer.size > MAX_BUFFER_SIZE && clipDecoder.sortedTimestamps.length > 0) {
      const oldestTs = clipDecoder.sortedTimestamps.shift()!;
      const oldFrame = clipDecoder.frameBuffer.get(oldestTs);
      if (oldFrame) {
        this.closeDecodedFrame(oldFrame);
        clipDecoder.frameBuffer.delete(oldestTs);
      }
    }

    this.refreshBufferedTimestampBounds(clipDecoder);
  }

  private closeDecodedFrame(decodedFrame: DecodedFrame): void {
    try {
      decodedFrame.frame.close();
    } catch {
      // The frame may already be closed after decoder reset/cleanup.
    }
  }

  private refreshBufferedTimestampBounds(clipDecoder: ClipDecoder): void {
    clipDecoder.oldestTimestamp = clipDecoder.sortedTimestamps[0] ?? Infinity;
    clipDecoder.newestTimestamp = clipDecoder.sortedTimestamps[clipDecoder.sortedTimestamps.length - 1] ?? -Infinity;
  }

  async prewarmClipStarts(
    startTime: number,
    endTime: number,
    maxStarts: number = MAX_PREWARM_CLIP_STARTS
  ): Promise<number> {
    if (!this.isActive || this.clipDecoders.size === 0) {
      return 0;
    }

    const clipStartTimes = new Map<number, number>();
    for (const [, clipDecoder] of this.clipDecoders) {
      const clipStart = getClipMainTimelineStart(clipDecoder.clipInfo);
      if (clipStart <= startTime + 0.0005 || clipStart >= endTime) {
        continue;
      }

      clipStartTimes.set(Math.round(clipStart * 1000), clipStart);
    }

    const prewarmTimes = Array.from(clipStartTimes.values())
      .sort((a, b) => a - b)
      .slice(0, maxStarts);

    for (const clipStart of prewarmTimes) {
      await this.prefetchFramesForTime(clipStart);
    }

    return prewarmTimes.length;
  }

  /**
   * Pre-decode frames for a specific timeline time across all clips
   * Optimized for speed: fires decode ahead in background, only waits if frame is missing
   */
  async prefetchFramesForTime(timelineTime: number): Promise<void> {
    log.debug(`prefetchFramesForTime(${timelineTime.toFixed(3)}) - isActive=${this.isActive}, decoders=${this.clipDecoders.size}`);
    if (!this.isActive) return;

    const clipsNeedingFlush: ClipDecoder[] = [];

    for (const [, clipDecoder] of this.clipDecoders) {
      const clipInfo = clipDecoder.clipInfo;
      const prefetchTarget = getPrefetchTargetForClip(
        clipInfo,
        timelineTime,
        UPCOMING_CLIP_PREFETCH_SECONDS
      );

      if (!prefetchTarget) {
        log.debug(`"${clipInfo.clipName}": Skipped - not in range (start=${clipInfo.startTime}, dur=${clipInfo.duration}, nested=${clipInfo.isNested})`);
        continue;
      }

      log.debug(`"${clipInfo.clipName}": Processing at time ${prefetchTarget.timelineTime.toFixed(3)}s - samples=${clipDecoder.samples.length}, buffer=${clipDecoder.frameBuffer.size}, decoderState=${clipDecoder.decoder.state}, blocking=${prefetchTarget.shouldBlock}`);

      // Wait for samples if lazy loading hasn't delivered them yet
      if (clipDecoder.samples.length === 0) {
        log.debug(`"${clipInfo.clipName}": Waiting for samples...`);
        const maxWaitMs = 10000; // 10 second max wait per clip (increased for large files)
        const startWait = performance.now();
        while (clipDecoder.samples.length === 0 && performance.now() - startWait < maxWaitMs) {
          await new Promise(r => setTimeout(r, 50));
        }
        if (clipDecoder.samples.length === 0) {
          const errorMsg = `"${clipInfo.clipName}" has no samples after waiting ${maxWaitMs}ms`;
          log.error(errorMsg);
          throw new Error(`Parallel decode initialization failed: ${errorMsg}`);
        }
        log.info(`"${clipInfo.clipName}" samples ready: ${clipDecoder.samples.length} (waited ${(performance.now() - startWait).toFixed(0)}ms)`);
      }

      // Calculate target source time and sample index
      const sourceTime = timelineToSourceTime(clipInfo, prefetchTarget.timelineTime);
      const targetSampleIndex = findSampleIndexForSourceTime(
        clipDecoder.samples,
        sourceTime,
        clipDecoder.presentationOffsetSeconds
      );

      // Check if frame is already in buffer (fast path)
      const targetTimestamp = sourceTime * 1_000_000;
      const checkTolerance = this.frameTolerance * 2; // Double tolerance for buffer check

      // Get buffer time range for logging
      const { start: bufferStart, end: bufferEnd } = getBufferedTimeRangeForLog(
        clipDecoder.sortedTimestamps
      );
      const frameInBuffer = hasUsableBufferedFrame(
        clipDecoder.sortedTimestamps,
        clipDecoder.oldestTimestamp,
        clipDecoder.newestTimestamp,
        targetTimestamp,
        checkTolerance
      );

      log.debug(`"${clipInfo.clipName}": Frame check - target=${(targetTimestamp/1_000_000).toFixed(3)}s, buffer=${clipDecoder.frameBuffer.size} frames [${bufferStart}s-${bufferEnd}s], frameInBuffer=${frameInBuffer}, tolerance=${(checkTolerance/1000).toFixed(1)}ms`);

      // Trigger decode ahead - ALWAYS await if we're behind the target sample
      // Also need to decode if frame is not in buffer (we might be too far ahead and need to seek back)
      const decodePlan = createDecodeSchedulingPlan({
        sampleIndex: clipDecoder.sampleIndex,
        targetSampleIndex,
        frameBufferSize: clipDecoder.frameBuffer.size,
        frameInBuffer,
      });
      const {
        decodeTarget,
        needsDecoding,
        needsDecodingBack,
        isBehindTarget,
        shouldSeekDirectlyToTarget,
      } = decodePlan;

      if (needsDecoding && !clipDecoder.isDecoding) {
        log.debug(`"${clipInfo.clipName}": Triggering decode - samples=${clipDecoder.samples.length}, targetIdx=${targetSampleIndex}, currentIdx=${clipDecoder.sampleIndex}, decodeTarget=${decodeTarget}, frameInBuffer=${frameInBuffer}, isBehindTarget=${isBehindTarget}, needsBackSeek=${needsDecodingBack}, directSeek=${shouldSeekDirectlyToTarget}`);

        // Decode WITHOUT flush first — let output callback deliver frames async.
        // This avoids the expensive flush→needsKeyframe→reset→re-decode-from-keyframe cycle.
        // The retry loop below will flush only if the frame hasn't appeared.
        if (!frameInBuffer) {
          const decodePromise = this.decodeAhead(
            clipDecoder,
            decodeTarget,
            shouldSeekDirectlyToTarget,
            0,
            targetSampleIndex
          );
          if (prefetchTarget.shouldBlock) {
            const directDecodeStart = performance.now();
            await decodePromise;
            const directDecodeMs = performance.now() - directDecodeStart;
            if (directDecodeMs >= SLOW_BLOCKING_PREFETCH_WARN_MS) {
              log.warn(`${clipDecoder.clipName}: slow direct prefetch decode`, {
                timelineTime: Number(prefetchTarget.timelineTime.toFixed(3)),
                sourceTime: Number(sourceTime.toFixed(3)),
                targetSampleIndex,
                decodeTarget,
                sampleIndex: clipDecoder.sampleIndex,
                directDecodeMs: Number(directDecodeMs.toFixed(1)),
                directSeek: shouldSeekDirectlyToTarget,
                decodeQueueSize: clipDecoder.decoder.decodeQueueSize,
                bufferSize: clipDecoder.frameBuffer.size,
                bufferedStart: Number.isFinite(clipDecoder.oldestTimestamp)
                  ? Number((clipDecoder.oldestTimestamp / 1_000_000).toFixed(3))
                  : null,
                bufferedEnd: Number.isFinite(clipDecoder.newestTimestamp)
                  ? Number((clipDecoder.newestTimestamp / 1_000_000).toFixed(3))
                  : null,
              });
            }
          } else {
            void decodePromise;
          }
        } else {
          // Frame already in buffer - background decode for future frames
          log.debug(`"${clipInfo.clipName}": Background decode (frame in buffer)`);
          this.decodeAhead(clipDecoder, decodeTarget, false);
        }
      }

      // Track clips that still need their frames
      if (prefetchTarget.shouldBlock && !frameInBuffer) {
        clipsNeedingFlush.push(clipDecoder);
      }
    }

    // Wait for clips that still need their frame — escalating strategy:
    // 1. Wait for async output callback (no flush)
    // 2. Flush only if frame hasn't appeared
    // 3. Re-decode with flush as last resort
    for (const clipDecoder of clipsNeedingFlush) {
      const clipInfo = clipDecoder.clipInfo;
      const sourceTime = timelineToSourceTime(clipInfo, timelineTime);
      const targetTimestamp = sourceTime * 1_000_000;
      const targetSampleIndex = findSampleIndexForSourceTime(
        clipDecoder.samples,
        sourceTime,
        clipDecoder.presentationOffsetSeconds
      );
      const blockingStart = performance.now();
      let attemptsUsed = 0;

      for (let attempt = 0; attempt < 10; attempt++) {
        attemptsUsed = attempt + 1;
        // Wait for pending decode to complete
        if (clipDecoder.pendingDecode) {
          await clipDecoder.pendingDecode;
        }

        // Check if frame is now in buffer
        const frameFound = hasUsableBufferedFrame(
          clipDecoder.sortedTimestamps,
          clipDecoder.oldestTimestamp,
          clipDecoder.newestTimestamp,
          targetTimestamp,
          this.frameTolerance * 2
        );

        if (frameFound) {
          if (attempt > 0) {
            log.debug(`"${clipDecoder.clipName}": Frame found after ${attempt + 1} attempts`);
          }
          break;
        }

        // Escalating strategy
        if (attempt < 2) {
          // First 2 attempts: just wait briefly for async output callback
          await new Promise(r => setTimeout(r, 8));
        } else if (clipDecoder.decoder.decodeQueueSize > 0) {
          // Flush decoder queue to force output
          log.debug(`"${clipDecoder.clipName}": Flushing decoder (attempt ${attempt + 1}, queue=${clipDecoder.decoder.decodeQueueSize})`);
          await clipDecoder.decoder.flush();
          clipDecoder.needsKeyframe = true;
        } else if (!clipDecoder.isDecoding) {
          // Queue is empty but frame not found — re-decode with forceFlush
          log.debug(`"${clipDecoder.clipName}": Re-decode with flush (attempt ${attempt + 1}, queue empty)`);
          const decodeTarget = Math.max(targetSampleIndex + BUFFER_AHEAD_FRAMES, BUFFER_AHEAD_FRAMES);
          await this.decodeAhead(clipDecoder, decodeTarget, true, 0, targetSampleIndex);
        } else {
          // Decoder is busy, wait for it
          await new Promise(r => setTimeout(r, 10));
        }
      }

      // Final check - strict export should fail instead of using a nearby frame.
      const finalTolerance = this.frameTolerance * 3; // 3x tolerance for final check
      const finalCheck = hasUsableBufferedFrame(
        clipDecoder.sortedTimestamps,
        clipDecoder.oldestTimestamp,
        clipDecoder.newestTimestamp,
        targetTimestamp,
        finalTolerance
      );
      const blockingMs = performance.now() - blockingStart;
      if (blockingMs >= SLOW_BLOCKING_PREFETCH_WARN_MS) {
        log.warn(`${clipDecoder.clipName}: slow blocking prefetch`, {
          timelineTime: Number(timelineTime.toFixed(3)),
          sourceTime: Number(sourceTime.toFixed(3)),
          targetSampleIndex,
          sampleIndex: clipDecoder.sampleIndex,
          attempts: attemptsUsed,
          blockingMs: Number(blockingMs.toFixed(1)),
          decodeQueueSize: clipDecoder.decoder.decodeQueueSize,
          bufferSize: clipDecoder.frameBuffer.size,
          bufferedStart: Number.isFinite(clipDecoder.oldestTimestamp)
            ? Number((clipDecoder.oldestTimestamp / 1_000_000).toFixed(3))
            : null,
          bufferedEnd: Number.isFinite(clipDecoder.newestTimestamp)
            ? Number((clipDecoder.newestTimestamp / 1_000_000).toFixed(3))
            : null,
          finalCheck,
        });
      }
      if (!finalCheck) {
        const availableFrames = Array.from(clipDecoder.frameBuffer.values())
          .map(f => (f.timestamp / 1_000_000).toFixed(3))
          .sort()
          .slice(0, 10)
          .join(', ');

        throw new Error(`FAST export failed: "${clipDecoder.clipName}" has no decoded frame at ${(targetTimestamp/1_000_000).toFixed(3)}s after all attempts (buffer: ${clipDecoder.frameBuffer.size} frames, decoderState: ${clipDecoder.decoder.state}, nearby: [${availableFrames}...]).`);
      }
    }
  }

  /**
   * Recreate a decoder that has entered the permanent 'closed' state due to an error.
   * WebCodecs decoders cannot be reset() once closed - a full recreate is needed.
   * Re-checks hardware acceleration support since the original mode may have been the cause.
   */
  private async recreateDecoder(clipDecoder: ClipDecoder): Promise<void> {
    log.warn(`${clipDecoder.clipName}: Recreating closed decoder`);

    // Re-check hardware acceleration — the original mode may have caused the failure
    const hwAccel = await this.findSupportedHwAccel(clipDecoder.codecConfig, clipDecoder.clipName);
    const newConfig = createHardwareDecoderConfig(clipDecoder.codecConfig, hwAccel);

    // Create new decoder with same callbacks
    const newDecoder = new VideoDecoder({
      output: (frame) => {
        if (!this.isActive) {
          frame.close();
          return;
        }
        const cd = this.clipDecoders.get(clipDecoder.clipId);
        if (cd) {
          this.handleDecodedFrame(cd, frame);
        } else {
          frame.close();
        }
      },
      error: (e) => {
        if (!this.isActive) {
          if (isDecoderResetAbort(e)) {
            log.debug(`Decoder reset cancelled pending work for ${clipDecoder.clipName}`);
          }
          return;
        }
        log.error(`Decoder error for ${clipDecoder.clipName}: ${e.message || e}`);
      },
    });

    // Configure with updated codec config
    try {
      newDecoder.configure(newConfig);
    } catch (e) {
      log.error(`${clipDecoder.clipName}: Failed to configure recreated decoder: ${e}`);
      throw e;
    }

    // Replace decoder and config
    clipDecoder.decoder = newDecoder;
    clipDecoder.codecConfig = newConfig;
    clipDecoder.needsKeyframe = true;
    clipDecoder.sampleIndex = 0;

    // Clear stale buffer
    for (const [, decodedFrame] of clipDecoder.frameBuffer) {
      try { decodedFrame.frame.close(); } catch (_) { /* already closed */ }
    }
    clipDecoder.frameBuffer.clear();
    clipDecoder.sortedTimestamps = [];
    clipDecoder.oldestTimestamp = Infinity;
    clipDecoder.newestTimestamp = -Infinity;

    log.info(`${clipDecoder.clipName}: Decoder recreated successfully (hwAccel=${hwAccel})`);
  }

  /**
   * Decode frames ahead to fill buffer - optimized for throughput
   * Does NOT flush after every batch - frames arrive via output callback asynchronously
   * @param seekTargetSampleIndex - If provided, use this for seek keyframe calculation instead of targetSampleIndex
   *                                This is important when targetSampleIndex includes buffer-ahead frames
   */
  private async decodeAhead(clipDecoder: ClipDecoder, targetSampleIndex: number, forceFlush: boolean = false, recursionDepth: number = 0, seekTargetSampleIndex?: number): Promise<void> {
    // Prevent infinite recursion
    if (recursionDepth > 3) {
      log.warn(`${clipDecoder.clipName}: Max recursion depth reached (${recursionDepth}), stopping`);
      return;
    }

    if (clipDecoder.isDecoding) {
      log.debug(`${clipDecoder.clipName}: Already decoding, skipping`);
      return; // Let current decode continue, don't wait
    }

    // Check if decoder is still valid - recreate if closed
    if (!clipDecoder.decoder || clipDecoder.decoder.state === 'closed') {
      log.warn(`${clipDecoder.clipName}: Decoder is ${clipDecoder.decoder?.state || 'null'}, recreating...`);
      await this.recreateDecoder(clipDecoder);
    }

    clipDecoder.isDecoding = true;

    clipDecoder.pendingDecode = (async () => {
      try {
        // Double-check decoder state inside async block - recreate if closed
        if (!clipDecoder.decoder || clipDecoder.decoder.state === 'closed') {
          log.warn(`${clipDecoder.clipName}: Decoder closed during decode setup, recreating...`);
          await this.recreateDecoder(clipDecoder);
        }
        // Check if we need to seek (target is far from current position - either ahead OR behind)
        // But ONLY seek if forceFlush is true (we actually need the frame now)
        // Background decodes should just continue forward, not seek
        const { isTooFarAhead, isTooFarBehind, needsSeek } = getDecodeSeekState({
          forceFlush,
          sampleIndex: clipDecoder.sampleIndex,
          targetSampleIndex,
          seekTargetSampleIndex,
        });

        // IMPORTANT: Do seek FIRST before calculating framesToDecode
        // Otherwise if we're past the target, framesToDecode will be negative and we'll return early
        if (needsSeek) {
          // Need to seek - find nearest keyframe before the ACTUAL target we need
          const seekTarget = getSeekTargetSampleIndex(
            clipDecoder.samples.length,
            targetSampleIndex,
            seekTargetSampleIndex
          );
          // Find keyframe candidates by CTS (display time), not decode order.
          // Due to B-frame reordering, a keyframe earlier in decode order
          // can have a LATER CTS than the target, causing wrong frames to be decoded.
          const targetSourceTime = getNormalizedSampleSourceTime(
            clipDecoder.samples[seekTarget],
            clipDecoder.presentationOffsetSeconds
          );
          const keyframeCandidates = collectPresentationKeyframeCandidates(
            clipDecoder.samples,
            clipDecoder.presentationOffsetSeconds,
            targetSourceTime
          );

          const exportConfig = clipDecoder.codecConfig;

          // Try keyframes from closest to earliest - some samples marked is_sync
          // by MP4Box aren't real IDR keyframes (e.g. open-GOP recovery points).
          // The decoder rejects these, so we fall back to earlier keyframes.
          const maxAttempts = Math.min(keyframeCandidates.length, 5);
          for (let k = keyframeCandidates.length - 1; k >= keyframeCandidates.length - maxAttempts; k--) {
            const candidateIndex = keyframeCandidates[k];
            const candidateSample = clipDecoder.samples[candidateIndex];
            const candidateSourceTime = getNormalizedSampleSourceTime(
              candidateSample,
              clipDecoder.presentationOffsetSeconds
            ).toFixed(3);

            clipDecoder.decoder.reset();
            clipDecoder.decoder.configure(exportConfig);

            const chunk = new EncodedVideoChunk({
              type: 'key',
              timestamp: getNormalizedSampleTimestampMicroseconds(candidateSample, clipDecoder.presentationOffsetSeconds),
              duration: (candidateSample.duration * 1_000_000) / candidateSample.timescale,
              data: candidateSample.data,
            });

            try {
              clipDecoder.decoder.decode(chunk);
              clipDecoder.sampleIndex = candidateIndex + 1; // Already decoded this one
              log.debug(`${clipDecoder.clipName}: Seek keyframe accepted at sample ${candidateIndex} (source=${candidateSourceTime}s, targetSource=${targetSourceTime.toFixed(3)}s, bufferTarget=${targetSampleIndex})`);
              break;
            } catch (e) {
              log.debug(`${clipDecoder.clipName}: Seek keyframe REJECTED at sample ${candidateIndex} (source=${candidateSourceTime}s) - not a real IDR, trying earlier`);
              if (k === keyframeCandidates.length - maxAttempts) {
                // Last attempt failed - reset and start from first sample
                clipDecoder.decoder.reset();
                clipDecoder.decoder.configure(exportConfig);
                clipDecoder.sampleIndex = 0;
                log.warn(`${clipDecoder.clipName}: No valid keyframe found after ${maxAttempts} attempts, starting from sample 0`);
              }
            }
          }

          clipDecoder.needsKeyframe = false;

          // Clear buffer since we're seeking
          for (const [, decodedFrame] of clipDecoder.frameBuffer) {
            decodedFrame.frame.close();
          }
          clipDecoder.frameBuffer.clear();
          clipDecoder.sortedTimestamps = [];
          clipDecoder.oldestTimestamp = Infinity;
          clipDecoder.newestTimestamp = -Infinity;
        }

        // Calculate frames to decode AFTER potential seek (sampleIndex may have changed)
        const endIndex = Math.min(targetSampleIndex, clipDecoder.samples.length);
        let framesToDecode = endIndex - clipDecoder.sampleIndex;

        if (framesToDecode <= 0) {
          log.debug(`${clipDecoder.clipName}: No frames to decode (sampleIndex=${clipDecoder.sampleIndex}, target=${targetSampleIndex})`);
          return;
        }

        // Decode in larger batches for throughput
        // Use much larger batch for seeks to reach target in one go
        const batchSize = getDecodeBatchSize(needsSeek);
        framesToDecode = Math.min(framesToDecode, batchSize);

        log.debug(`${clipDecoder.clipName}: Decoding ${framesToDecode} frames (from sample ${clipDecoder.sampleIndex} to ${clipDecoder.sampleIndex + framesToDecode}), forceFlush=${forceFlush}, needsSeek=${needsSeek} (ahead=${isTooFarAhead}, behind=${isTooFarBehind}), batchSize=${batchSize}`);

        // After flush/configure, decoder requires next chunk to be a keyframe.
        // Reset decoder and start from nearest keyframe (same approach as seek path).
        if (clipDecoder.needsKeyframe && !needsSeek) {
          const keyframeIndex = findKeyframeAtOrBeforeSample(
            clipDecoder.samples,
            clipDecoder.sampleIndex
          );
          // Reset decoder to clean state and start from keyframe
          clipDecoder.decoder.reset();
          clipDecoder.decoder.configure(clipDecoder.codecConfig);
          clipDecoder.sampleIndex = keyframeIndex;
          clipDecoder.needsKeyframe = false;
          log.debug(`${clipDecoder.clipName}: needsKeyframe - reset decoder, starting from keyframe at sample ${keyframeIndex}`);
        }

        // Queue frames for decode (non-blocking - output callback handles results)
        let decodedCount = 0;
        let needsKeyframeRecovery = false;
        for (let i = 0; i < framesToDecode && clipDecoder.sampleIndex < clipDecoder.samples.length; i++) {
          const sample = clipDecoder.samples[clipDecoder.sampleIndex];

          // Safety: if decoder rejected a delta frame, skip until next keyframe
          if (needsKeyframeRecovery && !sample.is_sync) {
            clipDecoder.sampleIndex++;
            continue;
          }
          if (needsKeyframeRecovery && sample.is_sync) {
            // Found a keyframe — reset decoder to clean state before feeding it
            clipDecoder.decoder.reset();
            clipDecoder.decoder.configure(clipDecoder.codecConfig);
            needsKeyframeRecovery = false;
            log.debug(`${clipDecoder.clipName}: keyframe recovery at sample ${clipDecoder.sampleIndex}`);
          }

          clipDecoder.sampleIndex++;

          const chunk = new EncodedVideoChunk({
            type: sample.is_sync ? 'key' : 'delta',
            timestamp: getNormalizedSampleTimestampMicroseconds(sample, clipDecoder.presentationOffsetSeconds),
            duration: (sample.duration * 1_000_000) / sample.timescale,
            data: sample.data,
          });

          try {
            clipDecoder.decoder.decode(chunk);
            decodedCount++;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes('key frame')) {
              // Decoder needs a keyframe — skip delta frames until we find one
              needsKeyframeRecovery = true;
              log.debug(`${clipDecoder.clipName}: key frame required at sample ${clipDecoder.sampleIndex - 1}, scanning for next keyframe`);
            } else {
              log.warn(`${clipDecoder.clipName}: decode error at sample ${clipDecoder.sampleIndex - 1}: ${e}`);
            }
          }
        }

        log.debug(`${clipDecoder.clipName}: Queued ${decodedCount} chunks to decoder, decodeQueueSize=${clipDecoder.decoder.decodeQueueSize}`);

        // Only flush if explicitly requested (when we need frames NOW)
        if (forceFlush) {
          await clipDecoder.decoder.flush();
          clipDecoder.needsKeyframe = true; // After flush, next decode needs keyframe
        }
      } catch (e) {
        if (!this.isActive && isDecoderResetAbort(e)) {
          log.debug(`${clipDecoder.clipName}: pending decode cancelled by decoder reset during cleanup`);
          return;
        }
        log.error(`Decode error for ${clipDecoder.clipName}: ${e}`);
      } finally {
        clipDecoder.isDecoding = false;
        clipDecoder.pendingDecode = null;
      }
    })();

    await clipDecoder.pendingDecode;

    // If we're still behind target after the batch, decode more recursively
    // BUT: Don't recurse if we just did a seek (needsSeek), as the seek resets sampleIndex
    // and would cause infinite recursion. Instead, let the next prefetch call handle it.
    const stillBehind = clipDecoder.sampleIndex < targetSampleIndex;
    // Check if a seek happened (either direction) - recompute same logic as above
    const didSeek = hasDecodeSeekDistance(clipDecoder.sampleIndex, targetSampleIndex);

    if (forceFlush && stillBehind && !didSeek && recursionDepth < 3) {
      const remainingFrames = targetSampleIndex - clipDecoder.sampleIndex;
      log.debug(`${clipDecoder.clipName}: Still behind target (sampleIndex=${clipDecoder.sampleIndex}, targetIdx=${targetSampleIndex}, remaining=${remainingFrames}), decoding additional batch (recursion ${recursionDepth + 1}/3)`);
      await this.decodeAhead(clipDecoder, targetSampleIndex, true, recursionDepth + 1);
    } else if (stillBehind) {
      log.debug(`${clipDecoder.clipName}: Still behind target (sampleIndex=${clipDecoder.sampleIndex}, targetIdx=${targetSampleIndex}), stopping (${didSeek ? 'after seek' : 'max recursion'})`);
    }
  }

  /**
   * Get the decoded frame for a clip at a specific timeline time
   * Returns null if frame isn't ready (shouldn't happen if prefetch was called)
   * Optimized: O(log n) binary search instead of O(n) linear scan
   */
  getFrameForClip(
    clipId: string,
    timelineTime: number,
    options: ParallelDecodeFrameLookupOptions = {}
  ): VideoFrame | null {
    const clipDecoder = this.clipDecoders.get(clipId);
    if (!clipDecoder) return null;

    const clipInfo = clipDecoder.clipInfo;
    const lookupTolerance = this.frameTolerance * Math.max(1, options.toleranceMultiplier ?? 1);

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

  /**
   * Get all frames for the current timeline time
   * Returns Map of clipId -> VideoFrame
   */
  async getFramesAtTime(timelineTime: number): Promise<Map<string, VideoFrame>> {
    // First prefetch to ensure frames are decoded
    await this.prefetchFramesForTime(timelineTime);

    const frames = new Map<string, VideoFrame>();

    for (const [clipId] of this.clipDecoders) {
      const frame = this.getFrameForClip(clipId, timelineTime);
      if (frame) {
        frames.set(clipId, frame);
      }
    }

    return frames;
  }

  /**
   * Advance buffer position after rendering a frame
   * Call this after successfully rendering to clean up old frames
   */
  advanceToTime(timelineTime: number): void {
    for (const [, clipDecoder] of this.clipDecoders) {
      const clipInfo = clipDecoder.clipInfo;

      // Skip if time is not in this clip's range
      if (!isTimeInClipRange(clipInfo, timelineTime)) {
        continue;
      }

      const sourceTime = timelineToSourceTime(clipInfo, timelineTime);
      const currentTimestamp = sourceTime * 1_000_000;  // Convert to microseconds

      // Clean up frames that are significantly behind current position (> 200ms behind)
      const timestampsToRemove: number[] = [];
      for (const [timestamp, decodedFrame] of clipDecoder.frameBuffer) {
        if (timestamp < currentTimestamp - 200_000) {  // 200ms behind
          decodedFrame.frame.close();
          timestampsToRemove.push(timestamp);
        }
      }

      for (const timestamp of timestampsToRemove) {
        clipDecoder.frameBuffer.delete(timestamp);
      }

      if (timestampsToRemove.length > 0) {
        const removedTimestamps = new Set(timestampsToRemove);
        clipDecoder.sortedTimestamps = clipDecoder.sortedTimestamps.filter(timestamp => !removedTimestamps.has(timestamp));
        this.refreshBufferedTimestampBounds(clipDecoder);
      }
    }
  }

  /**
   * Check if a clip is managed by this decoder
   */
  hasClip(clipId: string): boolean {
    return this.clipDecoders.has(clipId);
  }

  getRuntimeSnapshot(): ParallelDecodeRuntimeSnapshot {
    const clips = Array.from(this.clipDecoders.values()).map((clipDecoder) => {
      const estimatedBufferedFrameBytes = estimateDecodedFrameBytes(
        clipDecoder.videoTrack.video.width,
        clipDecoder.videoTrack.video.height,
        clipDecoder.frameBuffer.size
      );
      return {
        clipId: clipDecoder.clipId,
        clipName: clipDecoder.clipName,
        codec: clipDecoder.codecConfig.codec,
        decoderState: clipDecoder.decoder.state,
        decodeQueueSize: clipDecoder.decoder.decodeQueueSize,
        hardwareAcceleration: clipDecoder.codecConfig.hardwareAcceleration,
        dimensions: {
          width: clipDecoder.videoTrack.video.width,
          height: clipDecoder.videoTrack.video.height,
        },
        sampleCount: clipDecoder.samples.length,
        sampleIndex: clipDecoder.sampleIndex,
        isDecoding: clipDecoder.isDecoding,
        hasPendingDecode: Boolean(clipDecoder.pendingDecode),
        frameBufferSize: clipDecoder.frameBuffer.size,
        estimatedBufferedFrameBytes,
        oldestBufferedTimeSeconds: secondsFromTimestamp(clipDecoder.oldestTimestamp),
        newestBufferedTimeSeconds: secondsFromTimestamp(clipDecoder.newestTimestamp),
        lastDecodedTimeSeconds: secondsFromTimestamp(clipDecoder.lastDecodedTimestamp),
        isNested: clipDecoder.clipInfo.isNested,
        parentClipId: clipDecoder.clipInfo.parentClipId,
      } satisfies ParallelDecodeClipRuntimeSnapshot;
    });

    return createParallelDecodeRuntimeSnapshot({
      isActive: this.isActive,
      frameToleranceUs: this.frameTolerance,
      clips,
    });
  }

  /**
   * Find a supported hardwareAcceleration mode for the given config.
   * Tries prefer-software first (most reliable for export), then prefer-hardware, then no-preference.
   */
  private async findSupportedHwAccel(
    baseConfig: VideoDecoderConfig,
    clipName: string
  ): Promise<HardwareAcceleration> {
    for (const mode of HARDWARE_ACCELERATION_MODES) {
      try {
        const result = await VideoDecoder.isConfigSupported({ ...baseConfig, hardwareAcceleration: mode });
        if (result.supported) {
          if (mode !== 'prefer-software') {
            log.info(`"${clipName}": prefer-software not supported, using ${mode}`);
          }
          return mode;
        }
      } catch {
        // isConfigSupported threw — skip this mode
      }
    }

    // None explicitly supported — fall back to no-preference and let configure() decide
    log.warn(`"${clipName}": No hwAccel mode reported as supported for codec ${baseConfig.codec}, trying no-preference`);
    return 'no-preference';
  }

  /**
   * Cleanup all resources
   */
  cleanup(): void {
    // Set inactive first - this ensures handleDecodedFrame closes any new frames
    this.isActive = false;

    for (const [, clipDecoder] of this.clipDecoders) {
      // Reset decoder first to stop any pending decode operations
      // This will cause output callback to fire for any buffered frames
      try {
        if (clipDecoder.decoder.state !== 'closed') {
          clipDecoder.decoder.reset();
        }
      } catch (e) {
        // Ignore reset errors
      }

      // Close all buffered frames
      for (const [, decodedFrame] of clipDecoder.frameBuffer) {
        try {
          decodedFrame.frame.close();
        } catch (e) {
          // Frame may already be closed
        }
      }
      clipDecoder.frameBuffer.clear();
      clipDecoder.sortedTimestamps = [];

      // Close decoder
      try {
        if (clipDecoder.decoder.state !== 'closed') {
          clipDecoder.decoder.close();
        }
      } catch (e) {
        // Ignore close errors
      }
    }

    this.clipDecoders.clear();
    this.decodePromises.clear();
    log.info('Cleaned up');
  }
}
