import { useGuidedActionStore } from '../../stores/guidedActionStore';
import { useDockStore } from '../../stores/dockStore';
import { useTimelineStore } from '../../stores/timeline';
import type {
  GuidedAction,
  GuidedPoint,
  GuidedTargetRef,
  GuidedTargetResolved,
  SurfaceExecutionPolicy,
} from './types';
import type { GuidedActionHandlerContext, GuidedActionHandlerMap } from './runtime';

const TIMELINE_SURFACE_SELECTORS = [
  '[data-guided-target="timeline-tracks"]',
  '[data-ai-id="timeline-tracks"]',
  '.timeline-track-stack.timeline-tracks',
  '.timeline-tracks',
];
const TIMELINE_HEADER_WIDTH_FALLBACK = 210;
const TIMELINE_END_PADDING_FALLBACK = 500;

export interface GuidedSurfaceInteractionResult {
  actionType: GuidedAction['type'];
  executed: boolean;
  message?: string;
  policy: SurfaceExecutionPolicy | 'implicit';
  success: boolean;
}

export function createSurfaceInteractionHandlers(): GuidedActionHandlerMap {
  const driver = new GuidedSurfaceInteractionDriver();
  return {
    chooseDropdownOption: (action, context) => driver.execute(action, context),
    drawPreviewPath: (action, context) => driver.execute(action, context),
    focusPanel: (action, context) => driver.execute(action, context),
    openDropdown: (action, context) => driver.execute(action, context),
    openPropertiesTab: (action, context) => driver.execute(action, context),
    pressButton: (action, context) => driver.execute(action, context),
    resizePanel: (action, context) => driver.execute(action, context),
    scrollIntoView: (action, context) => driver.execute(action, context),
    selectClip: (action, context) => driver.execute(action, context),
    setPlayheadVisual: (action, context) => driver.execute(action, context),
    typeInto: (action, context) => driver.execute(action, context),
  };
}

export class GuidedSurfaceInteractionDriver {
  async execute(
    action: GuidedAction,
    context: GuidedActionHandlerContext,
  ): Promise<GuidedSurfaceInteractionResult> {
    switch (action.type) {
      case 'focusPanel':
        return this.focusPanel(action.panel);
      case 'openPropertiesTab':
        return this.openPropertiesTab(action.tab);
      case 'selectClip':
        return this.selectClip(action.clipId);
      case 'setPlayheadVisual':
        return this.setPlayhead(action.time);
      case 'scrollIntoView':
        return this.scrollIntoView(action.target, action.block, context);
      case 'resizePanel':
        return this.resizePanel(action, context);
      case 'pressButton':
        return this.clickTarget(action.type, action.target, action.policy, context);
      case 'openDropdown':
        return this.clickTarget(action.type, action.target, action.policy, context);
      case 'chooseDropdownOption':
        return this.clickTarget(action.type, action.target, action.policy, context);
      case 'typeInto':
        return this.typeInto(action.target, action.text, action.policy, context);
      case 'drawPreviewPath':
        return this.drawPreviewPath(action, context);
      default:
        return {
          actionType: action.type,
          executed: false,
          message: `Unsupported surface action ${action.type}`,
          policy: 'implicit',
          success: false,
        };
    }
  }

  private focusPanel(panel: Extract<GuidedAction, { type: 'focusPanel' }>['panel']): GuidedSurfaceInteractionResult {
    useDockStore.getState().activatePanelType(panel);
    return success('focusPanel', true, 'implicit');
  }

