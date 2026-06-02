import { describe, expect, it } from 'vitest';
import {
  clipLocalToContentTime,
  contentTimeToClipLocal,
  isNoteStartInWindow,
  noteAbsoluteStart,
  type MidiClipWindow,
} from '../../src/services/midi/midiClipTiming';

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

// Helper mirroring the production formula for the round-trip assertion.
function noteAbsoluteStartContent(clip: MidiClipWindow, content: number): number {
  return contentTimeToClipLocal(clip, content) + clip.inPoint;
}
