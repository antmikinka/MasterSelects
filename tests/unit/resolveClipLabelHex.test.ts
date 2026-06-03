import { describe, expect, it } from 'vitest';
import type { TimelineClip } from '../../src/types';
import type { LabelColor } from '../../src/stores/mediaStore/types';
import { getLabelHex } from '../../src/components/panels/media/labelColors';
import { resolveClipLabelHex } from '../../src/components/timeline/utils/resolveClipLabelHex';

function makeClip(overrides: Partial<TimelineClip>): TimelineClip {
  return {
    id: 'clip-1',
    name: 'Clip 1',
    startTime: 0,
    duration: 5,
    trimStart: 0,
    trimEnd: 5,
    type: 'video',
    ...overrides,
  } as TimelineClip;
}

function label(labelColor: LabelColor, extra: Record<string, unknown> = {}) {
  return { id: 'item-1', name: 'Item 1', labelColor, ...extra };
}

const emptyMediaState = {
  files: [],
  compositions: [],
};

describe('resolveClipLabelHex', () => {
  it('prefers composition label color over source media file label color', () => {
    const clip = makeClip({
      compositionId: 'comp-1',
      mediaFileId: 'file-1',
    });

    expect(resolveClipLabelHex(clip, {
      files: [label('blue', { id: 'file-1' })],
      compositions: [label('red', { id: 'comp-1' })],
    })).toBe(getLabelHex('red'));
  });

  it('resolves a media file label by mediaFileId or source mediaFileId', () => {
    expect(resolveClipLabelHex(makeClip({ mediaFileId: 'file-1' }), {
      files: [label('green', { id: 'file-1' })],
      compositions: [],
    })).toBe(getLabelHex('green'));

    expect(resolveClipLabelHex(makeClip({ source: { type: 'video', mediaFileId: 'file-2' } }), {
      files: [label('aqua', { id: 'file-2' })],
      compositions: [],
    })).toBe(getLabelHex('aqua'));
  });

  it('resolves special generated source labels through id, name, or type fallback', () => {
    expect(resolveClipLabelHex(makeClip({ name: 'Solid One', source: { type: 'solid' } }), {
      ...emptyMediaState,
      solidItems: [label('yellow', { name: 'Solid One' })],
    })).toBe(getLabelHex('yellow'));

    expect(resolveClipLabelHex(makeClip({ source: { type: 'text', mediaFileId: 'text-1' } }), {
      ...emptyMediaState,
      textItems: [label('pink', { id: 'text-1' })],
    })).toBe(getLabelHex('pink'));

    expect(resolveClipLabelHex(makeClip({ source: { type: 'model' }, meshType: 'cube' }), {
      ...emptyMediaState,
      meshItems: [label('purple', { meshType: 'cube' })],
    })).toBe(getLabelHex('purple'));

    expect(resolveClipLabelHex(makeClip({ source: { type: 'camera' } }), {
      ...emptyMediaState,
      cameraItems: [label('orange')],
    })).toBe(getLabelHex('orange'));

    expect(resolveClipLabelHex(makeClip({ name: 'Emitter', source: { type: 'splat-effector' } }), {
      ...emptyMediaState,
      splatEffectorItems: [label('cyan', { name: 'Emitter' })],
    })).toBe(getLabelHex('cyan'));
  });

  it('returns null for none or missing labels', () => {
    expect(resolveClipLabelHex(makeClip({ mediaFileId: 'file-1' }), {
      files: [label('none', { id: 'file-1' })],
      compositions: [],
    })).toBeNull();

    expect(resolveClipLabelHex(makeClip({ mediaFileId: 'missing' }), emptyMediaState)).toBeNull();
  });
});
