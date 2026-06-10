// Export Panel - embedded panel for frame-by-frame video export

import { useCallback, useRef, useState } from 'react';
import './ExportPanel.css';
import { Logger } from '../../services/logger';
import { projectFileService } from '../../services/projectFileService';

const log = Logger.create('ExportPanel');
import { FrameExporter } from '../../engine/export';
import type { VideoCodec, ContainerFormat } from '../../engine/export';
import { useShallow } from 'zustand/react/shallow';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import {
  PRORES_PROFILES,
  DNXHR_PROFILES,
  getCodecsForContainer,
} from '../../engine/ffmpeg';
import { CodecSelector } from './CodecSelector';
import {
  GIF_COLOR_PRESETS,
  GIF_DITHER_OPTIONS,
  GIF_PALETTE_MODES,
  getGifDitherLabel,
  getGifPaletteModeLabel,
} from '../../engine/gif/gifOptions';
import type {
  FFmpegContainer,
  FFmpegVideoCodec,
  ProResProfile,
  DnxhrProfile,
} from '../../engine/ffmpeg';
import { resolveExportRange } from './exportRange';
import { useExportState, type EncoderType } from './useExportState';
import { ExportAdvancedSummarySections } from './ExportAdvancedSummarySections';
import { ExportProgressView } from './ExportProgressView';
import {
  buildExportSettingsState,
  formatExportTime,
  IMAGE_FORMATS,
  IMAGE_QUALITY_PRESETS,
} from './exportSettingsState';
import type { ExportSummaryTarget } from './exportSummaryState';
import { useExportRunController } from './useExportRunController';
import {
  useExportStore,
} from '../../stores/exportStore';

