import {
  TIMELINE_RUNTIME_POLICY_IDS,
  type RenderResourceDescriptor,
  type RenderResourceKind,
  type RuntimeHealthStatus,
  type TimelineRuntimeBudgetPressure,
  type TimelineRuntimeBudgetUnit,
  type TimelineRuntimeCoordinator,
  type TimelineRuntimeCoordinatorBridgeStats,
  type TimelineRuntimePolicyBudget,
  type TimelineRuntimePolicyBudgetReport,
  type TimelineRuntimePolicyBridgeStats,
  type TimelineRuntimePolicyDescriptor,
  type TimelineRuntimePolicyId,
  type TimelineRuntimePolicyUsage,
} from './runtimeCoordinatorTypes';

export {
  TIMELINE_RUNTIME_POLICY_IDS,
  type RenderResourceDescriptor,
  type RenderResourceKind,
  type RuntimeAudioClockDiagnostics,
  type RuntimeDiagnosticMessage,
  type RuntimeHealthStatus,
  type RuntimeProviderHealthDiagnostics,
  type RuntimeResourceDiagnostics,
  type RuntimeResourceMemoryCost,
  type RuntimeResourceOwnerDescriptor,
  type RuntimeSessionHealthDiagnostics,
  type TimelineRuntimeBudgetPressure,
  type TimelineRuntimeCoordinator,
  type TimelineRuntimeCoordinatorBridgeStats,
  type TimelineRuntimePolicyBudget,
  type TimelineRuntimePolicyBudgetReport,
  type TimelineRuntimePolicyBridgeStats,
  type TimelineRuntimePolicyDescriptor,
  type TimelineRuntimePolicyId,
  type TimelineRuntimePolicyUsage,
} from './runtimeCoordinatorTypes';

export const RENDER_RESOURCE_KINDS = [
  'video-frame-provider',
  'html-media',
  'image-canvas',
  'native-decoder',
  'nested-composition-texture',
  'model',
  'gaussian-splat',
  'motion-data',
  'audio-source-clock',
  'runtime-binding',
] as const satisfies readonly RenderResourceKind[];

const INTERACTIVE_RESOURCE_KINDS = [
  'video-frame-provider',
  'html-media',
  'image-canvas',
  'native-decoder',
  'nested-composition-texture',
  'model',
  'gaussian-splat',
  'motion-data',
  'audio-source-clock',
  'runtime-binding',
] as const satisfies readonly RenderResourceKind[];

const NON_INTERACTIVE_RESOURCE_KINDS = [
  'video-frame-provider',
  'html-media',
  'image-canvas',
  'native-decoder',
  'nested-composition-texture',
  'model',
  'gaussian-splat',
  'motion-data',
  'audio-source-clock',
  'runtime-binding',
] as const satisfies readonly RenderResourceKind[];

