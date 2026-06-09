import type { TimelineClip } from '../../types';
import { calculateAudioMeterSnapshot } from '../audio/audioMetering';
import { useTimelineStore } from '../../stores/timeline';
import { vfPipelineMonitor } from '../vfPipelineMonitor';
import { clearMasterAudio, playheadState, setMasterAudioClock } from './PlayheadState';
import {
  STEM_MIXER_METER_INTERVAL_MS,
  type StemBufferMixerLayer,
  type StemBufferMixerSession,
  type StemBufferMixerSyncOptions,
} from './audioTrackStemSyncModel';

type CreateStemBufferMixerSessionParams = {
  clipId: string;
  context: AudioContext;
  key: string;
  layers: StemBufferMixerLayer[];
  buffers: Map<string, AudioBuffer>;
  startAt: number;
  startOffset: number;
  masterVolume: number;
  meterTrackId: string;
};

function clampGain(value: number): number {
  return Math.max(0, Math.min(4, value));
}

function disconnectAudioNode(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {
    // Ignore cleanup errors.
  }
}

export function stopStemBufferMixerSession(session: StemBufferMixerSession): void {
  if (playheadState.masterAudioClock === session.getSourceTime) clearMasterAudio();
  for (const source of session.sources) {
    try {
      source.stop();
    } catch {
      // Source nodes may already have ended.
    }
    disconnectAudioNode(source);
  }
  for (const gain of session.gains.values()) disconnectAudioNode(gain);
  disconnectAudioNode(session.masterGain);
  disconnectAudioNode(session.analyser);
  disconnectAudioNode(session.stereoSplitter);
  disconnectAudioNode(session.leftAnalyser);
  disconnectAudioNode(session.rightAnalyser);
}

export function createStemBufferMixerSession(
  params: CreateStemBufferMixerSessionParams,
): StemBufferMixerSession | null {
  const { clipId, context, key, layers, buffers, startAt, startOffset, masterVolume, meterTrackId } = params;
  const masterGain = context.createGain();
  const analyser = context.createAnalyser();
  const stereoSplitter = context.createChannelSplitter(2);
  const leftAnalyser = context.createAnalyser();
  const rightAnalyser = context.createAnalyser();
  analyser.fftSize = 1024;
  leftAnalyser.fftSize = analyser.fftSize;
  rightAnalyser.fftSize = analyser.fftSize;
  masterGain.gain.value = clampGain(masterVolume);
  masterGain.connect(analyser);
  masterGain.connect(stereoSplitter);
  stereoSplitter.connect(leftAnalyser, 0);
  stereoSplitter.connect(rightAnalyser, 1);
  analyser.connect(context.destination);

  const gains = new Map<string, GainNode>();
  const sources: AudioBufferSourceNode[] = [];
  for (const layer of layers) {
    const buffer = buffers.get(layer.id);
    if (!buffer) continue;
    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = clampGain(layer.gain);
    source.buffer = buffer;
    source.playbackRate.value = 1;
    source.connect(gain);
    gain.connect(masterGain);
    source.start(startAt, Math.min(startOffset, Math.max(0, buffer.duration - 0.02)));
    gains.set(layer.id, gain);
    sources.push(source);
  }
  if (sources.length === 0) {
    disconnectAudioNode(masterGain);
    return null;
  }

  return {
    key,
    clipId,
    context,
    masterGain,
    analyser,
    stereoSplitter,
    leftAnalyser,
    rightAnalyser,
    meterSamples: new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>,
    leftMeterSamples: new Float32Array(leftAnalyser.fftSize) as Float32Array<ArrayBuffer>,
    rightMeterSamples: new Float32Array(rightAnalyser.fftSize) as Float32Array<ArrayBuffer>,
    meterTrackId,
    getSourceTime: () => {
      if (context.state === 'closed') return null;
      const sourceTime = startOffset + (context.currentTime - startAt);
      return Number.isFinite(sourceTime) ? Math.max(0, sourceTime) : null;
    },
    sources,
    gains,
    startedAtContextTime: startAt,
    startedClipTime: startOffset,
    sourceCount: sources.length,
    lastGainSignature: '',
    lastMeterPublishAt: 0,
  };
}

export function updateStemBufferMixerGains(
  session: StemBufferMixerSession,
  layers: StemBufferMixerLayer[],
  masterVolume: number,
): void {
  const gainSignature = JSON.stringify({
    masterVolume: Math.round(masterVolume * 1000) / 1000,
    layers: layers.map(layer => [layer.id, Math.round(layer.gain * 1000) / 1000]),
  });
  if (session.lastGainSignature === gainSignature) return;
  session.lastGainSignature = gainSignature;

  const now = session.context.currentTime;
  session.masterGain.gain.setTargetAtTime(clampGain(masterVolume), now, 0.01);
  const targetGains = new Map(layers.map(layer => [layer.id, clampGain(layer.gain)]));
  for (const [layerId, gain] of session.gains) {
    gain.gain.setTargetAtTime(targetGains.get(layerId) ?? 0, now, 0.01);
  }
}

export function publishStemBufferMixerMeter(session: StemBufferMixerSession, force = false): void {
  const now = performance.now();
  if (!force && now - session.lastMeterPublishAt < STEM_MIXER_METER_INTERVAL_MS) return;
  session.lastMeterPublishAt = now;
  session.analyser.getFloatTimeDomainData(session.meterSamples);
  session.leftAnalyser.getFloatTimeDomainData(session.leftMeterSamples);
  session.rightAnalyser.getFloatTimeDomainData(session.rightMeterSamples);
  const snapshot = calculateAudioMeterSnapshot(session.meterSamples, now, undefined, {
    left: session.leftMeterSamples,
    right: session.rightMeterSamples,
  });
  useTimelineStore.getState().updateRuntimeAudioMeter(session.meterTrackId, snapshot);
}

export function setStemBufferMixerMasterClock(
  session: StemBufferMixerSession,
  clip: TimelineClip,
  timeInfo: StemBufferMixerSyncOptions['timeInfo'],
): void {
  setMasterAudioClock(session.getSourceTime, clip.startTime, clip.inPoint, timeInfo.absSpeed);
}

export function recordStemBufferMixerLifecycle(params: {
  action: 'restart' | 'start' | 'stop';
  clipId: string;
  driftMs?: number;
  sources: number;
}): void {
  vfPipelineMonitor.record('audio_stem_mixer', params);
}
