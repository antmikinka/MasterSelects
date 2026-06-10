import type {
  Dispatch,
  MouseEventHandler,
  PointerEventHandler,
  RefObject,
  SetStateAction,
} from 'react';

import type {
  AudioEqCharacterMode,
  AudioEqParamsV2,
  AudioEqPhaseMode,
  AudioEqPresetKind,
  AudioEqBandType,
} from '../../../../engine/audio/eq/AudioEqTypes';
import type { FlexEqGraphMode } from './canvasRenderer';
import { ANALYZER_VIEW_OPTIONS, PRESET_OPTIONS } from './controlOptions';

export type FlexEqControlParamValue =
  | string
  | number
  | boolean
  | null
  | FlexEqControlParamValue[]
  | { [key: string]: FlexEqControlParamValue };

export interface FlexEqBrowserPresetView {
  id: string;
  name: string;
  tags: readonly string[];
  favorite?: boolean;
  source: 'factory' | 'user';
}

interface TopControlsProps {
  ariaLabel: string;
  compact: boolean;
  disabled: boolean;
  normalized: AudioEqParamsV2;
  showPresetBrowser: boolean;
  presetQuery: string;
  presetTagFilter: string;
  presetFilter: 'all' | 'favorites' | 'user';
  presetTags: readonly string[];
  filteredPresets: readonly FlexEqBrowserPresetView[];
  graphMode: FlexEqGraphMode;
  hasAnalyzer: boolean;
  matchSourceActive: boolean;
  matchTargetActive: boolean;
  canApplyMatch: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  graphHeight: number;
  setShowPresetBrowser: Dispatch<SetStateAction<boolean>>;
  setPresetQuery: (value: string) => void;
  setPresetTagFilter: (value: string) => void;
  setPresetFilter: (value: 'all' | 'favorites' | 'user') => void;
  setGraphMode: Dispatch<SetStateAction<FlexEqGraphMode>>;
  setSketchPoints: (points: []) => void;
  updatePresetKind: (kind: AudioEqPresetKind) => void;
  updatePath: (path: string, value: FlexEqControlParamValue) => void;
  saveCurrentUserPreset: () => void;
  applyBrowserPreset: (presetId: string) => void;
  toggleBrowserPresetFavorite: (presetId: string) => void;
  deleteBrowserPreset: (preset: FlexEqBrowserPresetView) => void;
  switchABSlot: (slot: 'A' | 'B') => void;
  syncActiveABSlot: () => void;
  handleCopyCurve: () => void;
  handleCopyBands: () => void;
  handlePaste: () => void;
  captureMatchSource: () => void;
  captureMatchTarget: () => void;
  applyCapturedMatch: () => void;
  addBand: (type: AudioEqBandType, frequencyHz: number) => void;
  handlePointerDown: PointerEventHandler<HTMLCanvasElement>;
  handlePointerMove: PointerEventHandler<HTMLCanvasElement>;
  finishPointer: PointerEventHandler<HTMLCanvasElement>;
  handlePointerLeave: PointerEventHandler<HTMLCanvasElement>;
  handleContextMenu: MouseEventHandler<HTMLCanvasElement>;
  activeABSlot: 'A' | 'B';
  hasSelectedBand: boolean;
}

