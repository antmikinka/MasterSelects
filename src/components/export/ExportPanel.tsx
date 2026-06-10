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
} from '../../engine/ffmpeg';
import { CodecSelector } from './CodecSelector';
import {
  getGifPaletteModeLabel,
} from '../../engine/gif/gifOptions';
import type {
  FFmpegContainer,
  ProResProfile,
  DnxhrProfile,
} from '../../engine/ffmpeg';
import { resolveExportRange } from './exportRange';
import { useExportState } from './useExportState';
import { ExportAdvancedSummarySections } from './ExportAdvancedSummarySections';
import { ExportProgressView } from './ExportProgressView';
import {
  buildExportSettingsState,
  formatExportTime,
} from './exportSettingsState';
import type { ExportSummaryTarget } from './exportSummaryState';
import { useExportRunController } from './useExportRunController';
import {
  useExportStore,
} from '../../stores/exportStore';
import { ExportBasicsSection } from './panel/ExportBasicsSection';
import {
  ExportPresetCommandSection,
  ExportSummaryBadgesSection,
  ExportWorkflowSection,
} from './panel/ExportTopSections';
import type {
  ExportBasicsActions,
  ExportBasicsAudioState,
  ExportBasicsDisplayState,
  ExportBasicsGifState,
  ExportBasicsImageState,
  ExportBasicsModeState,
  ExportBasicsOptionState,
  ExportBasicsTimeState,
  ExportBasicsVideoState,
} from './panel/exportBasicsTypes';

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

  const basicsMode: ExportBasicsModeState = {
    encoder,
    isWebCodecsEncoder,
    webCodecsAvailable,
    ffmpegAvailable,
    isFFmpegLoading,
    isFFmpegReady,
    ffmpegLoadError,
    isXmlMode,
    isImageMode,
    isImageSequenceMode,
    imageSequenceFolderSupported,
    imageSequenceOutputLabel,
    isGifMode,
    isVideoMode,
    isAudioOnlyMode,
    videoEnabled,
    includeAudio,
    isAudioSupported,
    browserAudioUnavailable,
    showRangeInVideo,
    showRangeInAudio,
    showFFmpegQualityControl,
  };

  const basicsDisplay: ExportBasicsDisplayState = {
    displayOutputName,
    displayContainerLabel,
    currentContainerId,
    currentCodecLabel,
    currentAudioCodecLabel,
    browserAudioExtension,
    browserAudioCodecLabel,
    methodMeta,
    ffmpegCodecInfo: ffmpegCodecInfo ?? null,
    estimatedSizeLabel,
    sizeStatLabel,
    webCodecsRateNote,
    gifSizeRangeLabel,
  };

  const basicsVideo: ExportBasicsVideoState = {
    width,
    height,
    customWidth,
    customHeight,
    useCustomResolution,
    actualWidth,
    actualHeight,
    outputHeight,
    fps,
    customFps,
    useCustomFps,
    actualFps,
    frameCount,
    bitrate,
    rateControl,
    containerFormat,
    videoCodec,
    codecSupport,
    ffmpegCodec,
    ffmpegContainer,
    proresProfile,
    dnxhrProfile,
    ffmpegQuality,
    stackedAlpha,
  };

  const basicsGif: ExportBasicsGifState = {
    gifColors,
    gifDither,
    gifLoop,
    gifPaletteMode,
    gifOptimize,
    gifAlphaThreshold,
  };

  const basicsImage: ExportBasicsImageState = {
    imageFormat,
    imageExportMode,
    imageQuality,
    selectedImageFormat,
    imageSequenceFrameCount,
  };

  const basicsAudio: ExportBasicsAudioState = {
    includeAudio,
    audioOnlyFormat,
    audioSampleRate,
    audioBitrate,
    normalizeAudio,
  };

  const basicsOptions: ExportBasicsOptionState = {
    videoContainerFormats,
    quickResolutionPresets,
    quickFrameRatePresets,
    webQualityPresets,
    audioSampleRatePresets,
    audioBitratePresets,
  };

  const basicsTime: ExportBasicsTimeState = {
    startTime,
    endTime,
    playheadPosition,
    formatTime,
  };

  const basicsActions: ExportBasicsActions = {
    setEncoder,
    setFilename,
    setContainerFormat,
    handleFFmpegContainerChange,
    setSpecialContainer,
    setVideoEnabled,
    setVisualMode,
    setIncludeAudio,
    setImageFormat,
    setImageExportMode,
    setImageQuality,
    handleQuickResolutionPreset,
    setUseCustomResolution,
    setCustomWidth,
    setCustomHeight,
    handleQuickFpsPreset,
    setUseCustomFps,
    setFps,
    setCustomFps,
    setRateControl,
    setBitrate,
    handleQuickBitratePreset,
    setFfmpegQuality,
    handleFFmpegCodecChange,
    setVideoCodec,
    setProresProfile,
    setDnxhrProfile,
    setStackedAlpha,
    setUseInOut,
    setAudioOnlyFormat,
    setAudioSampleRate,
    setAudioBitrate,
    setNormalizeAudio,
    setGifColors,
    setGifDither,
    setGifLoop,
    setGifPaletteMode,
    setGifOptimize,
    setGifAlphaThreshold,
    loadFFmpeg,
  };

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
          <ExportSummaryBadgesSection
            summaryBadges={summaryBadges}
            primaryExportLabel={primaryExportLabel}
            exportDisabled={exportDisabled}
            onPrimaryExport={handlePrimaryExport}
            onScrollToSummaryTarget={scrollToSummaryTarget}
          />

          <ExportPresetCommandSection
            presets={presets}
            selectedPresetId={selectedPresetId}
            setupStatus={setupStatus}
            onSelectPreset={setSelectedPresetId}
            onLoad={loadSavedSetup}
            onUpdate={updateCurrentSetup}
            onSave={saveCurrentSetup}
          />

          <ExportWorkflowSection
            encoder={encoder}
            webCodecsAvailable={webCodecsAvailable}
            ffmpegAvailable={ffmpegAvailable}
            isFFmpegMultiThreaded={isFFmpegMultiThreaded}
            isFFmpegReady={isFFmpegReady}
            isFFmpegLoading={isFFmpegLoading}
            ffmpegLoadError={ffmpegLoadError}
            onSetEncoder={setEncoder}
            onLoadFFmpeg={loadFFmpeg}
          />

          <ExportBasicsSection
            filename={filename}
            mode={basicsMode}
            display={basicsDisplay}
            video={basicsVideo}
            image={basicsImage}
            gif={basicsGif}
            audio={basicsAudio}
            options={basicsOptions}
            time={basicsTime}
            useInOut={useInOut}
            actions={basicsActions}
          />

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
