import type {
  GuidedAction,
  GuidedActionFamily,
  GuidedTargetRef,
  GuidedToolCall,
  ValidationCheck,
} from '../types';
import type { GuidedToolChoreography, GuidedToolChoreographyContext } from './types';

type ClipTransformCheck = Extract<ValidationCheck, { kind: 'clipTransformMatches' }>;
type ClipTransformProperty = ClipTransformCheck['property'];

interface TransformPropertyChange {
  arg: string;
  property: string;
  value: unknown;
  target: GuidedTargetRef;
}

const CHOREOGRAPHIES = new Map<string, GuidedToolChoreography>([
  ['selectClips', compileSelectClips],
  ['setPlayhead', compileSetPlayhead],
  ['setTransform', compileSetTransform],
  ['splitClip', compileTimelineEdit],
  ['splitClipEvenly', compileTimelineEdit],
  ['splitClipAtTimes', compileTimelineEdit],
  ['trimClip', compileTimelineEdit],
  ['moveClip', compileTimelineEdit],
  ['deleteClip', compileTimelineEdit],
  ['deleteClips', compileTimelineEdit],
  ['addRectangleMask', compileMaskEdit],
  ['addEllipseMask', compileMaskEdit],
  ['addMask', compileMaskEdit],
  ['updateMask', compileMaskEdit],
  ['addEffect', compileEffectEdit],
  ['updateEffect', compileEffectEdit],
  ['addKeyframe', compileKeyframeEdit],
  ['captureFrame', compilePreviewAction],
  ['importLocalFiles', compileMediaAction],
]);

const TRANSFORM_ARG_PROPERTIES: Array<[string, string]> = [
  ['x', 'position.x'],
  ['y', 'position.y'],
  ['z', 'position.z'],
  ['scaleAll', 'scale.all'],
  ['scaleX', 'scale.x'],
  ['scaleY', 'scale.y'],
  ['scaleZ', 'scale.z'],
  ['rotation', 'rotation.z'],
  ['rotationX', 'rotation.x'],
  ['rotationY', 'rotation.y'],
  ['rotationZ', 'rotation.z'],
  ['opacity', 'opacity'],
  ['blendMode', 'blendMode'],
];

const CONFIRMABLE_TRANSFORM_PROPERTIES = new Set<string>([
  'position.x',
  'position.y',
  'position.z',
  'scale.x',
  'scale.y',
  'scale.z',
  'rotation.x',
  'rotation.y',
  'rotation.z',
]);

export function getGuidedToolChoreography(tool: string): GuidedToolChoreography | undefined {
  return CHOREOGRAPHIES.get(tool);
}

export function createDefaultToolChoreography(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const family = inferFallbackFamily(toolCall.tool);
  const actions: GuidedAction[] = [
    {
      type: 'callout',
      title: `Executing ${formatToolName(toolCall.tool)}`,
      body: 'Applying the requested edit.',
      family,
      label: `Execute ${toolCall.tool}`,
    },
    createExecutionAction(toolCall, family),
  ];

  if (context.includeValidation) {
    actions.push(createCustomConfirmation(toolCall, family));
  }

  return actions;
}

export function normalizeBatchToolCalls(actions: unknown): GuidedToolCall[] {
  if (!Array.isArray(actions)) {
    return [];
  }

  return actions.flatMap((action, index) => {
    if (!isRecord(action) || typeof action.tool !== 'string') {
      return [];
    }

    const tool = action.tool;
    const args = isRecord(action.args)
      ? action.args
      : objectWithout(action, ['tool', 'args']);

    return [{
      id: typeof action.id === 'string' ? action.id : `batch-${index}-${tool}`,
      tool,
      args,
    }];
  });
}

export function stripExecutionActions(actions: GuidedAction[]): GuidedAction[] {
  return actions.filter((action) => (
    action.type !== 'executeTool'
    && action.type !== 'confirmState'
    && action.type !== 'waitForUserAction'
  ));
}

