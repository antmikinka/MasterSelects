import { describe, expect, it } from 'vitest';
import {
  createLiveAudioRouteSettings,
  getTrackAudioMuted,
  getTrackAudioSolo,
} from '../../../src/services/audio/audioGraphRouteSettings';
import type { AudioEffectInstance, Effect, TimelineClip, TimelineTrack } from '../../../src/types';
import { createMockClip, createMockTrack } from '../../helpers/mockData';

function audioEffect(overrides: Partial<AudioEffectInstance> = {}): AudioEffectInstance {
  return {
    id: overrides.id ?? 'fx-volume',
    descriptorId: overrides.descriptorId ?? 'audio-volume',
    enabled: overrides.enabled ?? true,
    params: overrides.params ?? { volume: 1 },
    ...overrides,
  };
}

function legacyEffect(overrides: Partial<Effect> = {}): Effect {
  return {
    id: overrides.id ?? 'legacy-volume',
    name: overrides.name ?? 'Legacy Volume',
    type: overrides.type ?? 'audio-volume',
    enabled: overrides.enabled ?? true,
    params: overrides.params ?? { volume: 1 },
  };
}

function audioTrack(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return createMockTrack({
    id: overrides.id ?? 'track-a',
    type: 'audio',
    muted: false,
    solo: false,
    ...overrides,
  });
}

function audioClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return createMockClip({
    id: overrides.id ?? 'clip-a',
    trackId: overrides.trackId ?? 'track-a',
    source: { type: 'audio', mediaFileId: 'media-a' } as TimelineClip['source'],
    ...overrides,
  });
}

