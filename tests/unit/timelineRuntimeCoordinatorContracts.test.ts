import { describe, expect, it } from 'vitest';
import {
  RENDER_RESOURCE_KINDS,
  TIMELINE_RUNTIME_POLICY_DESCRIPTORS,
  TIMELINE_RUNTIME_POLICY_IDS,
  createEmptyTimelineRuntimeBridgeStats,
  createTimelineRuntimePolicyRegistry,
  isPlainTimelineRuntimeBridgeStats,
  isRenderResourceDescriptor,
} from '../../src/services/timeline/runtimeCoordinatorContracts';
import type {
  RenderResourceDescriptor,
  RuntimeProviderHealthDiagnostics,
  RuntimeSessionHealthDiagnostics,
  TimelineRuntimeCoordinatorBridgeStats,
} from '../../src/services/timeline/runtimeCoordinatorTypes';

const owner = {
  ownerId: 'clip-1',
  ownerType: 'clip' as const,
  clipId: 'clip-1',
  trackId: 'track-1',
};

const sampleResources: readonly RenderResourceDescriptor[] = [
  {
    id: 'resource-frame-provider',
    kind: 'video-frame-provider',
    policyId: 'interactive',
    owner,
    providerId: 'provider-1',
    providerKind: 'webcodecs',
    frameFormat: 'video-frame',
    runtime: {
      runtimeSourceId: 'media:media-1',
      runtimeSessionKey: 'interactive:track-1:media:media-1',
    },
    memoryCost: {
      decodedFrameBytes: 1920 * 1080 * 4,
    },
    diagnostics: {
      status: 'ok',
      provider: {
        providerId: 'provider-1',
        providerKind: 'webcodecs',
        status: 'ok',
        decodeQueueDepth: 1,
      },
    },
  },
  {
    id: 'resource-html-media',
    kind: 'html-media',
    policyId: 'thumbnail',
    owner,
    mediaElementKind: 'video',
    elementId: 'video-element-1',
    srcKind: 'blob-url',
    diagnostics: {
      status: 'warning',
      provider: {
        providerId: 'video-element-1',
        providerKind: 'html-video',
        status: 'warning',
        readyState: 2,
        networkState: 1,
      },
    },
  },
  {
    id: 'resource-image-canvas',
    kind: 'image-canvas',
    policyId: 'render-target',
    owner,
    imageKind: 'offscreen-canvas',
    imageId: 'canvas-1',
    dimensions: {
      width: 1920,
      height: 1080,
    },
  },
  {
    id: 'resource-native-decoder',
    kind: 'native-decoder',
    policyId: 'export',
    owner,
    decoderId: 'native-decoder-1',
    codec: 'prores',
    container: 'mov',
  },
  {
    id: 'resource-nested-composition',
    kind: 'nested-composition-texture',
    policyId: 'composition-render',
    owner: {
      ownerId: 'composition-1',
      ownerType: 'composition',
      compositionId: 'composition-1',
    },
    compositionId: 'composition-1',
    textureId: 'nested-texture-1',
    depth: 2,
    layerCount: 4,
    memoryCost: {
      gpuBytes: 1920 * 1080 * 4,
    },
  },
  {
    id: 'resource-model',
    kind: 'model',
    policyId: 'interactive',
    owner,
    modelId: 'model-1',
    modelKind: 'gltf',
  },
  {
    id: 'resource-gaussian-splat',
    kind: 'gaussian-splat',
    policyId: 'background',
    owner,
    splatId: 'splat-1',
    splatCount: 1000,
  },
  {
    id: 'resource-motion',
    kind: 'motion-data',
    policyId: 'slot-deck',
    owner,
    payloadId: 'motion-1',
    payloadKind: 'motion-layer',
  },
  {
    id: 'resource-audio-clock',
    kind: 'audio-source-clock',
    policyId: 'ram-preview',
    owner,
    audioSourceId: 'audio-source-1',
    clockId: 'clock-1',
    diagnostics: {
      status: 'ok',
      audioClock: {
        clockId: 'clock-1',
        status: 'ok',
        currentTimeSeconds: 2,
        driftMs: 3,
      },
    },
  },
  {
    id: 'resource-runtime-binding',
    kind: 'runtime-binding',
    policyId: 'interactive',
    owner,
    runtime: {
      runtimeSourceId: 'media:media-1',
      runtimeSessionKey: 'interactive:track-1:media:media-1',
    },
  },
];

