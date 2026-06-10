import { webCodecsTelemetry } from '../webcodecs/webCodecsTelemetry';
import { WEB_CODECS_PLAYER_LIMITS } from './playerConstants';
import { WebCodecsPlayerLoading } from './playerLoading';
import type { PendingSeekEndReason } from './playerTypes';

export abstract class WebCodecsPlayerSeekState extends WebCodecsPlayerLoading {
  /** Binary search for sample index whose CTS is closest to target */
  protected findSampleNearCts(targetCts: number): number {
    return this.sampleTimeline.findSampleNearCts(targetCts);
  }

  /** Find nearest keyframe at or before the given sample index (DTS order) */
  protected findKeyframeBefore(sampleIndex: number): number {
    return this.sampleTimeline.findKeyframeBefore(sampleIndex);
  }

  protected getCurrentFrameSampleIndex(): number | null {
    if (this.currentFrameTimestampUs === null || !this.videoTrack) {
      return null;
    }
    const currentCts = (this.currentFrameTimestampUs * this.videoTrack.timescale) / 1_000_000;
    return this.findSampleNearCts(currentCts);
  }

  protected getSampleTimestampUs(index: number): number | null {
    return this.sampleTimeline.getSampleTimestampUs(index);
  }

  protected beginPendingSeek(kind: 'seek' | 'advance', targetUs: number): void {
    if (!Number.isFinite(targetUs)) {
      return;
    }
    if (this.pendingSeekKind === kind && this.pendingSeekStartedAtMs !== null) {
      this.pendingSeekTargetDebugUs = targetUs;
      return;
    }
    this.endPendingSeek('replaced');
    this.pendingSeekStartedAtMs = performance.now();
    this.pendingSeekKind = kind;
    this.pendingSeekTargetDebugUs = targetUs;
    webCodecsTelemetry.pendingSeekStart(kind, targetUs);
  }

  protected endPendingSeek(reason: PendingSeekEndReason): void {
    if (this.pendingSeekStartedAtMs === null) {
      this.clearPendingSeekFallback();
      this.pendingSeekPreviewMode = 'strict';
      return;
    }
    webCodecsTelemetry.pendingSeekEnd(
      this.pendingSeekKind ?? 'unknown',
      performance.now() - this.pendingSeekStartedAtMs,
      this.pendingSeekTargetDebugUs ?? 0,
      reason
    );
    this.pendingSeekStartedAtMs = null;
    this.pendingSeekKind = null;
    this.pendingSeekTargetDebugUs = null;
    this.pendingSeekPreviewMode = 'strict';
    this.clearPendingSeekFallback();
  }

  protected setPendingAdvanceSeekTarget(targetIdx: number): void {
    this.pendingAdvanceSeekTargetIdx = targetIdx;
    const targetUs = this.getSampleTimestampUs(
      Math.min(targetIdx, this.samples.length - 1)
    );
    if (targetUs !== null) {
      this.beginPendingSeek('advance', targetUs);
    }
  }

  protected recordDecoderReset(reason: 'loop' | 'advance_seek' | 'seek' | 'fast_seek'): void {
    webCodecsTelemetry.decoderReset(reason);
  }

  protected clearAdvanceSeekState(reason: PendingSeekEndReason = 'cleared'): void {
    if (this.pendingAdvanceSeekTargetIdx !== null && this.pendingSeekKind === 'advance') {
      this.endPendingSeek(reason);
    }
    this.pendingAdvanceSeekTargetIdx = null;
  }

  protected clearPendingSeekFeed(): void {
    this.pendingSeekFeedEndIndex = null;
  }

  protected clearPausedPreroll(): void {
    this.pausedPrerollEndIndex = null;
  }

  protected resetDecodeQueueTracking(): void {
    this.trackedDecodeQueueSize = 0;
  }

  protected getEffectiveDecodeQueueSize(): number {
    return Math.max(this.decoder?.decodeQueueSize ?? 0, this.trackedDecodeQueueSize);
  }

  protected noteDecodeQueued(): number {
    const reportedQueueSize = this.decoder?.decodeQueueSize ?? 0;
    this.trackedDecodeQueueSize = Math.max(
      reportedQueueSize,
      this.trackedDecodeQueueSize + 1
    );
    return this.getEffectiveDecodeQueueSize();
  }

  protected noteDecodeDequeued(): number {
    const reportedQueueSize = this.decoder?.decodeQueueSize ?? 0;
    if (reportedQueueSize >= 0) {
      // Browser's VideoDecoder.decodeQueueSize is authoritative - trust it
      // to pull our tracked estimate back to reality and prevent inflation.
      this.trackedDecodeQueueSize = reportedQueueSize;
    } else {
      // Fallback: decrement tracked
      this.trackedDecodeQueueSize = Math.max(0, this.trackedDecodeQueueSize - 1);
    }
    return this.getEffectiveDecodeQueueSize();
  }

  protected getResumeQueueSize(targetUs: number): number {
    const reportedQueueSize = this.decoder?.decodeQueueSize ?? 0;
    const hasHotCurrentFrame =
      this.currentFrameTimestampUs !== null &&
      Math.abs(this.currentFrameTimestampUs - targetUs) <= (1_000_000 / Math.max(this.frameRate, 1)) * 1.5;
    const pendingTargetUs = this.getPendingSeekTime();
    const isFeedNearCurrentFrame =
      pendingTargetUs == null &&
      this.feedIndex >= this.sampleIndex &&
      this.feedIndex <= this.sampleIndex + WEB_CODECS_PLAYER_LIMITS.FEED_LOOKAHEAD;

    if (hasHotCurrentFrame && isFeedNearCurrentFrame) {
      if (this.trackedDecodeQueueSize > reportedQueueSize) {
        this.trackedDecodeQueueSize = reportedQueueSize;
      }
      return reportedQueueSize;
    }

    return this.getEffectiveDecodeQueueSize();
  }

  protected invalidateStrictPausedSeekFlush(): void {
    this.strictPausedSeekFlushToken++;
  }

  protected abstract clearPendingSeekFallback(exceptFrame?: VideoFrame | null): void;
}
