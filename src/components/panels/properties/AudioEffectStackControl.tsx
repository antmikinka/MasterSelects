import type { AudioEffectInstance } from '../../../types';
import './VolumeBlendshapeTabs.css';
import {
  getAllAudioEffects,
  getAudioEffect,
  type AudioEffectParamValue,
} from '../../../engine/audio/AudioEffectRegistry';
import { DraggableNumber, EffectKeyframeToggle } from './shared';

export interface AudioEffectStackControlProps {
  title?: string;
  effects: readonly AudioEffectInstance[];
  emptyLabel?: string;
  addLabel?: string;
  className?: string;
  excludeDescriptorIds?: ReadonlySet<string>;
  keyframeClipId?: string;
  onAddEffect: (descriptorId: string) => void;
  onUpdateEffect: (effect: AudioEffectInstance, paramName: string, value: AudioEffectParamValue) => void;
  onSetEffectEnabled: (effectId: string, enabled: boolean) => void;
  onRemoveEffect: (effectId: string) => void;
  onReorderEffect: (effectId: string, newIndex: number) => void;
}

function formatParamLabel(paramName: string): string {
  return paramName
    .replace(/Db\b/g, ' dB')
    .replace(/Hz\b/g, ' Hz')
    .replace(/Ms\b/g, ' ms')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, char => char.toUpperCase());
}

function getParamControlMeta(
  paramName: string,
  defaultValue: AudioEffectParamValue,
): { min: number; max: number; decimals: number; suffix: string; sensitivity: number } {
  if (paramName.includes('frequencyHz')) return { min: 20, max: 22000, decimals: 0, suffix: ' Hz', sensitivity: 60 };
  if (paramName === 'q') return { min: 0.1, max: 24, decimals: 2, suffix: '', sensitivity: 0.08 };
  if (paramName.includes('thresholdDb')) return { min: -80, max: 0, decimals: 1, suffix: ' dB', sensitivity: 0.25 };
  if (paramName.includes('floorDb')) return { min: -100, max: 0, decimals: 1, suffix: ' dB', sensitivity: 0.25 };
  if (paramName.includes('ceilingDb')) return { min: -24, max: 0, decimals: 1, suffix: ' dB', sensitivity: 0.15 };
  if (paramName.includes('makeupGainDb') || paramName.includes('inputGainDb')) return { min: -24, max: 24, decimals: 1, suffix: ' dB', sensitivity: 0.2 };
  if (paramName.includes('kneeDb')) return { min: 0, max: 40, decimals: 1, suffix: ' dB', sensitivity: 0.2 };
  if (paramName === 'ratio') return { min: 1, max: 20, decimals: 2, suffix: ':1', sensitivity: 0.05 };
  if (paramName.includes('attackMs')) return { min: 0.1, max: 500, decimals: 1, suffix: ' ms', sensitivity: 1 };
  if (paramName.includes('releaseMs')) return { min: 1, max: 2000, decimals: 0, suffix: ' ms', sensitivity: 4 };
  if (paramName === 'delayMs') return { min: 1, max: 2000, decimals: 0, suffix: ' ms', sensitivity: 4 };
  if (paramName === 'feedback') return { min: 0, max: 0.95, decimals: 2, suffix: '', sensitivity: 0.01 };
  if (paramName === 'mix') return { min: 0, max: 1, decimals: 2, suffix: '', sensitivity: 0.01 };
  if (paramName === 'toneHz') return { min: 200, max: 22000, decimals: 0, suffix: ' Hz', sensitivity: 60 };
  if (paramName === 'roomSize') return { min: 0, max: 1, decimals: 2, suffix: '', sensitivity: 0.01 };
  if (paramName === 'decaySeconds') return { min: 0.1, max: 12, decimals: 2, suffix: ' s', sensitivity: 0.05 };
  if (paramName === 'damping') return { min: 0, max: 1, decimals: 2, suffix: '', sensitivity: 0.01 };
  if (typeof defaultValue === 'number') return { min: -100, max: 100, decimals: 2, suffix: '', sensitivity: 0.5 };
  return { min: 0, max: 1, decimals: 2, suffix: '', sensitivity: 0.01 };
}

