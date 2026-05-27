/**
 * AI Tools Bridge - connects browser to Vite dev server via HMR
 * so external agents (Claude CLI) can execute aiTools via HTTP POST.
 *
 * Flow: POST /api/ai-tools → Vite server → HMR → browser → aiTools.execute() → HMR → HTTP response
 *
 * Uses direct import of executeAITool (not window.aiTools) to enforce 'devBridge' caller context.
 */
import { executeAITool, AI_TOOLS, getQuickTimelineSummary } from './index';
import type { AIToolExecutionOptions } from './types';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { useDockStore } from '../../stores/dockStore';
import { useGuidedActionStore } from '../../stores/guidedActionStore';
import { useRenderTargetStore } from '../../stores/renderTargetStore';
import { layerPlaybackManager } from '../layerPlaybackManager';
import { layerBuilder } from '../layerBuilder';
import { projectFileService } from '../projectFileService';
import { loadProjectToStores } from '../project/projectLoad';
import { compileGuidedToolCall, inspectGuidedToolCall } from '../guidedActions';

const tabId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `tab-${Math.random().toString(36).slice(2, 10)}`;
const BRIDGE_GUIDED_OPTIONS_ARG = '__guidedOptions';

function getTabPriorityDelayMs(isTargetedRequest = false): number {
  if (typeof document === 'undefined') return 0;

  const isVisible = document.visibilityState === 'visible';
  const hasFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;

  if (!isVisible) return isTargetedRequest ? 500 : -1;
  if (hasFocus) return 0;
  return 150;
}

function resolveBridgeToolExecution(
  args: unknown,
  options: unknown,
): { args: Record<string, unknown>; options: AIToolExecutionOptions } {
  const normalizedArgs = isRecord(args) ? args : {};
  const inlineOptions = normalizedArgs[BRIDGE_GUIDED_OPTIONS_ARG];
  const toolArgs = { ...normalizedArgs };
  delete toolArgs[BRIDGE_GUIDED_OPTIONS_ARG];

  return {
    args: toolArgs,
    options: sanitizeBridgeToolOptions(mergeBridgeOptions(inlineOptions, options)),
  };
}

function mergeBridgeOptions(inlineOptions: unknown, hmrOptions: unknown): unknown {
  if (isRecord(inlineOptions) || isRecord(hmrOptions)) {
    return {
      ...(isRecord(inlineOptions) ? inlineOptions : {}),
      ...(isRecord(hmrOptions) ? hmrOptions : {}),
    };
  }
  return hmrOptions ?? inlineOptions;
}

