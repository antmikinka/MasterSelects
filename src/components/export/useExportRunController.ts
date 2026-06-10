import { useCallback, useRef } from 'react';
import { Logger } from '../../services/logger';
import { downloadBlob } from '../../engine/export';
import type { AudioExportPipeline } from '../../engine/audio';
import { getFFmpegBridge } from '../../engine/ffmpeg';
import { ExportRenderSessionImpl } from '../../engine/export/ExportRenderSessionImpl';
import type { Composition } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { useExportStore } from '../../stores/exportStore';
import type { FFmpegFrameRenderer } from './exportHelpers';
import { resolveExportRange } from './exportRange';
import type { useExportState } from './useExportState';
import { runAudioOnlyExport } from './runners/audioOnlyExportRunner';
import { runFcpxmlExport } from './runners/fcpxmlExportRunner';
import { runFfmpegDirectExport } from './runners/ffmpegDirectExportRunner';
import { runBrowserGifExport } from './runners/gifExportRunner';
import { runImageSequenceExport } from './runners/imageSequenceExportRunner';
import type { RunnerImageFormatOption } from './runners/runnerUtils';
import { runStillImageExport } from './runners/stillImageExportRunner';
import { runWebCodecsExport } from './runners/webCodecsExportRunner';

const log = Logger.create('ExportRunController');

type ExportState = ReturnType<typeof useExportState>;

interface ExportRunControllerInput {
  exportState: ExportState;
  playheadPosition: number;
  startExport: (startTime: number, endTime: number) => void;
  setExportProgress: (percent: number, currentTime: number) => void;
  endExport: () => void;
  getActiveComposition: () => Composition | undefined;
  selectedImageFormat: RunnerImageFormatOption;
  isXmlMode: boolean;
  isImageMode: boolean;
  isImageSequenceMode: boolean;
  isGifMode: boolean;
  isWebCodecsEncoder: boolean;
}