function compileSelectClips(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const family: GuidedActionFamily = 'selection-navigation';
  const clipIds = readStringArray(toolCall.args.clipIds);
  const primaryClipId = clipIds[0];
  const primaryTarget = primaryClipId ? clipTarget(primaryClipId) : undefined;
  const actions: GuidedAction[] = [
    { type: 'focusPanel', panel: 'timeline', family, label: 'Open timeline' },
  ];

  if (primaryTarget) {
    actions.push(
      { type: 'resolveTarget', target: primaryTarget, required: false, family },
      { type: 'highlightTarget', target: primaryTarget, tone: 'primary', durationMs: 350, family },
      { type: 'callout', title: 'Select clips', body: `${clipIds.length} clip${clipIds.length === 1 ? '' : 's'}`, target: primaryTarget, family },
    );
  } else {
    actions.push({ type: 'callout', title: 'Select clips', body: 'Updating the current selection.', family });
  }

  actions.push(createExecutionAction(toolCall, family));

  if (context.includeValidation) {
    actions.push(...clipIds.map((clipId): GuidedAction => ({
      type: 'confirmState',
      check: { kind: 'clipSelected', clipId },
      family,
      label: `Confirm ${clipId} selected`,
    })));
  }

  return actions;
}

function compileSetPlayhead(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const family: GuidedActionFamily = 'selection-navigation';
  const time = readNumber(toolCall.args.time);
  const actions: GuidedAction[] = [
    { type: 'focusPanel', panel: 'timeline', family, label: 'Open timeline' },
  ];

  if (time !== null) {
    const timeTarget: GuidedTargetRef = { kind: 'timelineTime', time };
    actions.push(
      { type: 'setPlayheadVisual', time, family, label: `Move playhead to ${time}s` },
      { type: 'scrollIntoView', target: timeTarget, block: 'center', family, label: `Reveal ${time}s` },
      { type: 'moveCursorTo', target: timeTarget, durationMs: 500, family, label: `Point at ${time}s` },
      { type: 'highlightTarget', target: timeTarget, tone: 'primary', durationMs: 350, family },
      { type: 'callout', title: 'Move playhead', body: `Set timeline position to ${time}s.`, target: timeTarget, family },
    );
  } else {
    actions.push({ type: 'callout', title: 'Move playhead', body: 'Updating the timeline position.', family });
  }

  actions.push(createExecutionAction(toolCall, family));

  if (context.includeValidation) {
    actions.push(time !== null
      ? {
        type: 'confirmState',
        check: { kind: 'playheadAtTime', time, toleranceSeconds: 0.001 },
        family,
        label: 'Confirm playhead position',
      }
      : createCustomConfirmation(toolCall, family));
  }

  return actions;
}

function compileSetTransform(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const family: GuidedActionFamily = 'property-edit';
  const clipId = readString(toolCall.args.clipId);
  const changes = getTransformPropertyChanges(toolCall.args, clipId);
  const primaryTarget = changes[0]?.target ?? (clipId ? clipTarget(clipId) : undefined);
  const actions: GuidedAction[] = [];

  if (clipId) {
    actions.push(
      { type: 'selectClip', clipId, family, label: 'Select clip' },
      { type: 'focusPanel', panel: 'clip-properties', family, label: 'Open Properties' },
      { type: 'openPropertiesTab', tab: 'transform', family, label: 'Open Transform' },
      { type: 'resolveTarget', target: { kind: 'propertiesTab', tab: 'transform' }, required: false, family },
    );
  }

  for (const change of changes) {
    actions.push(
      { type: 'resolveTarget', target: change.target, required: false, family },
      { type: 'highlightTarget', target: change.target, tone: 'primary', durationMs: 350, family, label: `Highlight ${change.property}` },
    );
  }

  actions.push({
    type: 'callout',
    title: 'Update transform',
    body: changes.length > 0
      ? changes.map((change) => formatPropertyName(change.property)).join(', ')
      : 'Applying transform changes.',
    target: primaryTarget,
    family,
  });
  actions.push(createExecutionAction(toolCall, family));

  if (context.includeValidation && clipId) {
    const confirmations = changes
      .map((change) => createTransformConfirmation(clipId, change))
      .filter((action): action is GuidedAction => action !== null);
    actions.push(...confirmations);
    if (confirmations.length === 0) {
      actions.push(createCustomConfirmation(toolCall, family));
    }
  }

  return actions;
}

