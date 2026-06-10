import { webCodecsTelemetry } from '../webcodecs/webCodecsTelemetry';
import { WEB_CODECS_PLAYER_LIMITS } from './playerConstants';
import { WebCodecsPlayerSeekState } from './playerSeekState';

export abstract class WebCodecsPlayerFrameOutput extends WebCodecsPlayerSeekState {
  protected abstract feedPendingSeekSamples(mode?: 'seek' | 'advance_seek'): void;
  protected abstract feedPausedPrerollSamples(): void;
  protected abstract holdCurrentFrameDuringPause(): void;
  protected abstract startPausedPreroll(): void;

  protected setDisplayedFrame(frame: VideoFrame): void {
    if (this.currentFrame && this.currentFrame !== frame) {
      this.currentFrame.close();
    }
    this.currentFrame = frame;
    this.currentFrameTimestampUs = frame.timestamp;
  }

  protected shouldPublishInteractiveSeekPreview(frameTimestampUs: number): boolean {
    if (this.seekTargetUs === null) {
      return false;
    }

    if (this.currentFrameTimestampUs === null) {
      return true;
    }

    const currentDiff = Math.abs(this.currentFrameTimestampUs - this.seekTargetUs);
    const nextDiff = Math.abs(frameTimestampUs - this.seekTargetUs);
    if (nextDiff >= currentDiff) {
      return false;
    }

    const frameDurationUs = 1_000_000 / Math.max(this.frameRate, 1);
    const nearTargetWindowUs = Math.max(
      this.seekTargetToleranceUs * 3,
      frameDurationUs * WEB_CODECS_PLAYER_LIMITS.INTERACTIVE_PREVIEW_NEAR_TARGET_FRAMES
    );
    if (nextDiff <= nearTargetWindowUs) {
      return true;
    }

    const improvementUs = currentDiff - nextDiff;
    const hasWaitedLongEnough =
      performance.now() - this.lastInteractivePreviewPublishAtMs >=
      WEB_CODECS_PLAYER_LIMITS.INTERACTIVE_PREVIEW_FAR_FRAME_PUBLISH_MS;

    return hasWaitedLongEnough && improvementUs >= frameDurationUs;
  }

  isPlaybackStartupWarmupActive(): boolean {
    return (
      this.playbackStartupWarmupStartedAtMs !== null &&
      performance.now() - this.playbackStartupWarmupStartedAtMs <=
        WEB_CODECS_PLAYER_LIMITS.PLAYBACK_STARTUP_WARMUP_MAX_MS
    );
  }

  protected shouldPublishPlaybackStartupFrame(
    frameTimestampUs: number,
    targetUs: number
  ): boolean {
    if (!this.isPlaybackStartupWarmupActive()) {
      return false;
    }

    const frameDurationUs = 1_000_000 / Math.max(this.frameRate, 1);
    const maxWarmupDriftUs =
      frameDurationUs * WEB_CODECS_PLAYER_LIMITS.PLAYBACK_STARTUP_WARMUP_MAX_FRAMES;
    const nextDiff = Math.abs(frameTimestampUs - targetUs);
    if (nextDiff > maxWarmupDriftUs) {
      return false;
    }

    if (this.currentFrameTimestampUs === null) {
      return true;
    }

    if (frameTimestampUs <= this.currentFrameTimestampUs) {
      return false;
    }

    const currentDiff = Math.abs(this.currentFrameTimestampUs - targetUs);
    return nextDiff + frameDurationUs < currentDiff;
  }

  protected isFrameUsableForPlaybackStartup(
    frameTimestampUs: number | null,
    targetUs: number
  ): boolean {
    if (frameTimestampUs === null) {
      return false;
    }

    const frameDurationUs = 1_000_000 / Math.max(this.frameRate, 1);
    return (
      Math.abs(frameTimestampUs - targetUs) <=
      frameDurationUs * WEB_CODECS_PLAYER_LIMITS.PLAYBACK_STARTUP_WARMUP_MAX_FRAMES
    );
  }

