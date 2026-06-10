import type { ComponentProps, Dispatch, ReactNode, SetStateAction } from 'react';

import {
  AUDIO_EQ_DEFAULT_BAND_DYNAMICS,
  AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS,
} from '../../../../engine/audio/eq/AudioEqDefaults';
import type {
  AudioEqBand,
  AudioEqBandDynamics,
  AudioEqBandSpectralDynamics,
  AudioEqBandType,
  AudioEqParamsV2,
} from '../../../../engine/audio/eq/AudioEqTypes';
import { DraggableNumber, MultiKeyframeToggle } from '../shared';
import { formatEqualizerFrequency } from '../equalizerFormatting';
import { BAND_TYPE_OPTIONS } from './controlOptions';
import {
  GRAPH_MAX_FREQUENCY_HZ,
  GRAPH_MIN_FREQUENCY_HZ,
  clamp,
  formatSignedDb,
} from './graphMath';

type AdvancedPanel = 'none' | 'dynamics' | 'spectral';

interface SelectedBandControlsProps {
  advancedPanel: AdvancedPanel;
  disabled: boolean;
  effectId: string | undefined;
  keyframeClipId: string | undefined;
  normalized: AudioEqParamsV2;
  selectedBand: AudioEqBand | undefined;
  selectedBandAllKeyframeEntries: ComponentProps<typeof MultiKeyframeToggle>['entries'];
  soloBandIds: readonly string[];
  setAdvancedPanel: Dispatch<SetStateAction<AdvancedPanel>>;
  setSelectedBand: (bandId: string) => void;
  toggleSoloBand: (bandId: string) => void;
  updateBand: (bandId: string, patch: Partial<AudioEqBand>) => void;
  updateBandDynamics: (band: AudioEqBand, patch: Partial<AudioEqBandDynamics>) => void;
  updateBandSpectralDynamics: (band: AudioEqBand, patch: Partial<AudioEqBandSpectralDynamics>) => void;
  removeSelectedBand: () => void;
  resetBandGain: (bandId: string) => void;
  renderBandNumericKeyframeToggle: (band: AudioEqBand, paramPath: string, value: number) => ReactNode;
}

