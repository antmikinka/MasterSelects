import { clampAudioPan } from '../../../engine/audio/audioMath';
import type { LiveAudioRouteProcessor } from '../audioGraphRouteSettings';
import type { AudioRoute, MasterAudioRoute } from './routeGraphTypes';

export function processorSignature(processors: readonly LiveAudioRouteProcessor[] = []): string {
  return processors.map(processor => `${processor.id}:${processor.type}`).join('|');
}

export function applyTrackRouteEffectState(
  route: AudioRoute,
  volume: number,
  eqGains: readonly number[],
  pan: number,
): void {
  if (Math.abs(route.lastVolume - volume) > 0.001) {
    route.gainNode.gain.value = Math.max(0, Math.min(4, volume));
    route.lastVolume = volume;
  }

  const clampedPan = clampAudioPan(pan);
  if (Math.abs(route.lastPan - clampedPan) > 0.001) {
    route.panNode.pan.value = clampedPan;
    route.lastPan = clampedPan;
  }

  for (let index = 0; index < 10; index += 1) {
    const gain = eqGains[index] ?? 0;
    if (Math.abs(route.lastEQGains[index] - gain) > 0.01) {
      route.eqFilters[index].gain.value = gain;
      route.lastEQGains[index] = gain;
    }
  }
}

export function applyMasterRouteEffectState(
  route: MasterAudioRoute,
  volume: number,
  eqGains: readonly number[],
): void {
  if (Math.abs(route.lastVolume - volume) > 0.001) {
    route.gainNode.gain.value = Math.max(0, Math.min(4, volume));
    route.lastVolume = volume;
  }

  for (let index = 0; index < route.eqFilters.length; index += 1) {
    const gain = eqGains[index] ?? 0;
    if (Math.abs(route.lastEQGains[index] - gain) > 0.01) {
      route.eqFilters[index].gain.value = gain;
      route.lastEQGains[index] = gain;
    }
  }
}
