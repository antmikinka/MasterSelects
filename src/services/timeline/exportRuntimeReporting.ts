import type { ExportClipState, FullExportSettings } from '../../engine/export/types';
import type {
  ParallelDecodeClipRuntimeSnapshot,
  ParallelDecodeRuntimeSnapshot,
} from '../../engine/ParallelDecodeManager';
import type {
  RuntimeProviderDemand,
  TimelineRuntimeResourceKind,
} from '../../timeline';
import type {
  RenderResourceDescriptor,
  RuntimeHealthStatus,
  TimelineRuntimeAdmissionDecision,
} from './runtimeCoordinatorTypes';
import { createRenderResourceDescriptorFromDemand } from './runtimeProviderDemandBridge';
import { timelineRuntimeCoordinator } from './timelineRuntimeCoordinator';

const EXPORT_POLICY_ID = 'export' as const;

export interface ExportRunReport {
  runId: string;
  settings: FullExportSettings;
  totalFrames?: number;
  startedAtMs?: number;
  exportMode?: string;
  requestedAudio?: boolean;
  effectiveAudio?: boolean;
}

export interface ExportOutputSurfaceReport {
  runId: string;
  width: number;
  height: number;
  zeroCopy: boolean;
  stackedAlpha?: boolean;
}

export interface ExportPreviewFrameReport {
  runId: string;
  width: number;
  height: number;
  currentTime: number;
}

export type ExportAudioBufferStage =
  | 'source-buffer'
  | 'processed-buffer'
  | 'mix-buffer'
  | 'master-buffer';

export interface ExportAudioBufferReport {
  runId: string;
  stage: ExportAudioBufferStage;
  buffer: AudioBuffer;
  clipId?: string;
  mediaFileId?: string;
  trackId?: string;
}

export interface ExportClipElementAdmissionReport {
  runId: string;
  clip: {
    id: string;
    trackId?: string;
    mediaFileId?: string;
    duration?: number;
  };
  mediaFileId?: string;
  previewPath?: string;
  srcKind?: 'blob-url' | 'remote-url' | 'project-path' | 'unknown';
  dedicated?: boolean;
}

export interface ExportRuntimeBindingAdmissionReport {
  runId: string;
  clip: {
    id: string;
    trackId?: string;
    mediaFileId?: string;
    duration?: number;
  };
  runtimeSource: {
    type?: string;
    runtimeSourceId: string;
    runtimeSessionKey: string;
    mediaFileId?: string;
    filePath?: string;
  };
}

export interface ExportFrameProviderAdmissionReport {
  runId: string;
  clip: {
    id: string;
    trackId?: string;
    mediaFileId?: string;
    duration?: number;
  };
  runtimeSource?: {
    runtimeSourceId?: string;
    runtimeSessionKey?: string;
    mediaFileId?: string;
  };
  width?: number;
  height?: number;
  providerKind?: 'webcodecs' | 'runtime-frame-provider';
  frameFormat?: 'video-frame' | 'image-bitmap' | 'canvas-image-source' | 'unknown';
  label?: string;
  tags?: readonly string[];
}

export interface ExportParallelDecodeAdmissionReport {
  runId: string;
  clip: {
    id: string;
    trackId?: string;
    mediaFileId?: string;
    duration?: number;
  };
  runtimeSource?: {
    runtimeSourceId?: string;
    runtimeSessionKey?: string;
    mediaFileId?: string;
  };
  codec?: string;
  width?: number;
  height?: number;
  isNested?: boolean;
  estimatedBufferedFrameBytes?: number;
}

function retain(resource: RenderResourceDescriptor): void {
  timelineRuntimeCoordinator.retainResource(resource);
}

function canRetain(resource: RenderResourceDescriptor): TimelineRuntimeAdmissionDecision {
  return timelineRuntimeCoordinator.canRetainResource(resource);
}

