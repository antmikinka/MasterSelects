import type { AudioMeterSnapshot } from '../../../types/audio';
import { calculateAudioMeterSnapshot } from '../audioMetering';
import { getRouteDynamicsSnapshot } from './dynamicsSnapshots';
import type { AudioRouteProcessorNode } from './routeGraphTypes';

interface MeteredRoute {
  analyserNode: AnalyserNode;
  leftAnalyserNode: AnalyserNode;
  rightAnalyserNode: AnalyserNode;
  meterBuffer: Float32Array<ArrayBuffer>;
  leftMeterBuffer: Float32Array<ArrayBuffer>;
  rightMeterBuffer: Float32Array<ArrayBuffer>;
  frequencyBuffer: Float32Array<ArrayBuffer>;
  processorNodes: AudioRouteProcessorNode[];
}

export function readRouteMeterSnapshot(
  route: MeteredRoute,
  updatedAt: number,
): AudioMeterSnapshot {
  route.analyserNode.getFloatTimeDomainData(route.meterBuffer);
  route.analyserNode.getFloatFrequencyData(route.frequencyBuffer);
  route.leftAnalyserNode.getFloatTimeDomainData(route.leftMeterBuffer);
  route.rightAnalyserNode.getFloatTimeDomainData(route.rightMeterBuffer);
  return calculateAudioMeterSnapshot(
    route.meterBuffer,
    updatedAt,
    getRouteDynamicsSnapshot(route, updatedAt),
    { left: route.leftMeterBuffer, right: route.rightMeterBuffer },
    new Float32Array(route.frequencyBuffer),
  );
}