  private openPropertiesTab(tab: string): GuidedSurfaceInteractionResult {
    useDockStore.getState().activatePanelType('clip-properties');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('openPropertiesTab', { detail: { tab } }));
    }
    return success('openPropertiesTab', true, 'implicit');
  }

  private selectClip(clipId: string): GuidedSurfaceInteractionResult {
    useTimelineStore.getState().selectClip(clipId);
    return success('selectClip', true, 'implicit');
  }

  private setPlayhead(time: number): GuidedSurfaceInteractionResult {
    useTimelineStore.getState().setPlayheadPosition(time);
    return success('setPlayheadVisual', true, 'implicit');
  }

  private async scrollIntoView(
    target: GuidedTargetRef,
    block: Extract<GuidedAction, { type: 'scrollIntoView' }>['block'],
    context: GuidedActionHandlerContext,
  ): Promise<GuidedSurfaceInteractionResult> {
    if (target.kind === 'timelineTime') {
      return this.scrollTimelineTimeIntoView(target, context);
    }

    const resolution = await requireResolvedTarget(target, context);
    if (!resolution.element) {
      return fail('scrollIntoView', 'Resolved target has no DOM element', 'implicit', context);
    }

    resolution.element.scrollIntoView({ block: block ?? 'center', inline: 'nearest' });
    useGuidedActionStore.getState().setCursor({ visible: true, position: resolution.center });
    return success('scrollIntoView', true, 'implicit');
  }

  private async scrollTimelineTimeIntoView(
    target: Extract<GuidedTargetRef, { kind: 'timelineTime' }>,
    context: GuidedActionHandlerContext,
  ): Promise<GuidedSurfaceInteractionResult> {
    const timeline = useTimelineStore.getState();
    const zoom = Number.isFinite(timeline.zoom) && timeline.zoom > 0 ? timeline.zoom : 50;
    const surface = findFirstElement(TIMELINE_SURFACE_SELECTORS);
    const surfaceRect = surface?.getBoundingClientRect();
    const originOffset = surface
      ? readNumberAttribute(surface, 'data-guided-timeline-origin-x') ?? TIMELINE_HEADER_WIDTH_FALLBACK
      : TIMELINE_HEADER_WIDTH_FALLBACK;
    const visibleWidth = Math.max(
      1,
      surfaceRect ? surfaceRect.width - originOffset : 600,
    );
    const desiredScrollX = Math.max(0, target.time * zoom - visibleWidth / 2);
    const maxScrollX = Math.max(
      0,
      timeline.duration * zoom - visibleWidth + TIMELINE_END_PADDING_FALLBACK,
    );

    timeline.setScrollX(Math.min(desiredScrollX, maxScrollX));

    const resolution = await context.resolveTarget(target);
    if (resolution.status === 'resolved') {
      useGuidedActionStore.getState().setCursor({ visible: true, position: resolution.center });
    }

    return success('scrollIntoView', true, 'implicit');
  }

  private async resizePanel(
    action: Extract<GuidedAction, { type: 'resizePanel' }>,
    context: GuidedActionHandlerContext,
  ): Promise<GuidedSurfaceInteractionResult> {
    const policy = action.policy ?? 'visualOnly';
    if (action.visualTarget) {
      const resolution = await requireResolvedTarget(action.visualTarget, context);
      useGuidedActionStore.getState().setCursor({ visible: true, position: resolution.center });
    }

    if (!shouldExecuteUiPolicy(policy)) {
      return success('resizePanel', false, policy);
    }

    const dock = useDockStore.getState();
    const previousRatio = findSplitRatio(dock.layout.root, action.groupId);
    dock.setSplitRatio(action.groupId, action.ratio);

    if (policy === 'transientUi' && previousRatio !== null) {
      scheduleTransientRestore(context, () => {
        useDockStore.getState().setSplitRatio(action.groupId, previousRatio);
      });
    }

    return success('resizePanel', true, policy);
  }

  private async clickTarget(
    actionType: GuidedAction['type'],
    target: GuidedTargetRef,
    policy: SurfaceExecutionPolicy | undefined,
    context: GuidedActionHandlerContext,
  ): Promise<GuidedSurfaceInteractionResult> {
    const normalizedPolicy = policy ?? 'visualOnly';
    const resolution = await requireResolvedTarget(target, context);
    const store = useGuidedActionStore.getState();
    store.setCursor({ visible: true, position: resolution.center, clicking: true });

    if (!shouldExecuteUiPolicy(normalizedPolicy)) {
      return success(actionType, false, normalizedPolicy);
    }

    const clickable = resolution.element;
    if (!(clickable instanceof HTMLElement)) {
      return fail(actionType, 'Resolved target cannot be clicked safely', normalizedPolicy, context);
    }

    clickable.click();
    return success(actionType, true, normalizedPolicy);
  }

  private async typeInto(
    target: GuidedTargetRef,
    text: string,
    policy: SurfaceExecutionPolicy | undefined,
    context: GuidedActionHandlerContext,
  ): Promise<GuidedSurfaceInteractionResult> {
    const normalizedPolicy = policy ?? 'visualOnly';
    const resolution = await requireResolvedTarget(target, context);
    useGuidedActionStore.getState().setCursor({ visible: true, position: resolution.center, clicking: true });

    if (!shouldExecuteUiPolicy(normalizedPolicy)) {
      return success('typeInto', false, normalizedPolicy);
    }

    const input = resolution.element;
    if (!isTextInputElement(input)) {
      return fail('typeInto', 'Resolved target is not a text input', normalizedPolicy, context);
    }

    input.focus();
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    return success('typeInto', true, normalizedPolicy);
  }

  private async drawPreviewPath(
    action: Extract<GuidedAction, { type: 'drawPreviewPath' }>,
    context: GuidedActionHandlerContext,
  ): Promise<GuidedSurfaceInteractionResult> {
    const resolvedPoints: GuidedPoint[] = [];
    for (const [index, point] of action.points.entries()) {
      const resolution = await requireResolvedTarget({
        kind: 'previewPathVertex',
        x: point.x,
        y: point.y,
        index,
      }, context);
      resolvedPoints.push(resolution.center);
    }

    useGuidedActionStore.getState().addPreviewPath({
      points: resolvedPoints,
      closed: action.close ?? false,
      durationMs: context.scheduledAction.plannedDurationMs,
    });

    const lastPoint = resolvedPoints.at(-1);
    if (lastPoint) {
      useGuidedActionStore.getState().setCursor({ visible: true, position: lastPoint });
    }

    return success('drawPreviewPath', action.policy !== 'visualOnly', action.policy ?? 'visualOnly');
  }
}

