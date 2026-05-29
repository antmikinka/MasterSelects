import { useEffect, useRef, useState } from 'react';
import type { AudioEqAnalyzerView } from '../../../engine/audio/eq/AudioEqTypes';
import {
  runtimeAudioMeterBus,
  type RuntimeAudioMeterScope,
} from '../../../services/audio/runtimeAudioMeterBus';
import type { AudioMeterSnapshot } from '../../../types';

export type RuntimeAnalyzerScope = 'track' | 'master' | undefined;

type AnalyzerRef = { current: AudioEqAnalyzerView | undefined };

const DEFAULT_ANALYZER_FRAME_INTERVAL_MS = 1000 / 60;
const SPECTRUM_SUBSCRIPTION = { features: ['spectrum'] as const };

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function resolveBusScope(
  scope: RuntimeAnalyzerScope,
  trackId: string | undefined,
): RuntimeAudioMeterScope | undefined {
  if (scope === 'track' && trackId) return { kind: 'track', trackId };
  if (scope === 'master') return { kind: 'master' };
  return undefined;
}

function getScopeSpectrumDb(busScope: RuntimeAudioMeterScope): Float32Array | undefined {
  const snapshot = busScope.kind === 'master'
    ? runtimeAudioMeterBus.getMasterSnapshot()
    : runtimeAudioMeterBus.getTrackSnapshot(busScope.trackId);
  return snapshot?.spectrumDb;
}

function createAnalyzerView(spectrumDb: Float32Array | undefined): AudioEqAnalyzerView | undefined {
  return spectrumDb ? { postDb: spectrumDb } : undefined;
}

/**
 * Streams the live analyzer spectrum from the runtime audio meter bus into `analyzerRef`,
 * scheduling a canvas redraw without forcing a React render per published snapshot. Only
 * the "has analyzer" boolean is surfaced as React state.
 */
export function useRuntimeAnalyzerStream(
  scope: RuntimeAnalyzerScope,
  trackId: string | undefined,
  analyzerRef: AnalyzerRef,
  onAnalyzerFrame?: () => void,
  frameIntervalMs = DEFAULT_ANALYZER_FRAME_INTERVAL_MS,
): boolean {
  const onAnalyzerFrameRef = useRef(onAnalyzerFrame);
  const latestSpectrumRef = useRef<Float32Array | undefined>(undefined);
  const frameRef = useRef<number | null>(null);
  const lastCommittedAtRef = useRef(0);
  const [hasAnalyzer, setHasAnalyzer] = useState(false);
  const hasAnalyzerRef = useRef(false);

  useEffect(() => {
    onAnalyzerFrameRef.current = onAnalyzerFrame;
  }, [onAnalyzerFrame]);

  useEffect(() => {
    const busScope = resolveBusScope(scope, trackId);
    if (!busScope) {
      hasAnalyzerRef.current = false;
      const timeoutId = window.setTimeout(() => setHasAnalyzer(false), 0);
      return () => window.clearTimeout(timeoutId);
    }

    const commitSpectrum = (nextSpectrumDb: Float32Array | undefined) => {
      analyzerRef.current = createAnalyzerView(nextSpectrumDb);
      const nextHasAnalyzer = Boolean(nextSpectrumDb);
      if (hasAnalyzerRef.current !== nextHasAnalyzer) {
        hasAnalyzerRef.current = nextHasAnalyzer;
        setHasAnalyzer(nextHasAnalyzer);
      }
      onAnalyzerFrameRef.current?.();
    };

    latestSpectrumRef.current = getScopeSpectrumDb(busScope);
    commitSpectrum(latestSpectrumRef.current);
    lastCommittedAtRef.current = nowMs();

    const canUseRaf = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function';
    const cancelPendingFrame = () => {
      if (frameRef.current === null || !canUseRaf || typeof window.cancelAnimationFrame !== 'function') return;
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
    const flush = (timestamp: number) => {
      frameRef.current = null;
      if (timestamp - lastCommittedAtRef.current < frameIntervalMs) {
        frameRef.current = window.requestAnimationFrame(flush);
        return;
      }
      lastCommittedAtRef.current = timestamp;
      commitSpectrum(latestSpectrumRef.current);
    };
    const scheduleFlush = () => {
      if (!canUseRaf) {
        commitSpectrum(latestSpectrumRef.current);
        return;
      }
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(flush);
    };

    const onSnapshot = (snapshot: AudioMeterSnapshot | undefined) => {
      latestSpectrumRef.current = snapshot?.spectrumDb;
      scheduleFlush();
    };
    const unsubscribe = busScope.kind === 'master'
      ? runtimeAudioMeterBus.subscribeMaster(onSnapshot, SPECTRUM_SUBSCRIPTION)
      : runtimeAudioMeterBus.subscribeTrack(busScope.trackId, onSnapshot, SPECTRUM_SUBSCRIPTION);

    return () => {
      unsubscribe();
      cancelPendingFrame();
    };
  }, [analyzerRef, frameIntervalMs, scope, trackId]);

  return hasAnalyzer;
}
