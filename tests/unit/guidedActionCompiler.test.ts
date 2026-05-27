import { describe, expect, it } from 'vitest';
import { compileGuidedToolCall } from '../../src/services/guidedActions';
import type { GuidedAction, GuidedToolCall } from '../../src/services/guidedActions';

describe('guided action compiler', () => {
  it('compiles setTransform into properties choreography with one execution point', () => {
    const toolCall: GuidedToolCall = {
      tool: 'setTransform',
      args: {
        clipId: 'clip-1',
        x: 240,
        scaleAll: 1.5,
      },
    };

    const compiled = compileGuidedToolCall(toolCall);
    const actions = compiled.actions;

    expect(compiled.diagnostics.supported).toBe(true);
    expect(compiled.diagnostics.executionActionCount).toBe(1);
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'openPropertiesTab',
      tab: 'transform',
      family: 'property-edit',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'highlightTarget',
      target: { kind: 'propertyControl', property: 'position.x', clipId: 'clip-1' },
      family: 'property-edit',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'highlightTarget',
      target: { kind: 'propertyControl', property: 'scale.all', clipId: 'clip-1' },
      family: 'property-edit',
    }));
    expect(getExecutionActions(actions)).toEqual([
      expect.objectContaining({
        type: 'executeTool',
        tool: 'setTransform',
        args: toolCall.args,
        family: 'property-edit',
      }),
    ]);
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'confirmState',
      check: {
        kind: 'clipTransformMatches',
        clipId: 'clip-1',
        property: 'position.x',
        value: 240,
        valueSpace: 'toolPixels',
      },
      family: 'property-edit',
    }));
  });

  it('compiles splitClip into timeline choreography', () => {
    const toolCall: GuidedToolCall = {
      tool: 'splitClip',
      args: {
        clipId: 'clip-1',
        splitTime: 12.5,
      },
    };

    const compiled = compileGuidedToolCall(toolCall);
    const actions = compiled.actions;

    expect(compiled.diagnostics.supported).toBe(true);
    expect(compiled.diagnostics.executionActionCount).toBe(1);
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'focusPanel',
      panel: 'timeline',
      family: 'timeline-edit',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'setPlayheadVisual',
      time: 12.5,
      family: 'timeline-edit',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'scrollIntoView',
      target: { kind: 'timelineTime', time: 12.5 },
      family: 'timeline-edit',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'moveCursorTo',
      target: { kind: 'timelineTime', time: 12.5 },
      family: 'timeline-edit',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'highlightTarget',
      target: { kind: 'timelineClip', clipId: 'clip-1' },
      family: 'timeline-edit',
    }));
    expect(getExecutionActions(actions)[0]).toEqual(expect.objectContaining({
      type: 'executeTool',
      tool: 'splitClip',
      args: toolCall.args,
      family: 'timeline-edit',
    }));
  });

  it('compiles setPlayhead into a visible cursor choreography', () => {
    const toolCall: GuidedToolCall = {
      tool: 'setPlayhead',
      args: {
        time: 2.25,
      },
    };

    const compiled = compileGuidedToolCall(toolCall);
    const actions = compiled.actions;

    expect(compiled.diagnostics.supported).toBe(true);
    expect(compiled.diagnostics.executionActionCount).toBe(1);
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'setPlayheadVisual',
      time: 2.25,
      family: 'selection-navigation',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'moveCursorTo',
      target: { kind: 'timelineTime', time: 2.25 },
      family: 'selection-navigation',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'confirmState',
      check: { kind: 'playheadAtTime', time: 2.25, toleranceSeconds: 0.001 },
      family: 'selection-navigation',
    }));
    expect(getExecutionActions(actions)[0]).toEqual(expect.objectContaining({
      type: 'executeTool',
      tool: 'setPlayhead',
      args: toolCall.args,
      family: 'selection-navigation',
    }));
  });

  it('compiles addRectangleMask into mask toolbar choreography', () => {
    const toolCall: GuidedToolCall = {
      tool: 'addRectangleMask',
      args: {
        clipId: 'clip-1',
      },
    };

    const compiled = compileGuidedToolCall(toolCall);
    const actions = compiled.actions;

    expect(compiled.diagnostics.supported).toBe(true);
    expect(compiled.diagnostics.executionActionCount).toBe(1);
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'openPropertiesTab',
      tab: 'masks',
      family: 'mask-edit',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'highlightTarget',
      target: { kind: 'maskToolbarButton', button: 'rectangle' },
      family: 'mask-edit',
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'confirmState',
      check: { kind: 'maskExists', clipId: 'clip-1' },
      family: 'mask-edit',
    }));
  });

  it('normalizes executeBatch into visible substeps with a single batch execution point', () => {
    const toolCall: GuidedToolCall = {
      tool: 'executeBatch',
      args: {
        actions: [
          { tool: 'splitClip', args: { clipId: 'clip-1', splitTime: 4 } },
          { tool: 'setTransform', args: { clipId: 'clip-1', y: -25 } },
        ],
      },
    };

    const compiled = compileGuidedToolCall(toolCall);
    const executionActions = getExecutionActions(compiled.actions);

    expect(compiled.diagnostics.supported).toBe(true);
    expect(compiled.diagnostics.flattenedBatchActions).toBe(2);
    expect(executionActions).toEqual([
      expect.objectContaining({
        type: 'executeTool',
        tool: 'executeBatch',
        args: toolCall.args,
        family: 'semantic',
      }),
    ]);
    expect(compiled.actions).toContainEqual(expect.objectContaining({
      type: 'setPlayheadVisual',
      time: 4,
      family: 'timeline-edit',
    }));
    expect(compiled.actions).toContainEqual(expect.objectContaining({
      type: 'moveCursorTo',
      target: { kind: 'timelineTime', time: 4 },
      family: 'timeline-edit',
    }));
    expect(compiled.actions).toContainEqual(expect.objectContaining({
      type: 'highlightTarget',
      target: { kind: 'propertyControl', property: 'position.y', clipId: 'clip-1' },
      family: 'property-edit',
    }));
  });

  it('uses generic choreography for unsupported tools', () => {
    const compiled = compileGuidedToolCall({
      tool: 'unknownTool',
      args: { value: 1 },
    });

    expect(compiled.diagnostics.supported).toBe(false);
    expect(compiled.diagnostics.executionActionCount).toBe(1);
    expect(compiled.actions).toContainEqual(expect.objectContaining({
      type: 'callout',
      title: 'Executing Unknown Tool',
      family: 'semantic',
    }));
    expect(getExecutionActions(compiled.actions)[0]).toEqual(expect.objectContaining({
      type: 'executeTool',
      tool: 'unknownTool',
      family: 'semantic',
    }));
  });
});

function getExecutionActions(actions: GuidedAction[]): GuidedAction[] {
  return actions.filter((action) => action.type === 'executeTool');
}