function compileTimelineEdit(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const family: GuidedActionFamily = 'timeline-edit';
  const clipIds = getTimelineClipIds(toolCall);
  const primaryClipId = clipIds[0];
  const primaryTarget = primaryClipId ? clipTarget(primaryClipId) : undefined;
  const splitTime = getTimelineTime(toolCall);
  const actions: GuidedAction[] = [
    { type: 'focusPanel', panel: 'timeline', family, label: 'Open timeline' },
  ];

  if (primaryTarget) {
    actions.push(
      { type: 'resolveTarget', target: primaryTarget, required: false, family },
      { type: 'highlightTarget', target: primaryTarget, tone: getTimelineTone(toolCall.tool), durationMs: 420, family },
    );
  }

  if (typeof splitTime === 'number') {
    const timeTarget: GuidedTargetRef = { kind: 'timelineTime', time: splitTime };
    actions.push(
      { type: 'setPlayheadVisual', time: splitTime, family, label: `Move playhead to ${splitTime}s` },
      { type: 'scrollIntoView', target: timeTarget, block: 'center', family, label: `Reveal ${splitTime}s` },
      { type: 'moveCursorTo', target: timeTarget, durationMs: 260, family, label: `Point at ${splitTime}s` },
      { type: 'highlightTarget', target: timeTarget, tone: getTimelineTone(toolCall.tool), durationMs: 260, family },
    );
  }

  actions.push({
    type: 'callout',
    title: formatToolName(toolCall.tool),
    body: describeTimelineEdit(toolCall),
    target: primaryTarget,
    family,
  });
  actions.push(createExecutionAction(toolCall, family));

  if (context.includeValidation) {
    actions.push(createCustomConfirmation(toolCall, family));
  }

  return actions;
}

function compileMaskEdit(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const family: GuidedActionFamily = 'mask-edit';
  const clipId = readString(toolCall.args.clipId);
  const toolbarTarget = getMaskToolbarTarget(toolCall.tool);
  const actions: GuidedAction[] = [
    { type: 'focusPanel', panel: 'clip-properties', family, label: 'Open Properties' },
    { type: 'openPropertiesTab', tab: 'masks', family, label: 'Open Masks' },
    { type: 'resolveTarget', target: { kind: 'propertiesTab', tab: 'masks' }, required: false, family },
  ];

  if (clipId) {
    actions.unshift({ type: 'selectClip', clipId, family, label: 'Select clip' });
  }

  if (toolbarTarget) {
    actions.push(
      { type: 'resolveTarget', target: toolbarTarget, required: false, family },
      { type: 'highlightTarget', target: toolbarTarget, tone: 'primary', durationMs: 350, family },
    );
  }

  const path = getMaskPath(toolCall.args.vertices);
  if (path.length > 0) {
    actions.push({ type: 'drawPreviewPath', points: path, close: toolCall.args.closed !== false, family, label: 'Preview mask path' });
  }

  actions.push({
    type: 'callout',
    title: formatToolName(toolCall.tool),
    body: clipId ? `Editing masks on ${clipId}.` : 'Editing masks.',
    target: toolbarTarget ?? { kind: 'propertiesTab', tab: 'masks' },
    family,
  });
  actions.push(createExecutionAction(toolCall, family));

  if (context.includeValidation && clipId) {
    actions.push({
      type: 'confirmState',
      check: toolCall.tool === 'updateMask' && readString(toolCall.args.maskId)
        ? { kind: 'activeMask', clipId, maskId: readString(toolCall.args.maskId)! }
        : { kind: 'maskExists', clipId },
      family,
      label: 'Confirm mask change',
    });
  }

  return actions;
}

function compileEffectEdit(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const family: GuidedActionFamily = 'property-edit';
  const clipId = readString(toolCall.args.clipId);
  const effectId = readString(toolCall.args.effectId);
  const effectType = readString(toolCall.args.effectType);
  const actions = compilePropertiesStackEdit(toolCall, family, 'effects', 'Edit effect');

  if (context.includeValidation && clipId) {
    actions.push({
      type: 'confirmState',
      check: {
        kind: 'effectExists',
        clipId,
        ...(effectId ? { effectId } : {}),
        ...(effectType ? { effectType } : {}),
      },
      family,
      label: 'Confirm effect change',
    });
  }

  return actions;
}

