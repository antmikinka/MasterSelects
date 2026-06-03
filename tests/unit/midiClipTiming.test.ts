import { describe, expect, it } from 'vitest';
import {
  clipLocalToContentTime,
  contentTimeToClipLocal,
  isNoteStartInWindow,
  noteAbsoluteStart,
  partitionMidiNotesAtCut,
  type MidiClipWindow,
} from '../../src/services/midi/midiClipTiming';
import type { MidiNote } from '../../src/types/midiClip';

// A clip whose window has been slid right: content origin 0 sits 2s before the
// window, so the window [2, 6] shows content times 2..6 over a 4s duration.
const slidClip: MidiClipWindow = { startTime: 10, duration: 4, inPoint: 2, outPoint: 6 };
// A clip enlarged to the left past the content origin: inPoint is negative, so
// there is empty pre-roll before the first possible note.
const preRollClip: MidiClipWindow = { startTime: 3, duration: 5, inPoint: -2, outPoint: 3 };

describe('midiClipTiming', () => {
  it('places a note at startTime when its content time equals inPoint', () => {
    expect(noteAbsoluteStart(slidClip, { start: 2 })).toBe(10);
  });

  it('keeps absolute position stable when the window slides (resize, not move)', () => {
    const note = { start: 4 }; // content time 4
    // Original window inPoint 2 -> abs 10 + (4-2) = 12.
    expect(noteAbsoluteStart(slidClip, note)).toBe(12);
    // Slide the window left by 2 (left-enlarge): startTime and inPoint both -2.
    const enlarged: MidiClipWindow = { startTime: 8, duration: 6, inPoint: 0, outPoint: 6 };
    expect(noteAbsoluteStart(enlarged, note)).toBe(12); // note did not move
  });

  it('round-trips clip-local <-> content time', () => {
    expect(clipLocalToContentTime(slidClip, 0)).toBe(2);
    expect(contentTimeToClipLocal(slidClip, 2)).toBe(0);
    expect(contentTimeToClipLocal(slidClip, noteAbsoluteStartContent(slidClip, 3))).toBeCloseTo(1);
  });

  it('treats notes outside the window as hidden but does not move them', () => {
    expect(isNoteStartInWindow(slidClip, { start: 2 })).toBe(true);
    expect(isNoteStartInWindow(slidClip, { start: 5.9 })).toBe(true);
    expect(isNoteStartInWindow(slidClip, { start: 1.5 })).toBe(false); // before window
    expect(isNoteStartInWindow(slidClip, { start: 6 })).toBe(false); // at/after window end
  });

  it('supports negative in-points (left-enlarged empty pre-roll)', () => {
    // Content origin note still lands at startTime + (0 - (-2)) = 3 + 2 = 5.
    expect(noteAbsoluteStart(preRollClip, { start: 0 })).toBe(5);
    expect(isNoteStartInWindow(preRollClip, { start: 0 })).toBe(true);
  });
});

describe('partitionMidiNotesAtCut', () => {
  let nextId = 0;
  const makeNote = (source: MidiNote, rebased: { start: number; duration: number }): MidiNote => ({
    id: `n${nextId++}`,
    pitch: source.pitch,
    velocity: source.velocity,
    start: rebased.start,
    duration: rebased.duration,
  });
  const note = (start: number, duration: number, pitch = 60, velocity = 0.8): MidiNote =>
    ({ id: 'src', pitch, start, duration, velocity });

  // A fresh, unwindowed clip: inPoint 0, outPoint 4, cut at 2s.
  const window = { inPoint: 0, outPoint: 4 };

  it('assigns notes to a half by where their start falls, rebased to each origin', () => {
    const { left, right } = partitionMidiNotesAtCut(
      [note(0.5, 0.5), note(2.5, 0.5)],
      window,
      2,
      makeNote,
    );
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ start: 0.5, duration: 0.5 });
    expect(right).toHaveLength(1);
    // Rebased by the cut: 2.5 - 2 = 0.5.
    expect(right[0]).toMatchObject({ start: 0.5, duration: 0.5 });
  });

  it('keeps a note that straddles the cut WHOLE on the left, never slicing it', () => {
    const { left, right } = partitionMidiNotesAtCut([note(1.5, 1.0, 64, 0.5)], window, 2, makeNote);
    // Starts left of the cut, so the whole note stays left with its full duration
    // and rings out past the cut. The right clip gets no fragment of it.
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ start: 1.5, duration: 1.0, pitch: 64, velocity: 0.5 });
    expect(right).toHaveLength(0);
  });

  it('drops notes whose start is outside the visible window', () => {
    // Window [2, 6] over content; notes before 2 / at-or-after 6 are already silent.
    const { left, right } = partitionMidiNotesAtCut(
      [note(1, 0.5), note(3, 0.5), note(6, 0.5)],
      { inPoint: 2, outPoint: 6 },
      4,
      makeNote,
    );
    // Only the note at content 3 survives; it lands left of the cut, rebased by inPoint.
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ start: 1, duration: 0.5 }); // 3 - inPoint(2)
    expect(right).toHaveLength(0);
  });

  it('keeps every surviving note absolutely positioned after a cut', () => {
    // Single clip at startTime 10, window [0,4], note at content 2.5.
    const startTime = 10;
    const { left, right } = partitionMidiNotesAtCut([note(2.5, 0.5)], window, 2, makeNote);
    expect(left).toHaveLength(0);
    // Right clip starts at startTime + cut = 12; its note origin is 0 -> abs 12.5.
    const rightClipStart = startTime + 2;
    const absBefore = startTime + 2.5; // original abs (inPoint 0)
    const absAfter = rightClipStart + right[0].start;
    expect(absAfter).toBeCloseTo(absBefore);
  });
});

// Helper mirroring the production formula for the round-trip assertion.
function noteAbsoluteStartContent(clip: MidiClipWindow, content: number): number {
  return contentTimeToClipLocal(clip, content) + clip.inPoint;
}