function getAudioEffectValue(
  effect: AudioEffectInstance,
  paramName: string,
  defaultValue: AudioEffectParamValue,
): AudioEffectParamValue {
  return effect.params[paramName] ?? defaultValue;
}

export function AudioEffectStackControl({
  title = 'Audio FX Stack',
  effects,
  emptyLabel = 'No registry audio effects',
  addLabel = '+ Add FX',
  className,
  excludeDescriptorIds,
  keyframeClipId,
  onAddEffect,
  onUpdateEffect,
  onSetEffectEnabled,
  onRemoveEffect,
  onReorderEffect,
}: AudioEffectStackControlProps) {
  const availableEffects = getAllAudioEffects().filter(effect => !excludeDescriptorIds?.has(effect.id));

  return (
    <div className={`audio-effect-stack-control ${className ?? ''}`}>
      <div className="section-header-row audio-effect-stack-control-header">
        <h4>{title}</h4>
        <select
          className="audio-effect-add-select"
          defaultValue=""
          onChange={(e) => {
            onAddEffect(e.target.value);
            e.target.value = '';
          }}
        >
          <option value="" disabled>{addLabel}</option>
          {availableEffects.map(effect => (
            <option key={effect.id} value={effect.id}>{effect.name}</option>
          ))}
        </select>
      </div>

      {effects.length === 0 ? (
        <div className="audio-effect-stack-empty">{emptyLabel}</div>
      ) : (
        <div className="audio-effect-stack-list">
          {effects.map((effect, index) => {
            const descriptor = getAudioEffect(effect.descriptorId);
            if (!descriptor) return null;
            const enabled = effect.enabled !== false;
            return (
              <div key={effect.id} className={`audio-effect-stack-item ${enabled ? '' : 'bypassed'}`}>
                <div className="audio-effect-stack-item-header">
                  <div>
                    <strong>{descriptor.name}</strong>
                    <span>{descriptor.category ?? 'audio'}</span>
                  </div>
                  <div className="audio-effect-stack-actions">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => onReorderEffect(effect.id, index - 1)}
                      disabled={index === 0}
                      title="Move effect earlier"
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => onReorderEffect(effect.id, index + 1)}
                      disabled={index >= effects.length - 1}
                      title="Move effect later"
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => onSetEffectEnabled(effect.id, !enabled)}
                    >
                      {enabled ? 'Bypass' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => onRemoveEffect(effect.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div className="audio-effect-param-grid">
                  {descriptor.paramNames.map(paramName => {
                    const param = descriptor.params[paramName];
                    const currentValue = getAudioEffectValue(effect, paramName, param.default);
                    if (typeof param.default === 'boolean') {
                      return (
                        <label key={paramName} className="audio-effect-param-row checkbox-row">
                          <span>{formatParamLabel(paramName)}</span>
                          <input
                            type="checkbox"
                            checked={Boolean(currentValue)}
                            onChange={(e) => onUpdateEffect(effect, paramName, e.target.checked)}
                          />
                        </label>
                      );
                    }
                    if (typeof param.default === 'number') {
                      const numericValue = typeof currentValue === 'number' ? currentValue : param.default;
                      const meta = getParamControlMeta(paramName, param.default);
                      return (
                        <div key={paramName} className="audio-effect-param-row">
                          <span>{formatParamLabel(paramName)}</span>
                          <div className={`audio-effect-param-control ${keyframeClipId ? '' : 'no-keyframes'}`}>
                            {keyframeClipId && (
                              <EffectKeyframeToggle
                                clipId={keyframeClipId}
                                effectId={effect.id}
                                paramName={paramName}
                                value={numericValue}
                              />
                            )}
                            <DraggableNumber
                              value={numericValue}
                              onChange={(value) => onUpdateEffect(effect, paramName, value)}
                              defaultValue={param.default}
                              min={meta.min}
                              max={meta.max}
                              decimals={meta.decimals}
                              suffix={meta.suffix}
                              sensitivity={meta.sensitivity}
                            />
                          </div>
                        </div>
                      );
                    }
                    return (
                      <label key={paramName} className="audio-effect-param-row">
                        <span>{formatParamLabel(paramName)}</span>
                        <input
                          type="text"
                          value={String(currentValue)}
                          onChange={(e) => onUpdateEffect(effect, paramName, e.target.value)}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