export function useExportRunController({
  exportState, playheadPosition, startExport, setExportProgress, endExport,
  getActiveComposition, selectedImageFormat, isXmlMode, isImageMode,
  isImageSequenceMode, isGifMode, isWebCodecsEncoder,
}: ExportRunControllerInput) {
  const ffmpegFrameRendererRef = useRef<FFmpegFrameRenderer | null>(null);
  const ffmpegAudioPipelineRef = useRef<AudioExportPipeline | null>(null);
  const exportRenderSessionRef = useRef<ExportRenderSessionImpl | null>(null);

  const {
    encoder, width, height, customWidth, customHeight, useCustomResolution,
    fps, customFps, useCustomFps, filename, bitrate, containerFormat, videoCodec,
    rateControl, ffmpegCodec, ffmpegContainer, proresProfile, dnxhrProfile,
    ffmpegQuality, gifColors, gifDither, gifLoop, gifPaletteMode, gifOptimize,
    gifAlphaThreshold, stackedAlpha, includeAudio, audioOnlyFormat, audioSampleRate,
    audioBitrate, normalizeAudio, videoEnabled, visualMode, imageFormat, imageQuality,
    isExporting, setIsExporting, setProgress, setFfmpegProgress, setExportPhase,
    setError, exporter, setExporter, isFFmpegReady, loadFFmpeg,
  } = exportState;

  const getCurrentExportRange = useCallback(() => {
    const timelineState = useTimelineStore.getState();
    const exportSettings = useExportStore.getState().settings;
    return resolveExportRange(
      {
        duration: timelineState.duration,
        inPoint: timelineState.inPoint,
        outPoint: timelineState.outPoint,
      },
      exportSettings.useInOut,
    );
  }, []);

  const handleWebCodecsExport = useCallback(async () => {
    if (isExporting) return;

    setIsExporting(true);
    setError(null);
    setProgress(null);

    const { startTime, endTime } = getCurrentExportRange();
    const actualWidth = useCustomResolution ? customWidth : width;
    const actualHeight = useCustomResolution ? customHeight : height;
    const exportFps = useCustomFps ? customFps : fps;
    startExport(startTime, endTime);

    try {
      const result = await runWebCodecsExport({
        width: actualWidth, height: actualHeight, fps: exportFps, startTime, endTime,
        videoCodec, containerFormat, bitrate, rateControl, stackedAlpha,
        includeAudio, audioSampleRate, audioBitrate, normalizeAudio,
        exportMode: encoder === 'webcodecs' ? 'fast' : 'precise',
        filename,
        onExporter: setExporter,
        onProgress: setProgress,
        onTimelineProgress: setExportProgress,
      });

      if (result) {
        downloadBlob(result.blob, result.filename);
      }
    } catch (e) {
      log.error('Export failed', e);
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setIsExporting(false);
      setExporter(null);
      endExport();
    }
  }, [audioBitrate, audioSampleRate, bitrate, containerFormat, customFps, customHeight, customWidth, encoder, endExport, filename, fps, getCurrentExportRange, height, includeAudio, isExporting, normalizeAudio, rateControl, setError, setExportProgress, setExporter, setIsExporting, setProgress, stackedAlpha, startExport, useCustomFps, useCustomResolution, videoCodec, width]);

  const handleCancel = useCallback(() => {
    if (!videoEnabled) {
      ffmpegAudioPipelineRef.current?.cancel();
    } else if (visualMode === 'gif' || visualMode === 'image') {
      ffmpegFrameRendererRef.current?.cancel();
      getFFmpegBridge().cancel();
    } else if (encoder === 'webcodecs' || encoder === 'htmlvideo') {
      exporter?.cancel();
      setExporter(null);
    } else {
      ffmpegFrameRendererRef.current?.cancel();
      ffmpegAudioPipelineRef.current?.cancel();
      getFFmpegBridge().cancel();
    }
    exportRenderSessionRef.current?.cancel('Export cancelled');
    setIsExporting(false);
    setExportPhase('idle');
    endExport();
  }, [encoder, endExport, exporter, setExportPhase, setExporter, setIsExporting, videoEnabled, visualMode]);

  const handleBrowserGifExport = useCallback(async () => {
    if (isExporting) return;

    setIsExporting(true);
    setError(null);
    setProgress(null);

    const { startTime, endTime } = getCurrentExportRange();
    const actualWidth = useCustomResolution ? customWidth : width;
    const actualHeight = useCustomResolution ? customHeight : height;
    const exportFps = useCustomFps ? customFps : fps;

    startExport(startTime, endTime);

    try {
      const result = await runBrowserGifExport({
        width: actualWidth, height: actualHeight, fps: exportFps, startTime, endTime,
        exportMode: encoder === 'webcodecs' ? 'fast' : 'precise',
        filename, gifColors, gifDither, gifLoop, gifPaletteMode, gifOptimize, gifAlphaThreshold,
        frameRendererRef: ffmpegFrameRendererRef, renderSessionRef: exportRenderSessionRef,
        createRenderSession: (options) => new ExportRenderSessionImpl(options),
        onProgress: setProgress, onTimelineProgress: setExportProgress,
      });

      if (result) {
        downloadBlob(result.blob, result.filename);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'GIF export failed');
    } finally {
      setIsExporting(false);
      endExport();
    }
  }, [customFps, customHeight, customWidth, encoder, endExport, filename, fps, getCurrentExportRange, gifAlphaThreshold, gifColors, gifDither, gifLoop, gifOptimize, gifPaletteMode, height, isExporting, setError, setExportProgress, setIsExporting, setProgress, startExport, useCustomFps, useCustomResolution, width]);

  const handleFFmpegExport = useCallback(async () => {
    if (isExporting) return;

    if (!isFFmpegReady) {
      await loadFFmpeg();
      if (!getFFmpegBridge().isLoaded()) {
        setError('FFmpeg not loaded');
        return;
      }
    }

    setIsExporting(true);
    setError(null);
    setFfmpegProgress(null);
    setExportPhase('rendering');

    const { startTime, endTime } = getCurrentExportRange();
    const actualWidth = useCustomResolution ? customWidth : width;
    const actualHeight = useCustomResolution ? customHeight : height;
    const exportFps = useCustomFps ? customFps : fps;

    startExport(startTime, endTime);

    try {
      const result = await runFfmpegDirectExport({
        width: actualWidth, height: actualHeight, fps: exportFps, startTime, endTime,
        filename, visualMode, includeAudio, audioSampleRate, audioBitrate, normalizeAudio,
        ffmpegCodec, ffmpegContainer, ffmpegQuality, proresProfile, dnxhrProfile,
        gifColors, gifDither, gifLoop, gifPaletteMode, gifOptimize, gifAlphaThreshold,
        frameRendererRef: ffmpegFrameRendererRef, audioPipelineRef: ffmpegAudioPipelineRef,
        renderSessionRef: exportRenderSessionRef,
        createRenderSession: (options) => new ExportRenderSessionImpl(options),
        onFfmpegProgress: setFfmpegProgress, onTimelineProgress: setExportProgress, onPhase: setExportPhase,
      });

      if (result) {
        const url = URL.createObjectURL(result.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      ffmpegAudioPipelineRef.current = null;
      setIsExporting(false);
      setExportPhase('idle');
      endExport();
    }
  }, [audioBitrate, audioSampleRate, customFps, customHeight, customWidth, dnxhrProfile, endExport, ffmpegCodec, ffmpegContainer, ffmpegQuality, filename, fps, getCurrentExportRange, gifAlphaThreshold, gifColors, gifDither, gifLoop, gifOptimize, gifPaletteMode, height, includeAudio, isExporting, isFFmpegReady, loadFFmpeg, normalizeAudio, proresProfile, setError, setExportPhase, setExportProgress, setFfmpegProgress, setIsExporting, startExport, useCustomFps, useCustomResolution, visualMode, width]);

  const handleExportAudioOnly = useCallback(async () => {
    if (isExporting) return;

    setIsExporting(true);
    setError(null);
    const { startTime, endTime } = getCurrentExportRange();
    const actualWidth = useCustomResolution ? customWidth : width;
    const actualHeight = useCustomResolution ? customHeight : height;
    const actualFps = useCustomFps ? customFps : fps;
    let timelineExportStarted = false;

    try {
      const result = await runAudioOnlyExport({
        width: actualWidth, height: actualHeight, fps: actualFps, startTime, endTime,
        filename, encoder, videoCodec, containerFormat, bitrate,
        audioOnlyFormat, audioSampleRate, audioBitrate, normalizeAudio,
        audioPipelineRef: ffmpegAudioPipelineRef,
        onProgress: setProgress,
        onTimelineProgress: setExportProgress,
        onTimelineStart: (rangeStart, rangeEnd) => {
          startExport(rangeStart, rangeEnd);
          timelineExportStarted = true;
        },
      });

      if (result.kind === 'download') {
        downloadBlob(result.blob, result.filename);
      } else {
        setError(result.message);
      }
    } catch (e) {
      log.error('Audio export failed', e);
      setError(e instanceof Error ? e.message : 'Audio export failed');
    } finally {
      ffmpegAudioPipelineRef.current = null;
      setIsExporting(false);
      if (timelineExportStarted) {
        endExport();
      }
    }
  }, [audioBitrate, audioOnlyFormat, audioSampleRate, bitrate, containerFormat, customFps, customHeight, customWidth, encoder, endExport, filename, fps, getCurrentExportRange, height, isExporting, normalizeAudio, setError, setExportProgress, setIsExporting, setProgress, startExport, useCustomFps, useCustomResolution, videoCodec, width]);

  const handleExportFCPXML = useCallback(() => {
    runFcpxmlExport({
      getActiveComposition,
      filename,
      fps,
      width,
      height,
      includeAudio,
    });
  }, [filename, fps, getActiveComposition, height, includeAudio, width]);

  const handleRenderFrame = useCallback(async () => {
    if (isExporting) return;

    const actualWidth = useCustomResolution ? customWidth : width;
    const actualHeight = useCustomResolution ? customHeight : height;
    const exportTime = playheadPosition;
    const exportFps = useCustomFps ? customFps : fps;

    try {
      const result = await runStillImageExport({
        width: actualWidth, height: actualHeight, fps: exportFps, exportTime,
        filename, imageFormat, imageQuality, selectedImageFormat,
        renderSessionRef: exportRenderSessionRef,
        createRenderSession: (options) => new ExportRenderSessionImpl(options),
      });

      if (result) {
        downloadBlob(result.blob, result.filename);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Frame render failed');
    }
  }, [customFps, customHeight, customWidth, filename, fps, height, imageFormat, imageQuality, isExporting, playheadPosition, selectedImageFormat, setError, useCustomFps, useCustomResolution, width]);

  const handleRenderImageSequence = useCallback(async () => {
    if (isExporting) return;

    setIsExporting(true);
    setError(null);
    setProgress(null);
    setExportPhase('rendering');

    const { startTime, endTime } = getCurrentExportRange();
    const actualWidth = useCustomResolution ? customWidth : width;
    const actualHeight = useCustomResolution ? customHeight : height;
    const exportFps = useCustomFps ? customFps : fps;
    let timelineExportStarted = false;

    try {
      const result = await runImageSequenceExport({
        width: actualWidth, height: actualHeight, fps: exportFps, startTime, endTime,
        exportMode: encoder === 'webcodecs' ? 'fast' : 'precise',
        filename, imageFormat, imageQuality, selectedImageFormat,
        frameRendererRef: ffmpegFrameRendererRef, renderSessionRef: exportRenderSessionRef,
        createRenderSession: (options) => new ExportRenderSessionImpl(options),
        onTimelineStart: (rangeStart, rangeEnd) => {
          startExport(rangeStart, rangeEnd);
          timelineExportStarted = true;
        },
        onProgress: setProgress, onTimelineProgress: setExportProgress,
      });

      if (result?.kind === 'zip') {
        downloadBlob(result.blob, result.filename);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Image sequence export failed');
    } finally {
      setExportPhase('idle');
      setIsExporting(false);
      if (timelineExportStarted) {
        endExport();
      }
    }
  }, [customFps, customHeight, customWidth, encoder, endExport, filename, fps, getCurrentExportRange, height, imageFormat, imageQuality, isExporting, selectedImageFormat, setError, setExportPhase, setExportProgress, setIsExporting, setProgress, startExport, useCustomFps, useCustomResolution, width]);

  const handlePrimaryExport = useCallback(() => {
    if (isXmlMode) {
      handleExportFCPXML();
      return;
    }

    if (isImageMode) {
      if (isImageSequenceMode) {
        void handleRenderImageSequence();
      } else {
        void handleRenderFrame();
      }
      return;
    }

    if (isGifMode) {
      if (encoder === 'ffmpeg') {
        void handleFFmpegExport();
      } else {
        void handleBrowserGifExport();
      }
      return;
    }

    if (!videoEnabled) {
      if (includeAudio) {
        void handleExportAudioOnly();
      }
      return;
    }

    if (isWebCodecsEncoder) {
      void handleWebCodecsExport();
      return;
    }

    void handleFFmpegExport();
  }, [encoder, handleBrowserGifExport, handleExportAudioOnly, handleExportFCPXML, handleFFmpegExport, handleRenderFrame, handleRenderImageSequence, handleWebCodecsExport, includeAudio, isGifMode, isImageMode, isImageSequenceMode, isWebCodecsEncoder, isXmlMode, videoEnabled]);

  return {
    handleCancel,
    handlePrimaryExport,
  };
}