function sanitizeBridgeToolOptions(options: unknown): AIToolExecutionOptions {
  if (!isRecord(options)) {
    return {};
  }

  const sanitized: AIToolExecutionOptions = {};

  if (typeof options.guidedReplay === 'boolean') {
    sanitized.guidedReplay = options.guidedReplay;
  }

  if (typeof options.guidedAnimationBudgetMs === 'number' && Number.isFinite(options.guidedAnimationBudgetMs)) {
    sanitized.guidedAnimationBudgetMs = clampGuidedReplayBudgetMs(options.guidedAnimationBudgetMs);
  }

  if (isGuidedVisualizationMode(options.guidedVisualizationMode)) {
    sanitized.guidedVisualizationMode = options.guidedVisualizationMode;
  }

  if (isGuidedCompressionMode(options.guidedCompressionMode)) {
    sanitized.guidedCompressionMode = options.guidedCompressionMode;
  }

  if (isGuidedLegacyFeedback(options.guidedLegacyFeedback)) {
    sanitized.guidedLegacyFeedback = options.guidedLegacyFeedback;
  }

  return sanitized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGuidedVisualizationMode(value: unknown): value is NonNullable<AIToolExecutionOptions['guidedVisualizationMode']> {
  return value === 'off' || value === 'concise' || value === 'full';
}

function isGuidedCompressionMode(value: unknown): value is NonNullable<AIToolExecutionOptions['guidedCompressionMode']> {
  return value === 'none' || value === 'family' || value === 'aggressive';
}

function isGuidedLegacyFeedback(value: unknown): value is NonNullable<AIToolExecutionOptions['guidedLegacyFeedback']> {
  return value === 'native' || value === 'bridge' || value === 'off';
}

function clampGuidedReplayBudgetMs(value: number): number {
  return Math.max(0, Math.round(value));
}

function collectDebugState(scope: string = 'all') {
  const timelineState = useTimelineStore.getState();
  const mediaState = useMediaStore.getState();
  const dockState = useDockStore.getState();
  const guidedState = useGuidedActionStore.getState();
  const renderTargetState = useRenderTargetStore.getState();
  const activeLayers = Object.fromEntries(
    layerPlaybackManager.getActiveLayerIndices().map((layerIndex) => [
      layerIndex,
      layerPlaybackManager.getLayerPlaybackInfo(layerIndex),
    ]),
  );
  const activeComposition = mediaState.compositions.find((composition) => composition.id === mediaState.activeCompositionId);
  const activeCompositionTimeline = activeComposition?.timelineData;
  const persistedKeyframeCounts = (activeCompositionTimeline?.clips || [])
    .map((clip) => ({
      clipId: clip.id,
      count: Array.isArray(clip.keyframes) ? clip.keyframes.length : 0,
      properties: Array.from(new Set((clip.keyframes || []).map((keyframe) => keyframe.property))).sort(),
    }))
    .filter((entry) => entry.count > 0);

  const renderTargets = Array.from(renderTargetState.targets.values()).map((target) => ({
    id: target.id,
    name: target.name,
    source: target.source,
    enabled: target.enabled,
    destinationType: target.destinationType,
    hasCanvas: !!target.canvas,
    hasWindow: !!target.window,
    showTransparencyGrid: target.showTransparencyGrid,
  }));

  const keyframeCounts = Array.from(timelineState.clipKeyframes.entries()).map(([clipId, keyframes]) => ({
    clipId,
    count: keyframes.length,
    properties: Array.from(new Set(keyframes.map((keyframe) => keyframe.property))).sort(),
  }));

  let builtLayers: Array<{
    id: string;
    name: string;
    sourceType: string | null;
    sourceClipId?: string;
    is3D: boolean;
    hasNestedComposition: boolean;
  }> = [];

  if (scope === 'all' || scope === 'preview') {
    try {
      builtLayers = layerBuilder.buildLayersFromStore()
        .filter((layer): layer is NonNullable<typeof layer> => layer != null)
        .map((layer) => ({
          id: layer.id,
          name: layer.name,
          sourceType: layer.source?.type ?? null,
          sourceClipId: layer.sourceClipId,
          is3D: layer.is3D === true,
          hasNestedComposition: !!layer.source?.nestedComposition,
        }));
    } catch (error) {
      builtLayers = [{
        id: '__error__',
        name: error instanceof Error ? error.message : String(error),
        sourceType: 'error',
        is3D: false,
        hasNestedComposition: false,
      }];
    }
  }

  return {
    scope,
    capturedAt: new Date().toISOString(),
    tabId,
    timeline: {
      playheadPosition: timelineState.playheadPosition,
      isPlaying: timelineState.isPlaying,
      slotGridProgress: timelineState.slotGridProgress,
      selectedClipIds: Array.from(timelineState.selectedClipIds),
      primarySelectedClipId: timelineState.primarySelectedClipId,
      clipCount: timelineState.clips.length,
      keyframeClipCount: timelineState.clipKeyframes.size,
      keyframeCounts,
    },
    media: {
      activeCompositionId: mediaState.activeCompositionId,
      previewCompositionId: mediaState.previewCompositionId,
      selectedSlotCompositionId: mediaState.selectedSlotCompositionId,
      activeLayerSlots: mediaState.activeLayerSlots,
      slotAssignments: mediaState.slotAssignments,
      slotClipSettings: mediaState.slotClipSettings,
      openCompositionIds: mediaState.openCompositionIds,
      activeCompositionPersistedKeyframeClipCount: persistedKeyframeCounts.length,
      activeCompositionPersistedKeyframeCounts: persistedKeyframeCounts,
    },
    project: {
      isOpen: projectFileService.isProjectOpen(),
      hasUnsavedChanges: projectFileService.hasUnsavedChanges(),
    },
    guided: {
      activeSession: guidedState.activeSession
        ? {
            id: guidedState.activeSession.id,
            status: guidedState.activeSession.status,
            label: guidedState.activeSession.label,
            playbackMode: guidedState.activeSession.context.playbackMode,
            visualizationMode: guidedState.activeSession.context.visualizationMode,
            inputLockMode: guidedState.activeSession.context.inputLock.mode,
            plannedDurationMs: guidedState.activeSession.plan.diagnostics.plannedDurationMs,
            actionCount: guidedState.activeSession.plan.diagnostics.actionCount,
          }
        : null,
      currentStep: guidedState.currentStep
        ? {
            index: guidedState.currentStep.index,
            type: guidedState.currentStep.action.type,
            family: guidedState.currentStep.family,
            label: guidedState.currentStep.action.label,
            startsAtMs: guidedState.currentStep.startsAtMs,
            plannedDurationMs: guidedState.currentStep.plannedDurationMs,
          }
        : null,
      diagnosticCount: guidedState.diagnostics.length,
      recentDiagnostics: guidedState.diagnostics.slice(-5),
      eventCount: guidedState.eventLog.length,
    },
    layerPlayback: activeLayers,
    builtLayers,
    renderTargets,
    dock: {
      activePanelTypes: dockState.layout.root
        ? dockState.layout.root.kind === 'tab-group'
          ? dockState.layout.root.panels.map((panel) => panel.type)
          : []
        : [],
    },
  };
}

function inspectGuidedBridgeTool(args: Record<string, unknown>) {
  const tool = typeof args.tool === 'string'
    ? args.tool
    : typeof args.name === 'string'
      ? args.name
      : '';
  const toolArgs = isRecord(args.args) ? args.args : {};

  if (!tool) {
    return { success: false, error: 'Missing guided tool name. Pass { tool, args }.' };
  }

  const toolCall = { tool, args: toolArgs };
  const compiled = compileGuidedToolCall(toolCall);
  return {
    success: true,
    data: {
      actions: inspectGuidedToolCall(toolCall),
      diagnostics: compiled.diagnostics,
      tool,
    },
  };
}

async function runDebugAction(action: string, args: Record<string, unknown> = {}) {
  const timelineState = useTimelineStore.getState();
  const mediaState = useMediaStore.getState();

  switch (action) {
    case 'set-slot-view': {
      const progress = typeof args.progress === 'number' ? args.progress : 1;
      timelineState.setSlotGridProgress(progress);
      return { success: true, data: { action, progress } };
    }
    case 'activate-slot': {
      const compositionId = typeof args.compositionId === 'string' ? args.compositionId : null;
      const layerIndex = typeof args.layerIndex === 'number' ? args.layerIndex : 0;
      const select = args.select !== false;
      const open = args.open === true;
      const play = args.play === true;
      if (!compositionId) {
        return { success: false, error: 'Missing compositionId' };
      }

      const composition = mediaState.compositions.find((entry) => entry.id === compositionId);
      if (!composition) {
        return { success: false, error: `Composition not found: ${compositionId}` };
      }

      mediaState.ensureSlotClipSettings(compositionId, composition.duration);
      if (select) {
        mediaState.selectSlotComposition(compositionId);
      }
      if (open) {
        mediaState.openCompositionTab(compositionId, { skipAnimation: true });
      }
      mediaState.activateOnLayer(compositionId, layerIndex);
      if (play) {
        layerPlaybackManager.playLayer(layerIndex);
      }

      return { success: true, data: { action, compositionId, layerIndex, select, open, play } };
    }
    case 'play-slot-layer': {
      const layerIndex = typeof args.layerIndex === 'number' ? args.layerIndex : 0;
      layerPlaybackManager.playLayer(layerIndex);
      return { success: true, data: { action, layerIndex } };
    }
    case 'pause-slot-layer': {
      const layerIndex = typeof args.layerIndex === 'number' ? args.layerIndex : 0;
      layerPlaybackManager.pauseLayer(layerIndex);
      return { success: true, data: { action, layerIndex } };
    }
    case 'stop-slot-layer': {
      const layerIndex = typeof args.layerIndex === 'number' ? args.layerIndex : 0;
      layerPlaybackManager.stopLayer(layerIndex);
      return { success: true, data: { action, layerIndex } };
    }
    case 'deactivate-all-slots': {
      mediaState.deactivateAllLayers();
      mediaState.selectSlotComposition(null);
      return { success: true, data: { action } };
    }
    case 'load-project-path': {
      const projectPath = typeof args.path === 'string' ? args.path : '';
      if (!projectPath) {
        return { success: false, error: 'Missing path' };
      }

      const loaded = await projectFileService.loadProject(projectPath);
      if (!loaded) {
        return { success: false, error: `Failed to load project: ${projectPath}` };
      }

      await loadProjectToStores();
      return {
        success: true,
        data: {
          action,
          projectPath,
          projectName: projectFileService.getProjectData()?.name ?? null,
        },
      };
    }
    case 'reload-page': {
      window.location.reload();
      return { success: true, data: { action } };
    }
    default:
      return { success: false, error: `Unknown debug action: ${action}` };
  }
}

if (import.meta.hot) {
  let presenceIntervalId: number | null = null;
  const sendPresence = () => {
    import.meta.hot!.send('ai-tools:presence', {
      tabId,
      visibilityState: typeof document !== 'undefined' ? document.visibilityState : 'hidden',
      hasFocus: typeof document !== 'undefined' && typeof document.hasFocus === 'function'
        ? document.hasFocus()
        : false,
    });
  };

  sendPresence();
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', sendPresence);
    window.addEventListener('blur', sendPresence);
    document.addEventListener('visibilitychange', sendPresence);
    presenceIntervalId = window.setInterval(sendPresence, 10000);
  }

  import.meta.hot.dispose(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', sendPresence);
      window.removeEventListener('blur', sendPresence);
      document.removeEventListener('visibilitychange', sendPresence);
      if (presenceIntervalId !== null) {
        window.clearInterval(presenceIntervalId);
      }
    }
  });

  import.meta.hot.on('ai-tools:execute', async (data: {
    requestId: string;
    tool: string;
    args: Record<string, unknown>;
    options?: unknown;
    targetTabId?: string | null;
  }) => {
    if (data.targetTabId && data.targetTabId !== tabId) {
      return;
    }

    try {
      const delayMs = getTabPriorityDelayMs(data.targetTabId === tabId);
      if (delayMs < 0) {
        return;
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      let result: unknown;
      if (data.tool === '_list') {
        result = { success: true, data: AI_TOOLS };
      } else if (data.tool === '_status') {
        result = { success: true, data: getQuickTimelineSummary() };
      } else if (data.tool === '_inspectGuided') {
        result = inspectGuidedBridgeTool(data.args);
      } else {
        const execution = resolveBridgeToolExecution(data.args, data.options);
        result = await executeAITool(data.tool, execution.args, 'devBridge', execution.options);
      }

      import.meta.hot!.send('ai-tools:result', {
        requestId: data.requestId,
        result,
      });
    } catch (error: unknown) {
      import.meta.hot!.send('ai-tools:result', {
        requestId: data.requestId,
        result: { success: false, error: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  import.meta.hot.on('debug-state:request', async (data: {
    requestId: string;
    scope?: string;
    targetTabId?: string | null;
  }) => {
    if (data.targetTabId && data.targetTabId !== tabId) {
      return;
    }

    try {
      const delayMs = getTabPriorityDelayMs(data.targetTabId === tabId);
      if (delayMs < 0) {
        return;
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      import.meta.hot!.send('debug-state:result', {
        requestId: data.requestId,
        result: { success: true, data: collectDebugState(data.scope) },
      });
    } catch (error: unknown) {
      import.meta.hot!.send('debug-state:result', {
        requestId: data.requestId,
        result: { success: false, error: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  import.meta.hot.on('debug-action:request', async (data: {
    requestId: string;
    action: string;
    args?: Record<string, unknown>;
    targetTabId?: string | null;
  }) => {
    if (data.targetTabId && data.targetTabId !== tabId) {
      return;
    }

    try {
      const delayMs = getTabPriorityDelayMs(data.targetTabId === tabId);
      if (delayMs < 0) {
        return;
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      import.meta.hot!.send('debug-action:result', {
        requestId: data.requestId,
        result: await runDebugAction(data.action, data.args ?? {}),
      });
    } catch (error: unknown) {
      import.meta.hot!.send('debug-action:result', {
        requestId: data.requestId,
        result: { success: false, error: error instanceof Error ? error.message : String(error) },
      });
    }
  });
}