describe('audio graph route settings', () => {
  it('prefers advanced track mute and solo state over legacy track flags', () => {
    const track = audioTrack({
      muted: false,
      solo: false,
      audioState: {
        volumeDb: 0,
        pan: 0,
        muted: true,
        solo: true,
        recordArm: false,
        inputMonitor: false,
        meterMode: 'peak',
      },
    });

    expect(getTrackAudioMuted(track)).toBe(true);
    expect(getTrackAudioSolo(track)).toBe(true);
  });

  it('combines clip, track, and master route settings for live playback', () => {
    const clip = audioClip({
      audioState: {
        effectStack: [
          audioEffect({
            id: 'clip-volume',
            descriptorId: 'audio-volume',
            params: { volume: 0.5 },
          }),
        ],
      },
    });
    const track = audioTrack({
      audioState: {
        volumeDb: -6,
        pan: 0.75,
        muted: false,
        solo: false,
        recordArm: false,
        inputMonitor: false,
        meterMode: 'peak',
        effectStack: [
          audioEffect({
            id: 'track-eq',
            descriptorId: 'audio-eq',
            params: { band1k: 3 },
          }),
        ],
      },
    });
    const masterEffect = audioEffect({
      id: 'master-eq',
      descriptorId: 'audio-eq',
      params: { band1k: -1, band4k: 2 },
    });

    const route = createLiveAudioRouteSettings({
      clip,
      track,
      masterAudioState: {
        volumeDb: -3,
        limiterEnabled: true,
        truePeakCeilingDb: -1,
        effectStack: [masterEffect],
      },
      interpolatedClipEffects: [
        legacyEffect({
          id: 'legacy-volume',
          params: { volume: 0.8 },
        }),
      ],
    });

    expect(route.volume).toBeCloseTo(0.5 * 0.8 * Math.pow(10, -9 / 20), 5);
    expect(route.pan).toBe(0.75);
    expect(route.muted).toBe(false);
    expect(route.eqGains[5]).toBe(2);
    expect(route.eqGains[7]).toBe(2);
  });

  it('adds enabled track sends to the live route as master-return gain', () => {
    const clip = audioClip();
    const track = audioTrack({
      audioState: {
        volumeDb: -6,
        pan: 0,
        muted: false,
        solo: false,
        recordArm: false,
        inputMonitor: false,
        meterMode: 'peak',
        sends: [
          {
            id: 'send-a',
            targetBusId: 'bus-a',
            gainDb: -6,
            preFader: false,
            enabled: true,
          },
        ],
      },
    });

    const route = createLiveAudioRouteSettings({
      clip,
      track,
      interpolatedClipEffects: [],
    });

    const trackGain = Math.pow(10, -6 / 20);
    expect(route.volume).toBeCloseTo(trackGain + (trackGain * trackGain), 5);
  });

  it('keeps pre-fader track sends independent from the track fader in the live route', () => {
    const clip = audioClip();
    const track = audioTrack({
      audioState: {
        volumeDb: -12,
        pan: 0,
        muted: false,
        solo: false,
        recordArm: false,
        inputMonitor: false,
        meterMode: 'peak',
        sends: [
          {
            id: 'send-a',
            targetBusId: 'bus-a',
            gainDb: 0,
            preFader: true,
            enabled: true,
          },
        ],
      },
    });

    const route = createLiveAudioRouteSettings({
      clip,
      track,
      interpolatedClipEffects: [],
    });

    expect(route.volume).toBeCloseTo(Math.pow(10, -12 / 20) + 1, 5);
  });

  it('ignores disabled track sends in the live route', () => {
    const clip = audioClip();
    const track = audioTrack({
      audioState: {
        volumeDb: -6,
        pan: 0,
        muted: false,
        solo: false,
        recordArm: false,
        inputMonitor: false,
        meterMode: 'peak',
        sends: [
          {
            id: 'send-a',
            targetBusId: 'bus-a',
            gainDb: 12,
            preFader: false,
            enabled: false,
          },
        ],
      },
    });

    const route = createLiveAudioRouteSettings({
      clip,
      track,
      interpolatedClipEffects: [],
    });

    expect(route.volume).toBeCloseTo(Math.pow(10, -6 / 20), 5);
  });

  it('projects browser-supported registry processors for live clip, track, and master routing', () => {
    const clip = audioClip({
      audioState: {
        effectStack: [
          audioEffect({
            id: 'clip-high-pass',
            descriptorId: 'audio-high-pass',
            params: { frequencyHz: 120, q: 0.9 },
          }),
          audioEffect({
            id: 'clip-de-esser',
            descriptorId: 'audio-de-esser',
            params: { frequencyHz: 7200, thresholdDb: -22, ratio: 4, kneeDb: 6, attackMs: 1, releaseMs: 90, makeupGainDb: 0 },
          }),
          audioEffect({
            id: 'clip-gate',
            descriptorId: 'audio-noise-gate',
            params: { thresholdDb: -45, floorDb: -80, attackMs: 2, releaseMs: 80 },
          }),
        ],
      },
    });
    const track = audioTrack({
      audioState: {
        volumeDb: 0,
        pan: 0,
        muted: false,
        solo: false,
        recordArm: false,
        inputMonitor: false,
        meterMode: 'peak',
        effectStack: [
          audioEffect({
            id: 'track-compressor',
            descriptorId: 'audio-compressor',
            params: { thresholdDb: -18, ratio: 3, kneeDb: 6, attackMs: 8, releaseMs: 140, makeupGainDb: 2 },
          }),
        ],
      },
    });

    const route = createLiveAudioRouteSettings({
      clip,
      track,
      masterAudioState: {
        volumeDb: 0,
        limiterEnabled: true,
        truePeakCeilingDb: -1,
        effectStack: [
          audioEffect({
            id: 'master-low-pass',
            descriptorId: 'audio-low-pass',
            params: { frequencyHz: 18000, q: 0.707 },
          }),
          audioEffect({
            id: 'master-delay',
            descriptorId: 'audio-delay',
            params: { delayMs: 180, feedback: 0.25, mix: 0.3, toneHz: 9000 },
          }),
          audioEffect({
            id: 'master-reverb',
            descriptorId: 'audio-reverb',
            params: { roomSize: 0.55, decaySeconds: 1.8, damping: 0.4, mix: 0.2 },
          }),
        ],
      },
      interpolatedClipEffects: [],
    });

    expect(route.processors).toEqual([
      { id: 'clip-high-pass', type: 'high-pass', frequencyHz: 120, q: 0.9 },
      {
        id: 'clip-de-esser',
        type: 'de-esser',
        frequencyHz: 7200,
        thresholdDb: -22,
        ratio: 4,
        kneeDb: 6,
        attackMs: 1,
        releaseMs: 90,
        makeupGainDb: 0,
      },
      {
        id: 'track-compressor',
        type: 'compressor',
        thresholdDb: -18,
        ratio: 3,
        kneeDb: 6,
        attackMs: 8,
        releaseMs: 140,
        makeupGainDb: 2,
      },
      { id: 'master-low-pass', type: 'low-pass', frequencyHz: 18000, q: 0.707 },
      { id: 'master-delay', type: 'delay', delayMs: 180, feedback: 0.25, mix: 0.3, toneHz: 9000 },
      { id: 'master-reverb', type: 'reverb', roomSize: 0.55, decaySeconds: 1.8, damping: 0.4, mix: 0.2 },
    ]);
  });
});
