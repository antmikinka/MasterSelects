import { beforeEach, describe, expect, it } from 'vitest';
import { useDockStore } from '../../src/stores/dockStore';
import { DEFAULT_TRACKS, useTimelineStore } from '../../src/stores/timeline';

describe('dock store saved layouts', () => {
  beforeEach(() => {
    localStorage.clear();
    useDockStore.setState({
      savedLayouts: [],
      defaultSavedLayoutId: null,
      activeSavedLayoutId: null,
    });
    useDockStore.getState().resetLayout();
    useTimelineStore.setState({
      tracks: DEFAULT_TRACKS.map((track) => ({ ...track })),
      audioDisplayMode: 'detailed',
      audioFocusMode: false,
      trackFocusMode: 'balanced',
    });
  });

  it('toggles favorite state for saved layouts', () => {
    const savedLayout = useDockStore.getState().saveNamedLayout('Video Edit');

    expect(savedLayout).not.toBeNull();
    expect(useDockStore.getState().activeSavedLayoutId).toBe(savedLayout!.id);
    useDockStore.getState().toggleFavoriteSavedLayout(savedLayout!.id);
    expect(useDockStore.getState().savedLayouts[0].favorite).toBe(true);

    useDockStore.getState().toggleFavoriteSavedLayout(savedLayout!.id);
    expect(useDockStore.getState().savedLayouts[0].favorite).toBe(false);
  });

  it('preserves favorite state when an existing saved layout is overwritten', () => {
    const savedLayout = useDockStore.getState().saveNamedLayout('Audio Edit');
    expect(savedLayout).not.toBeNull();

    useDockStore.getState().toggleFavoriteSavedLayout(savedLayout!.id);
    const updatedLayout = useDockStore.getState().saveNamedLayout('Audio Edit');

    expect(updatedLayout?.id).toBe(savedLayout!.id);
    expect(updatedLayout?.favorite).toBe(true);
    expect(useDockStore.getState().savedLayouts[0].favorite).toBe(true);
  });

  it('stores and restores timeline focus state and track heights in saved layouts', () => {
    const timeline = useTimelineStore.getState();
    timeline.setAudioDisplayMode('spectral');
    timeline.setTrackFocusMode('audio');
    timeline.setTrackHeight('video-1', 120);
    timeline.setTrackHeight('audio-1', 88);

    const savedLayout = useDockStore.getState().saveNamedLayout('Audio Focus');

    expect(savedLayout?.timeline).toMatchObject({
      audioDisplayMode: 'spectral',
      audioFocusMode: true,
      trackFocusMode: 'audio',
      trackHeights: {
        'video-1': 120,
        'audio-1': 88,
      },
    });

    timeline.setAudioDisplayMode('compact');
    timeline.setTrackFocusMode('video');
    timeline.setTrackHeight('video-1', 20);
    timeline.setTrackHeight('audio-1', 20);

    useDockStore.getState().loadSavedLayout(savedLayout!.id);

    const restoredTimeline = useTimelineStore.getState();
    expect(restoredTimeline.audioDisplayMode).toBe('spectral');
    expect(restoredTimeline.trackFocusMode).toBe('audio');
    expect(restoredTimeline.audioFocusMode).toBe(true);
    expect(restoredTimeline.tracks.find((track) => track.id === 'video-1')?.height).toBe(120);
    expect(restoredTimeline.tracks.find((track) => track.id === 'audio-1')?.height).toBe(88);
  });

  it('saves over the current named layout without prompting for a new name', () => {
    const savedLayout = useDockStore.getState().saveNamedLayout('Current Layout');
    expect(savedLayout).not.toBeNull();

    useDockStore.getState().setSplitRatio('root-split', 0.42);
    useTimelineStore.getState().setTrackFocusMode('audio');
    useTimelineStore.getState().setTrackHeight('audio-1', 96);

    const updatedLayout = useDockStore.getState().saveCurrentNamedLayout();

    expect(updatedLayout?.id).toBe(savedLayout!.id);
    expect(updatedLayout?.name).toBe('Current Layout');
    expect(updatedLayout?.timeline?.trackFocusMode).toBe('audio');
    expect(updatedLayout?.timeline?.trackHeights?.['audio-1']).toBe(96);
    expect(updatedLayout?.layout.root.kind).toBe('split');
    if (updatedLayout?.layout.root.kind === 'split') {
      expect(updatedLayout.layout.root.ratio).toBe(0.42);
    }
  });

  it('returns null when there is no current named layout to overwrite', () => {
    expect(useDockStore.getState().saveCurrentNamedLayout()).toBeNull();
  });
});