export const TIMELINE_RUNTIME_POLICY_DESCRIPTORS = [
  {
    id: 'interactive',
    label: 'Interactive Playback',
    mode: 'interactive',
    description: 'Active and near-active timeline resources for preview playback and scrubbing.',
    priority: 100,
    interactive: true,
    ownsPlaybackClock: true,
    allowedResourceKinds: INTERACTIVE_RESOURCE_KINDS,
    defaultBudget: {
      maxResources: 48,
      maxSessions: 16,
      maxFrameProviders: 8,
      maxHtmlMediaElements: 12,
      maxNativeDecoders: 4,
      maxGpuTextures: 16,
      maxImageBitmaps: 64,
      maxAudioSources: 8,
      maxHeapBytes: 512 * 1024 * 1024,
      maxGpuBytes: 768 * 1024 * 1024,
      warmWindowSeconds: 12,
    },
  },
  {
    id: 'background',
    label: 'Background Layers',
    mode: 'background',
    description: 'Persistent background layer resources that can render outside active clip focus.',
    priority: 70,
    interactive: false,
    ownsPlaybackClock: false,
    allowedResourceKinds: INTERACTIVE_RESOURCE_KINDS,
    defaultBudget: {
      maxResources: 32,
      maxSessions: 8,
      maxFrameProviders: 4,
      maxHtmlMediaElements: 6,
      maxNativeDecoders: 2,
      maxGpuTextures: 12,
      maxImageBitmaps: 32,
      maxAudioSources: 4,
      maxHeapBytes: 256 * 1024 * 1024,
      maxGpuBytes: 512 * 1024 * 1024,
      warmWindowSeconds: 8,
    },
  },
  {
    id: 'slot-deck',
    label: 'Slot Deck',
    mode: 'interactive',
    description: 'Program output and layer slot resources outside the editor timeline track stack.',
    priority: 80,
    interactive: true,
    ownsPlaybackClock: true,
    allowedResourceKinds: INTERACTIVE_RESOURCE_KINDS,
    defaultBudget: {
      maxResources: 48,
      maxSessions: 12,
      maxFrameProviders: 6,
      maxHtmlMediaElements: 8,
      maxNativeDecoders: 3,
      maxGpuTextures: 16,
      maxImageBitmaps: 48,
      maxAudioSources: 8,
      maxHeapBytes: 384 * 1024 * 1024,
      maxGpuBytes: 768 * 1024 * 1024,
      warmWindowSeconds: 10,
    },
  },
  {
    id: 'composition-render',
    label: 'Composition Render',
    mode: 'background',
    description: 'Nested composition evaluation and composition renderer prepared sources.',
    priority: 60,
    interactive: false,
    ownsPlaybackClock: false,
    allowedResourceKinds: NON_INTERACTIVE_RESOURCE_KINDS,
    defaultBudget: {
      maxResources: 64,
      maxSessions: 24,
      maxFrameProviders: 12,
      maxHtmlMediaElements: 12,
      maxNativeDecoders: 4,
      maxGpuTextures: 24,
      maxImageBitmaps: 96,
      maxAudioSources: 8,
      maxHeapBytes: 512 * 1024 * 1024,
      maxGpuBytes: 1024 * 1024 * 1024,
      warmWindowSeconds: 6,
    },
  },
  {
    id: 'thumbnail',
    label: 'Thumbnail',
    mode: 'background',
    description: 'Visible thumbnail DB loads, missing-thumbnail generation, and bitmap decode work.',
    priority: 40,
    interactive: false,
    ownsPlaybackClock: false,
    allowedResourceKinds: [
      'video-frame-provider',
      'html-media',
      'image-canvas',
      'native-decoder',
      'runtime-binding',
    ],
    defaultBudget: {
      maxResources: 32,
      maxSessions: 8,
      maxFrameProviders: 4,
      maxHtmlMediaElements: 4,
      maxNativeDecoders: 2,
      maxImageBitmaps: 256,
      maxJobs: 4,
      maxHeapBytes: 256 * 1024 * 1024,
      maxGpuBytes: 128 * 1024 * 1024,
    },
  },
  {
    id: 'render-target',
    label: 'Render Target',
    mode: 'background',
    description: 'Render-target generation and dependency refresh work outside live playback.',
    priority: 45,
    interactive: false,
    ownsPlaybackClock: false,
    allowedResourceKinds: NON_INTERACTIVE_RESOURCE_KINDS,
    defaultBudget: {
      maxResources: 48,
      maxSessions: 12,
      maxFrameProviders: 6,
      maxHtmlMediaElements: 6,
      maxNativeDecoders: 3,
      maxGpuTextures: 24,
      maxImageBitmaps: 96,
      maxJobs: 3,
      maxHeapBytes: 384 * 1024 * 1024,
      maxGpuBytes: 1024 * 1024 * 1024,
    },
  },
  {
    id: 'ram-preview',
    label: 'RAM Preview',
    mode: 'offline',
    description: 'RAM preview pre-render and playback resources with explicit non-interactive policy.',
    priority: 55,
    interactive: false,
    ownsPlaybackClock: true,
    allowedResourceKinds: NON_INTERACTIVE_RESOURCE_KINDS,
    defaultBudget: {
      maxResources: 96,
      maxSessions: 24,
      maxFrameProviders: 16,
      maxHtmlMediaElements: 16,
      maxNativeDecoders: 6,
      maxGpuTextures: 48,
      maxImageBitmaps: 512,
      maxAudioSources: 12,
      maxJobs: 2,
      maxHeapBytes: 1024 * 1024 * 1024,
      maxGpuBytes: 1536 * 1024 * 1024,
    },
  },
  {
    id: 'export',
    label: 'Export',
    mode: 'offline',
    description: 'Export clip preparation, seeking, layer building, audio, and cleanup resources.',
    priority: 50,
    interactive: false,
    ownsPlaybackClock: true,
    allowedResourceKinds: NON_INTERACTIVE_RESOURCE_KINDS,
    defaultBudget: {
      maxResources: 128,
      maxSessions: 48,
      maxFrameProviders: 24,
      maxHtmlMediaElements: 24,
      maxNativeDecoders: 8,
      maxGpuTextures: 64,
      maxImageBitmaps: 512,
      maxAudioSources: 24,
      maxJobs: 1,
      maxHeapBytes: 1536 * 1024 * 1024,
      maxGpuBytes: 2048 * 1024 * 1024,
    },
  },
] as const satisfies readonly TimelineRuntimePolicyDescriptor[];

