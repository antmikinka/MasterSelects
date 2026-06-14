import { formatDbLong } from './audioMixerMath';
import type { FxWindowTarget } from './audioMixerTypes';
import { useMixerRuntimeAudioMeter } from './mixerMeterRuntime';

export function MixerMeterScale() {
  return (
    <div className="audio-mixer-meter-scale-labels" aria-hidden="true">
      <span>+3</span>
      <span>0</span>
      <span>-5</span>
      <span>-10</span>
      <span>-18</span>
      <span>-30</span>
      <span>-50</span>
    </div>
  );
}

export function MixerMeterReadout({
  scope,
  trackId,
}: {
  scope: FxWindowTarget['scope'];
  trackId?: string;
}) {
  const meter = useMixerRuntimeAudioMeter(scope, trackId);
  return <strong>{meter ? formatDbLong(meter.peakDb) : '-inf'}</strong>;
}