  protected promotePendingSeekFallbackForPlaybackStartup(targetUs: number): boolean {
    const fallbackFrame = this.pendingSeekFallbackFrame;
    if (!fallbackFrame) {
      return false;
    }

    const fallbackDiffUs = Math.abs(fallbackFrame.timestamp - targetUs);
    if (!this.isFrameUsableForPlaybackStartup(fallbackFrame.timestamp, targetUs)) {
      return false;
    }

    const currentDiffUs =
      this.currentFrameTimestampUs !== null
        ? Math.abs(this.currentFrameTimestampUs - targetUs)
        : Number.POSITIVE_INFINITY;
    if (fallbackDiffUs >= currentDiffUs) {
      return false;
    }

    this.setDisplayedFrame(fallbackFrame);
    this.clearPendingSeekFallback(fallbackFrame);
    webCodecsTelemetry.seekPublish(
      targetUs,
      fallbackFrame.timestamp,
      fallbackDiffUs,
      'playback_start_fallback'
    );
    this.onFrame?.(fallbackFrame);
    return true;
  }

  protected isDisplayedFrameNearTarget(
    targetUs: number,
    maxFrameDelta = 6
  ): boolean {
    if (this.currentFrameTimestampUs === null) {
      return false;
    }

    const frameDurationUs = 1_000_000 / Math.max(this.frameRate, 1);
    return Math.abs(this.currentFrameTimestampUs - targetUs) <= frameDurationUs * maxFrameDelta;
  }

  protected clearDisplayedFrame(): void {
    if (this.currentFrame) {
      this.currentFrame.close();
    }
    this.currentFrame = null;
    this.currentFrameTimestampUs = null;
  }

  protected clearPendingSeekFallback(exceptFrame: VideoFrame | null = null): void {
    if (
      this.pendingSeekFallbackFrame &&
      this.pendingSeekFallbackFrame !== exceptFrame &&
      this.pendingSeekFallbackFrame !== this.currentFrame
    ) {
      this.pendingSeekFallbackFrame.close();
    }
    this.pendingSeekFallbackFrame = null;
    this.pendingSeekFallbackDiffUs = Number.POSITIVE_INFINITY;
  }

  protected rememberPendingSeekFallback(frame: VideoFrame, diffUs: number): boolean {
    if (this.pendingSeekPreviewMode !== 'strict') {
      return false;
    }

    if (diffUs >= this.pendingSeekFallbackDiffUs) {
      return false;
    }

    this.clearPendingSeekFallback(frame);
    this.pendingSeekFallbackFrame = frame;
    this.pendingSeekFallbackDiffUs = diffUs;
    return true;
  }

  protected publishStrictSeekFallbackAfterFlush(): boolean {
    if (
      this.pendingSeekPreviewMode !== 'strict' ||
      this.seekTargetUs === null ||
      this.pendingSeekFallbackFrame === null
    ) {
      return false;
    }

    const frame = this.pendingSeekFallbackFrame;
    const diffUs = Math.abs(frame.timestamp - this.seekTargetUs);
    const frameDurationUs = 1_000_000 / Math.max(this.frameRate, 1);
    const fallbackToleranceUs = Math.max(this.seekTargetToleranceUs * 2, frameDurationUs * 3);

    if (diffUs > fallbackToleranceUs && this.currentFrame !== null) {
      return false;
    }

    this.setDisplayedFrame(frame);
    this.clearPendingSeekFallback(frame);
    webCodecsTelemetry.seekPublish(
      this.seekTargetUs,
      frame.timestamp,
      diffUs,
      'strict_flush_fallback'
    );

    this.seekTargetUs = null;
    this.seekTargetToleranceUs = 0;
    this.clearPendingSeekFeed();
    this.endPendingSeek('fallback');

    if (!this._isPlaying) {
      this.holdCurrentFrameDuringPause();
      this.startPausedPreroll();
    }

    this.onFrame?.(frame);
    return true;
  }