export function isTimelineRuntimePolicyId(value: string): value is TimelineRuntimePolicyId {
  return (TIMELINE_RUNTIME_POLICY_IDS as readonly string[]).includes(value);
}

export function isRenderResourceKind(value: string): value is RenderResourceKind {
  return (RENDER_RESOURCE_KINDS as readonly string[]).includes(value);
}

export function createEmptyPolicyUsage(): TimelineRuntimePolicyUsage {
  return {
    resources: 0,
    sessions: 0,
    frameProviders: 0,
    htmlMediaElements: 0,
    nativeDecoders: 0,
    gpuTextures: 0,
    imageBitmaps: 0,
    audioSources: 0,
    jobs: 0,
    heapBytes: 0,
    gpuBytes: 0,
  };
}

export function getBudgetLimit(
  budget: TimelineRuntimePolicyBudget,
  unit: TimelineRuntimeBudgetPressure['unit']
): number | undefined {
  switch (unit) {
    case 'resource':
      return budget.maxResources;
    case 'session':
      return budget.maxSessions;
    case 'frame-provider':
      return budget.maxFrameProviders;
    case 'html-media-element':
      return budget.maxHtmlMediaElements;
    case 'native-decoder':
      return budget.maxNativeDecoders;
    case 'gpu-texture':
      return budget.maxGpuTextures;
    case 'image-bitmap':
      return budget.maxImageBitmaps;
    case 'audio-source':
      return budget.maxAudioSources;
    case 'job':
      return budget.maxJobs;
    case 'heap-bytes':
      return budget.maxHeapBytes;
    case 'gpu-bytes':
      return budget.maxGpuBytes;
    default:
      return undefined;
  }
}

function getUsageValue(
  usage: TimelineRuntimePolicyUsage,
  unit: TimelineRuntimeBudgetPressure['unit']
): number {
  switch (unit) {
    case 'resource':
      return usage.resources;
    case 'session':
      return usage.sessions;
    case 'frame-provider':
      return usage.frameProviders;
    case 'html-media-element':
      return usage.htmlMediaElements;
    case 'native-decoder':
      return usage.nativeDecoders;
    case 'gpu-texture':
      return usage.gpuTextures;
    case 'image-bitmap':
      return usage.imageBitmaps;
    case 'audio-source':
      return usage.audioSources;
    case 'job':
      return usage.jobs;
    case 'heap-bytes':
      return usage.heapBytes;
    case 'gpu-bytes':
      return usage.gpuBytes;
    default:
      return 0;
  }
}

function getPressureStatus(ratio: number | undefined): RuntimeHealthStatus {
  if (ratio === undefined) return 'unknown';
  if (ratio >= 1) return 'critical';
  if (ratio >= 0.8) return 'warning';
  return 'ok';
}

export function createBudgetPressure(
  budget: TimelineRuntimePolicyBudget,
  usage: TimelineRuntimePolicyUsage
): readonly TimelineRuntimeBudgetPressure[] {
  const units = [
    'resource',
    'session',
    'frame-provider',
    'html-media-element',
    'native-decoder',
    'gpu-texture',
    'image-bitmap',
    'audio-source',
    'job',
    'heap-bytes',
    'gpu-bytes',
  ] as const satisfies readonly TimelineRuntimeBudgetUnit[];

  return units.map((unit) => {
    const limit = getBudgetLimit(budget, unit);
    const used = getUsageValue(usage, unit);
    const ratio = limit && limit > 0 ? used / limit : undefined;
    return {
      unit,
      used,
      ...(limit === undefined ? {} : { limit }),
      ...(ratio === undefined ? {} : { ratio }),
      status: getPressureStatus(ratio),
    };
  });
}

export function createEmptyBudgetReport(
  descriptor: TimelineRuntimePolicyDescriptor
): TimelineRuntimePolicyBudgetReport {
  const usage = createEmptyPolicyUsage();
  return {
    policyId: descriptor.id,
    budget: descriptor.defaultBudget,
    usage,
    pressure: createBudgetPressure(descriptor.defaultBudget, usage),
    diagnostics: [],
  };
}

function createEmptyPolicyBridgeStats(
  descriptor: TimelineRuntimePolicyDescriptor
): TimelineRuntimePolicyBridgeStats {
  return {
    descriptor,
    budgetReport: createEmptyBudgetReport(descriptor),
    resources: [],
    sessions: [],
  };
}

