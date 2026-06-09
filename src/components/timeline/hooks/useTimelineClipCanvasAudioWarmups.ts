import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { TimelineSpectrogramTileSet } from '../../../services/audio/timelineSpectrogramCache';
import {
  collectTimelineAudioAnalysisArtifactRefs,
  warmTimelineAudioAnalysisArtifacts,
} from '../../../services/timeline/timelineAudioAnalysisArtifactWarmup';
import {
  scheduleTimelineProcessedWaveformDerivation,
  scheduleTimelineSpectrogramTileGeneration,
} from '../../../services/timeline/timelineAudioArtifactGenerationWarmup';
import {
  collectTimelineSpectrogramArtifactRefs,
  warmTimelineSpectrogramArtifacts,
} from '../../../services/timeline/timelineSpectrogramArtifactWarmup';
import {
  collectVisibleTimelineSourceWaveformGenerationRequests,
  scheduleVisibleTimelineSourceWaveformGeneration,
} from '../../../services/timeline/timelineSourceWaveformWarmup';
import {
  collectTimelineWaveformArtifactRefs,
  warmTimelineWaveformArtifacts,
} from '../../../services/timeline/timelineWaveformArtifactWarmup';
import type { TimelineAudioDisplayMode } from '../../../stores/timeline/types';
import type { TimelinePaintSourceClip } from '../../../timeline';
import { isTimelineClipCanvasAudioClip } from '../utils/timelineClipCanvasAudio';
import type { TimelineClipCanvasSpectrogramTileSetMap } from '../utils/timelineClipCanvasSpectrogramResource';
import type { TimelineClipCanvasWaveformPyramidMap } from '../utils/timelineClipCanvasWaveformResource';
import type { TimelineWaveformPyramid } from '../utils/waveformLod';

const WAVEFORM_PYRAMID_AUTO_UPGRADE_ZOOM = 250;
const WAVEFORM_PYRAMID_AUTO_UPGRADE_WIDTH = 16_384;
const WAVEFORM_GENERATION_DELAY_MS = 300;
const SPECTROGRAM_ARTIFACT_RETRY_MS = 2000;

export interface TimelineClipCanvasAudioWarmupsInput {
  clips: readonly TimelinePaintSourceClip[];
  scrollX: number;
  viewportWidth: number;
  cssWidth: number;
  timeToPixel: (time: number) => number;
  waveformsEnabled?: boolean;
  audioDisplayMode?: TimelineAudioDisplayMode;
  isInteractionPreviewActive: boolean;
  renderOverscanPx: number;
  visibleAudioArtifactClipIds: readonly string[];
  requestRedraw: () => void;
}

export interface TimelineClipCanvasAudioWarmups {
  waveformPyramids: TimelineClipCanvasWaveformPyramidMap;
  spectrogramTileSets: TimelineClipCanvasSpectrogramTileSetMap;
}

