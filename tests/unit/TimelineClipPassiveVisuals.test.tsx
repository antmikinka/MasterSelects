import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimelineClip } from '../../src/components/timeline/TimelineClip';
import { useMediaStore } from '../../src/stores/mediaStore';
import type { TimelineClip as TimelineClipType, TimelineTrack } from '../../src/types';

function createTrack(): TimelineTrack {
  return {
    id: 'track-video',
    name: 'Video 1',
    type: 'video',
    height: 64,
    visible: true,
    muted: false,
    solo: false,
    locked: false,
  } as TimelineTrack;
}

function createClip(): TimelineClipType {
  return {
    id: 'clip-video',
    trackId: 'track-video',
    name: 'Decorated Clip',
    file: new File([], 'clip.mp4'),
    startTime: 0,
    duration: 4,
    inPoint: 0,
    outPoint: 4,
    source: { type: 'video', mediaFileId: 'media-video', naturalDuration: 4 },
    effects: [],
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    needsReload: true,
    reversed: true,
    transcriptStatus: 'ready',
    transcript: [{ id: 'word-1', text: 'Hello', start: 0, end: 1 }],
    analysisStatus: 'ready',
    analysis: {
      frames: [{ timestamp: 0, focusScore: 0.8, motionScore: 0.1 }],
      sampleInterval: 500,
    },
  } as TimelineClipType;
}

function mockMediaStore() {
  const mediaState = {
    files: [
      {
        id: 'media-video',
        type: 'video',
        name: 'clip.mp4',
        transcribedRanges: [[0, 4]],
      },
    ],
    selectedIds: [],
    compositions: [],
    textItems: [],
    solidItems: [],
    meshItems: [],
    cameraItems: [],
    splatEffectorItems: [],
  };
  const mediaStore = vi.mocked(useMediaStore);
  mediaStore.mockImplementation((selector: (state: typeof mediaState) => unknown) => selector(mediaState));
  vi.mocked(useMediaStore.getState).mockReturnValue(mediaState as ReturnType<typeof useMediaStore.getState>);
}

function renderClip(passiveVisualsSuppressed: boolean) {
  mockMediaStore();
  const track = createTrack();
  const clip = createClip();

  return render(
    <TimelineClip
      clip={clip}
      trackId={track.id}
      track={track}
      trackBaseHeight={64}
      tracks={[track]}
      clips={[clip]}
      isSelected={false}
      isInLinkedGroup
      isDragging={false}
      isTrimming={false}
      isFading={false}
      isLinkedToDragging={false}
      isLinkedToTrimming={false}
      isClipDragActive={false}
      clipDrag={null}
      clipTrim={null}
      zoom={20}
      scrollX={0}
      timelineViewportWidth={800}
      proxyEnabled={true}
      proxyStatus="ready"
      proxyProgress={100}
      audioProxyStatus="none"
      audioProxyProgress={0}
      showTranscriptMarkers={true}
      snappingEnabled={true}
      onMouseDown={vi.fn()}
      onDoubleClick={vi.fn()}
      onContextMenu={vi.fn()}
      onTrimStart={vi.fn()}
      onFadeStart={vi.fn()}
      hasKeyframes={() => false}
      fadeInDuration={0}
      fadeOutDuration={0}
      opacityKeyframes={[]}
      keyframeTimeGroups={[]}
      onMoveKeyframeGroup={vi.fn()}
      timeToPixel={(time) => time * 20}
      formatTime={(seconds) => `${seconds.toFixed(2)}s`}
      passiveVisualsSuppressed={passiveVisualsSuppressed}
    />,
  );
}

describe('TimelineClip passive visual suppression', () => {
  it('removes passive overlay decorations while preserving active handles', () => {
    const visible = renderClip(false);
    expect(visible.container.querySelector('.clip-content')).toBeTruthy();
    expect(visible.container.querySelector('.clip-transcript-badge')).toBeTruthy();
    expect(visible.container.querySelector('.clip-analysis-badge')).toBeTruthy();
    expect(visible.container.querySelector('.clip-reload-badge')).toBeTruthy();
    expect(visible.container.querySelector('.clip-proxy-badge')).toBeTruthy();
    visible.unmount();

    const suppressed = renderClip(true);
    expect(suppressed.container.querySelector('.clip-content')).toBeNull();
    expect(suppressed.container.querySelector('.clip-transcript-badge')).toBeNull();
    expect(suppressed.container.querySelector('.clip-analysis-badge')).toBeNull();
    expect(suppressed.container.querySelector('.clip-reload-badge')).toBeNull();
    expect(suppressed.container.querySelector('.clip-proxy-badge')).toBeNull();
    expect(suppressed.container.querySelectorAll('.trim-handle')).toHaveLength(2);
    expect(suppressed.container.querySelectorAll('.fade-handle')).toHaveLength(2);
  });
});