function compileKeyframeEdit(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const family: GuidedActionFamily = 'keyframes';
  const clipId = readString(toolCall.args.clipId);
  const property = readString(toolCall.args.property);
  const time = readNumber(toolCall.args.time);
  const actions = compilePropertiesStackEdit(toolCall, family, 'transform', 'Add keyframe');

  if (property && clipId) {
    const target: GuidedTargetRef = { kind: 'propertyControl', property, clipId };
    actions.splice(actions.length - 1, 0,
      { type: 'resolveTarget', target, required: false, family },
      { type: 'highlightTarget', target, tone: 'primary', durationMs: 350, family },
    );
  }

  if (context.includeValidation && clipId) {
    actions.push({
      type: 'confirmState',
      check: {
        kind: 'keyframeExists',
        clipId,
        ...(property ? { property } : {}),
        ...(time !== null ? { time } : {}),
      },
      family,
      label: 'Confirm keyframe',
    });
  }

  return actions;
}

function compilePreviewAction(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const family: GuidedActionFamily = 'playback-debug';
  const previewTarget: GuidedTargetRef = { kind: 'panel', panel: 'preview' };
  const actions: GuidedAction[] = [
    { type: 'focusPanel', panel: 'preview', family, label: 'Open Preview' },
    { type: 'resolveTarget', target: previewTarget, required: false, family },
    { type: 'spotlight', target: previewTarget, family, label: 'Spotlight Preview' },
    { type: 'callout', title: formatToolName(toolCall.tool), body: 'Capturing the current preview frame.', target: previewTarget, family },
    createExecutionAction(toolCall, family),
  ];

  if (context.includeValidation) {
    actions.push(createCustomConfirmation(toolCall, family));
  }

  return actions;
}

function compileMediaAction(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const family: GuidedActionFamily = 'media';
  const actions: GuidedAction[] = [
    { type: 'focusPanel', panel: 'media', family, label: 'Open Media' },
    { type: 'callout', title: formatToolName(toolCall.tool), body: describeMediaAction(toolCall), family },
    createExecutionAction(toolCall, family),
  ];

  if (context.includeValidation) {
    actions.push({
      type: 'confirmState',
      check: { kind: 'mediaItemImported' },
      family,
      label: 'Confirm media import',
    });
  }

  return actions;
}

function compilePropertiesStackEdit(
  toolCall: GuidedToolCall,
  family: GuidedActionFamily,
  tab: string,
  title: string,
): GuidedAction[] {
  const clipId = readString(toolCall.args.clipId);
  const tabTarget: GuidedTargetRef = { kind: 'propertiesTab', tab };
  const actions: GuidedAction[] = [];

  if (clipId) {
    actions.push({ type: 'selectClip', clipId, family, label: 'Select clip' });
  }

  actions.push(
    { type: 'focusPanel', panel: 'clip-properties', family, label: 'Open Properties' },
    { type: 'openPropertiesTab', tab, family, label: `Open ${tab}` },
    { type: 'resolveTarget', target: tabTarget, required: false, family },
    { type: 'highlightTarget', target: tabTarget, tone: 'primary', durationMs: 350, family },
    { type: 'callout', title, body: formatToolName(toolCall.tool), target: tabTarget, family },
    createExecutionAction(toolCall, family),
  );

  return actions;
}

function createExecutionAction(toolCall: GuidedToolCall, family: GuidedActionFamily): GuidedAction {
  return {
    type: 'executeTool',
    tool: toolCall.tool,
    args: toolCall.args,
    family,
    label: `Execute ${toolCall.tool}`,
  };
}

function createCustomConfirmation(toolCall: GuidedToolCall, family: GuidedActionFamily): GuidedAction {
  return {
    type: 'confirmState',
    check: {
      kind: 'custom',
      id: `guided-tool:${toolCall.tool}`,
      label: `Confirm ${toolCall.tool}`,
      data: {
        tool: toolCall.tool,
        args: toolCall.args,
      },
    },
    family,
    label: `Confirm ${toolCall.tool}`,
  };
}

function createTransformConfirmation(
  clipId: string,
  change: TransformPropertyChange,
): GuidedAction | null {
  const numericValue = readNumber(change.value);
  if (numericValue === null || !isConfirmableTransformProperty(change.property)) {
    return null;
  }

  return {
    type: 'confirmState',
    check: {
      kind: 'clipTransformMatches',
      clipId,
      property: change.property,
      value: numericValue,
      ...(isToolPixelTransformArg(change.arg) ? { valueSpace: 'toolPixels' as const } : {}),
    },
    family: 'property-edit',
    label: `Confirm ${change.property}`,
  };
}