export function useTimelineClipCanvasAudioWarmups(
  input: TimelineClipCanvasAudioWarmupsInput,
): TimelineClipCanvasAudioWarmups {
  const {
    clips,
    scrollX,
    viewportWidth,
    cssWidth,
    timeToPixel,
    waveformsEnabled,
    audioDisplayMode,
    isInteractionPreviewActive,
    renderOverscanPx,
    visibleAudioArtifactClipIds,
    requestRedraw,
  } = input;
  const [spectrogramRetryNonce, bumpSpectrogramRetry] = useReducer((n: number) => n + 1, 0);
  const [waveformPyramids, setWaveformPyramids] = useState<Map<string, TimelineWaveformPyramid | null>>(() => new Map());
  const [spectrogramTileSets, setSpectrogramTileSets] = useState<Map<string, TimelineSpectrogramTileSet | null>>(() => new Map());
  const waveformPyramidsRef = useRef<TimelineClipCanvasWaveformPyramidMap>(waveformPyramids);
  const spectrogramTileSetsRef = useRef<TimelineClipCanvasSpectrogramTileSetMap>(spectrogramTileSets);
  const spectrogramMissedAtRef = useRef<Map<string, number>>(new Map());

  const visibleWaveformClips = useMemo(() => {
    if (!waveformsEnabled) return [] as readonly TimelinePaintSourceClip[];
    const visibleLeft = scrollX - renderOverscanPx;
    const visibleRight = scrollX + viewportWidth + renderOverscanPx;
    return clips.filter((clip) => {
      if (!isTimelineClipCanvasAudioClip(clip)) return false;
      const x = timeToPixel(clip.startTime);
      const w = timeToPixel(clip.duration);
      return x + w >= visibleLeft && x <= visibleRight;
    });
  }, [clips, renderOverscanPx, scrollX, timeToPixel, viewportWidth, waveformsEnabled]);

  const visibleWaveformArtifactRefs = useMemo(
    () => audioDisplayMode === 'spectral' ? [] : collectTimelineWaveformArtifactRefs(visibleWaveformClips),
    [audioDisplayMode, visibleWaveformClips],
  );
  const visibleSpectrogramArtifactRefs = useMemo(
    () => audioDisplayMode === 'spectral' ? collectTimelineSpectrogramArtifactRefs(visibleWaveformClips) : [],
    [audioDisplayMode, visibleWaveformClips],
  );
  const visibleSourceWaveformGenerationRequests = useMemo(() => {
    if (!waveformsEnabled || isInteractionPreviewActive) return [];
    if (audioDisplayMode !== 'detailed') {
      const shouldUpgradeCompact =
        audioDisplayMode === 'compact' &&
        (timeToPixel(1) >= WAVEFORM_PYRAMID_AUTO_UPGRADE_ZOOM || cssWidth > WAVEFORM_PYRAMID_AUTO_UPGRADE_WIDTH);
      if (!shouldUpgradeCompact) return [];
    }

    return collectVisibleTimelineSourceWaveformGenerationRequests({
      clips: visibleWaveformClips,
      scrollX,
      viewportWidth,
      overscanPx: renderOverscanPx,
      timeToPixel,
      mode: audioDisplayMode,
    });
  }, [
    audioDisplayMode,
    cssWidth,
    isInteractionPreviewActive,
    renderOverscanPx,
    scrollX,
    timeToPixel,
    viewportWidth,
    visibleWaveformClips,
    waveformsEnabled,
  ]);
  const visibleSourceWaveformGenerationKey = useMemo(
    () => visibleSourceWaveformGenerationRequests.map((request) => request.requestKey).join('|'),
    [visibleSourceWaveformGenerationRequests],
  );
  const waveformRefKey = useMemo(
    () => visibleWaveformArtifactRefs.join('|'),
    [visibleWaveformArtifactRefs],
  );
  const spectrogramRefKey = useMemo(
    () => visibleSpectrogramArtifactRefs.join('|'),
    [visibleSpectrogramArtifactRefs],
  );
  const visibleAudioArtifactClipIdKey = visibleAudioArtifactClipIds.join('|');
  const visibleAudioAnalysisArtifactRefs = useMemo(() => {
    if (!waveformsEnabled || visibleAudioArtifactClipIds.length === 0) return [];
    const visibleClipIds = new Set(visibleAudioArtifactClipIds);
    return collectTimelineAudioAnalysisArtifactRefs(
      clips.filter((clip) => visibleClipIds.has(clip.id)),
    );
  }, [clips, visibleAudioArtifactClipIds, waveformsEnabled]);
  const audioAnalysisArtifactRefKey = useMemo(
    () => visibleAudioAnalysisArtifactRefs.map((ref) => `${ref.kind}:${ref.refId}`).join('|'),
    [visibleAudioAnalysisArtifactRefs],
  );

  useEffect(() => {
    waveformPyramidsRef.current = waveformPyramids;
  }, [waveformPyramids]);
  useEffect(() => {
    spectrogramTileSetsRef.current = spectrogramTileSets;
  }, [spectrogramTileSets]);

  useEffect(() => {
    if (!waveformsEnabled || !waveformRefKey) return;
    const controller = new AbortController();
    const refs = waveformRefKey
      .split('|')
      .filter((refId) => refId && !waveformPyramidsRef.current.has(refId));
    if (refs.length === 0) return;

    const publish = (refId: string, pyramid: TimelineWaveformPyramid | null) => {
      if (controller.signal.aborted) return;
      setWaveformPyramids((prev) => {
        if (prev.has(refId) && prev.get(refId) === pyramid) return prev;
        const next = new Map(prev);
        next.set(refId, pyramid);
        return next;
      });
      requestRedraw();
    };

    void warmTimelineWaveformArtifacts(
      refs,
      {
        signal: controller.signal,
        onResult: ({ refId, pyramid }) => publish(refId, pyramid),
      },
    );

    return () => {
      controller.abort();
    };
  }, [requestRedraw, waveformRefKey, waveformsEnabled]);

  useEffect(() => {
    if (!waveformsEnabled || audioDisplayMode !== 'spectral' || !spectrogramRefKey) return;
    const controller = new AbortController();
    const now = Date.now();
    const refs = spectrogramRefKey
      .split('|')
      .filter((refId) => {
        if (!refId || spectrogramTileSetsRef.current.get(refId)) return false;
        const missedAt = spectrogramMissedAtRef.current.get(refId);
        return missedAt === undefined || now - missedAt >= SPECTROGRAM_ARTIFACT_RETRY_MS;
      });
    if (refs.length === 0) return;
    let retryTimer: number | null = null;

    const publish = (refId: string, tileSet: TimelineSpectrogramTileSet | null) => {
      if (controller.signal.aborted) return;
      if (!tileSet) {
        spectrogramMissedAtRef.current.set(refId, Date.now());
        if (retryTimer === null && typeof window !== 'undefined') {
          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            bumpSpectrogramRetry();
          }, SPECTROGRAM_ARTIFACT_RETRY_MS);
        }
        return;
      }
      spectrogramMissedAtRef.current.delete(refId);
      setSpectrogramTileSets((prev) => {
        if (prev.has(refId) && prev.get(refId) === tileSet) return prev;
        const next = new Map(prev);
        next.set(refId, tileSet);
        return next;
      });
      requestRedraw();
    };

    void warmTimelineSpectrogramArtifacts(
      refs,
      {
        signal: controller.signal,
        onResult: ({ refId, tileSet }) => publish(refId, tileSet),
      },
    );

    return () => {
      controller.abort();
      if (retryTimer !== null && typeof window !== 'undefined') {
        window.clearTimeout(retryTimer);
      }
    };
  }, [audioDisplayMode, requestRedraw, spectrogramRefKey, spectrogramRetryNonce, waveformsEnabled]);

  useEffect(() => {
    if (!waveformsEnabled || !audioAnalysisArtifactRefKey) return;
    const controller = new AbortController();

    void warmTimelineAudioAnalysisArtifacts(
      visibleAudioAnalysisArtifactRefs,
      { signal: controller.signal },
    );

    return () => {
      controller.abort();
    };
  }, [audioAnalysisArtifactRefKey, visibleAudioAnalysisArtifactRefs, waveformsEnabled]);

  useEffect(() => {
    if (!waveformsEnabled || !visibleSourceWaveformGenerationKey) return;
    return scheduleVisibleTimelineSourceWaveformGeneration(
      visibleSourceWaveformGenerationRequests,
      { delayMs: WAVEFORM_GENERATION_DELAY_MS },
    );
  }, [visibleSourceWaveformGenerationKey, visibleSourceWaveformGenerationRequests, waveformsEnabled]);

  useEffect(() => {
    if (!waveformsEnabled || !visibleAudioArtifactClipIdKey) return;
    const cleanups = visibleAudioArtifactClipIds.map((clipId) => (
      audioDisplayMode === 'spectral'
        ? scheduleTimelineSpectrogramTileGeneration({
          clipId,
          requestKey: `timeline-canvas:spectrogram:${clipId}`,
        })
        : scheduleTimelineProcessedWaveformDerivation({
          clipId,
          requestKey: `timeline-canvas:processed-waveform:${clipId}`,
        })
    ));
    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [audioDisplayMode, visibleAudioArtifactClipIdKey, visibleAudioArtifactClipIds, waveformsEnabled]);

  return {
    waveformPyramids,
    spectrogramTileSets,
  };
}