async function requireResolvedTarget(
  target: GuidedTargetRef,
  context: GuidedActionHandlerContext,
): Promise<GuidedTargetResolved> {
  const resolution = await context.resolveTarget(target);
  if (resolution.status === 'missing') {
    throw new Error(resolution.message ?? `Missing guided surface target: ${resolution.reason}`);
  }
  return resolution;
}

function success(
  actionType: GuidedAction['type'],
  executed: boolean,
  policy: SurfaceExecutionPolicy | 'implicit',
): GuidedSurfaceInteractionResult {
  return {
    actionType,
    executed,
    policy,
    success: true,
  };
}

function fail(
  actionType: GuidedAction['type'],
  message: string,
  policy: SurfaceExecutionPolicy | 'implicit',
  context: GuidedActionHandlerContext,
): GuidedSurfaceInteractionResult {
  useGuidedActionStore.getState().appendDiagnostic(context.session.id, message, {
    actionType,
    policy,
  });
  context.emitEvent({
    type: 'diagnostic',
    sessionId: context.session.id,
    message,
    data: { actionType, policy },
  });
  return {
    actionType,
    executed: false,
    message,
    policy,
    success: false,
  };
}

function shouldExecuteUiPolicy(policy: SurfaceExecutionPolicy): boolean {
  return policy === 'persistUi' || policy === 'transientUi';
}

function isTextInputElement(element: Element | undefined): element is HTMLInputElement | HTMLTextAreaElement {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}

function findFirstElement(selectors: string[]): Element | null {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element;
    }
  }
  return null;
}

function readNumberAttribute(element: Element, attribute: string): number | null {
  const raw = element.getAttribute(attribute);
  if (raw === null || raw.trim() === '') {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function scheduleTransientRestore(context: GuidedActionHandlerContext, restore: () => void): void {
  const timeoutMs = Math.max(0, context.scheduledAction.plannedDurationMs);
  const timer = globalThis.setTimeout(() => {
    context.signal.removeEventListener('abort', onAbort);
    restore();
  }, timeoutMs);

  const onAbort = () => {
    globalThis.clearTimeout(timer);
    restore();
  };

  context.signal.addEventListener('abort', onAbort, { once: true });
}

type DockLayoutNode = ReturnType<typeof useDockStore.getState>['layout']['root'];

function findSplitRatio(node: DockLayoutNode, splitId: string): number | null {
  if (node.kind === 'split' && node.id === splitId) {
    return node.ratio;
  }

  if (node.kind === 'split') {
    return findSplitRatio(node.children[0], splitId) ?? findSplitRatio(node.children[1], splitId);
  }

  return null;
}