describe('timeline runtime coordinator contracts', () => {
  it('keeps the Phase 0 runtime policy list stable', () => {
    expect(TIMELINE_RUNTIME_POLICY_IDS).toEqual([
      'interactive',
      'background',
      'slot-deck',
      'composition-render',
      'thumbnail',
      'render-target',
      'ram-preview',
      'export',
    ]);

    const registry = createTimelineRuntimePolicyRegistry();
    expect(registry.listPolicies().map((policy) => policy.id)).toEqual(
      TIMELINE_RUNTIME_POLICY_IDS
    );
    expect(registry.getPolicy('export')?.defaultBudget.maxSessions).toBeGreaterThan(0);
    expect(registry.getBudgetReport()).toHaveLength(TIMELINE_RUNTIME_POLICY_IDS.length);
  });

  it('defines every policy as a budget-reportable registry entry', () => {
    const stats = createEmptyTimelineRuntimeBridgeStats(123);
    expect(stats.policyOrder).toEqual(TIMELINE_RUNTIME_POLICY_IDS);

    for (const policy of TIMELINE_RUNTIME_POLICY_DESCRIPTORS) {
      expect(stats.policies[policy.id].descriptor.id).toBe(policy.id);
      expect(stats.policies[policy.id].budgetReport.policyId).toBe(policy.id);
      expect(stats.policies[policy.id].budgetReport.pressure.length).toBeGreaterThan(0);
      expect(policy.allowedResourceKinds.length).toBeGreaterThan(0);
    }
  });

  it('covers LayerSource-parity resource descriptor shapes with plain handles', () => {
    expect(sampleResources.map((resource) => resource.kind)).toEqual(RENDER_RESOURCE_KINDS);
    for (const resource of sampleResources) {
      expect(isRenderResourceDescriptor(resource), resource.kind).toBe(true);
      expect(JSON.stringify(resource)).not.toContain('function');
    }
  });

  it('keeps bridge-facing diagnostics plain-data and cloneable', () => {
    const provider: RuntimeProviderHealthDiagnostics = {
      providerId: 'provider-1',
      providerKind: 'webcodecs',
      status: 'ok',
      isReady: true,
      decodeQueueDepth: 0,
    };
    const session: RuntimeSessionHealthDiagnostics = {
      sourceId: 'media:media-1',
      sessionKey: 'interactive:track-1:media:media-1',
      policyId: 'interactive',
      status: 'ok',
      provider,
      audioClock: {
        clockId: 'clock-1',
        status: 'ok',
        currentTimeSeconds: 1,
      },
    };
    const empty = createEmptyTimelineRuntimeBridgeStats(123);
    const stats: TimelineRuntimeCoordinatorBridgeStats = {
      ...empty,
      policies: {
        ...empty.policies,
        interactive: {
          ...empty.policies.interactive,
          resources: [sampleResources[0], sampleResources[9]],
          sessions: [session],
        },
      },
      diagnostics: {
        providers: [provider],
        sessions: [session],
        resources: [sampleResources[0], sampleResources[9]],
        messages: [
          {
            severity: 'info',
            code: 'runtime.contract.test',
            message: 'Runtime diagnostics are plain bridge data.',
            policyId: 'interactive',
          },
        ],
      },
    };

    expect(isPlainTimelineRuntimeBridgeStats(stats)).toBe(true);
    expect(structuredClone(stats)).toEqual(stats);
    expect(JSON.parse(JSON.stringify(stats))).toEqual(stats);
  });

  it('rejects runtime objects and functions in bridge stats', () => {
    const statsWithFunction = {
      ...createEmptyTimelineRuntimeBridgeStats(123),
      diagnostics: {
        providers: [],
        sessions: [],
        resources: [],
        messages: [
          {
            severity: 'info',
            code: 'bad',
            message: 'not plain',
            dispose: () => undefined,
          },
        ],
      },
    };

    expect(isPlainTimelineRuntimeBridgeStats(statsWithFunction)).toBe(false);
  });
});