function getTransformPropertyChanges(
  args: Record<string, unknown>,
  clipId: string | null,
): TransformPropertyChange[] {
  return TRANSFORM_ARG_PROPERTIES.flatMap(([arg, property]) => {
    if (!(arg in args)) {
      return [];
    }
    return [{
      arg,
      property,
      value: args[arg],
      target: {
        kind: 'propertyControl',
        property,
        clipId: clipId ?? undefined,
      },
    }];
  });
}

function getTimelineClipIds(toolCall: GuidedToolCall): string[] {
  const direct = readString(toolCall.args.clipId);
  if (direct) {
    return [direct];
  }
  return readStringArray(toolCall.args.clipIds);
}

function getTimelineTime(toolCall: GuidedToolCall): number | null {
  return readNumber(toolCall.args.splitTime)
    ?? readNumber(toolCall.args.newStartTime)
    ?? readNumber(toolCall.args.timelineStart)
    ?? null;
}

function getTimelineTone(tool: string): 'primary' | 'warning' | 'danger' {
  if (tool === 'deleteClip' || tool === 'deleteClips') {
    return 'danger';
  }
  if (tool === 'trimClip') {
    return 'warning';
  }
  return 'primary';
}

function describeTimelineEdit(toolCall: GuidedToolCall): string {
  switch (toolCall.tool) {
    case 'splitClip':
      return `Split at ${formatMaybeNumber(readNumber(toolCall.args.splitTime))}.`;
    case 'splitClipEvenly':
      return `Split into ${formatMaybeNumber(readNumber(toolCall.args.parts))} parts.`;
    case 'splitClipAtTimes':
      return `Split at ${readNumberArray(toolCall.args.times).length} timeline times.`;
    case 'moveClip':
      return `Move to ${formatMaybeNumber(readNumber(toolCall.args.newStartTime))}.`;
    case 'trimClip':
      return 'Adjust clip in/out points.';
    case 'deleteClip':
    case 'deleteClips':
      return 'Remove selected timeline media.';
    default:
      return 'Apply timeline edit.';
  }
}

function describeMediaAction(toolCall: GuidedToolCall): string {
  const paths = readStringArray(toolCall.args.paths);
  if (paths.length > 0) {
    return `Import ${paths.length} file${paths.length === 1 ? '' : 's'}.`;
  }
  return 'Update media panel.';
}

function getMaskToolbarTarget(tool: string): GuidedTargetRef | null {
  switch (tool) {
    case 'addRectangleMask':
      return { kind: 'maskToolbarButton', button: 'rectangle' };
    case 'addEllipseMask':
      return { kind: 'maskToolbarButton', button: 'ellipse' };
    case 'addMask':
      return { kind: 'maskToolbarButton', button: 'pen' };
    case 'updateMask':
      return { kind: 'maskToolbarButton', button: 'edit' };
    default:
      return null;
  }
}

function getMaskPath(vertices: unknown): Array<{ x: number; y: number }> {
  if (!Array.isArray(vertices)) {
    return [];
  }

  return vertices.flatMap((vertex) => {
    if (!isRecord(vertex)) {
      return [];
    }
    const x = readNumber(vertex.x);
    const y = readNumber(vertex.y);
    if (x === null || y === null) {
      return [];
    }
    return [{ x, y }];
  });
}

function inferFallbackFamily(tool: string): GuidedActionFamily {
  if (tool.toLowerCase().includes('media') || tool === 'importLocalFiles') {
    return 'media';
  }
  if (tool.toLowerCase().includes('mask')) {
    return 'mask-edit';
  }
  if (tool.toLowerCase().includes('keyframe')) {
    return 'keyframes';
  }
  if (tool.toLowerCase().includes('clip') || tool.toLowerCase().includes('timeline')) {
    return 'timeline-edit';
  }
  return 'semantic';
}

function clipTarget(clipId: string): GuidedTargetRef {
  return { kind: 'timelineClip', clipId };
}

function formatToolName(tool: string): string {
  return tool
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatPropertyName(property: string): string {
  return property.replace(/\./g, ' ');
}

function formatMaybeNumber(value: number | null): string {
  return value === null ? 'target time' : `${value}s`;
}

function isConfirmableTransformProperty(property: string): property is ClipTransformProperty {
  return CONFIRMABLE_TRANSFORM_PROPERTIES.has(property);
}

function isToolPixelTransformArg(arg: string): boolean {
  return arg === 'x' || arg === 'y';
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];
}

function readNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry))
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectWithout(
  value: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const ignored = new Set(keys);
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !ignored.has(key)),
  );
}
