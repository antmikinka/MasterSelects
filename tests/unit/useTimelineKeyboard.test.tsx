import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTimelineKeyboard } from '../../src/components/timeline/hooks/useTimelineKeyboard';
import { ALL_BLEND_MODES } from '../../src/components/timeline/constants';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Composition } from '../../src/stores/mediaStore';
import type { TimelineEditOperationActions } from '../../src/stores/timeline/types';
import type { TimelineClip } from '../../src/types';
import { createMockClip } from '../helpers/mockData';

function KeyboardHarness({
  selectedClipIds = new Set<string>(),
  selectedKeyframeIds = new Set<string>(),
  clipMap = new Map<string, TimelineClip>(),
  activeComposition = null,
  playheadPosition = 0,
  duration = 10,
  setPlayheadPosition = vi.fn(),
  applyTimelineEditOperation,
}: {
  selectedClipIds?: Set<string>;
  selectedKeyframeIds?: Set<string>;
  clipMap?: Map<string, TimelineClip>;
  activeComposition?: Composition | null;
  playheadPosition?: number;
  duration?: number;
  setPlayheadPosition?: (time: number) => void;
  applyTimelineEditOperation: TimelineEditOperationActions['applyTimelineEditOperation'];
}) {
  useTimelineKeyboard({
    isPlaying: false,
    play: vi.fn(),
    pause: vi.fn(),
    playForward: vi.fn(),
    playReverse: vi.fn(),
    setInPointAtPlayhead: vi.fn(),
    setOutPointAtPlayhead: vi.fn(),
    clearInOut: vi.fn(),
    toggleLoopPlayback: vi.fn(),
    selectedClipIds,
    selectedKeyframeIds,
    applyTimelineEditOperation,
    splitClipAtPlayhead: vi.fn(),
    copyClips: vi.fn(),
    pasteClips: vi.fn(),
    copyKeyframes: vi.fn(),
    pasteKeyframes: vi.fn(),
    toolMode: 'select',
    toggleCutTool: vi.fn(),
    clipMap,
    activeComposition,
    playheadPosition,
    duration,
    setPlayheadPosition,
    addMarker: vi.fn(),
  });

  return <input data-testid="text-input" />;
}