export function ExportPanel() {
  const summaryHighlightTimeoutsRef = useRef<Map<HTMLElement, number>>(new Map());
  const [setupStatus, setSetupStatus] = useState<string | null>(null);
  const { duration, inPoint, outPoint, playheadPosition, startExport, setExportProgress, endExport } = useTimelineStore(useShallow(s => ({
    duration: s.duration,
    inPoint: s.inPoint,
    outPoint: s.outPoint,
    playheadPosition: s.playheadPosition,
    startExport: s.startExport,
    setExportProgress: s.setExportProgress,
    endExport: s.endExport,
  })));
  const { getActiveComposition } = useMediaStore(useShallow(s => ({
    getActiveComposition: s.getActiveComposition,
  })));
  const composition = getActiveComposition();
  const {
    presets,
    selectedPresetId,
    setSelectedPresetId,
    savePreset,
    updatePreset,
    loadPreset,
  } = useExportStore(useShallow((state) => ({
    presets: state.presets,
    selectedPresetId: state.selectedPresetId,
    setSelectedPresetId: state.setSelectedPresetId,
    savePreset: state.savePreset,
    updatePreset: state.updatePreset,
    loadPreset: state.loadPreset,
  })));

  // All export state, effects, and simple handlers extracted to hook
  const exportState = useExportState(composition);
  const {
    encoder, setEncoder,
    width, height,
    customWidth, setCustomWidth, customHeight, setCustomHeight,
    useCustomResolution, setUseCustomResolution,
    fps, setFps, customFps, setCustomFps, useCustomFps, setUseCustomFps,
    useInOut, setUseInOut, filename, setFilename,
    bitrate, setBitrate, containerFormat, setContainerFormat,
    videoCodec, setVideoCodec, codecSupport, rateControl, setRateControl,
    ffmpegCodec, ffmpegContainer,
    proresProfile, setProresProfile, dnxhrProfile, setDnxhrProfile,
    ffmpegQuality, setFfmpegQuality, ffmpegBitrate, ffmpegRateControl,
    gifColors, setGifColors,
    gifDither, setGifDither,
    gifLoop, setGifLoop,
    gifPaletteMode, setGifPaletteMode,
    gifOptimize, setGifOptimize,
    gifAlphaThreshold, setGifAlphaThreshold,
    isFFmpegLoading, isFFmpegReady, ffmpegLoadError,
    stackedAlpha, setStackedAlpha,
    includeAudio, setIncludeAudio, audioOnlyFormat, setAudioOnlyFormat, audioSampleRate, setAudioSampleRate,
    audioBitrate, setAudioBitrate, normalizeAudio, setNormalizeAudio,
    videoEnabled, setVideoEnabled,
    visualMode, setVisualMode,
    imageFormat, setImageFormat,
    imageExportMode, setImageExportMode,
    imageQuality, setImageQuality,
    specialContainer, setSpecialContainer,
    isExporting, progress,
    ffmpegProgress, exportPhase,
    error,
    isSupported, isAudioSupported, audioCodec,
    isFFmpegSupported, isFFmpegMultiThreaded,
    handleResolutionChange, loadFFmpeg,
    handleFFmpegContainerChange, handleFFmpegCodecChange,
  } = exportState;

  // Compute actual start/end based on In/Out markers for display.
  const { startTime, endTime } = resolveExportRange({ duration, inPoint, outPoint }, useInOut);

  const formatTime = formatExportTime;
  const {
    actualWidth,
    actualHeight,
    actualFps,
    imageSequenceFrameCount,
    gifSizeRangeLabel,
    webCodecsAvailable,
    ffmpegAvailable,
    ffmpegCodecInfo,
    showFFmpegQualityControl,
    isWebCodecsEncoder,
    isXmlMode,
    isImageMode,
    isImageSequenceMode,
    imageSequenceFolderSupported,
    imageSequenceOutputLabel,
    isGifMode,
    isVideoMode,
    isAudioOnlyMode,
    currentContainerId,
    currentCodecLabel,
    methodMeta,
    selectedImageFormat,
    browserAudioExtension,
    browserAudioCodecLabel,
    browserAudioUnavailable,
    currentAudioCodecLabel,
    outputHeight,
    frameCount,
    displayOutputName,
    displayContainerLabel,
    estimatedSizeLabel,
    sizeStatLabel,
    webCodecsRateNote,
    exportDisabled,
    primaryExportLabel,
    usesBrowserProgress,
    summaryBadges,
    showRangeInVideo,
    showRangeInAudio,
    quickResolutionPresets,
    quickFrameRatePresets,
    videoContainerFormats,
    webQualityPresets,
    audioSampleRatePresets,
    audioBitratePresets,
    selectedPresetName,
  } = buildExportSettingsState({
    composition,
    presets,
    selectedPresetId,
    durationStartTime: startTime,
    durationEndTime: endTime,
    playheadPosition,
    encoder,
    width,
    height,
    customWidth,
    customHeight,
    useCustomResolution,
    fps,
    customFps,
    useCustomFps,
    filename,
    bitrate,
    containerFormat,
    videoCodec,
    rateControl,
    ffmpegCodec,
    ffmpegContainer,
    ffmpegQuality,
    ffmpegBitrate,
    ffmpegRateControl,
    gifColors,
    gifDither,
    gifLoop,
    gifPaletteMode,
    gifOptimize,
    gifAlphaThreshold,
    stackedAlpha,
    includeAudio,
    audioOnlyFormat,
    audioSampleRate,
    audioBitrate,
    normalizeAudio,
    audioCodec,
    isAudioSupported,
    isSupported,
    isFFmpegSupported,
    isFFmpegLoading,
    isFFmpegMultiThreaded,
    videoEnabled,
    visualMode,
    imageFormat,
    imageExportMode,
    imageQuality,
    specialContainer,
    isExporting,
  });
  const { handleCancel, handlePrimaryExport } = useExportRunController({
    exportState,
    playheadPosition,
    startExport,
    setExportProgress,
    endExport,
    getActiveComposition,
    selectedImageFormat,
    isXmlMode,
    isImageMode,
    isImageSequenceMode,
    isGifMode,
    isWebCodecsEncoder,
  });

  const handleQuickResolutionPreset = useCallback((value: string) => {
    setUseCustomResolution(false);
    handleResolutionChange(value);
  }, [handleResolutionChange, setUseCustomResolution]);

  const handleQuickFpsPreset = useCallback((value: number) => {
    setUseCustomFps(false);
    setFps(value);
  }, [setFps, setUseCustomFps]);

  const handleQuickBitratePreset = useCallback((value: number) => {
    setRateControl('vbr');
    setBitrate(value);
  }, [setBitrate, setRateControl]);

  const saveCurrentSetup = useCallback(() => {
    try {
      const suggestedName = selectedPresetName || filename || 'Export Preset';
      const nextName = window.prompt('Preset name', suggestedName);
      if (nextName === null) {
        return;
      }

      const result = savePreset(nextName);
      if (!result) {
        setSetupStatus('Preset name required');
        return;
      }

      const suffix = projectFileService.isProjectOpen() ? '' : ' (session only)';
      setSetupStatus(result.overwritten ? `Preset updated${suffix}` : `Preset saved${suffix}`);
    } catch (error) {
      log.error('Failed to save export setup', error);
      setSetupStatus('Preset save failed');
    }
  }, [filename, savePreset, selectedPresetName]);

  const updateCurrentSetup = useCallback(() => {
    try {
      if (!selectedPresetId) {
        setSetupStatus(presets.length > 0 ? 'Select a preset' : 'No presets saved');
        return;
      }

      const updatedPreset = updatePreset(selectedPresetId);
      if (!updatedPreset) {
        setSetupStatus('Preset not found');
        return;
      }

      const suffix = projectFileService.isProjectOpen() ? '' : ' (session only)';
      setSetupStatus(`Preset updated${suffix}`);
    } catch (error) {
      log.error('Failed to update export setup', error);
      setSetupStatus('Preset update failed');
    }
  }, [presets.length, selectedPresetId, updatePreset]);

  const loadSavedSetup = useCallback(() => {
    try {
      if (!selectedPresetId) {
        setSetupStatus(presets.length > 0 ? 'Select a preset' : 'No presets saved');
        return;
      }

      const loaded = loadPreset(selectedPresetId);
      setSetupStatus(loaded ? 'Preset loaded' : 'Preset not found');
    } catch (error) {
      log.error('Failed to load export setup', error);
      setSetupStatus('Preset load failed');
    }
  }, [loadPreset, presets.length, selectedPresetId]);

  const scrollToSummaryTarget = useCallback((target: ExportSummaryTarget) => {
    if (typeof document === 'undefined') {
      return;
    }

    const node = document.querySelector<HTMLElement>(`[data-export-target="${target}"]`);
    if (!node) {
      return;
    }

    node.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });

    const existingTimeout = summaryHighlightTimeoutsRef.current.get(node);
    if (existingTimeout) {
      window.clearTimeout(existingTimeout);
    }

    node.classList.remove('export-scroll-highlight');
    void node.offsetHeight;
    node.classList.add('export-scroll-highlight');

    const timeout = window.setTimeout(() => {
      node.classList.remove('export-scroll-highlight');
      summaryHighlightTimeoutsRef.current.delete(node);
    }, 1200);

    summaryHighlightTimeoutsRef.current.set(node, timeout);
  }, []);

  // If neither encoder is supported, show error
  if (!webCodecsAvailable && !ffmpegAvailable) {
    return (
      <div className="export-panel">
        <div className="panel-header">
          <h3>Export</h3>
        </div>
        <div className="export-error">
          No video encoder available. WebCodecs requires Chrome 94+ or Safari 16.4+.
          FFmpeg WASM requires WebAssembly support.
        </div>
      </div>
    );
  }

  return (
    <div className="export-panel">
      {!isExporting ? (
        <div className="export-form">
          <section className="export-hero-card export-summary-sticky export-summary-badges">
            <div className="export-summary-actions">
              <div className="export-pill-row">
                {summaryBadges.map((badge) => (
                  <button
                    key={`${badge.target}-${badge.label}`}
                    type="button"
                    className={`export-pill${badge.warning ? ' export-pill-warning' : ''}`}
                    onClick={() => scrollToSummaryTarget(badge.target)}
                  >
                    {badge.label}
                  </button>
                ))}
              </div>
              <button
                className="btn export-start-btn export-summary-cta"
                onClick={handlePrimaryExport}
                disabled={exportDisabled}
              >
                {primaryExportLabel}
              </button>
            </div>
          </section>

          <div className="export-section export-command-row" data-export-target="command-bar">
            <div className="export-command-bar">
              <div className="export-command-actions">
                <div className="export-preset-picker">
                  <select
                    id="export-preset-select"
                    aria-label="Export preset"
                    value={selectedPresetId ?? ''}
                    onChange={(e) => setSelectedPresetId(e.target.value || null)}
                  >
                    <option value="">Project presets</option>
                    {presets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="button" className="export-chip" onClick={loadSavedSetup} disabled={!selectedPresetId}>
                  Load
                </button>
                <button type="button" className="export-chip" onClick={updateCurrentSetup} disabled={!selectedPresetId}>
                  Update
                </button>
                <button type="button" className="export-chip" onClick={saveCurrentSetup}>
                  Save
                </button>
              </div>
            </div>

            {setupStatus && (
              <div className="export-inline-note">
                {setupStatus}
              </div>
            )}
          </div>

          {/* Encoder Selection */}
          <div className="export-section export-workflow-section">
            <div className="export-section-header">Workflow</div>
            <div className="export-method-grid">
              {webCodecsAvailable && (
                <button
                  type="button"
                  className={`export-method-card${encoder === 'webcodecs' ? ' is-active' : ''}`}
                  onClick={() => setEncoder('webcodecs')}
                >
                  <span className="export-method-chip">Fast</span>
                  <strong>WebCodecs</strong>
                  <span>Hardware-assisted browser export for quick delivery files.</span>
                </button>
              )}
              {webCodecsAvailable && (
                <button
                  type="button"
                  className={`export-method-card${encoder === 'htmlvideo' ? ' is-active' : ''}`}
                  onClick={() => setEncoder('htmlvideo')}
                >
                  <span className="export-method-chip">Precise</span>
                  <strong>HTMLVideo</strong>
                  <span>Explicit HTMLVideo seeking when accuracy matters more than speed.</span>
                </button>
              )}
              {ffmpegAvailable && (
                <button
                  type="button"
                  className={`export-method-card${encoder === 'ffmpeg' ? ' is-active' : ''}`}
                  onClick={() => setEncoder('ffmpeg')}
                >
                  <span className="export-method-chip">CPU</span>
                  <strong>FFmpeg</strong>
                  <span>Intermediates, archival codecs, and NLE-friendly containers.</span>
                </button>
              )}
            </div>
            <div className="control-row export-legacy-control">
              <label>Method</label>
              <select
                value={encoder}
                onChange={(e) => setEncoder(e.target.value as EncoderType)}
              >
                {webCodecsAvailable && (
                  <option value="webcodecs">⚡ WebCodecs (Fast)</option>
                )}
                {webCodecsAvailable && (
                  <option value="htmlvideo">🎯 HTMLVideo (Precise)</option>
                )}
                {ffmpegAvailable && (
                  <option value="ffmpeg">
                    FFmpeg (CPU){!isFFmpegMultiThreaded ? ' - ST' : ''}
                  </option>
                )}
              </select>
            </div>

            {/* FFmpeg Load Button / Status */}
            {encoder === 'ffmpeg' && (
              <div className="export-status-row">
                {!isFFmpegReady ? (
                  <button
                    type="button"
                    onClick={loadFFmpeg}
                    disabled={isFFmpegLoading}
                    className="btn-small export-status-button"
                  >
                    {isFFmpegLoading ? 'Loading FFmpeg...' : 'Load FFmpeg Runtime'}
                  </button>
                ) : (
                  <span className="export-status-ok">
                    FFmpeg Ready
                  </span>
                )}
              </div>
            )}

            {ffmpegLoadError && encoder === 'ffmpeg' && (
              <div className="export-error export-error-inline">
                {ffmpegLoadError}
              </div>
            )}
          </div>

          <div className="export-section export-basics-section">
            <div className="export-section-header">Basics</div>

            <div className="export-channel-grid">
              <div className="export-channel-card export-basic-card">
                <div className="export-channel-head">
                  <div className="export-channel-title">
                    <span>Basic</span>
                    <strong>{displayContainerLabel}</strong>
                  </div>
                </div>

                <div className="export-field-card export-subcard" data-export-target="basic-output">
                  <div className="export-field-head">
                    <span>Output</span>
                    <strong>{displayOutputName}</strong>
                  </div>
                  <div className="control-row">
                    <label>Name</label>
                    <div className="export-input-group">
                      <input
                        type="text"
                        value={filename}
                        onChange={(e) => setFilename(e.target.value)}
                        placeholder="export"
                      />
                    </div>
                  </div>
                </div>

                <div className="export-field-card export-subcard" data-export-target="basic-container">
                  <div className="export-field-head">
                    <span>Container</span>
                    <strong>{displayContainerLabel}</strong>
                  </div>
                  <div className="export-container-groups">
                    <div className="export-container-group">
                      <span className="export-container-group-label">Video</span>
                      <div className="export-chip-row">
                        {videoContainerFormats.map((format) => (
                          <button
                            key={`video-${format.id}`}
                            type="button"
                            className={`export-chip${!isXmlMode && isVideoMode && currentContainerId === format.id ? ' is-active' : ''}`}
                            onClick={() => {
                              setSpecialContainer('none');
                              setVideoEnabled(true);
                              if (format.id === 'gif') {
                                setVisualMode('gif');
                                setIncludeAudio(false);
                                if (encoder === 'ffmpeg') {
                                  handleFFmpegContainerChange('gif');
                                }
                                return;
                              }
                              setVisualMode('video');
                              if (isWebCodecsEncoder) {
                                setContainerFormat(format.id as ContainerFormat);
                              } else {
                                handleFFmpegContainerChange(format.id as FFmpegContainer);
                              }
                            }}
                          >
                            .{format.id}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="export-container-group">
                      <span className="export-container-group-label">Image</span>
                      <div className="export-chip-row">
                        {IMAGE_FORMATS.map((format) => (
                          <button
                            key={`image-${format.id}`}
                            type="button"
                            className={`export-chip${!isXmlMode && isImageMode && imageFormat === format.id ? ' is-active' : ''}`}
                            onClick={() => {
                              setSpecialContainer('none');
                              setVideoEnabled(true);
                              setVisualMode('image');
                              setImageFormat(format.id);
                            }}
                          >
                            .{format.id}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="export-container-group">
                      <span className="export-container-group-label">Audio</span>
                      <div className="export-chip-row">
                        <button
                          type="button"
                          className={`export-chip${!isXmlMode && isAudioOnlyMode && audioOnlyFormat === 'wav' ? ' is-active' : ''}`}
                          onClick={() => {
                            setSpecialContainer('none');
                            setVideoEnabled(false);
                            setIncludeAudio(true);
                            setAudioOnlyFormat('wav');
                          }}
                        >
                          .wav
                        </button>
                        <button
                          type="button"
                          className={`export-chip${!isXmlMode && isAudioOnlyMode && audioOnlyFormat === 'browser' ? ' is-active' : ''}`}
                          onClick={() => {
                            setSpecialContainer('none');
                            setVideoEnabled(false);
                            setIncludeAudio(true);
                            setAudioOnlyFormat('browser');
                          }}
                          disabled={!isAudioSupported}
                        >
                          .{browserAudioExtension}
                        </button>
                      </div>
                    </div>

                    <div className="export-container-group">
                      <span className="export-container-group-label">XML</span>
                      <div className="export-chip-row">
                        <button
                          type="button"
                          className={`export-chip${isXmlMode ? ' is-active' : ''}`}
                          onClick={() => {
                            setSpecialContainer('xml');
                            setVideoEnabled(true);
                          }}
                        >
                          .fcpxml
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {isVideoMode ? (
                  <div className="export-field-card export-subcard" data-export-target="basic-workflow">
                    <div className="export-field-head">
                      <span>Workflow</span>
                      <strong>{methodMeta.title}</strong>
                    </div>
                    <div className="export-chip-row">
                      {webCodecsAvailable && (
                        <button
                          type="button"
                          className={`export-chip${encoder === 'webcodecs' ? ' is-active' : ''}`}
                          onClick={() => setEncoder('webcodecs')}
                        >
                          WebCodecs
                        </button>
                      )}
                      {webCodecsAvailable && (
                        <button
                          type="button"
                          className={`export-chip${encoder === 'htmlvideo' ? ' is-active' : ''}`}
                          onClick={() => setEncoder('htmlvideo')}
                        >
                          HTMLVideo
                        </button>
                      )}
                      {ffmpegAvailable && (
                        <button
                          type="button"
                          className={`export-chip${encoder === 'ffmpeg' ? ' is-active' : ''}`}
                          onClick={() => setEncoder('ffmpeg')}
                        >
                          FFmpeg
                        </button>
                      )}
                    </div>

                    {encoder === 'ffmpeg' && (
                      <div className="export-status-row">
                        {!isFFmpegReady ? (
                          <button
                            type="button"
                            onClick={loadFFmpeg}
                            disabled={isFFmpegLoading}
                            className="btn-small export-status-button"
                          >
                            {isFFmpegLoading ? 'Loading FFmpeg...' : 'Load FFmpeg Runtime'}
                          </button>
                        ) : (
                          <span className="export-status-ok">
                            FFmpeg Ready
                          </span>
                        )}
                      </div>
                    )}

                    {ffmpegLoadError && encoder === 'ffmpeg' && (
                      <div className="export-error export-error-inline">
                        {ffmpegLoadError}
                      </div>
                    )}
                  </div>
                ) : isXmlMode ? (
                  <div className="export-inline-note">
                    XML export writes a Final Cut Pro interchange file from the current timeline instead of rendering media.
                  </div>
                ) : isImageMode ? (
                  <div className="export-inline-note">
                    {isImageSequenceMode
                      ? imageSequenceFolderSupported
                        ? 'Image sequence export writes numbered frames into a selected folder.'
                        : 'Image sequence export uses a ZIP fallback because folder writes are not available in this browser.'
                      : 'Image export renders exactly one frame at the current playhead position.'}
                  </div>
                ) : isAudioOnlyMode ? (
                  <div className="export-inline-note">
                    Audio-only export writes the selected audio file format.
                  </div>
                ) : null}
              </div>

              <div className={`export-channel-card${!isXmlMode && videoEnabled ? '' : ' is-disabled'}`} data-export-target={isImageMode ? 'image-section' : 'video-section'}>
                <div className="export-channel-head">
                  <div className="export-channel-title">
                    <span>{isXmlMode ? 'XML' : isImageMode ? 'Image' : 'Video'}</span>
                    <strong>{isXmlMode ? 'Timeline interchange' : videoEnabled ? `${actualWidth}x${outputHeight}` : 'Disabled'}</strong>
                  </div>
                  {isXmlMode ? (
                    <span className="export-chip export-chip-static">FCPXML</span>
                  ) : (
                    <button
                      type="button"
                      className={`export-toggle${videoEnabled ? ' is-active' : ''}`}
                      onClick={() => {
                        if (videoEnabled) {
                          setVideoEnabled(false);
                          return;
                        }
                        setSpecialContainer('none');
                        setVideoEnabled(true);
                        setVisualMode('video');
                      }}
                    >
                      {videoEnabled ? 'On' : 'Off'}
                    </button>
                  )}
                </div>

                {isXmlMode ? (
                  <div className="export-inline-note">
                    XML export uses the current timeline structure and clip references. Render-specific video settings do not apply here.
                  </div>
                ) : isImageMode ? (
                  <>
                    <div className="export-quick-grid export-quick-grid-stack">
                      <div className="export-field-card export-subcard" data-export-target="image-mode">
                        <div className="export-field-head">
                          <span>Mode</span>
                          <strong>{isImageSequenceMode ? `Sequence ${imageSequenceOutputLabel}` : 'Single frame'}</strong>
                        </div>
                        <div className="export-chip-row">
                          <button
                            type="button"
                            className={`export-chip${imageExportMode === 'frame' ? ' is-active' : ''}`}
                            onClick={() => setImageExportMode('frame')}
                          >
                            Frame
                          </button>
                          <button
                            type="button"
                            className={`export-chip${imageExportMode === 'sequence' ? ' is-active' : ''}`}
                            onClick={() => setImageExportMode('sequence')}
                          >
                            Sequence
                          </button>
                        </div>
                      </div>

                      <div className="export-field-card export-subcard" data-export-target="image-resolution">
                        <div className="export-field-head">
                          <span>Resolution</span>
                          <strong>{actualWidth}x{actualHeight}</strong>
                        </div>
                        <div className="export-chip-row">
                          {quickResolutionPresets.map(({ label, width: presetWidth, height: presetHeight }) => (
                            <button
                              key={`${presetWidth}x${presetHeight}`}
                              type="button"
                              className={`export-chip${!useCustomResolution && width === presetWidth && height === presetHeight ? ' is-active' : ''}`}
                              onClick={() => handleQuickResolutionPreset(`${presetWidth}x${presetHeight}`)}
                            >
                              {label.split(' ')[0]}
                            </button>
                          ))}
                          <button
                            type="button"
                            className={`export-chip${useCustomResolution ? ' is-active' : ''}`}
                            onClick={() => setUseCustomResolution(true)}
                          >
                            Custom
                          </button>
                        </div>
                        {useCustomResolution && (
                          <div className="export-inline-inputs">
                            <input
                              type="number"
                              value={customWidth}
                              onChange={(e) => setCustomWidth(Math.max(1, parseInt(e.target.value) || 1920))}
                              placeholder="Width"
                              min="1"
                              max="7680"
                            />
                            <span>x</span>
                            <input
                              type="number"
                              value={customHeight}
                              onChange={(e) => setCustomHeight(Math.max(1, parseInt(e.target.value) || 1080))}
                              placeholder="Height"
                              min="1"
                              max="4320"
                            />
                          </div>
                        )}
                      </div>

                      <div className="export-field-card export-subcard" data-export-target="image-quality">
                        <div className="export-field-head">
                          <span>Quality</span>
                          <strong>{selectedImageFormat.lossless ? 'Lossless' : `${Math.round(imageQuality * 100)}%`}</strong>
                        </div>
                        <div className="export-chip-row">
                          <span className="export-chip export-chip-static">
                            {selectedImageFormat.supportsAlpha ? 'Alpha kept' : 'Opaque'}
                          </span>
                          {!selectedImageFormat.lossless && IMAGE_QUALITY_PRESETS.map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              className={`export-chip${Math.abs(imageQuality - preset.value) < 0.001 ? ' is-active' : ''}`}
                              onClick={() => setImageQuality(preset.value)}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                        {!selectedImageFormat.lossless && (
                          <div className="export-slider-control">
                            <div className="export-slider-head">
                              <label>Fine Tune</label>
                              <span className="export-slider-value">{Math.round(imageQuality * 100)}%</span>
                            </div>
                            <input
                              className="export-slider-input"
                              type="range"
                              min={0.4}
                              max={1}
                              step={0.01}
                              value={imageQuality}
                              onChange={(e) => setImageQuality(Number(e.target.value))}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    {isImageSequenceMode ? (
                      <>
                        <div className="export-field-card export-subcard" data-export-target="image-fps">
                          <div className="export-field-head">
                            <span>Frame Rate</span>
                            <strong>{actualFps} fps</strong>
                          </div>
                          <div className="export-chip-row">
                            {[24, 25, 30, 60].map((presetFps) => (
                              <button
                                key={`image-sequence-fps-${presetFps}`}
                                type="button"
                                className={`export-chip${!useCustomFps && fps === presetFps ? ' is-active' : ''}`}
                                onClick={() => {
                                  setUseCustomFps(false);
                                  setFps(presetFps);
                                }}
                              >
                                {presetFps}
                              </button>
                            ))}
                            <button
                              type="button"
                              className={`export-chip${useCustomFps ? ' is-active' : ''}`}
                              onClick={() => setUseCustomFps(true)}
                            >
                              Custom
                            </button>
                          </div>
                          {useCustomFps && (
                            <div className="export-inline-inputs">
                              <input
                                type="number"
                                value={customFps}
                                onChange={(e) => setCustomFps(Math.max(1, Math.min(240, parseFloat(e.target.value) || 30)))}
                                min={1}
                                max={240}
                                step={0.001}
                              />
                              <span>fps</span>
                            </div>
                          )}
                        </div>

                        <div className="export-field-card export-subcard" data-export-target="image-range">
                          <div className="export-field-head">
                            <span>Sequence</span>
                            <strong>{imageSequenceFrameCount} frames</strong>
                          </div>
                          <div className="export-chip-row">
                            <button
                              type="button"
                              className={`export-chip${useInOut ? ' is-active' : ''}`}
                              onClick={() => setUseInOut(!useInOut)}
                            >
                              Use In/Out
                            </button>
                            <span className="export-chip export-chip-static">{imageSequenceOutputLabel}</span>
                          </div>
                          <div className="export-inline-note">
                            Range {formatTime(startTime)} - {formatTime(endTime)} saved as numbered .{imageFormat} files.
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="export-field-card export-subcard">
                        <div className="export-field-head">
                          <span>Frame</span>
                          <strong>{formatTime(playheadPosition)}</strong>
                        </div>
                        <div className="export-inline-note">
                          Exports the exact composited frame currently under the playhead.
                        </div>
                      </div>
                    )}
                  </>
                ) : videoEnabled ? (
                  <>
                    <div className="export-quick-grid">
                      <div className="export-field-card export-subcard" data-export-target="video-resolution">
                        <div className="export-field-head">
                          <span>Resolution</span>
                          <strong>{actualWidth}x{actualHeight}</strong>
                        </div>
                        <div className="export-chip-row">
                          {quickResolutionPresets.map(({ label, width: presetWidth, height: presetHeight }) => (
                            <button
                              key={`${presetWidth}x${presetHeight}`}
                              type="button"
                              className={`export-chip${!useCustomResolution && width === presetWidth && height === presetHeight ? ' is-active' : ''}`}
                              onClick={() => handleQuickResolutionPreset(`${presetWidth}x${presetHeight}`)}
                            >
                              {label.split(' ')[0]}
                            </button>
                          ))}
                          <button
                            type="button"
                            className={`export-chip${useCustomResolution ? ' is-active' : ''}`}
                            onClick={() => setUseCustomResolution(true)}
                          >
                            Custom
                          </button>
                        </div>
                        {useCustomResolution && (
                          <div className="export-inline-inputs">
                            <input
                              type="number"
                              value={customWidth}
                              onChange={(e) => setCustomWidth(Math.max(1, parseInt(e.target.value) || 1920))}
                              placeholder="Width"
                              min="1"
                              max="7680"
                            />
                            <span>x</span>
                            <input
                              type="number"
                              value={customHeight}
                              onChange={(e) => setCustomHeight(Math.max(1, parseInt(e.target.value) || 1080))}
                              placeholder="Height"
                              min="1"
                              max="4320"
                            />
                          </div>
                        )}
                      </div>

                      <div className="export-field-card export-subcard" data-export-target="video-fps">
                        <div className="export-field-head">
                          <span>Frame Rate</span>
                          <strong>{actualFps} fps</strong>
                        </div>
                        <div className="export-chip-row">
                          {quickFrameRatePresets.map((presetFps) => (
                            <button
                              key={presetFps}
                              type="button"
                              className={`export-chip${!useCustomFps && fps === presetFps ? ' is-active' : ''}`}
                              onClick={() => handleQuickFpsPreset(presetFps)}
                            >
                              {presetFps} fps
                            </button>
                          ))}
                          <button
                            type="button"
                            className={`export-chip${useCustomFps ? ' is-active' : ''}`}
                            onClick={() => setUseCustomFps(true)}
                          >
                            Custom
                          </button>
                        </div>
                        {useCustomFps && (
                          <div className="export-inline-inputs export-inline-inputs-single">
                            <input
                              type="number"
                              value={customFps}
                              onChange={(e) => setCustomFps(Math.max(1, Math.min(240, parseFloat(e.target.value) || 30)))}
                              min={1}
                              max={240}
                              step={0.001}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    {(isGifMode || isWebCodecsEncoder || showFFmpegQualityControl) && (
                    <div className="export-field-card export-subcard" data-export-target={isGifMode ? 'gif-palette' : 'video-rate'}>
                      <div className="export-field-head">
                        <span>{isGifMode ? 'Palette' : isWebCodecsEncoder ? 'Rate' : 'Quality'}</span>
                        <strong>
                          {isGifMode
                            ? `${gifColors} colors / ${getGifPaletteModeLabel(gifPaletteMode)}`
                            : isWebCodecsEncoder
                            ? `${rateControl.toUpperCase()} / ${(bitrate / 1_000_000).toFixed(1)} Mbps`
                            : `MJPEG / Q${ffmpegQuality}`}
                        </strong>
                      </div>
                      {isGifMode ? (
                        <>
                          <div className="export-chip-row">
                            {GIF_COLOR_PRESETS.map((value) => (
                              <button
                                key={value}
                                type="button"
                                className={`export-chip${gifColors === value ? ' is-active' : ''}`}
                                onClick={() => setGifColors(value)}
                              >
                                {value}
                              </button>
                            ))}
                          </div>
                          <div className="export-chip-row">
                            {GIF_PALETTE_MODES.map((mode) => (
                              <button
                                key={mode.id}
                                type="button"
                                className={`export-chip${gifPaletteMode === mode.id ? ' is-active' : ''}`}
                                onClick={() => setGifPaletteMode(mode.id)}
                              >
                                {mode.label}
                              </button>
                            ))}
                          </div>
                          <div className="export-chip-row">
                            {GIF_DITHER_OPTIONS.map((dither) => (
                              <button
                                key={dither.id}
                                type="button"
                                className={`export-chip${gifDither === dither.id ? ' is-active' : ''}`}
                                onClick={() => setGifDither(dither.id)}
                                disabled={isWebCodecsEncoder}
                              >
                                {dither.label}
                              </button>
                            ))}
                          </div>
                          <div className="export-chip-row">
                            <button
                              type="button"
                              className={`export-toggle${gifLoop === 'forever' ? ' is-active' : ''}`}
                              onClick={() => setGifLoop(gifLoop === 'forever' ? 'once' : 'forever')}
                            >
                              {gifLoop === 'forever' ? 'Loop Forever' : 'Play Once'}
                            </button>
                            <button
                              type="button"
                              className={`export-toggle${gifOptimize ? ' is-active' : ''}`}
                              onClick={() => setGifOptimize(!gifOptimize)}
                              disabled={isWebCodecsEncoder}
                            >
                              Optimize
                            </button>
                          </div>
                          <div className="export-slider-control">
                            <div className="export-slider-head">
                              <label>Alpha Threshold</label>
                              <span className="export-slider-value">{gifAlphaThreshold}</span>
                            </div>
                            <input
                              className="export-slider-input"
                              type="range"
                              min={0}
                              max={255}
                              step={1}
                              value={gifAlphaThreshold}
                              onChange={(e) => setGifAlphaThreshold(Number(e.target.value))}
                            />
                          </div>
                          <div className="export-inline-note">
                            Estimated range: {gifSizeRangeLabel}. {isWebCodecsEncoder ? 'Browser GIF uses fast quantization without dithering.' : `Dither: ${getGifDitherLabel(gifDither)}.`}
                          </div>
                        </>
                      ) : isWebCodecsEncoder ? (
                        <>
                          <div className="export-chip-row">
                            <button
                              type="button"
                              className={`export-chip${rateControl === 'vbr' ? ' is-active' : ''}`}
                              onClick={() => setRateControl('vbr')}
                            >
                              VBR
                            </button>
                            <button
                              type="button"
                              className={`export-chip${rateControl === 'cbr' ? ' is-active' : ''}`}
                              onClick={() => setRateControl('cbr')}
                            >
                              CBR
                            </button>
                          </div>
                          <div className="export-chip-row">
                            {webQualityPresets.map((preset) => (
                              <button
                                key={preset.id}
                                type="button"
                                className={`export-chip${bitrate === preset.value ? ' is-active' : ''}`}
                                onClick={() => handleQuickBitratePreset(preset.value)}
                              >
                                {preset.detail}
                              </button>
                            ))}
                          </div>
                          <div className="export-slider-control">
                            <div className="export-slider-head">
                              <label>Fine Tune</label>
                              <span className="export-slider-value">{(bitrate / 1_000_000).toFixed(1)} Mbps</span>
                            </div>
                            <input
                              className="export-slider-input"
                              type="range"
                              min={1_000_000}
                              max={100_000_000}
                              step={500_000}
                              value={bitrate}
                              onChange={(e) => setBitrate(Number(e.target.value))}
                            />
                          </div>
                          <div className="export-inline-note">
                            {webCodecsRateNote}
                          </div>
                        </>
                      ) : (
                        <div className="export-slider-control">
                          <div className="export-slider-head">
                            <label>MJPEG</label>
                            <span className="export-slider-value">
                              {ffmpegQuality} {ffmpegQuality <= 5 ? '(High)' : ffmpegQuality <= 10 ? '(Good)' : ffmpegQuality <= 20 ? '(Med)' : '(Low)'}
                            </span>
                          </div>
                          <input
                            className="export-slider-input"
                            type="range"
                            min={1}
                            max={31}
                            value={ffmpegQuality}
                            onChange={(e) => setFfmpegQuality(parseInt(e.target.value))}
                          />
                        </div>
                      )}
                    </div>
                    )}

                    <div className="export-field-card export-subcard" data-export-target="video-codec">
                      <div className="export-field-head">
                        <span>Codec</span>
                        <strong>{currentCodecLabel}</strong>
                      </div>
                      <div className="export-chip-row">
                        {isGifMode ? (
                          <span className="export-chip export-chip-static">
                            {encoder === 'ffmpeg' ? 'FFmpeg palette' : 'Browser encoder'}
                          </span>
                        ) : isWebCodecsEncoder
                          ? FrameExporter.getVideoCodecs(containerFormat).map(({ id, label }) => (
                              <button
                                key={id}
                                type="button"
                                className={`export-chip${videoCodec === id ? ' is-active' : ''}`}
                                onClick={() => setVideoCodec(id as VideoCodec)}
                                disabled={!codecSupport[id]}
                              >
                                {label}
                              </button>
                            ))
                          : getCodecsForContainer(ffmpegContainer).map((codec) => (
                              <button
                                key={codec.id}
                                type="button"
                                className={`export-chip${ffmpegCodec === codec.id ? ' is-active' : ''}`}
                                onClick={() => handleFFmpegCodecChange(codec.id as FFmpegVideoCodec)}
                              >
                                {codec.name}
                              </button>
                            ))}
                      </div>

                      {(encoder === 'ffmpeg' || isGifMode) && ffmpegCodecInfo && (
                        <div className="export-inline-note">
                          {ffmpegCodecInfo.description}
                          {ffmpegCodecInfo.supportsAlpha && ' | Alpha'}
                          {ffmpegCodecInfo.supports10bit && ' | 10-bit'}
                        </div>
                      )}

                      {encoder === 'ffmpeg' && !isGifMode && ffmpegCodec === 'prores' && (
                        <div className="export-chip-row">
                          {PRORES_PROFILES.map((profile) => (
                            <button
                              key={profile.id}
                              type="button"
                              className={`export-chip${proresProfile === profile.id ? ' is-active' : ''}`}
                              onClick={() => setProresProfile(profile.id as ProResProfile)}
                            >
                              {profile.name}
                            </button>
                          ))}
                        </div>
                      )}

                      {encoder === 'ffmpeg' && !isGifMode && ffmpegCodec === 'dnxhd' && (
                        <div className="export-chip-row">
                          {DNXHR_PROFILES.map((profile) => (
                            <button
                              key={profile.id}
                              type="button"
                              className={`export-chip${dnxhrProfile === profile.id ? ' is-active' : ''}`}
                              onClick={() => setDnxhrProfile(profile.id as DnxhrProfile)}
                            >
                              {profile.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="export-field-card export-subcard" data-export-target="video-alpha">
                      <div className="export-field-head">
                        <span>{isGifMode ? 'Transparency' : 'Alpha'}</span>
                        <strong>{isGifMode ? `Threshold ${gifAlphaThreshold}` : stackedAlpha ? 'Stacked' : 'Off'}</strong>
                      </div>
                      <div className="export-chip-row">
                        <button
                          type="button"
                          className={`export-toggle${stackedAlpha ? ' is-active' : ''}`}
                          onClick={() => setStackedAlpha(!stackedAlpha)}
                          disabled={!isWebCodecsEncoder || isGifMode}
                        >
                          Stacked Alpha
                        </button>
                        {showRangeInVideo && (
                          <button
                            type="button"
                            className={`export-toggle${useInOut ? ' is-active' : ''}`}
                            onClick={() => setUseInOut(!useInOut)}
                          >
                            Use In/Out
                          </button>
                        )}
                      </div>
                      {stackedAlpha && !isGifMode && (
                        <div className="export-inline-note export-inline-note-warning">
                          Output becomes {actualWidth}x{actualHeight * 2}. Top half is RGB, bottom half is alpha as grayscale.
                        </div>
                      )}
                      {showRangeInVideo && (
                        <div className="export-stats-grid export-stats-grid-compact">
                          <div className="export-stat-card">
                            <span>Output</span>
                            <strong>{actualWidth}x{outputHeight}</strong>
                          </div>
                          <div className="export-stat-card">
                            <span>Frames</span>
                            <strong>{frameCount}</strong>
                          </div>
                          <div className="export-stat-card">
                            <span>{sizeStatLabel}</span>
                            <strong>{estimatedSizeLabel}</strong>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="export-inline-note">
                    Visual export is disabled. Switch to Video or Image, or use Audio-only export.
                  </div>
                )}
              </div>

              <div className={`export-channel-card${isImageMode || isGifMode || (!includeAudio && !isXmlMode) ? ' is-disabled' : ''}`} data-export-target="audio-section">
                <div className="export-channel-head">
                  <div className="export-channel-title">
                    <span>Audio</span>
                    <strong>{isGifMode ? 'Not supported' : isXmlMode ? (includeAudio ? 'Track references included' : 'No audio references') : !isImageMode && includeAudio ? `${currentAudioCodecLabel} / ${audioSampleRate / 1000} kHz` : 'Disabled'}</strong>
                  </div>
                  <button
                    type="button"
                    className={`export-toggle${!isGifMode && (isXmlMode ? includeAudio : !isImageMode && includeAudio) ? ' is-active' : ''}`}
                    onClick={() => setIncludeAudio(!includeAudio)}
                    disabled={isImageMode || isGifMode || (!isXmlMode && browserAudioUnavailable)}
                  >
                    {!isGifMode && (isXmlMode ? includeAudio : !isImageMode && includeAudio) ? 'On' : 'Off'}
                  </button>
                </div>

                {isImageMode ? (
                  <div className="export-inline-note">
                    Image export ignores audio and renders only the current playhead frame.
                  </div>
                ) : isGifMode ? (
                  <div className="export-inline-note">
                    GIF export is silent.
                  </div>
                ) : isXmlMode ? (
                  <div className="export-inline-note">
                    XML export can include or omit audio track references, but it does not encode audio files.
                  </div>
                ) : includeAudio ? (
                  <>
                    <div className="export-field-card export-subcard" data-export-target="audio-format">
                      <div className="export-field-head">
                        <span>Format</span>
                        <strong>{currentAudioCodecLabel}</strong>
                      </div>
                      <div className="export-chip-row">
                        {isAudioOnlyMode ? (
                          <>
                            <button
                              type="button"
                              className={`export-chip${audioOnlyFormat === 'wav' ? ' is-active' : ''}`}
                              onClick={() => setAudioOnlyFormat('wav')}
                            >
                              WAV PCM
                            </button>
                            <button
                              type="button"
                              className={`export-chip${audioOnlyFormat === 'browser' ? ' is-active' : ''}`}
                              onClick={() => setAudioOnlyFormat('browser')}
                              disabled={!isAudioSupported}
                            >
                              {browserAudioCodecLabel}
                            </button>
                          </>
                        ) : (
                          <span className="export-chip export-chip-static">
                            {currentAudioCodecLabel}{videoEnabled && encoder === 'ffmpeg' ? ' auto' : ''}
                          </span>
                        )}
                        {audioSampleRatePresets.map((preset) => (
                          <button
                            key={preset.value}
                            type="button"
                            className={`export-chip${audioSampleRate === preset.value ? ' is-active' : ''}`}
                            onClick={() => setAudioSampleRate(preset.value)}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="export-field-card export-subcard" data-export-target="audio-quality">
                      <div className="export-field-head">
                        <span>Quality</span>
                        <strong>{isAudioOnlyMode && audioOnlyFormat === 'wav' ? '16-bit PCM' : `${Math.round(audioBitrate / 1000)} kbps`}</strong>
                      </div>
                      <div className="export-chip-row">
                        {isAudioOnlyMode && audioOnlyFormat === 'wav' ? (
                          <span className="export-chip export-chip-static">16-bit PCM</span>
                        ) : (
                          audioBitratePresets.map((preset) => (
                            <button
                              type="button"
                              key={preset.value}
                              className={`export-chip${audioBitrate === preset.value ? ' is-active' : ''}`}
                              onClick={() => setAudioBitrate(preset.value)}
                            >
                              {preset.label}
                            </button>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="export-field-card export-subcard" data-export-target="audio-processing">
                      <div className="export-field-head">
                        <span>Processing</span>
                        <strong>{normalizeAudio ? 'Normalized' : 'Direct'}</strong>
                      </div>
                      <div className="export-chip-row">
                        <button
                          type="button"
                          className={`export-toggle${normalizeAudio ? ' is-active' : ''}`}
                          onClick={() => setNormalizeAudio(!normalizeAudio)}
                        >
                          Normalize
                        </button>
                        {showRangeInAudio && (
                          <button
                            type="button"
                            className={`export-toggle${useInOut ? ' is-active' : ''}`}
                            onClick={() => setUseInOut(!useInOut)}
                          >
                            Use In/Out
                          </button>
                        )}
                      </div>

                      {browserAudioUnavailable && (
                        <div className="export-inline-note export-inline-note-warning">
                          Browser audio encoding is not available here. Video export still works.
                        </div>
                      )}

                      {showRangeInAudio && (
                        <div className="export-stats-grid export-stats-grid-compact">
                          <div className="export-stat-card">
                            <span>Output</span>
                            <strong>{currentAudioCodecLabel} only</strong>
                          </div>
                          <div className="export-stat-card">
                            <span>Duration</span>
                            <strong>{formatTime(endTime - startTime)}</strong>
                          </div>
                          <div className="export-stat-card">
                            <span>{sizeStatLabel}</span>
                            <strong>{estimatedSizeLabel}</strong>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="export-inline-note">
                    Audio export is disabled. Video export stays silent until you turn audio back on.
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* Video Settings */}
          <div className="export-section export-advanced-section">
            <div className="export-section-header">Advanced Video</div>

            {/* Filename */}
            <div className="control-row">
              <label>Filename</label>
              <div className="export-input-group">
                <input
                  type="text"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder="export"
                />
                <select
                  className="export-extension-select"
                  value={currentContainerId}
                  onChange={(e) => {
                    const nextContainer = e.target.value;
                    if (nextContainer === 'gif') {
                      setSpecialContainer('none');
                      setVideoEnabled(true);
                      setVisualMode('gif');
                      setIncludeAudio(false);
                    } else if (isWebCodecsEncoder) {
                      setVisualMode('video');
                      setContainerFormat(nextContainer as ContainerFormat);
                    } else {
                      setVisualMode('video');
                      handleFFmpegContainerChange(nextContainer as FFmpegContainer);
                    }
                  }}
                  title="Click to change container format"
                >
                  {videoContainerFormats.map(({ id }) => (
                    <option key={id} value={id}>.{id}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Video Codec */}
            <div className="control-row">
              <label>Codec</label>
              {isGifMode ? (
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  {currentCodecLabel}
                </span>
              ) : (encoder === 'webcodecs' || encoder === 'htmlvideo') ? (
                <select
                  value={videoCodec}
                  onChange={(e) => setVideoCodec(e.target.value as VideoCodec)}
                >
                  {FrameExporter.getVideoCodecs(containerFormat).map(({ id, label }) => (
                    <option key={id} value={id} disabled={!codecSupport[id]}>
                      {label} {!codecSupport[id] ? '(not supported)' : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <CodecSelector
                  container={ffmpegContainer}
                  value={ffmpegCodec}
                  onChange={handleFFmpegCodecChange}
                />
              )}
            </div>

            {/* FFmpeg Codec description */}
            {(encoder === 'ffmpeg' || isGifMode) && ffmpegCodecInfo && (
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '-4px', marginBottom: '8px', paddingLeft: '4px' }}>
                {ffmpegCodecInfo.description}
                {ffmpegCodecInfo.supportsAlpha && ' | Alpha'}
                {ffmpegCodecInfo.supports10bit && ' | 10-bit'}
              </div>
            )}

            {/* FFmpeg ProRes Profile */}
            {encoder === 'ffmpeg' && !isGifMode && ffmpegCodec === 'prores' && (
              <div className="control-row">
                <label>Profile</label>
                <select
                  value={proresProfile}
                  onChange={(e) => setProresProfile(e.target.value as ProResProfile)}
                >
                  {PRORES_PROFILES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} - {p.description}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* FFmpeg DNxHR Profile */}
            {encoder === 'ffmpeg' && !isGifMode && ffmpegCodec === 'dnxhd' && (
              <div className="control-row">
                <label>Profile</label>
                <select
                  value={dnxhrProfile}
                  onChange={(e) => setDnxhrProfile(e.target.value as DnxhrProfile)}
                >
                  {DNXHR_PROFILES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} - {p.description}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* HAP codec removed - requires snappy which doesn't build with ASYNCIFY */}

            {/* Resolution */}
            <div className="control-row">
              <label>Resolution</label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select
                  value={useCustomResolution ? 'custom' : `${width}x${height}`}
                  onChange={(e) => {
                    if (e.target.value === 'custom') {
                      setUseCustomResolution(true);
                    } else {
                      setUseCustomResolution(false);
                      handleResolutionChange(e.target.value);
                    }
                  }}
                  disabled={useCustomResolution}
                  style={{ flex: 1 }}
                >
                  {quickResolutionPresets.map(({ label, width: w, height: h }) => (
                    <option key={`${w}x${h}`} value={`${w}x${h}`}>
                      {label}
                    </option>
                  ))}
                  <option value="custom">Custom...</option>
                </select>
                <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="checkbox"
                    checked={useCustomResolution}
                    onChange={(e) => setUseCustomResolution(e.target.checked)}
                  />
                  Custom
                </label>
              </div>
            </div>

            {/* Custom Resolution Inputs */}
            {useCustomResolution && (
              <div className="control-row">
                <label>Custom Size</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="number"
                    value={customWidth}
                    onChange={(e) => setCustomWidth(Math.max(1, parseInt(e.target.value) || 1920))}
                    placeholder="Width"
                    min="1"
                    max="7680"
                    style={{ flex: 1 }}
                  />
                  <span>×</span>
                  <input
                    type="number"
                    value={customHeight}
                    onChange={(e) => setCustomHeight(Math.max(1, parseInt(e.target.value) || 1080))}
                    placeholder="Height"
                    min="1"
                    max="4320"
                    style={{ flex: 1 }}
                  />
                </div>
              </div>
            )}

            {/* Frame Rate */}
            <div className="control-row">
              <label>Frame Rate</label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {!useCustomFps ? (
                  <select
                    value={fps}
                    onChange={(e) => setFps(Number(e.target.value))}
                    style={{ flex: 1 }}
                  >
                    <option value={23.976}>23.976 fps (Film)</option>
                    <option value={24}>24 fps (Cinema)</option>
                    <option value={25}>25 fps (PAL)</option>
                    <option value={29.97}>29.97 fps (NTSC)</option>
                    <option value={30}>30 fps</option>
                    <option value={48}>48 fps (HFR)</option>
                    <option value={50}>50 fps (PAL)</option>
                    <option value={59.94}>59.94 fps (NTSC)</option>
                    <option value={60}>60 fps</option>
                    <option value={120}>120 fps</option>
                  </select>
                ) : (
                  <input
                    type="number"
                    value={customFps}
                    onChange={(e) => setCustomFps(Math.max(1, Math.min(240, parseFloat(e.target.value) || 30)))}
                    min={1}
                    max={240}
                    step={0.001}
                    style={{ flex: 1 }}
                  />
                )}
                <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                  <input
                    type="checkbox"
                    checked={useCustomFps}
                    onChange={(e) => setUseCustomFps(e.target.checked)}
                  />
                  Custom
                </label>
              </div>
            </div>

            {/* Quality - different controls for each encoder */}
            {isGifMode ? (
              <div className="control-row">
                <label>GIF Palette</label>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  {gifColors} colors, {getGifPaletteModeLabel(gifPaletteMode)}, {estimatedSizeLabel}
                </span>
              </div>
            ) : (encoder === 'webcodecs' || encoder === 'htmlvideo') ? (
              <>
                {/* Rate Control */}
                <div className="control-row">
                  <label>Rate Control</label>
                  <select
                    value={rateControl}
                    onChange={(e) => setRateControl(e.target.value as 'vbr' | 'cbr')}
                  >
                    <option value="vbr">VBR (Variable Bitrate)</option>
                    <option value="cbr">CBR (Constant Bitrate)</option>
                  </select>
                </div>

                {/* Bitrate */}
                <div className="control-row">
                  <label>{rateControl === 'cbr' ? 'Bitrate' : 'Target Bitrate'}</label>
                  <select
                    value={bitrate}
                    onChange={(e) => setBitrate(Number(e.target.value))}
                  >
                    <option value={5_000_000}>5 Mbps (Low)</option>
                    <option value={10_000_000}>10 Mbps (Medium)</option>
                    <option value={15_000_000}>15 Mbps (High)</option>
                    <option value={20_000_000}>20 Mbps</option>
                    <option value={25_000_000}>25 Mbps (Very High)</option>
                    <option value={35_000_000}>35 Mbps</option>
                    <option value={50_000_000}>50 Mbps (Max)</option>
                  </select>
                </div>

                {/* Bitrate Slider */}
                <div className="control-row">
                  <label></label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flex: 1 }}>
                    <input
                      type="range"
                      min={1_000_000}
                      max={100_000_000}
                      step={500_000}
                      value={bitrate}
                      onChange={(e) => setBitrate(Number(e.target.value))}
                      style={{ flex: 1 }}
                    />
                    <span style={{ minWidth: '70px', fontSize: '12px', textAlign: 'right' }}>
                      {(bitrate / 1_000_000).toFixed(1)} Mbps
                    </span>
                  </div>
                </div>
              </>
            ) : showFFmpegQualityControl && (
              /* MJPEG Quality Control - lower values = higher quality */
              <div className="control-row">
                <label>Quality</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                  <input
                    type="range"
                    min={1}
                    max={31}
                    value={ffmpegQuality}
                    onChange={(e) => setFfmpegQuality(parseInt(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <span style={{ minWidth: '60px', textAlign: 'right', fontSize: '12px' }}>
                    {ffmpegQuality} {ffmpegQuality <= 5 ? '(High)' : ffmpegQuality <= 10 ? '(Good)' : ffmpegQuality <= 20 ? '(Med)' : '(Low)'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Audio Settings */}
          <div className="export-section export-advanced-section">
            <div className="export-section-header">Advanced Audio</div>

            <div className="control-row">
              <label>
                  <input
                    type="checkbox"
                    checked={includeAudio}
                    onChange={(e) => setIncludeAudio(e.target.checked)}
                    disabled={isGifMode || browserAudioUnavailable}
                  />
                  Include Audio
                </label>
              {isGifMode && (
                <span style={{ color: 'var(--text-secondary)', fontSize: '11px', marginLeft: '8px' }}>
                  GIF is silent
                </span>
              )}
              {browserAudioUnavailable && (
                <span style={{ color: 'var(--warning)', fontSize: '11px', marginLeft: '8px' }}>
                  Not supported
                </span>
              )}
            </div>

            {includeAudio && !isGifMode && (
              <>
                <div className="control-row">
                  <label>Sample Rate</label>
                  <select
                    value={audioSampleRate}
                    onChange={(e) => setAudioSampleRate(Number(e.target.value) as 44100 | 48000)}
                  >
                    <option value={48000}>48 kHz (Video)</option>
                    <option value={44100}>44.1 kHz (CD)</option>
                  </select>
                </div>

                <div className="control-row">
                  <label>Audio Quality</label>
                  {isAudioOnlyMode && audioOnlyFormat === 'wav' ? (
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      16-bit PCM
                    </span>
                  ) : (
                    <select
                      value={audioBitrate}
                      onChange={(e) => setAudioBitrate(Number(e.target.value))}
                    >
                      <option value={128000}>128 kbps</option>
                      <option value={192000}>192 kbps</option>
                      <option value={256000}>256 kbps (High)</option>
                      <option value={320000}>320 kbps (Max)</option>
                    </select>
                  )}
                </div>

                {(encoder === 'ffmpeg' || isAudioOnlyMode) && (
                  <div className="control-row">
                    <label>Audio Codec</label>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {isAudioOnlyMode
                        ? currentAudioCodecLabel
                        : `${ffmpegContainer === 'mov' ? 'AAC' :
                           ffmpegContainer === 'mkv' ? 'FLAC' :
                           ffmpegContainer === 'avi' ? 'PCM' :
                           ffmpegContainer === 'mxf' ? 'PCM' : 'AAC'} (auto)`}
                    </span>
                  </div>
                )}

                <div className="control-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={normalizeAudio}
                      onChange={(e) => setNormalizeAudio(e.target.checked)}
                    />
                    Normalize (prevent clipping)
                  </label>
                </div>
              </>
            )}
          </div>

          <ExportAdvancedSummarySections
            encoder={encoder}
            isGifMode={isGifMode}
            stackedAlpha={stackedAlpha}
            setStackedAlpha={setStackedAlpha}
            actualWidth={actualWidth}
            actualHeight={actualHeight}
            outputHeight={outputHeight}
            useInOut={useInOut}
            setUseInOut={setUseInOut}
            startTime={startTime}
            endTime={endTime}
            frameCount={frameCount}
            estimatedSizeLabel={estimatedSizeLabel}
            error={error}
            formatTime={formatTime}
          />
        </div>
      ) : (
        <ExportProgressView
          encoder={encoder}
          progress={progress}
          ffmpegProgress={ffmpegProgress}
          exportPhase={exportPhase}
          usesBrowserProgress={usesBrowserProgress}
          isImageSequenceMode={isImageSequenceMode}
          isGifMode={isGifMode}
          formatTime={formatTime}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}