export function SelectedBandControls({
  advancedPanel,
  disabled,
  effectId,
  keyframeClipId,
  normalized,
  selectedBand,
  selectedBandAllKeyframeEntries,
  soloBandIds,
  setAdvancedPanel,
  setSelectedBand,
  toggleSoloBand,
  updateBand,
  updateBandDynamics,
  updateBandSpectralDynamics,
  removeSelectedBand,
  resetBandGain,
  renderBandNumericKeyframeToggle,
}: SelectedBandControlsProps) {
  return (
    <>
      {selectedBand && (
        <>
        <div className="flex-eq-selected-band">
          {keyframeClipId && effectId && selectedBandAllKeyframeEntries.length > 0 && (
            <MultiKeyframeToggle
              clipId={keyframeClipId}
              entries={selectedBandAllKeyframeEntries}
              dragId={`${keyframeClipId}:effect:${effectId}:eq-band:${selectedBand.id}:all`}
              title="Add all selected band parameter keyframes"
            />
          )}
          <select
            value={selectedBand.type}
            disabled={disabled}
            aria-label="Band type"
            onChange={(event) => updateBand(selectedBand.id, { type: event.currentTarget.value as AudioEqBandType })}
          >
            {BAND_TYPE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {renderBandNumericKeyframeToggle(selectedBand, 'frequencyHz', selectedBand.frequencyHz)}
          <DraggableNumber
            value={selectedBand.frequencyHz}
            onChange={(value) => updateBand(selectedBand.id, { frequencyHz: clamp(value, GRAPH_MIN_FREQUENCY_HZ, GRAPH_MAX_FREQUENCY_HZ) })}
            defaultValue={selectedBand.frequencyHz}
            min={GRAPH_MIN_FREQUENCY_HZ}
            max={GRAPH_MAX_FREQUENCY_HZ}
            decimals={0}
            suffix=" Hz"
            sensitivity={80}
          />
          {renderBandNumericKeyframeToggle(selectedBand, 'gainDb', selectedBand.gainDb)}
          <DraggableNumber
            value={selectedBand.gainDb}
            onChange={(value) => updateBand(selectedBand.id, { gainDb: clamp(value, -60, 60) })}
            defaultValue={0}
            min={-60}
            max={60}
            decimals={1}
            suffix=" dB"
            sensitivity={0.2}
          />
          {renderBandNumericKeyframeToggle(selectedBand, 'q', selectedBand.q)}
          <DraggableNumber
            value={selectedBand.q}
            onChange={(value) => updateBand(selectedBand.id, { q: clamp(value, 0.025, 100) })}
            defaultValue={1}
            min={0.025}
            max={100}
            decimals={2}
            sensitivity={0.04}
          />
          <button type="button" className={selectedBand.enabled ? 'active' : ''} disabled={disabled} onClick={() => updateBand(selectedBand.id, { enabled: !selectedBand.enabled })}>
            On
          </button>
          <button type="button" className={soloBandIds.includes(selectedBand.id) ? 'active' : ''} disabled={disabled} onClick={() => toggleSoloBand(selectedBand.id)}>
            Solo
          </button>
          <button type="button" className={advancedPanel === 'dynamics' || selectedBand.dynamic?.enabled ? 'active' : ''} disabled={disabled} onClick={() => setAdvancedPanel(current => current === 'dynamics' ? 'none' : 'dynamics')}>
            Dyn
          </button>
          <button type="button" className={advancedPanel === 'spectral' || selectedBand.spectralDynamics?.enabled ? 'active' : ''} disabled={disabled || selectedBand.type === 'all-pass'} onClick={() => setAdvancedPanel(current => current === 'spectral' ? 'none' : 'spectral')}>
            Spec
          </button>
          <button type="button" disabled={disabled || normalized.audible.bands.length <= 1} onClick={removeSelectedBand}>
            x
          </button>
        </div>

        {advancedPanel === 'dynamics' && (
        <div className="flex-eq-dynamics-row">
          <button type="button" className={selectedBand.dynamic?.enabled ? 'active' : ''} disabled={disabled} onClick={() => updateBandDynamics(selectedBand, { enabled: selectedBand.dynamic?.enabled !== true })}>
            Dyn
          </button>
          <select value={selectedBand.dynamic?.mode ?? 'compress'} disabled={disabled} aria-label="Dynamic EQ mode" onChange={(event) => updateBandDynamics(selectedBand, { mode: event.currentTarget.value as AudioEqBandDynamics['mode'] })}>
            <option value="compress">Compress</option>
            <option value="expand">Expand</option>
          </select>
          {renderBandNumericKeyframeToggle(selectedBand, 'dynamic.thresholdDb', selectedBand.dynamic?.thresholdDb ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.thresholdDb)}
          <DraggableNumber value={selectedBand.dynamic?.thresholdDb ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.thresholdDb} onChange={(value) => updateBandDynamics(selectedBand, { thresholdDb: clamp(value, -120, 24) })} defaultValue={AUDIO_EQ_DEFAULT_BAND_DYNAMICS.thresholdDb} min={-120} max={24} decimals={1} suffix=" dB" sensitivity={0.2} />
          {renderBandNumericKeyframeToggle(selectedBand, 'dynamic.rangeDb', selectedBand.dynamic?.rangeDb ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.rangeDb)}
          <DraggableNumber value={selectedBand.dynamic?.rangeDb ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.rangeDb} onChange={(value) => updateBandDynamics(selectedBand, { rangeDb: clamp(value, 0, 60) })} defaultValue={AUDIO_EQ_DEFAULT_BAND_DYNAMICS.rangeDb} min={0} max={60} decimals={1} suffix=" dB" sensitivity={0.16} />
          {renderBandNumericKeyframeToggle(selectedBand, 'dynamic.ratio', selectedBand.dynamic?.ratio ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.ratio)}
          <DraggableNumber value={selectedBand.dynamic?.ratio ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.ratio} onChange={(value) => updateBandDynamics(selectedBand, { ratio: clamp(value, 1, 100) })} defaultValue={AUDIO_EQ_DEFAULT_BAND_DYNAMICS.ratio} min={1} max={100} decimals={1} suffix=":1" sensitivity={0.08} />
          {renderBandNumericKeyframeToggle(selectedBand, 'dynamic.attackMs', selectedBand.dynamic?.attackMs ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.attackMs)}
          <DraggableNumber value={selectedBand.dynamic?.attackMs ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.attackMs} onChange={(value) => updateBandDynamics(selectedBand, { attackMs: clamp(value, 0.1, 5000) })} defaultValue={AUDIO_EQ_DEFAULT_BAND_DYNAMICS.attackMs} min={0.1} max={5000} decimals={1} suffix=" ms" sensitivity={0.12} />
          {renderBandNumericKeyframeToggle(selectedBand, 'dynamic.releaseMs', selectedBand.dynamic?.releaseMs ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.releaseMs)}
          <DraggableNumber value={selectedBand.dynamic?.releaseMs ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.releaseMs} onChange={(value) => updateBandDynamics(selectedBand, { releaseMs: clamp(value, 1, 10000) })} defaultValue={AUDIO_EQ_DEFAULT_BAND_DYNAMICS.releaseMs} min={1} max={10000} decimals={0} suffix=" ms" sensitivity={2} />
        </div>
        )}

        {advancedPanel === 'spectral' && (
        <div className="flex-eq-spectral-row">
          <button type="button" className={selectedBand.spectralDynamics?.enabled ? 'active' : ''} disabled={disabled || selectedBand.type === 'all-pass'} onClick={() => updateBandSpectralDynamics(selectedBand, { enabled: selectedBand.spectralDynamics?.enabled !== true })}>
            Spec
          </button>
          <select value={selectedBand.spectralDynamics?.mode ?? 'compress'} disabled={disabled || selectedBand.type === 'all-pass'} aria-label="Spectral Dynamics mode" onChange={(event) => updateBandSpectralDynamics(selectedBand, { mode: event.currentTarget.value as AudioEqBandSpectralDynamics['mode'] })}>
            <option value="compress">Compress</option>
            <option value="expand">Expand</option>
          </select>
          {renderBandNumericKeyframeToggle(selectedBand, 'spectralDynamics.thresholdDb', selectedBand.spectralDynamics?.thresholdDb ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.thresholdDb)}
          <DraggableNumber value={selectedBand.spectralDynamics?.thresholdDb ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.thresholdDb} onChange={(value) => updateBandSpectralDynamics(selectedBand, { thresholdDb: clamp(value, -120, 24) })} defaultValue={AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.thresholdDb} min={-120} max={24} decimals={1} suffix=" dB" sensitivity={0.2} />
          {renderBandNumericKeyframeToggle(selectedBand, 'spectralDynamics.rangeDb', selectedBand.spectralDynamics?.rangeDb ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.rangeDb)}
          <DraggableNumber value={selectedBand.spectralDynamics?.rangeDb ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.rangeDb} onChange={(value) => updateBandSpectralDynamics(selectedBand, { rangeDb: clamp(value, 0, 60) })} defaultValue={AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.rangeDb} min={0} max={60} decimals={1} suffix=" dB" sensitivity={0.16} />
          {renderBandNumericKeyframeToggle(selectedBand, 'spectralDynamics.ratio', selectedBand.spectralDynamics?.ratio ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.ratio)}
          <DraggableNumber value={selectedBand.spectralDynamics?.ratio ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.ratio} onChange={(value) => updateBandSpectralDynamics(selectedBand, { ratio: clamp(value, 1, 100) })} defaultValue={AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.ratio} min={1} max={100} decimals={1} suffix=":1" sensitivity={0.08} />
          {renderBandNumericKeyframeToggle(selectedBand, 'spectralDynamics.attackMs', selectedBand.spectralDynamics?.attackMs ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.attackMs)}
          <DraggableNumber value={selectedBand.spectralDynamics?.attackMs ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.attackMs} onChange={(value) => updateBandSpectralDynamics(selectedBand, { attackMs: clamp(value, 0.1, 5000) })} defaultValue={AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.attackMs} min={0.1} max={5000} decimals={1} suffix=" ms" sensitivity={0.12} />
          {renderBandNumericKeyframeToggle(selectedBand, 'spectralDynamics.releaseMs', selectedBand.spectralDynamics?.releaseMs ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.releaseMs)}
          <DraggableNumber value={selectedBand.spectralDynamics?.releaseMs ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.releaseMs} onChange={(value) => updateBandSpectralDynamics(selectedBand, { releaseMs: clamp(value, 1, 10000) })} defaultValue={AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.releaseMs} min={1} max={10000} decimals={0} suffix=" ms" sensitivity={2} />
          <select value={selectedBand.spectralDynamics?.resolution ?? 'balanced'} disabled={disabled || selectedBand.type === 'all-pass'} aria-label="Spectral Dynamics resolution" onChange={(event) => updateBandSpectralDynamics(selectedBand, { resolution: event.currentTarget.value as AudioEqBandSpectralDynamics['resolution'] })}>
            <option value="low-latency">Low</option>
            <option value="balanced">Bal</option>
            <option value="mastering">Mast</option>
          </select>
        </div>
        )}
        </>
      )}

      <div className="flex-eq-band-strip">
        {normalized.audible.bands.map((band) => {
          const selected = selectedBand?.id === band.id;
          const soloActive = soloBandIds.length > 0;
          const soloed = soloBandIds.includes(band.id);
          return (
            <button
              key={band.id}
              type="button"
              className={`${selected ? 'selected' : ''} ${band.enabled ? '' : 'muted'} ${soloed ? 'soloed' : ''} ${soloActive && !soloed ? 'not-soloed' : ''}`}
              disabled={disabled}
              onClick={() => setSelectedBand(band.id)}
              onDoubleClick={() => resetBandGain(band.id)}
            >
              <span>{formatEqualizerFrequency(band.frequencyHz)}</span>
              <strong>{formatSignedDb(band.gainDb)}</strong>
            </button>
          );
        })}
      </div>
    </>
  );
}
