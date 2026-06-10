import { webCodecsTelemetry } from '../webcodecs/webCodecsTelemetry';
import { WebCodecsPlayerAdvancePlayback } from './playerAdvancePlayback';
import type { SeekPreviewMode } from './playerTypes';

export abstract class WebCodecsPlayerSeekingControls extends WebCodecsPlayerAdvancePlayback {
  seek(timeSeconds: number, options?: { previewMode?: SeekPreviewMode }): void {
    // Simple mode: direct seek on video element
    if (this.useSimpleMode && this.simpleSource.hasVideoElement()) {
      this.simpleSource.seek(timeSeconds);
      return;
    }

    // Full mode: decode from keyframe
    if (!this.videoTrack || this.samples.length === 0 || !this.decoder) return;

    const seekStart = performance.now();
    const targetTime = timeSeconds * this.videoTrack.timescale;

    // Binary search for closest CTS match (O(log n) instead of O(n))
    const targetIndex = this.findSampleNearCts(targetTime);
    const keyframeIndex = this.findKeyframeBefore(targetIndex);
    const framesDecoded = targetIndex - keyframeIndex + 1;

    // Set seek target. Intermediate GOP traversal frames are dropped in output callback
    // so the renderer keeps showing the last stable frame until the target arrives.
    const targetSample = this.samples[targetIndex];
    this.seekTargetUs = (targetSample.cts * 1_000_000) / targetSample.timescale;
    this.seekTargetToleranceUs = this.computeSeekToleranceUs(targetIndex);
    this.clearAdvanceSeekState('replaced');
    this.clearPausedPreroll();
    const previewMode = options?.previewMode ?? 'strict';
    const canExtendPendingSeek = this.canExtendPendingPausedSeek(targetIndex, previewMode);
    const canReusePipeline = canExtendPendingSeek || this.canReusePausedSeekPipeline(targetIndex, previewMode);
    const feedEndIndex = this.getPausedSeekFeedEndIndex(targetIndex, previewMode);
    this.invalidateStrictPausedSeekFlush();
    if (!canReusePipeline) {
      this.clearPendingSeekFeed();
    }
    this.beginPendingSeek('seek', this.seekTargetUs);
    this.pendingSeekPreviewMode = previewMode;

    webCodecsTelemetry.seekStart(timeSeconds, framesDecoded);

    if (canReusePipeline) {
      webCodecsTelemetry.seekSkipReuse(
        canExtendPendingSeek ? 'seek_extend_pending' : 'seek_reuse_pipeline',
        targetIndex,
        this.getCurrentFrameSampleIndex() ?? -1,
        this.feedIndex
      );

      this.sampleIndex = targetIndex;
      if (!canExtendPendingSeek) {
        this.feedIndex = Math.max(this.feedIndex, (this.getCurrentFrameSampleIndex() ?? targetIndex) + 1);
      }
      this.pendingSeekFeedEndIndex = Math.max(
        this.pendingSeekFeedEndIndex ?? this.feedIndex - 1,
        feedEndIndex
      );
      this.feedPendingSeekSamples('seek');
    } else {
      // Reset decoder
      this.recordDecoderReset('seek');
      this.decoder.reset();
      this.decoder.configure(this.codecConfig!);
      this.resetDecodeQueueTracking();

      this.sampleIndex = targetIndex;
      this.feedIndex = keyframeIndex;
      this.pendingSeekFeedEndIndex = feedEndIndex;
      this.clearFrameBuffer();
      this.feedPendingSeekSamples('seek');
    }

    // Don't flush here - the initial feed may only queue a subset of
    // the required samples (limited by ADVANCE_SEEK_QUEUE_TARGET).
    // Flushing now would block decoder.decode() for continuation feeds,
    // preventing the seek from ever reaching its target.  The flush is
    // triggered later by feedPendingSeekSamples once all samples are fed.

    webCodecsTelemetry.seekEnd(timeSeconds, framesDecoded, performance.now() - seekStart);
  }

