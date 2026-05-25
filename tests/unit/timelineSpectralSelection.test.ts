import { describe, expect, it } from 'vitest';
import {
  frequencyHzFromSpectralY,
  getSpectralMaxFrequencyHz,
  resolveTimelineSpectralRegionSelection,
  spectralYFromFrequencyHz,
} from '../../src/components/timeline/utils/spectralSelection';
import { createMockClip } from '../helpers/mockData';

describe('timeline spectral selection', () => {
  it('maps spectral y coordinates and frequencies round-trip', () => {
    const maxFrequencyHz = getSpectralMaxFrequencyHz(48_000);
    const y = spectralYFromFrequencyHz(6000, 180, maxFrequencyHz);
    const frequency = frequencyHzFromSpectralY(y, 180, maxFrequencyHz);

    expect(maxFrequencyHz).toBe(24_000);
    expect(frequency).toBeCloseTo(6000, 1);
  });

  it('creates ascending source and frequency ranges for spectral drags', () => {
    const clip = createMockClip({
      id: 'audio-clip',
      trackId: 'audio-1',
      startTime: 10,
      duration: 5,
      inPoint: 2,
      outPoint: 7,
      waveform: [0.3, 0.2, 0.1, 0.2],
    });

    const selection = resolveTimelineSpectralRegionSelection({
      clip,
      anchorTimelineTime: 13,
      focusTimelineTime: 11,
      anchorFrequencyHz: 6200,
      focusFrequencyHz: 280,
      maxFrequencyHz: 24_000,
    });

    expect(selection).toMatchObject({
      clipId: 'audio-clip',
      trackId: 'audio-1',
      startTime: 11,
      endTime: 13,
      sourceInPoint: 3,
      sourceOutPoint: 5,
      frequencyMinHz: 280,
      frequencyMaxHz: 6200,
    });
  });
});
