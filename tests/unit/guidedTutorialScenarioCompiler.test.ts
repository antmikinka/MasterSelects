import { describe, expect, it, vi } from 'vitest';
import {
  compileGuidedScenario,
  createGuidedScenarioSessionRequest,
  GuidedActionRuntime,
  inspectGuidedScenario,
  SemanticExecutionAdapter,
  type SemanticToolExecutor,
  type GuidedScenario,
} from '../../src/services/guidedActions';

describe('guided tutorial scenario compiler', () => {
  it('compiles demo scenarios into tutorial runtime requests with semantic execution', () => {
    const scenario: GuidedScenario = {
      id: 'demo-transform',
      title: 'Demo Transform',
      steps: [
        {
          id: 'move-x',
          title: 'Move clip',
          body: 'Move X position.',
          mode: 'demo',
          target: { kind: 'panel', panel: 'clip-properties' },
          toolCall: {
            tool: 'setTransform',
            args: { clipId: 'clip-1', x: 192 },
          },
        },
      ],
    };

    const request = createGuidedScenarioSessionRequest(scenario, {
      animationBudgetMs: 0,
      sessionId: 'tutorial-demo-test',
    });

    expect(request.playbackMode).toBe('tutorialDemo');
    expect(request.inputLock).toEqual({ mode: 'locked', allowCancel: true });
    expect(request.actions).toContainEqual(expect.objectContaining({
      type: 'executeTool',
      tool: 'setTransform',
    }));
    expect(request.actions).toContainEqual(expect.objectContaining({
      type: 'confirmState',
      check: expect.objectContaining({ kind: 'clipTransformMatches' }),
    }));
  });

  it('can execute tutorial demo semantic actions through the shared runtime adapter', async () => {
    const executor = vi.fn<SemanticToolExecutor>(async () => ({
      success: true,
      data: { tutorialEdit: true },
    }));
    const adapter = new SemanticExecutionAdapter({ executeTool: executor });
    const runtime = new GuidedActionRuntime({
      actionHandlers: adapter.createActionHandlers(),
    });
    const scenario: GuidedScenario = {
      id: 'demo-runtime-transform',
      title: 'Demo Runtime Transform',
      steps: [
        {
          id: 'move-x',
          title: 'Move clip',
          mode: 'demo',
          toolCall: {
            tool: 'setTransform',
            args: { clipId: 'clip-1', x: 192 },
          },
        },
      ],
    };
    const request = createGuidedScenarioSessionRequest(scenario, {
      animationBudgetMs: 0,
      includeValidation: false,
      sessionId: 'tutorial-demo-runtime-test',
    });

    const result = await runtime.startSession(request);

    expect(result.status).toBe('completed');
    expect(result.toolResults).toEqual([
      expect.objectContaining({ success: true, data: { tutorialEdit: true } }),
    ]);
    expect(executor).toHaveBeenCalledWith('setTransform', { clipId: 'clip-1', x: 192 }, 'internal', expect.objectContaining({
      guidedSessionId: 'tutorial-demo-runtime-test',
    }));
  });

  it('compiles guided-user scenarios into waits without semantic execution', () => {
    const scenario: GuidedScenario = {
      id: 'guided-selection',
      title: 'Guided Selection',
      defaultMode: 'guided',
      steps: [
        {
          id: 'select-any-clip',
          title: 'Select a clip',
          target: { kind: 'panel', panel: 'timeline' },
          waitFor: { kind: 'clipSelected' },
          toolCall: {
            tool: 'selectClips',
            args: { clipIds: ['clip-1'] },
          },
        },
      ],
    };

    const request = createGuidedScenarioSessionRequest(scenario);

    expect(request.playbackMode).toBe('guidedUser');
    expect(request.inputLock).toEqual({
      mode: 'targetOnly',
      targets: [{ kind: 'panel', panel: 'timeline' }],
    });
    expect(request.actions.some((action) => action.type === 'executeTool')).toBe(false);
    expect(request.actions).toContainEqual(expect.objectContaining({
      type: 'waitForUserAction',
      check: { kind: 'clipSelected' },
    }));
  });

  it('exposes compact action inspection for scenario authoring', () => {
    const scenario: GuidedScenario = {
      id: 'inspect-me',
      title: 'Inspect Me',
      steps: [
        {
          id: 'callout',
          title: 'Look here',
          target: { kind: 'panel', panel: 'timeline' },
        },
      ],
    };

    const compiled = compileGuidedScenario(scenario);
    const inspection = inspectGuidedScenario(scenario);

    expect(compiled.diagnostics.stepCount).toBe(1);
    expect(inspection).toEqual(expect.objectContaining({
      scenarioId: 'inspect-me',
      stepCount: 1,
    }));
    expect(inspection.actions.map((action) => action.type)).toContain('callout');
  });
});
