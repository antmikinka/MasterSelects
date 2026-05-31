import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimelineTrack } from '../../src/components/timeline/TimelineTrack';
import type { TimelineTrackProps } from '../../src/components/timeline/types';
import type { TimelineTrack as TimelineTrackType } from '../../src/types';

function createTrack(): TimelineTrackType {
  return {
    id: 'track-video',
    name: 'Video 1',
    type: 'video',
    height: 64,
    visible: true,
    muted: false,
    solo: false,
    locked: false,
  } as TimelineTrackType;
}

function renderTimelineTrack(overrides: Partial<TimelineTrackProps> = {}) {
  const props: TimelineTrackProps = {
    track: createTrack(),
    clips: [],
    isDimmed: false,
    isExpanded: false,
    baseHeight: 64,
    dynamicHeight: 64,
    isDragTarget: false,
    isExternalDragTarget: false,
    selectedClipIds: new Set(),
    selectedKeyframeIds: new Set(),
    activeTimelineToolId: 'select',
    isClipDragActive: false,
    clipDrag: null,
    clipTrim: null,
    externalDrag: null,
    zoom: 10,
    scrollX: 0,
    timelineRef: { current: document.createElement('div') },
    onClipMouseDown: vi.fn(),
    onClipContextMenu: vi.fn(),
    onEmptyMouseDown: vi.fn(),
    onEmptyContextMenu: vi.fn(),
    onTrimStart: vi.fn(),
    onDrop: vi.fn(),
    onDragOver: vi.fn(),
    onDragEnter: vi.fn(),
    onDragLeave: vi.fn(),
    renderClip: () => null,
    clipKeyframes: new Map(),
    renderKeyframeDiamonds: () => null,
    timeToPixel: (time) => time * 10,
    pixelToTime: (pixel) => pixel / 10,
    expandedCurveProperties: new Map(),
    onSelectKeyframe: vi.fn(),
    onMoveKeyframe: vi.fn(),
    onUpdateBezierHandle: vi.fn(),
    addKeyframe: vi.fn(),
    ...overrides,
  };

  const result = render(<TimelineTrack {...props} />);
  const row = result.container.querySelector<HTMLElement>('.track-clip-row');
  if (!row) {
    throw new Error('Expected track clip row to render.');
  }
  row.getBoundingClientRect = () => ({
    x: 20,
    y: 0,
    left: 20,
    top: 0,
    right: 820,
    bottom: 64,
    width: 800,
    height: 64,
    toJSON: () => ({}),
  });

  return { ...result, row, props };
}

describe('TimelineTrack empty lane right mouse behavior', () => {
  it('starts the empty-lane right-button path without opening the menu immediately', () => {
    const onEmptyMouseDown = vi.fn();
    const onEmptyContextMenu = vi.fn();
    const { row } = renderTimelineTrack({ onEmptyMouseDown, onEmptyContextMenu });

    fireEvent.mouseDown(row, { button: 2, clientX: 70, clientY: 24 });

    expect(onEmptyMouseDown).toHaveBeenCalledTimes(1);
    expect(onEmptyMouseDown.mock.calls[0][1]).toBe('track-video');
    expect(onEmptyMouseDown.mock.calls[0][2]).toBe(5);
    expect(onEmptyContextMenu).not.toHaveBeenCalled();
  });

  it('still opens the empty-lane menu for a normal single right-click', () => {
    const onEmptyContextMenu = vi.fn();
    const { row } = renderTimelineTrack({ onEmptyContextMenu });

    fireEvent.contextMenu(row, { button: 2, clientX: 90, clientY: 24 });

    expect(onEmptyContextMenu).toHaveBeenCalledTimes(1);
    expect(onEmptyContextMenu.mock.calls[0][1]).toBe('track-video');
    expect(onEmptyContextMenu.mock.calls[0][2]).toBe(7);
  });
});