describe('useTimelineKeyboard edit operation routing', () => {
  let applyTimelineEditOperation: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useTimelineStore.setState({
      propertiesSelection: null,
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      playheadPosition: 0,
    });
    applyTimelineEditOperation = vi.fn(() => ({
      success: true,
      operationId: 'operation',
      changedClipIds: [],
      warnings: [],
    }));
  });

  it('routes delete through keyboard-delete-command with keyframes-first priority', () => {
    render(
      <KeyboardHarness
        selectedClipIds={new Set(['clip-1'])}
        selectedKeyframeIds={new Set(['kf-1'])}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );

    fireEvent.keyDown(window, { key: 'Delete' });

    expect(applyTimelineEditOperation).toHaveBeenCalledTimes(1);
    expect(applyTimelineEditOperation.mock.calls[0][0]).toMatchObject({
      type: 'keyboard-delete-command',
      command: 'delete',
      priority: 'keyframes-first',
      keyframeIds: ['kf-1'],
      clipIds: ['clip-1'],
      includeLinked: false,
      source: 'shortcut',
    });
    expect(applyTimelineEditOperation.mock.calls[0][1]).toMatchObject({
      source: 'shortcut',
      historyLabel: 'Delete keyframes',
    });
  });

  it('routes delete to transition removal when a transition is selected', () => {
    useTimelineStore.setState({
      propertiesSelection: {
        kind: 'transition',
        clipId: 'clip-a',
        edge: 'out',
        transitionId: 'transition-a',
      },
    });

    render(
      <KeyboardHarness
        selectedClipIds={new Set(['clip-1'])}
        selectedKeyframeIds={new Set(['kf-1'])}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );

    fireEvent.keyDown(window, { key: 'Delete' });

    expect(applyTimelineEditOperation).toHaveBeenCalledTimes(1);
    expect(applyTimelineEditOperation.mock.calls[0][0]).toMatchObject({
      type: 'transition-remove',
      clipId: 'clip-a',
      edge: 'out',
      transitionId: 'transition-a',
      source: 'shortcut',
    });
    expect(applyTimelineEditOperation.mock.calls[0][1]).toMatchObject({
      source: 'shortcut',
      historyLabel: 'Remove transition',
    });
  });

  it('routes delete through keyboard-delete-command for clips-only fallback', () => {
    render(
      <KeyboardHarness
        selectedClipIds={new Set(['clip-1', 'clip-2'])}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );

    fireEvent.keyDown(window, { key: 'Backspace' });

    expect(applyTimelineEditOperation).toHaveBeenCalledTimes(1);
    expect(applyTimelineEditOperation.mock.calls[0][0]).toMatchObject({
      type: 'keyboard-delete-command',
      command: 'delete',
      priority: 'clips-only',
      keyframeIds: [],
      clipIds: ['clip-1', 'clip-2'],
      includeLinked: false,
    });
  });

  it('routes next blend mode through keyboard-cycle-blend-mode-command', () => {
    const clipMap = new Map<string, TimelineClip>([
      ['clip-a', createMockClip({ id: 'clip-a', transform: { ...createMockClip().transform, blendMode: 'normal' } })],
      ['clip-b', createMockClip({ id: 'clip-b' })],
    ]);

    render(
      <KeyboardHarness
        selectedClipIds={new Set(['clip-a', 'clip-b'])}
        clipMap={clipMap}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );

    fireEvent.keyDown(window, { key: '+', code: 'NumpadAdd' });

    expect(applyTimelineEditOperation).toHaveBeenCalledTimes(1);
    expect(applyTimelineEditOperation.mock.calls[0][0]).toMatchObject({
      type: 'keyboard-cycle-blend-mode-command',
      command: 'cycle-blend-mode',
      clipIds: ['clip-a', 'clip-b'],
      direction: 'next',
      anchorClipId: 'clip-a',
      currentBlendMode: 'normal',
      nextBlendMode: 'dissolve',
      blendModeSequence: ALL_BLEND_MODES,
    });
  });

  it('does not route edit shortcuts from text entry targets', () => {
    const { getByTestId } = render(
      <KeyboardHarness
        selectedClipIds={new Set(['clip-1'])}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );

    fireEvent.keyDown(getByTestId('text-input'), { key: 'Delete' });

    expect(applyTimelineEditOperation).not.toHaveBeenCalled();
  });

  it('steps repeated frame shortcuts from the fresh store position without waiting for rerender', () => {
    const activeComposition: Composition = {
      id: 'comp-60fps',
      name: '60 fps comp',
      type: 'composition',
      parentId: null,
      createdAt: 0,
      width: 1920,
      height: 1080,
      frameRate: 60,
      duration: 10,
      backgroundColor: '#000000',
    };
    const setPlayheadPosition = vi.fn((time: number) => {
      useTimelineStore.setState({ playheadPosition: time });
    });

    useTimelineStore.setState({ playheadPosition: 6 });

    render(
      <KeyboardHarness
        activeComposition={activeComposition}
        playheadPosition={6}
        duration={10}
        setPlayheadPosition={setPlayheadPosition}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });

    expect(setPlayheadPosition).toHaveBeenCalledTimes(3);
    expect(setPlayheadPosition.mock.calls[0][0]).toBeCloseTo(5.983333333333333, 8);
    expect(setPlayheadPosition.mock.calls[1][0]).toBeCloseTo(5.966666666666667, 8);
    expect(setPlayheadPosition.mock.calls[2][0]).toBeCloseTo(5.983333333333333, 8);
  });
});