export function TopControls({
  ariaLabel,
  compact,
  disabled,
  normalized,
  showPresetBrowser,
  presetQuery,
  presetTagFilter,
  presetFilter,
  presetTags,
  filteredPresets,
  graphMode,
  hasAnalyzer,
  matchSourceActive,
  matchTargetActive,
  canApplyMatch,
  stageRef,
  canvasRef,
  graphHeight,
  setShowPresetBrowser,
  setPresetQuery,
  setPresetTagFilter,
  setPresetFilter,
  setGraphMode,
  setSketchPoints,
  updatePresetKind,
  updatePath,
  saveCurrentUserPreset,
  applyBrowserPreset,
  toggleBrowserPresetFavorite,
  deleteBrowserPreset,
  switchABSlot,
  syncActiveABSlot,
  handleCopyCurve,
  handleCopyBands,
  handlePaste,
  captureMatchSource,
  captureMatchTarget,
  applyCapturedMatch,
  addBand,
  handlePointerDown,
  handlePointerMove,
  finishPointer,
  handlePointerLeave,
  handleContextMenu,
  activeABSlot,
  hasSelectedBand,
}: TopControlsProps) {
  return (
    <>
      <div className="flex-eq-toolbar">
        <div className="flex-eq-primary-tools">
          <div className="flex-eq-segments" role="group" aria-label="EQ preset">
            {PRESET_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                className={normalized.audible.presetKind === option.value ? 'active' : ''}
                disabled={disabled}
                onClick={() => updatePresetKind(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <select
            value={normalized.audible.phaseMode}
            disabled={disabled}
            aria-label="EQ phase mode"
            onChange={(event) => updatePath('eq.audible.phaseMode', event.currentTarget.value as AudioEqPhaseMode)}
          >
            <option value="zero-latency">Zero</option>
            <option value="natural">Natural</option>
            <option value="linear">Linear</option>
          </select>
          <select
            value={normalized.audible.characterMode}
            disabled={disabled}
            aria-label="EQ character mode"
            onChange={(event) => updatePath('eq.audible.characterMode', event.currentTarget.value as AudioEqCharacterMode)}
          >
            <option value="clean">Clean</option>
            <option value="subtle">Subtle</option>
            <option value="warm">Warm</option>
          </select>
        </div>

        <div className="flex-eq-secondary-tools">
          <div className="flex-eq-ab-controls" role="group" aria-label="EQ A/B">
            <button type="button" className={activeABSlot === 'A' ? 'active' : ''} disabled={disabled} onClick={() => switchABSlot('A')}>
              A
            </button>
            <button type="button" className={activeABSlot === 'B' ? 'active' : ''} disabled={disabled} onClick={() => switchABSlot('B')}>
              B
            </button>
            <button type="button" disabled={disabled} onClick={syncActiveABSlot}>Store</button>
          </div>
          <button
            type="button"
            className={`flex-eq-tool-button ${showPresetBrowser ? 'active' : ''}`}
            disabled={disabled}
            onClick={() => setShowPresetBrowser(current => !current)}
          >
            Presets
          </button>
          <div className="flex-eq-clipboard-controls" role="group" aria-label="EQ clipboard">
            <button type="button" disabled={disabled} onClick={handleCopyCurve}>Copy</button>
            <button type="button" disabled={disabled || !hasSelectedBand} onClick={handleCopyBands}>Band</button>
            <button type="button" disabled={disabled} onClick={handlePaste}>Paste</button>
          </div>
        </div>
      </div>

      {showPresetBrowser && (
      <div className="flex-eq-preset-browser">
        <div className="flex-eq-preset-tools">
          <input
            value={presetQuery}
            disabled={disabled}
            aria-label="Search EQ presets"
            placeholder="Search presets"
            onChange={(event) => setPresetQuery(event.currentTarget.value)}
          />
          <select
            value={presetTagFilter}
            disabled={disabled}
            aria-label="Preset tag filter"
            onChange={(event) => setPresetTagFilter(event.currentTarget.value)}
          >
            <option value="">Tags</option>
            {presetTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
          </select>
          <div className="flex-eq-preset-filter" role="group" aria-label="Preset filter">
            {(['all', 'favorites', 'user'] as const).map(filter => (
              <button key={filter} type="button" className={presetFilter === filter ? 'active' : ''} disabled={disabled} onClick={() => setPresetFilter(filter)}>
                {filter === 'all' ? 'All' : filter === 'favorites' ? 'Fav' : 'User'}
              </button>
            ))}
          </div>
          <button type="button" disabled={disabled} onClick={saveCurrentUserPreset}>Save</button>
        </div>
        <div className="flex-eq-preset-list" role="list" aria-label="EQ presets">
          {filteredPresets.slice(0, compact ? 6 : 10).map(preset => (
            <div key={`${preset.source}:${preset.id}`} className="flex-eq-preset-pill" role="listitem">
              <button type="button" className="flex-eq-preset-main" disabled={disabled} onClick={() => applyBrowserPreset(preset.id)}>
                <span>{preset.name}</span>
                <small>{preset.tags.slice(0, 2).join(' / ') || preset.source}</small>
              </button>
              <button type="button" className={preset.favorite ? 'active' : ''} disabled={disabled} aria-label={`Favorite ${preset.name}`} onClick={() => toggleBrowserPresetFavorite(preset.id)}>
                Fav
              </button>
              {preset.source === 'user' && (
                <button type="button" disabled={disabled} aria-label={`Delete ${preset.name}`} onClick={() => deleteBrowserPreset(preset)}>
                  x
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      )}

      <div className="flex-eq-generator-row">
        <div className="flex-eq-mode-controls" role="group" aria-label="EQ graph mode">
          <button type="button" className={graphMode === 'edit' ? 'active' : ''} disabled={disabled} onClick={() => { setGraphMode('edit'); setSketchPoints([]); }}>
            Edit
          </button>
          <button type="button" className={graphMode === 'sketch' ? 'active' : ''} disabled={disabled} onClick={() => { setGraphMode(graphMode === 'sketch' ? 'edit' : 'sketch'); setSketchPoints([]); }}>
            Sketch
          </button>
          <button type="button" className={graphMode === 'grab' ? 'active' : ''} disabled={disabled || !hasAnalyzer} onClick={() => setGraphMode(graphMode === 'grab' ? 'edit' : 'grab')}>
            Grab
          </button>
        </div>
        <div className="flex-eq-match-controls" role="group" aria-label="EQ match">
          <button type="button" disabled={disabled || !hasAnalyzer} className={matchSourceActive ? 'active' : ''} onClick={captureMatchSource}>
            Src
          </button>
          <button type="button" disabled={disabled || !hasAnalyzer} className={matchTargetActive ? 'active' : ''} onClick={captureMatchTarget}>
            Ref
          </button>
          <button type="button" disabled={disabled || !canApplyMatch} onClick={applyCapturedMatch}>
            Match
          </button>
        </div>
        <div className="flex-eq-analyzer-controls" role="group" aria-label="Spectrum view">
          {ANALYZER_VIEW_OPTIONS.map(option => {
            const currentAnalyzerMode = normalized.display.analyzerMode === 'off'
              ? 'post'
              : normalized.display.analyzerMode;
            return (
              <button key={option.value} type="button" disabled={disabled || !hasAnalyzer} className={currentAnalyzerMode === option.value ? 'active' : ''} onClick={() => updatePath('eq.display.analyzerMode', option.value)}>
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div ref={stageRef} className="flex-eq-stage" style={{ width: '100%', height: graphHeight }}>
        <canvas
          ref={canvasRef}
          className="flex-eq-canvas"
          aria-label={ariaLabel}
          role="img"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
          onPointerLeave={handlePointerLeave}
          onContextMenu={handleContextMenu}
        />
      </div>

      <div className="flex-eq-add-row">
        <button type="button" disabled={disabled} onClick={() => addBand('bell', 1000)}>+ Bell</button>
        <button type="button" disabled={disabled} onClick={() => addBand('low-shelf', 120)}>+ Shelf</button>
        <button type="button" disabled={disabled} onClick={() => addBand('low-cut', 35)}>+ Cut</button>
        <label>
          <span>Range</span>
          <select value={normalized.display.graphRangeDb} disabled={disabled} onChange={(event) => updatePath('eq.display.graphRangeDb', Number(event.currentTarget.value))}>
            <option value={3}>3 dB</option>
            <option value={6}>6 dB</option>
            <option value={12}>12 dB</option>
            <option value={30}>30 dB</option>
          </select>
        </label>
      </div>
    </>
  );
}