  /**
   * Fast seek: decode only the nearest keyframe (1 frame instead of N).
   * Use during fast scrubbing for instant feedback - shows nearest I-frame.
   */
  fastSeek(timeSeconds: number): void {
    if (this.useSimpleMode && this.simpleSource.hasVideoElement()) {
      this.simpleSource.fastSeek(timeSeconds);
      return;
    }

    if (!this.videoTrack || this.samples.length === 0 || !this.decoder) return;

    const targetTime = timeSeconds * this.videoTrack.timescale;

    // Find nearest keyframe: check before AND after target for closest match
    const targetIdx = this.findSampleNearCts(targetTime);
    const kfBefore = this.findKeyframeBefore(targetIdx);
    let bestKeyframe = kfBefore;
    // Check if a keyframe after target is closer
    for (let i = targetIdx + 1; i < this.samples.length; i++) {
      if (this.samples[i].is_sync) {
        if (Math.abs(this.samples[i].cts - targetTime) < Math.abs(this.samples[kfBefore].cts - targetTime)) {
          bestKeyframe = i;
        }
        break;
      }
    }

    // fastSeek shows keyframe directly - no GOP traversal, so no seekTargetUs needed
    this.seekTargetUs = null;
    this.seekTargetToleranceUs = 0;
    this.pendingSeekPreviewMode = 'strict';
    this.invalidateStrictPausedSeekFlush();
    this.endPendingSeek('replaced');
    this.clearPendingSeekFeed();
    this.clearPausedPreroll();
    this.clearAdvanceSeekState('replaced');

    // Reset decoder and decode just the keyframe
    this.recordDecoderReset('fast_seek');
    this.decoder.reset();
    this.decoder.configure(this.codecConfig!);
    this.resetDecodeQueueTracking();

    const sample = this.samples[bestKeyframe];
    const chunk = new EncodedVideoChunk({
      type: 'key',
      timestamp: (sample.cts * 1_000_000) / sample.timescale,
      duration: (sample.duration * 1_000_000) / sample.timescale,
      data: sample.data,
    });

    try {
      this.decoder.decode(chunk);
      this.noteDecodeQueued();
    } catch {
      // Skip decode errors
    }

    this.sampleIndex = bestKeyframe;
    this.feedIndex = bestKeyframe + 1;
    this.clearFrameBuffer();
  }

  /**
   * Async seek that waits for the frame to be decoded
   * Use this for export where we need guaranteed frame accuracy
   */
  async seekAsync(timeSeconds: number): Promise<void> {
    // Simple mode: seek video element and wait for frame
    if (this.useSimpleMode && this.simpleSource.hasVideoElement()) {
      return this.simpleSource.seekAsync(timeSeconds);
    }

    // Full mode: decode and flush
    if (!this.videoTrack || this.samples.length === 0 || !this.decoder) {
      return;
    }

    this.seekTargetUs = null;
    this.seekTargetToleranceUs = 0;
    this.pendingSeekPreviewMode = 'strict';
    this.invalidateStrictPausedSeekFlush();
    this.clearPendingSeekFeed();
    this.clearAdvanceSeekState();

    const targetTime = timeSeconds * this.videoTrack.timescale;

    // Binary search for closest CTS match
    const targetIndex = this.findSampleNearCts(targetTime);
    const keyframeIndex = this.findKeyframeBefore(targetIndex);

    // Reset decoder
    this.decoder.reset();
    this.decoder.configure(this.codecConfig!);
    this.resetDecodeQueueTracking();

    // Decode from keyframe up to target frame
    for (let i = keyframeIndex; i <= targetIndex; i++) {
      const sample = this.samples[i];
      const chunk = new EncodedVideoChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp: (sample.cts * 1_000_000) / sample.timescale,
        duration: (sample.duration * 1_000_000) / sample.timescale,
        data: sample.data,
      });
      try {
        this.decoder.decode(chunk);
        this.noteDecodeQueued();
        void this.decoder.flush().catch(() => {});
      } catch {
        // Skip decode errors
      }
    }

    // Flush to ensure all frames are decoded
    await this.decoder.flush();

    this.sampleIndex = targetIndex;
    this.feedIndex = targetIndex + 1;
    this.clearFrameBuffer();
  }
}
