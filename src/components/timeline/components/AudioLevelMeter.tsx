import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import type { AudioMeterSnapshot } from '../../../types';
import { AUDIO_METER_FLOOR_DB, audioMeterDbToUnit } from '../../../services/audio/audioMetering';
import type {
  RuntimeAudioMeterFeature,
  RuntimeAudioMeterScope,
} from '../../../services/audio/runtimeAudioMeterBus';
import {
  useRuntimeAudioMeterFrame,
  useRuntimeAudioMeterSnapshot,
} from '../../../services/audio/runtimeAudioMeterHooks';

interface AudioLevelMeterProps {
  /** Static snapshot mode: render a fixed snapshot. */
  meter?: AudioMeterSnapshot;
  /** Streaming mode: subscribe to the runtime meter bus and animate via refs/CSS. */
  streamScope?: RuntimeAudioMeterScope;
  streamFeatures?: readonly RuntimeAudioMeterFeature[];
  label: string;
  className?: string;
  orientation?: 'horizontal' | 'vertical';
  display?: 'mono' | 'stereo' | 'auto';
}

function formatDb(value: number): string {
  if (value <= AUDIO_METER_FLOOR_DB + 0.5) return '-inf dB';
  return `${value.toFixed(1)} dB`;
}

function formatUnit(value: number): string {
  return value.toFixed(2);
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function buildMeterTitle(label: string, meter: AudioMeterSnapshot | undefined, resolvedDisplay: 'mono' | 'stereo'): string {
  if (!meter) return `${label}: no live signal`;
  const phaseCorrelation = Number.isFinite(meter.phaseCorrelation) ? meter.phaseCorrelation : undefined;
  const stereoWidth = Number.isFinite(meter.stereoWidth) ? meter.stereoWidth : undefined;
  return `${label}: peak ${formatDb(meter.peakDb)}, rms ${formatDb(meter.rmsDb)}${
    resolvedDisplay === 'stereo' && meter.channels
      ? `, L ${formatDb(meter.channels.left.peakDb)}, R ${formatDb(meter.channels.right.peakDb)}`
      : ''
  }${
    phaseCorrelation !== undefined ? `, phase ${formatUnit(phaseCorrelation)}` : ''
  }${stereoWidth !== undefined ? `, width ${formatUnit(stereoWidth)}` : ''}`;
}

// ── Static (prop-driven) rendering ──────────────────────────────────────────

function StaticAudioLevelMeter({
  meter,
  label,
  className = '',
  orientation = 'horizontal',
  display = 'mono',
}: AudioLevelMeterProps) {
  const hasStereoChannels = Boolean(meter?.channels);
  const resolvedDisplay = display === 'auto'
    ? (hasStereoChannels ? 'stereo' : 'mono')
    : display;
  const peak = clampUnit(meter ? audioMeterDbToUnit(meter.peakDb) : 0);
  const rms = clampUnit(meter ? audioMeterDbToUnit(meter.rmsDb) : 0);
  const leftPeak = clampUnit(meter ? audioMeterDbToUnit(meter.channels?.left.peakDb ?? meter.peakDb) : 0);
  const leftRms = clampUnit(meter ? audioMeterDbToUnit(meter.channels?.left.rmsDb ?? meter.rmsDb) : 0);
  const rightPeak = clampUnit(meter ? audioMeterDbToUnit(meter.channels?.right.peakDb ?? meter.peakDb) : 0);
  const rightRms = clampUnit(meter ? audioMeterDbToUnit(meter.channels?.right.rmsDb ?? meter.rmsDb) : 0);
  const phaseCorrelation = meter && Number.isFinite(meter.phaseCorrelation) ? meter.phaseCorrelation : undefined;
  const phaseUnit = phaseCorrelation !== undefined ? clampUnit((phaseCorrelation + 1) / 2) : 0.5;
  const peakTransform = orientation === 'vertical' ? `scaleY(${peak})` : `scaleX(${peak})`;
  const rmsTransform = orientation === 'vertical' ? `scaleY(${rms})` : `scaleX(${rms})`;
  const peakFillStyle = {
    transform: peakTransform,
    opacity: meter && peak > 0 ? 0.68 : 0,
  } as CSSProperties;
  const rmsStyle = {
    transform: rmsTransform,
    opacity: meter && rms > 0 ? 0.9 : 0,
  } as CSSProperties;
  const peakStyle = orientation === 'vertical'
    ? {
        bottom: `${peak * 100}%`,
        transform: 'translateY(50%)',
        opacity: meter && peak > 0 ? 1 : 0,
      }
    : {
        left: `${peak * 100}%`,
        transform: 'translateX(-50%)',
        opacity: meter && peak > 0 ? 1 : 0,
      };
  const phaseStyle = orientation === 'vertical'
    ? {
        bottom: `${phaseUnit * 100}%`,
        transform: 'translateY(50%)',
        opacity: phaseCorrelation !== undefined ? 0.95 : 0,
      }
    : {
        left: `${phaseUnit * 100}%`,
        transform: 'translateX(-50%)',
        opacity: phaseCorrelation !== undefined ? 0.95 : 0,
      };
  const title = buildMeterTitle(label, meter, resolvedDisplay);
  const stereoBarStyle = (peakUnit: number, rmsUnit: number) => ({
    '--meter-peak-top': `${(1 - peakUnit) * 100}%`,
    '--meter-peak-right': `${(1 - peakUnit) * 100}%`,
    '--meter-rms-top': `${(1 - rmsUnit) * 100}%`,
    '--meter-peak-pos': `${peakUnit * 100}%`,
    '--meter-rms-pos': `${rmsUnit * 100}%`,
    '--meter-active': meter && peakUnit > 0 ? 1 : 0,
    '--meter-rms-active': meter && rmsUnit > 0 ? 1 : 0,
  }) as CSSProperties;

  if (resolvedDisplay === 'stereo') {
    return (
      <div
        className={`audio-level-meter stereo ${orientation} ${meter?.clipping ? 'clipping' : ''} ${className}`.trim()}
        role="meter"
        aria-label={label}
        aria-valuemin={AUDIO_METER_FLOOR_DB}
        aria-valuemax={0}
        aria-valuenow={meter?.peakDb ?? AUDIO_METER_FLOOR_DB}
        title={title}
      >
        <div className="audio-level-meter-stereo-channel left" style={stereoBarStyle(leftPeak, leftRms)}>
          <div className="audio-level-meter-scale" />
          <div className="audio-level-meter-peak-fill" />
          <div className="audio-level-meter-rms" />
          <div className="audio-level-meter-peak" />
        </div>
        <div className="audio-level-meter-stereo-channel right" style={stereoBarStyle(rightPeak, rightRms)}>
          <div className="audio-level-meter-scale" />
          <div className="audio-level-meter-peak-fill" />
          <div className="audio-level-meter-rms" />
          <div className="audio-level-meter-peak" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`audio-level-meter ${orientation} ${meter?.clipping ? 'clipping' : ''} ${className}`.trim()}
      role="meter"
      aria-label={label}
      aria-valuemin={AUDIO_METER_FLOOR_DB}
      aria-valuemax={0}
      aria-valuenow={meter?.peakDb ?? AUDIO_METER_FLOOR_DB}
      title={title}
    >
      <div className="audio-level-meter-scale" />
      <div className="audio-level-meter-peak-fill" style={peakFillStyle} />
      <div className="audio-level-meter-rms" style={rmsStyle} />
      <div className="audio-level-meter-phase" style={phaseStyle} />
      <div className="audio-level-meter-peak" style={peakStyle} />
    </div>
  );
}

// ── Streaming (bus-driven) rendering ────────────────────────────────────────

function applyMonoMeterStyles(
  peakFill: HTMLElement | null,
  rms: HTMLElement | null,
  peakMarker: HTMLElement | null,
  phase: HTMLElement | null,
  meter: AudioMeterSnapshot | undefined,
  orientation: 'horizontal' | 'vertical',
): void {
  const hasMeter = Boolean(meter);
  const peak = clampUnit(meter ? audioMeterDbToUnit(meter.peakDb) : 0);
  const rmsUnit = clampUnit(meter ? audioMeterDbToUnit(meter.rmsDb) : 0);
  const phaseCorrelation = meter && Number.isFinite(meter.phaseCorrelation) ? meter.phaseCorrelation : undefined;
  const phaseUnit = phaseCorrelation !== undefined ? clampUnit((phaseCorrelation + 1) / 2) : 0.5;
  const vertical = orientation === 'vertical';

  if (peakFill) {
    peakFill.style.transform = vertical ? `scaleY(${peak})` : `scaleX(${peak})`;
    peakFill.style.opacity = String(hasMeter && peak > 0 ? 0.68 : 0);
  }
  if (rms) {
    rms.style.transform = vertical ? `scaleY(${rmsUnit})` : `scaleX(${rmsUnit})`;
    rms.style.opacity = String(hasMeter && rmsUnit > 0 ? 0.9 : 0);
  }
  if (peakMarker) {
    if (vertical) {
      peakMarker.style.bottom = `${peak * 100}%`;
      peakMarker.style.transform = 'translateY(50%)';
    } else {
      peakMarker.style.left = `${peak * 100}%`;
      peakMarker.style.transform = 'translateX(-50%)';
    }
    peakMarker.style.opacity = String(hasMeter && peak > 0 ? 1 : 0);
  }
  if (phase) {
    if (vertical) {
      phase.style.bottom = `${phaseUnit * 100}%`;
      phase.style.transform = 'translateY(50%)';
    } else {
      phase.style.left = `${phaseUnit * 100}%`;
      phase.style.transform = 'translateX(-50%)';
    }
    phase.style.opacity = String(phaseCorrelation !== undefined ? 0.95 : 0);
  }
}

function applyStereoChannelVars(
  element: HTMLElement | null,
  peakUnit: number,
  rmsUnit: number,
  hasMeter: boolean,
): void {
  if (!element) return;
  element.style.setProperty('--meter-peak-top', `${(1 - peakUnit) * 100}%`);
  element.style.setProperty('--meter-peak-right', `${(1 - peakUnit) * 100}%`);
  element.style.setProperty('--meter-rms-top', `${(1 - rmsUnit) * 100}%`);
  element.style.setProperty('--meter-peak-pos', `${peakUnit * 100}%`);
  element.style.setProperty('--meter-rms-pos', `${rmsUnit * 100}%`);
  element.style.setProperty('--meter-active', String(hasMeter && peakUnit > 0 ? 1 : 0));
  element.style.setProperty('--meter-rms-active', String(hasMeter && rmsUnit > 0 ? 1 : 0));
}

const SLOW_META_FPS = 4;

function StreamingAudioLevelMeter({
  streamScope,
  streamFeatures,
  label,
  className = '',
  orientation = 'horizontal',
  display = 'mono',
}: AudioLevelMeterProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const peakFillRef = useRef<HTMLDivElement | null>(null);
  const rmsRef = useRef<HTMLDivElement | null>(null);
  const peakRef = useRef<HTMLDivElement | null>(null);
  const phaseRef = useRef<HTMLDivElement | null>(null);
  const leftChannelRef = useRef<HTMLDivElement | null>(null);
  const rightChannelRef = useRef<HTMLDivElement | null>(null);

  // Resolved display + accessibility/title text update on a slow human-visible cadence
  // so the structure stays stable while the bars animate through refs.
  const slowFeatures = streamFeatures ?? (display === 'stereo' ? (['level', 'stereo', 'phase'] as const) : (['level', 'phase'] as const));
  const slowMeter = useRuntimeAudioMeterSnapshot(streamScope, { features: slowFeatures, maxFps: SLOW_META_FPS });
  const resolvedDisplay = display === 'auto'
    ? (slowMeter?.channels ? 'stereo' : 'mono')
    : display;

  const applyStyles = useCallback((meter: AudioMeterSnapshot | undefined) => {
    const root = rootRef.current;
    if (root) root.classList.toggle('clipping', Boolean(meter?.clipping));

    if (resolvedDisplay === 'stereo') {
      const hasMeter = Boolean(meter);
      const leftPeak = clampUnit(meter ? audioMeterDbToUnit(meter.channels?.left.peakDb ?? meter.peakDb) : 0);
      const leftRms = clampUnit(meter ? audioMeterDbToUnit(meter.channels?.left.rmsDb ?? meter.rmsDb) : 0);
      const rightPeak = clampUnit(meter ? audioMeterDbToUnit(meter.channels?.right.peakDb ?? meter.peakDb) : 0);
      const rightRms = clampUnit(meter ? audioMeterDbToUnit(meter.channels?.right.rmsDb ?? meter.rmsDb) : 0);
      applyStereoChannelVars(leftChannelRef.current, leftPeak, leftRms, hasMeter);
      applyStereoChannelVars(rightChannelRef.current, rightPeak, rightRms, hasMeter);
      return;
    }

    applyMonoMeterStyles(peakFillRef.current, rmsRef.current, peakRef.current, phaseRef.current, meter, orientation);
  }, [orientation, resolvedDisplay]);

  useRuntimeAudioMeterFrame(streamScope, applyStyles, { features: slowFeatures });

  // Re-apply the latest snapshot when the rendered structure changes (mono<->stereo,
  // orientation) so the freshly mounted elements are styled before the next publish.
  useEffect(() => {
    applyStyles(slowMeter);
  }, [applyStyles, slowMeter]);

  const title = buildMeterTitle(label, slowMeter, resolvedDisplay);
  const ariaValueNow = slowMeter?.peakDb ?? AUDIO_METER_FLOOR_DB;

  if (resolvedDisplay === 'stereo') {
    return (
      <div
        ref={rootRef}
        className={`audio-level-meter stereo ${orientation} ${className}`.trim()}
        role="meter"
        aria-label={label}
        aria-valuemin={AUDIO_METER_FLOOR_DB}
        aria-valuemax={0}
        aria-valuenow={ariaValueNow}
        title={title}
      >
        <div ref={leftChannelRef} className="audio-level-meter-stereo-channel left">
          <div className="audio-level-meter-scale" />
          <div className="audio-level-meter-peak-fill" />
          <div className="audio-level-meter-rms" />
          <div className="audio-level-meter-peak" />
        </div>
        <div ref={rightChannelRef} className="audio-level-meter-stereo-channel right">
          <div className="audio-level-meter-scale" />
          <div className="audio-level-meter-peak-fill" />
          <div className="audio-level-meter-rms" />
          <div className="audio-level-meter-peak" />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`audio-level-meter ${orientation} ${className}`.trim()}
      role="meter"
      aria-label={label}
      aria-valuemin={AUDIO_METER_FLOOR_DB}
      aria-valuemax={0}
      aria-valuenow={ariaValueNow}
      title={title}
    >
      <div className="audio-level-meter-scale" />
      <div ref={peakFillRef} className="audio-level-meter-peak-fill" style={{ opacity: 0 }} />
      <div ref={rmsRef} className="audio-level-meter-rms" style={{ opacity: 0 }} />
      <div ref={phaseRef} className="audio-level-meter-phase" style={{ opacity: 0 }} />
      <div ref={peakRef} className="audio-level-meter-peak" style={{ opacity: 0 }} />
    </div>
  );
}

export function AudioLevelMeter(props: AudioLevelMeterProps) {
  if (props.streamScope) {
    return <StreamingAudioLevelMeter {...props} />;
  }
  return <StaticAudioLevelMeter {...props} />;
}