export function createEmptyPolicyStatsRecord(): Record<
  TimelineRuntimePolicyId,
  TimelineRuntimePolicyBridgeStats
> {
  const entries = TIMELINE_RUNTIME_POLICY_DESCRIPTORS.map((descriptor) => [
    descriptor.id,
    createEmptyPolicyBridgeStats(descriptor),
  ]);
  return Object.fromEntries(entries) as Record<
    TimelineRuntimePolicyId,
    TimelineRuntimePolicyBridgeStats
  >;
}

export function createEmptyTimelineRuntimeBridgeStats(
  generatedAtMs = 0
): TimelineRuntimeCoordinatorBridgeStats {
  return {
    schemaVersion: 1,
    generatedAtMs,
    policyOrder: TIMELINE_RUNTIME_POLICY_IDS,
    policies: createEmptyPolicyStatsRecord(),
    totals: createEmptyPolicyUsage(),
    diagnostics: {
      providers: [],
      sessions: [],
      resources: [],
      messages: [],
    },
  };
}

export function createTimelineRuntimePolicyRegistry(
  descriptors: readonly TimelineRuntimePolicyDescriptor[] = TIMELINE_RUNTIME_POLICY_DESCRIPTORS
): TimelineRuntimeCoordinator {
  const policiesById = new Map<TimelineRuntimePolicyId, TimelineRuntimePolicyDescriptor>(
    descriptors.map((descriptor) => [descriptor.id, descriptor])
  );

  return {
    listPolicies: () => descriptors,
    getPolicy: (policyId) => policiesById.get(policyId) ?? null,
    getBudgetReport: (policyId) => {
      if (policyId) {
        const descriptor = policiesById.get(policyId);
        return descriptor ? [createEmptyBudgetReport(descriptor)] : [];
      }
      return descriptors.map((descriptor) => createEmptyBudgetReport(descriptor));
    },
    getBridgeStats: () => createEmptyTimelineRuntimeBridgeStats(Date.now()),
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isRenderResourceDescriptor(value: unknown): value is RenderResourceDescriptor {
  if (!isObjectRecord(value)) {
    return false;
  }
  if (typeof value.id !== 'string' || !isRenderResourceKind(String(value.kind))) {
    return false;
  }
  if (!isTimelineRuntimePolicyId(String(value.policyId))) {
    return false;
  }
  if (!isObjectRecord(value.owner) || typeof value.owner.ownerId !== 'string') {
    return false;
  }

  switch (value.kind) {
    case 'video-frame-provider':
      return typeof value.providerId === 'string' && typeof value.providerKind === 'string';
    case 'html-media':
      return (
        typeof value.elementId === 'string' &&
        (value.mediaElementKind === 'video' || value.mediaElementKind === 'audio')
      );
    case 'image-canvas':
      return typeof value.imageId === 'string' && typeof value.imageKind === 'string';
    case 'native-decoder':
      return typeof value.decoderId === 'string';
    case 'nested-composition-texture':
      return (
        typeof value.compositionId === 'string' &&
        typeof value.textureId === 'string' &&
        typeof value.depth === 'number'
      );
    case 'model':
      return typeof value.modelId === 'string' && typeof value.modelKind === 'string';
    case 'gaussian-splat':
      return typeof value.splatId === 'string';
    case 'motion-data':
      return typeof value.payloadId === 'string' && typeof value.payloadKind === 'string';
    case 'audio-source-clock':
      return typeof value.audioSourceId === 'string';
    case 'runtime-binding':
      return (
        isObjectRecord(value.runtime) &&
        typeof value.runtime.runtimeSourceId === 'string' &&
        typeof value.runtime.runtimeSessionKey === 'string'
      );
    default:
      return false;
  }
}

function isPlainDataValue(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null) return true;
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined') {
    return false;
  }
  if (typeof value !== 'object') {
    return true;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const isPlainArray = value.every((entry) => isPlainDataValue(entry, seen));
    seen.delete(value);
    return isPlainArray;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    seen.delete(value);
    return false;
  }

  const isPlainObject = Object.values(value).every((entry) => isPlainDataValue(entry, seen));
  seen.delete(value);
  return isPlainObject;
}

export function isPlainTimelineRuntimeBridgeStats(
  value: unknown
): value is TimelineRuntimeCoordinatorBridgeStats {
  if (!isObjectRecord(value)) {
    return false;
  }
  return value.schemaVersion === 1 && isPlainDataValue(value);
}