export function createExportRunId(now = Date.now()): string {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getExportRunOwnerId(runId: string): string {
  return `export:run:${runId}`;
}

function getRunResourceId(runId: string, suffix: string): string {
  return `export:${runId}:${suffix}`;
}

function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

function hasDefinedEntries(value: object): boolean {
  return Object.keys(value).length > 0;
}

function getRunOwner(
  runId: string,
  clipId?: string,
  mediaFileId?: string
): RuntimeProviderDemand['owner'] {
  return removeUndefinedValues({
    ownerId: getExportRunOwnerId(runId),
    ownerType: 'export' as const,
    clipId,
    mediaFileId,
  });
}

function createExportDemand(params: {
  id: string;
  resourceKind: TimelineRuntimeResourceKind;
  owner: RuntimeProviderDemand['owner'];
  source?: RuntimeProviderDemand['source'];
  dimensions?: RuntimeProviderDemand['dimensions'];
  priority?: RuntimeProviderDemand['priority'];
  cacheKey?: string;
  tags: readonly string[];
}): RuntimeProviderDemand {
  const demand: RuntimeProviderDemand = {
    id: params.id,
    facetId: `${params.id}:facet`,
    resourceKind: params.resourceKind,
    policyId: EXPORT_POLICY_ID,
    leasePolicy: 'retain-until-release',
    owner: params.owner,
    priority: params.priority ?? 'background',
    tags: params.tags,
  };
  if (params.source && hasDefinedEntries(params.source)) {
    demand.source = params.source;
  }
  if (params.dimensions && hasDefinedEntries(params.dimensions)) {
    demand.dimensions = params.dimensions;
  }
  if (params.cacheKey) {
    demand.cacheKey = params.cacheKey;
  }
  return demand;
}

function getClipElementMediaFileId(report: ExportClipElementAdmissionReport): string | undefined {
  return report.mediaFileId ?? report.clip.mediaFileId;
}

function getRuntimeSourceMediaFileId(report: ExportRuntimeBindingAdmissionReport): string | undefined {
  return report.runtimeSource.mediaFileId ?? report.clip.mediaFileId;
}

function getFrameProviderMediaFileId(report: ExportFrameProviderAdmissionReport): string | undefined {
  return report.runtimeSource?.mediaFileId ?? report.clip.mediaFileId;
}

function getParallelDecodeMediaFileId(report: ExportParallelDecodeAdmissionReport): string | undefined {
  return report.runtimeSource?.mediaFileId ?? report.clip.mediaFileId;
}

function getMediaStatus(video: HTMLMediaElement): RuntimeHealthStatus {
  if (video.error) return 'warning';
  return video.readyState >= HTMLMediaElement.HAVE_METADATA ? 'ok' : 'unknown';
}

function getSrcKind(
  src: string | undefined
): 'blob-url' | 'remote-url' | 'project-path' | 'unknown' {
  if (!src) return 'unknown';
  if (src.startsWith('blob:')) return 'blob-url';
  if (src.startsWith('http')) return 'remote-url';
  return 'project-path';
}

function createExportRunJobResource(report: ExportRunReport): RenderResourceDescriptor {
  const resourceId = getRunResourceId(report.runId, 'job:render');
  return createRenderResourceDescriptorFromDemand(createExportDemand({
    id: resourceId,
    resourceKind: 'job',
    owner: getRunOwner(report.runId),
    dimensions: {
      width: report.settings.width,
      height: report.settings.stackedAlpha ? report.settings.height * 2 : report.settings.height,
      fps: report.settings.fps,
      durationSeconds: Math.max(0, report.settings.endTime - report.settings.startTime),
    },
    source: {
      previewPath: `${report.settings.startTime.toFixed(3)}-${report.settings.endTime.toFixed(3)}`,
    },
    tags: [
      'export',
      report.exportMode ?? report.settings.exportMode ?? 'unknown',
      report.requestedAudio ? 'audio-requested' : 'video-only',
      report.effectiveAudio ? 'audio-effective' : 'no-audio',
    ],
  }), {
    resourceKind: 'job',
    jobId: report.runId,
    jobKind: 'export-render',
    startedAtMs: report.startedAtMs,
    diagnostics: {
      status: 'ok',
      messages: [
        {
          severity: 'info',
          code: 'export.render-job',
          message: `Export ${report.exportMode ?? report.settings.exportMode ?? 'unknown'} render started.`,
          policyId: EXPORT_POLICY_ID,
        },
      ],
    },
    label: 'Export render job',
  });
}

export function canRetainExportRunJob(report: ExportRunReport): TimelineRuntimeAdmissionDecision {
  return canRetain(createExportRunJobResource(report));
}

export function reportExportRunJob(report: ExportRunReport): void {
  retain(createExportRunJobResource(report));
}

function createExportOutputSurfaceResource(
  report: ExportOutputSurfaceReport
): RenderResourceDescriptor {
  const height = report.stackedAlpha ? report.height * 2 : report.height;
  const resourceId = getRunResourceId(report.runId, 'output-surface');
  const demand = createExportDemand({
    id: resourceId,
    resourceKind: report.zeroCopy ? 'gpu-texture' : 'image-canvas',
    owner: getRunOwner(report.runId),
    dimensions: {
      width: report.width,
      height,
    },
    tags: ['export', report.zeroCopy ? 'zero-copy' : 'readback', 'output-surface'],
  });

  if (report.zeroCopy) {
    return createRenderResourceDescriptorFromDemand(demand, {
      resourceKind: 'gpu-texture',
      textureId: resourceId,
      textureKind: 'export-frame',
      format: 'rgba8unorm',
      memoryCost: {
        gpuBytes: report.width * height * 4,
      },
      label: 'Export zero-copy output surface',
    });
  }

  return createRenderResourceDescriptorFromDemand(demand, {
    resourceKind: 'image-canvas',
    imageKind: 'offscreen-canvas',
    imageId: resourceId,
    memoryCost: {
      heapBytes: report.width * height * 4,
    },
    label: 'Export readback output surface',
  });
}

export function canRetainExportOutputSurface(
  report: ExportOutputSurfaceReport
): TimelineRuntimeAdmissionDecision {
  return canRetain(createExportOutputSurfaceResource(report));
}

export function reportExportOutputSurface(report: ExportOutputSurfaceReport): void {
  retain(createExportOutputSurfaceResource(report));
}

function createExportRuntimeBindingResource(
  report: ExportRuntimeBindingAdmissionReport
): RenderResourceDescriptor {
  const mediaFileId = getRuntimeSourceMediaFileId(report);
  const resourceId = getRunResourceId(
    report.runId,
    `clip:${report.clip.id}:runtime-binding:${report.runtimeSource.runtimeSourceId}:${report.runtimeSource.runtimeSessionKey}`
  );
  return createRenderResourceDescriptorFromDemand(createExportDemand({
    id: resourceId,
    resourceKind: 'runtime-binding',
    owner: getRunOwner(report.runId, report.clip.id, mediaFileId),
    source: removeUndefinedValues({
      sourceId: report.runtimeSource.runtimeSourceId,
      mediaFileId,
      clipId: report.clip.id,
      trackId: report.clip.trackId,
      projectPath: report.runtimeSource.filePath,
    }),
    dimensions: removeUndefinedValues({
      durationSeconds: report.clip.duration,
    }),
    tags: ['export', 'clip-state', report.runtimeSource.type ?? 'unknown'],
  }), {
    resourceKind: 'runtime-binding',
    runtimeSourceId: report.runtimeSource.runtimeSourceId,
    runtimeSessionKey: report.runtimeSource.runtimeSessionKey,
    label: 'Export runtime binding',
  });
}

export function canRetainExportRuntimeBinding(
  report: ExportRuntimeBindingAdmissionReport
): TimelineRuntimeAdmissionDecision {
  return canRetain(createExportRuntimeBindingResource(report));
}

export function reserveExportRuntimeBinding(
  report: ExportRuntimeBindingAdmissionReport
): TimelineRuntimeAdmissionDecision {
  const resource = createExportRuntimeBindingResource(report);
  const decision = canRetain(resource);
  if (decision.admitted) {
    retain(resource);
  }
  return decision;
}

export function releaseReservedExportRuntimeBinding(
  report: ExportRuntimeBindingAdmissionReport
): void {
  timelineRuntimeCoordinator.releaseResource(
    getRunResourceId(
      report.runId,
      `clip:${report.clip.id}:runtime-binding:${report.runtimeSource.runtimeSourceId}:${report.runtimeSource.runtimeSessionKey}`
    )
  );
}

function reportExportRuntimeBinding(runId: string, state: ExportClipState): void {
  const runtimeSource = state.runtimeSource;
  if (!runtimeSource?.runtimeSourceId || !runtimeSource.runtimeSessionKey) {
    return;
  }

  retain(createExportRuntimeBindingResource({
    runId,
    clip: {
      id: state.clipId,
      mediaFileId: runtimeSource.mediaFileId,
    },
    runtimeSource: {
      type: runtimeSource.type,
      runtimeSourceId: runtimeSource.runtimeSourceId,
      runtimeSessionKey: runtimeSource.runtimeSessionKey,
      mediaFileId: runtimeSource.mediaFileId,
      filePath: runtimeSource.filePath,
    },
  }));
}

function createExportFrameProviderResource(
  report: ExportFrameProviderAdmissionReport
): RenderResourceDescriptor {
  const mediaFileId = getFrameProviderMediaFileId(report);
  const resourceId = getRunResourceId(report.runId, `clip:${report.clip.id}:frame-provider`);
  return createRenderResourceDescriptorFromDemand(createExportDemand({
    id: resourceId,
    resourceKind: 'video-frame-provider',
    owner: getRunOwner(report.runId, report.clip.id, mediaFileId),
    source: removeUndefinedValues({
      sourceId: report.runtimeSource?.runtimeSourceId,
      mediaFileId,
      clipId: report.clip.id,
      trackId: report.clip.trackId,
    }),
    dimensions: removeUndefinedValues({
      width: report.width,
      height: report.height,
      durationSeconds: report.clip.duration,
    }),
    tags: report.tags ?? ['export', 'clip-state', report.providerKind ?? 'webcodecs'],
  }), {
    resourceKind: 'video-frame-provider',
    providerId: resourceId,
    providerKind: report.providerKind ?? 'webcodecs',
    canSeek: true,
    canProvideStaleFrame: false,
    frameFormat: report.frameFormat ?? 'video-frame',
    runtimeSourceId: report.runtimeSource?.runtimeSourceId,
    runtimeSessionKey: report.runtimeSource?.runtimeSessionKey,
    label: report.label ?? 'Export WebCodecs frame provider',
  });
}

export function canRetainExportFrameProvider(
  report: ExportFrameProviderAdmissionReport
): TimelineRuntimeAdmissionDecision {
  return canRetain(createExportFrameProviderResource(report));
}

export function reserveExportFrameProvider(
  report: ExportFrameProviderAdmissionReport
): TimelineRuntimeAdmissionDecision {
  const resource = createExportFrameProviderResource(report);
  const decision = canRetain(resource);
  if (decision.admitted) {
    retain(resource);
  }
  return decision;
}

export function releaseReservedExportFrameProvider(
  report: ExportFrameProviderAdmissionReport
): void {
  timelineRuntimeCoordinator.releaseResource(
    getRunResourceId(report.runId, `clip:${report.clip.id}:frame-provider`)
  );
}

function reportExportFrameProvider(runId: string, state: ExportClipState): void {
  const player = state.webCodecsPlayer;
  const runtimeSource = state.runtimeSource;
  if (!player) {
    return;
  }

  const status: RuntimeHealthStatus = player.isFullMode() ? 'ok' : 'warning';
  const resource = createExportFrameProviderResource({
    runId,
    clip: {
      id: state.clipId,
      mediaFileId: runtimeSource?.mediaFileId,
    },
    runtimeSource: runtimeSource?.runtimeSourceId
      ? {
          runtimeSourceId: runtimeSource.runtimeSourceId,
          runtimeSessionKey: runtimeSource.runtimeSessionKey,
          mediaFileId: runtimeSource.mediaFileId,
        }
      : undefined,
  });
  retain({
    ...resource,
    diagnostics: {
      status,
      provider: {
        providerId: getRunResourceId(runId, `clip:${state.clipId}:frame-provider`),
        providerKind: 'webcodecs',
        status,
        isReady: player.isFullMode(),
        isPlaying: player.isPlaying,
        isSeeking: player.isSeeking?.(),
        isDecodePending: player.isDecodePending?.(),
        currentTimeSeconds: player.currentTime,
        pendingSeekTimeSeconds: player.getPendingSeekTime?.() ?? null,
      },
    },
  });
}

function reportExportPreciseVideo(runId: string, state: ExportClipState): void {
  const video = state.preciseVideoElement;
  if (!video) {
    return;
  }

  const runtimeSource = state.runtimeSource;
  const status = getMediaStatus(video);
  const resourceId = getRunResourceId(runId, `clip:${state.clipId}:html-media:video`);
  const elementId = getRunResourceId(runId, `clip:${state.clipId}:video`);
  retain(createRenderResourceDescriptorFromDemand(createExportDemand({
    id: resourceId,
    resourceKind: 'html-media',
    owner: getRunOwner(runId, state.clipId, runtimeSource?.mediaFileId),
    source: removeUndefinedValues({
      sourceId: runtimeSource?.runtimeSourceId,
      mediaFileId: runtimeSource?.mediaFileId,
      clipId: state.clipId,
    }),
    tags: ['export', 'clip-state', 'html-video'],
  }), {
    resourceKind: 'html-media',
    mediaElementKind: 'video',
    elementId,
    srcKind: getSrcKind(video.currentSrc || video.src),
    diagnostics: {
      status,
      provider: {
        providerId: elementId,
        providerKind: 'html-video',
        status,
        isReady: video.readyState >= HTMLMediaElement.HAVE_METADATA,
        isPlaying: !video.paused,
        isSeeking: video.seeking,
        currentTimeSeconds: video.currentTime,
        readyState: video.readyState,
        networkState: video.networkState,
        errorCode: video.error ? String(video.error.code) : undefined,
      },
    },
    label: state.hasDedicatedPreciseVideoElement
      ? 'Export dedicated precise video element'
      : 'Export shared precise video element',
  }));
}

function createExportPreciseVideoElementResource(
  report: ExportClipElementAdmissionReport
): RenderResourceDescriptor {
  const mediaFileId = getClipElementMediaFileId(report);
  const resourceId = getRunResourceId(report.runId, `clip:${report.clip.id}:html-media:video`);
  return createRenderResourceDescriptorFromDemand(createExportDemand({
    id: resourceId,
    resourceKind: 'html-media',
    owner: getRunOwner(report.runId, report.clip.id, mediaFileId),
    source: removeUndefinedValues({
      mediaFileId,
      clipId: report.clip.id,
      trackId: report.clip.trackId,
      previewPath: report.previewPath,
    }),
    dimensions: removeUndefinedValues({
      durationSeconds: report.clip.duration,
    }),
    tags: ['export', 'clip-state', 'html-video'],
  }), {
    resourceKind: 'html-media',
    mediaElementKind: 'video',
    elementId: getRunResourceId(report.runId, `clip:${report.clip.id}:video`),
    srcKind: report.srcKind ?? 'unknown',
    label: report.dedicated === false
      ? 'Export shared precise video element'
      : 'Export dedicated precise video element',
  });
}

export function canRetainExportPreciseVideoElement(
  report: ExportClipElementAdmissionReport
): TimelineRuntimeAdmissionDecision {
  return canRetain(createExportPreciseVideoElementResource(report));
}

export function reserveExportPreciseVideoElement(
  report: ExportClipElementAdmissionReport
): TimelineRuntimeAdmissionDecision {
  const resource = createExportPreciseVideoElementResource(report);
  const decision = canRetain(resource);
  if (decision.admitted) {
    retain(resource);
  }
  return decision;
}

export function releaseReservedExportPreciseVideoElement(
  report: ExportClipElementAdmissionReport
): void {
  timelineRuntimeCoordinator.releaseResource(
    getRunResourceId(report.runId, `clip:${report.clip.id}:html-media:video`)
  );
}

function reportExportImage(runId: string, state: ExportClipState): void {
  const image = state.exportImageElement;
  if (!image) {
    return;
  }

  const runtimeSource = state.runtimeSource;
  const src = image.currentSrc || image.src;
  const status: RuntimeHealthStatus = image.complete || image.naturalWidth > 0 ? 'ok' : 'unknown';
  const resourceId = getRunResourceId(runId, `clip:${state.clipId}:image:html-image`);
  retain(createRenderResourceDescriptorFromDemand(createExportDemand({
    id: resourceId,
    resourceKind: 'image-canvas',
    owner: getRunOwner(runId, state.clipId, runtimeSource?.mediaFileId),
    source: removeUndefinedValues({
      sourceId: runtimeSource?.runtimeSourceId,
      mediaFileId: runtimeSource?.mediaFileId,
      clipId: state.clipId,
      previewPath: src || undefined,
    }),
    tags: ['export', 'clip-state', 'html-image', getSrcKind(src)],
  }), {
    resourceKind: 'image-canvas',
    imageKind: 'html-image',
    imageId: getRunResourceId(runId, `clip:${state.clipId}:image`),
    diagnostics: {
      status,
    },
    label: state.hasDedicatedExportImageElement
      ? 'Export dedicated image element'
      : 'Export shared image element',
  }));
}

function createExportImageElementResource(
  report: ExportClipElementAdmissionReport
): RenderResourceDescriptor {
  const mediaFileId = getClipElementMediaFileId(report);
  const resourceId = getRunResourceId(report.runId, `clip:${report.clip.id}:image:html-image`);
  return createRenderResourceDescriptorFromDemand(createExportDemand({
    id: resourceId,
    resourceKind: 'image-canvas',
    owner: getRunOwner(report.runId, report.clip.id, mediaFileId),
    source: removeUndefinedValues({
      mediaFileId,
      clipId: report.clip.id,
      trackId: report.clip.trackId,
      previewPath: report.previewPath,
    }),
    dimensions: removeUndefinedValues({
      durationSeconds: report.clip.duration,
    }),
    tags: ['export', 'clip-state', 'html-image', report.srcKind ?? 'unknown'],
  }), {
    resourceKind: 'image-canvas',
    imageKind: 'html-image',
    imageId: getRunResourceId(report.runId, `clip:${report.clip.id}:image`),
    label: report.dedicated === false ? 'Export shared image element' : 'Export dedicated image element',
  });
}

export function canRetainExportImageElement(
  report: ExportClipElementAdmissionReport
): TimelineRuntimeAdmissionDecision {
  return canRetain(createExportImageElementResource(report));
}

export function reserveExportImageElement(
  report: ExportClipElementAdmissionReport
): TimelineRuntimeAdmissionDecision {
  const resource = createExportImageElementResource(report);
  const decision = canRetain(resource);
  if (decision.admitted) {
    retain(resource);
  }
  return decision;
}

export function releaseReservedExportImageElement(
  report: ExportClipElementAdmissionReport
): void {
  timelineRuntimeCoordinator.releaseResource(
    getRunResourceId(report.runId, `clip:${report.clip.id}:image:html-image`)
  );
}

export function reportExportClipStates(
  runId: string,
  clipStates: ReadonlyMap<string, ExportClipState>
): void {
  for (const state of clipStates.values()) {
    reportExportRuntimeBinding(runId, state);
    reportExportFrameProvider(runId, state);
    reportExportPreciseVideo(runId, state);
    reportExportImage(runId, state);
  }
}

function getParallelDecodeStatus(
  snapshot: ParallelDecodeRuntimeSnapshot,
  clip: ParallelDecodeClipRuntimeSnapshot
): RuntimeHealthStatus {
  if (!snapshot.isActive || clip.decoderState === 'closed') return 'disposed';
  if (clip.decoderState !== 'configured') return 'warning';
  return 'ok';
}

function getExportClipSource(
  clipStates: ReadonlyMap<string, ExportClipState> | undefined,
  clipId: string
): ExportClipState['runtimeSource'] | undefined {
  return clipStates?.get(clipId)?.runtimeSource;
}

function getParallelDecodeTags(
  report: ExportParallelDecodeAdmissionReport,
  hardwareAcceleration?: string
): string[] {
  return [
    'export',
    'parallel-decode',
    report.isNested ? 'nested-clip' : 'timeline-clip',
    hardwareAcceleration ?? 'hardware-unknown',
  ];
}

function createExportParallelDecoderResource(
  report: ExportParallelDecodeAdmissionReport,
  status: RuntimeHealthStatus = 'unknown',
  hardwareAcceleration?: string
): RenderResourceDescriptor {
  const mediaFileId = getParallelDecodeMediaFileId(report);
  const decoderId = getRunResourceId(report.runId, `parallel:${report.clip.id}:decoder`);
  return createRenderResourceDescriptorFromDemand(createExportDemand({
    id: decoderId,
    resourceKind: 'native-decoder',
    owner: getRunOwner(report.runId, report.clip.id, mediaFileId),
    source: removeUndefinedValues({
      sourceId: report.runtimeSource?.runtimeSourceId,
      mediaFileId,
      clipId: report.clip.id,
      trackId: report.clip.trackId,
    }),
    dimensions: removeUndefinedValues({
      width: report.width,
      height: report.height,
      durationSeconds: report.clip.duration,
    }),
    tags: getParallelDecodeTags(report, hardwareAcceleration),
  }), {
    resourceKind: 'native-decoder',
    decoderId,
    codec: report.codec,
    container: 'mp4',
    diagnostics: {
      status,
    },
    label: 'Export parallel VideoDecoder',
  });
}

function createExportParallelFrameBufferResource(
  report: ExportParallelDecodeAdmissionReport,
  status: RuntimeHealthStatus = 'unknown',
  hardwareAcceleration?: string
): RenderResourceDescriptor {
  const mediaFileId = getParallelDecodeMediaFileId(report);
  const providerId = getRunResourceId(report.runId, `parallel:${report.clip.id}:frame-buffer`);
  return createRenderResourceDescriptorFromDemand(createExportDemand({
    id: providerId,
    resourceKind: 'video-frame-provider',
    owner: getRunOwner(report.runId, report.clip.id, mediaFileId),
    source: removeUndefinedValues({
      sourceId: report.runtimeSource?.runtimeSourceId,
      mediaFileId,
      clipId: report.clip.id,
      trackId: report.clip.trackId,
    }),
    dimensions: removeUndefinedValues({
      width: report.width,
      height: report.height,
      durationSeconds: report.clip.duration,
    }),
    tags: [...getParallelDecodeTags(report, hardwareAcceleration), 'decoded-frame-buffer'],
  }), {
    resourceKind: 'video-frame-provider',
    providerId,
    providerKind: 'webcodecs',
    canSeek: true,
    canProvideStaleFrame: false,
    frameFormat: 'video-frame',
    memoryCost: removeUndefinedValues({
      heapBytes: report.estimatedBufferedFrameBytes,
      decodedFrameBytes: report.estimatedBufferedFrameBytes,
    }),
    diagnostics: {
      status,
    },
    label: 'Export parallel decoded VideoFrame buffer',
  });
}

export function canRetainExportParallelDecoder(
  report: ExportParallelDecodeAdmissionReport
): TimelineRuntimeAdmissionDecision {
  return canRetain(createExportParallelDecoderResource(report));
}

export function reserveExportParallelDecoder(
  report: ExportParallelDecodeAdmissionReport
): TimelineRuntimeAdmissionDecision {
  const resource = createExportParallelDecoderResource(report);
  const decision = canRetain(resource);
  if (decision.admitted) {
    retain(resource);
  }
  return decision;
}

export function releaseReservedExportParallelDecoder(
  report: ExportParallelDecodeAdmissionReport
): void {
  timelineRuntimeCoordinator.releaseResource(
    getRunResourceId(report.runId, `parallel:${report.clip.id}:decoder`)
  );
}

export function canRetainExportParallelFrameBuffer(
  report: ExportParallelDecodeAdmissionReport
): TimelineRuntimeAdmissionDecision {
  return canRetain(createExportParallelFrameBufferResource(report));
}

export function reserveExportParallelFrameBuffer(
  report: ExportParallelDecodeAdmissionReport
): TimelineRuntimeAdmissionDecision {
  const resource = createExportParallelFrameBufferResource(report);
  const decision = canRetain(resource);
  if (decision.admitted) {
    retain(resource);
  }
  return decision;
}

export function releaseReservedExportParallelFrameBuffer(
  report: ExportParallelDecodeAdmissionReport
): void {
  timelineRuntimeCoordinator.releaseResource(
    getRunResourceId(report.runId, `parallel:${report.clip.id}:frame-buffer`)
  );
}

export function reportExportParallelDecodeResources(
  runId: string,
  snapshot: ParallelDecodeRuntimeSnapshot,
  clipStates?: ReadonlyMap<string, ExportClipState>
): void {
  for (const clip of snapshot.clips) {
    const runtimeSource = getExportClipSource(clipStates, clip.clipId);
    const status = getParallelDecodeStatus(snapshot, clip);
    const report: ExportParallelDecodeAdmissionReport = {
      runId,
      clip: {
        id: clip.clipId,
        mediaFileId: runtimeSource?.mediaFileId,
      },
      runtimeSource: runtimeSource?.runtimeSourceId
        ? {
            runtimeSourceId: runtimeSource.runtimeSourceId,
            runtimeSessionKey: runtimeSource.runtimeSessionKey,
            mediaFileId: runtimeSource.mediaFileId,
          }
        : undefined,
      codec: clip.codec,
      width: clip.dimensions.width,
      height: clip.dimensions.height,
      isNested: clip.isNested,
      estimatedBufferedFrameBytes: clip.estimatedBufferedFrameBytes,
    };
    const decoderId = getRunResourceId(runId, `parallel:${clip.clipId}:decoder`);
    const providerId = getRunResourceId(runId, `parallel:${clip.clipId}:frame-buffer`);
    const decoderResource = createExportParallelDecoderResource(
      report,
      status,
      clip.hardwareAcceleration
    );
    const frameBufferResource = createExportParallelFrameBufferResource(
      report,
      status,
      clip.hardwareAcceleration
    );

    retain({
      ...decoderResource,
      diagnostics: {
        status,
        provider: {
          providerId: decoderId,
          providerKind: 'native-decoder',
          status,
          isReady: clip.decoderState === 'configured',
          isDecodePending: clip.hasPendingDecode || clip.isDecoding || clip.decodeQueueSize > 0,
          isDisposed: !snapshot.isActive || clip.decoderState === 'closed',
          decodeQueueDepth: clip.decodeQueueSize,
          bufferedFrameCount: clip.frameBufferSize,
          currentTimeSeconds: clip.lastDecodedTimeSeconds,
          errorCode: clip.decoderState === 'configured' ? undefined : clip.decoderState,
        },
      },
    });

    retain({
      ...frameBufferResource,
      diagnostics: {
        status,
        provider: {
          providerId,
          providerKind: 'webcodecs',
          status,
          isReady: clip.frameBufferSize > 0,
          isDecodePending: clip.hasPendingDecode || clip.isDecoding || clip.decodeQueueSize > 0,
          isDisposed: !snapshot.isActive,
          currentTimeSeconds: clip.lastDecodedTimeSeconds,
          lastFrameTimeSeconds: clip.newestBufferedTimeSeconds,
          decodeQueueDepth: clip.decodeQueueSize,
          bufferedFrameCount: clip.frameBufferSize,
        },
      },
    });
  }
}

function createExportAudioBufferResource(report: ExportAudioBufferReport): RenderResourceDescriptor {
  const audioSourceId = getRunResourceId(
    report.runId,
    `audio:${report.stage}:${report.clipId ?? report.trackId ?? 'timeline'}`
  );
  const heapBytes = Math.max(
    0,
    report.buffer.length * report.buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT
  );

  return createRenderResourceDescriptorFromDemand(createExportDemand({
    id: audioSourceId,
    resourceKind: 'audio-source-clock',
    owner: getRunOwner(report.runId, report.clipId, report.mediaFileId),
    source: removeUndefinedValues({
      mediaFileId: report.mediaFileId,
      clipId: report.clipId,
      trackId: report.trackId,
    }),
    dimensions: {
      sampleRate: report.buffer.sampleRate,
      channelCount: report.buffer.numberOfChannels,
      durationSeconds: report.buffer.duration,
    },
    tags: ['export', 'audio', report.stage],
  }), {
    resourceKind: 'audio-source-clock',
    audioSourceId,
    clockId: audioSourceId,
    memoryCost: {
      heapBytes,
      decodedFrameBytes: heapBytes,
    },
    diagnostics: {
      status: 'ok',
      audioClock: {
        clockId: audioSourceId,
        status: 'ok',
        sampleRate: report.buffer.sampleRate,
        channelCount: report.buffer.numberOfChannels,
      },
    },
    label: `Export audio ${report.stage}`,
  });
}

export function canRetainExportAudioBuffer(
  report: ExportAudioBufferReport
): TimelineRuntimeAdmissionDecision {
  return canRetain(createExportAudioBufferResource(report));
}

export function reportExportAudioBuffer(report: ExportAudioBufferReport): void {
  retain(createExportAudioBufferResource(report));
}

function createExportPreviewFrameResource(report: ExportPreviewFrameReport): RenderResourceDescriptor {
  const resourceId = getRunResourceId(report.runId, 'preview-frame:image-bitmap');
  return createRenderResourceDescriptorFromDemand(createExportDemand({
    id: resourceId,
    resourceKind: 'image-canvas',
    owner: getRunOwner(report.runId),
    dimensions: {
      width: report.width,
      height: report.height,
    },
    source: {
      previewPath: report.currentTime.toFixed(3),
    },
    tags: ['export', 'preview-frame'],
  }), {
    resourceKind: 'image-canvas',
    imageKind: 'image-bitmap',
    imageId: getRunResourceId(report.runId, 'preview-frame'),
    memoryCost: {
      heapBytes: report.width * report.height * 4,
    },
    label: 'Export preview frame bitmap',
  });
}

export function canRetainExportPreviewFrame(
  report: ExportPreviewFrameReport
): TimelineRuntimeAdmissionDecision {
  return canRetain(createExportPreviewFrameResource(report));
}

export function reportExportPreviewFrame(report: ExportPreviewFrameReport): void {
  retain(createExportPreviewFrameResource(report));
}

export function releaseExportRunResources(runId: string): void {
  timelineRuntimeCoordinator.clearResources({
    ownerId: getExportRunOwnerId(runId),
    policyId: EXPORT_POLICY_ID,
  });
}