  protected handleDecodedFrame(frame: VideoFrame): void {
    const queueSize = this.noteDecodeDequeued();
    webCodecsTelemetry.decodeOutput(frame.timestamp, queueSize);

    if (this.exportMode.isInExportMode) {
      this.exportMode.handleDecoderOutput(frame);
    } else if (this._isPlaying) {
      this.frameBuffer.push(frame);
      while (this.frameBuffer.length > WEB_CODECS_PLAYER_LIMITS.MAX_FRAME_BUFFER) {
        const oldest = this.frameBuffer[0];
        if (oldest === this.currentFrame) break;
        this.frameBuffer.shift()!.close();
      }
    } else if (this.seekTargetUs !== null && this.pendingSeekKind !== null) {
      const diff = Math.abs(frame.timestamp - this.seekTargetUs);
      const publishPreview =
        this.pendingSeekPreviewMode === 'interactive' &&
        this.shouldPublishInteractiveSeekPreview(frame.timestamp);

      if (diff <= this.seekTargetToleranceUs || publishPreview) {
        this.setDisplayedFrame(frame);
        this.clearPendingSeekFallback(frame);
        this.lastInteractivePreviewPublishAtMs = performance.now();
        webCodecsTelemetry.seekPublish(
          this.seekTargetUs,
          frame.timestamp,
          diff,
          publishPreview ? 'interactive_preview' : 'resolved'
        );

        if (diff <= this.seekTargetToleranceUs) {
          this.seekTargetUs = null;
          this.seekTargetToleranceUs = 0;
          this.clearPendingSeekFeed();
          this.endPendingSeek('resolved');

          // After a paused seek resolves, protect the just-seeked frame from
          // being overwritten by post-seek lookahead frames still in the
          // decoder queue.  holdCurrentFrameDuringPause + startPausedPreroll
          // route those late arrivals into the preroll buffer instead.
          // This is critical for cold-start after page reload where no
          // pause() has been called on the player yet.
          if (!this._isPlaying) {
            this.holdCurrentFrameDuringPause();
            this.startPausedPreroll();
          }
        }

        this.onFrame?.(frame);
      } else {
        if (!this.rememberPendingSeekFallback(frame, diff)) {
          webCodecsTelemetry.frameDropSeekIntermediate(frame.timestamp, this.seekTargetUs);
          frame.close();
        }
        // Don't return early - fall through so feedPendingSeekSamples
        // continues feeding the decoder towards the seek target.
      }
    } else if (this.pausedPrerollEndIndex !== null) {
      if (
        this.currentFrameTimestampUs !== null &&
        frame.timestamp <= this.currentFrameTimestampUs
      ) {
        frame.close();
      } else {
        this.frameBuffer.push(frame);
        while (this.frameBuffer.length > WEB_CODECS_PLAYER_LIMITS.MAX_FRAME_BUFFER) {
          this.frameBuffer.shift()!.close();
        }
      }
    } else {
      this.setDisplayedFrame(frame);
      this.onFrame?.(frame);
    }

    if (!this.exportMode.isInExportMode && !this._isPlaying && this.pendingSeekFeedEndIndex !== null) {
      this.feedPendingSeekSamples('seek');
    }
    if (!this.exportMode.isInExportMode && !this._isPlaying && this.pausedPrerollEndIndex !== null) {
      this.feedPausedPrerollSamples();
    }
    if (this.frameResolve) {
      this.frameResolve();
      this.frameResolve = null;
    }
  }

  /** Close all buffered frames */
  protected clearFrameBuffer(): void {
    for (const f of this.frameBuffer) {
      f.close();
    }
    this.frameBuffer.length = 0;
  }

  protected decodeFirstFrame(): void {
    if (!this.decoder || this.samples.length === 0) return;

    // Decode the first keyframe to have an initial frame available
    const firstSample = this.samples[0];
    if (!firstSample.is_sync) return; // First frame should be a keyframe

    const chunk = new EncodedVideoChunk({
      type: 'key',
      timestamp: (firstSample.cts * 1_000_000) / firstSample.timescale,
      duration: (firstSample.duration * 1_000_000) / firstSample.timescale,
      data: firstSample.data,
    });

    try {
      this.decoder.decode(chunk);
      this.noteDecodeQueued();
      this.sampleIndex = 0;
      this.feedIndex = 1;
      this.clearAdvanceSeekState();
    } catch {
      // Ignore decode errors on first frame
    }
  }

  // Check if there's a valid frame available
  hasFrame(): boolean {
    return this.currentFrame !== null;
  }

  hasBufferedFutureFrame(minFrameDelta = 0.5): boolean {
    if (this.currentFrameTimestampUs === null || this.frameBuffer.length === 0) {
      return false;
    }

    const frameDurationUs = 1_000_000 / Math.max(this.frameRate, 1);
    const minFutureTimestampUs = this.currentFrameTimestampUs + frameDurationUs * minFrameDelta;
    return this.frameBuffer.some((frame) => frame.timestamp >= minFutureTimestampUs);
  }

  /** Debug info for stats overlay (null in simple mode) */
  getDebugInfo(): { codec: string; hwAccel: string; decodeQueueSize: number; samplesLoaded: number; sampleIndex: number } | null {
    if (this.useSimpleMode || !this.codecConfig) return null;
    return {
      codec: this.codecConfig.codec,
      hwAccel: (this.codecConfig.hardwareAcceleration as string) || 'no-preference',
      decodeQueueSize: this.getEffectiveDecodeQueueSize(),
      samplesLoaded: this.samples.length,
      sampleIndex: this.sampleIndex,
    };
  }
}
