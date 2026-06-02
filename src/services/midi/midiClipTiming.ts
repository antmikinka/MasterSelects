// MIDI clip timing model (issue #232).
//
// A MIDI clip is a fixed canvas of notes plus a movable WINDOW onto that canvas:
//
//   - `note.start` is CONTENT time — seconds from the clip's content origin
//     (origin = 0). It never changes when the clip is resized; it only changes
//     when the user actually edits the note.
//   - `[clip.inPoint, clip.outPoint]` is the visible/playable window into the
//     content (`outPoint = inPoint + duration`). Resizing a clip moves this
//     window, not the notes.
//   - On the timeline the window's left edge sits at `clip.startTime`, so a note
//     at content time `t` plays at absolute time `startTime + (t - inPoint)`.
//
// Because every existing MIDI clip has `inPoint === 0`, these formulas reduce to
// the old `startTime + note.start` behavior — so this is backward compatible.
// Centralizing the mapping keeps the scheduler, piano roll, clip preview and
// ghost notes from drifting apart.

import type { MidiNote } from '../../types/midiClip';

const EPSILON = 0.0001;

/** The clip fields the timing model needs (subset of TimelineClip). */
export interface MidiClipWindow {
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
}

/** Absolute timeline time (seconds) at which a note starts. */
export function noteAbsoluteStart(clip: MidiClipWindow, note: Pick<MidiNote, 'start'>): number {
  return clip.startTime + (note.start - clip.inPoint);
}

/** Convert a clip-local offset (seconds from the window's left edge) to content time. */
export function clipLocalToContentTime(clip: Pick<MidiClipWindow, 'inPoint'>, localSeconds: number): number {
  return clip.inPoint + localSeconds;
}

/** Convert a note's content time to a clip-local offset (seconds from the window's left edge). */
export function contentTimeToClipLocal(clip: Pick<MidiClipWindow, 'inPoint'>, contentTime: number): number {
  return contentTime - clip.inPoint;
}

/**
 * Whether a note's START falls inside the clip's visible window `[inPoint, outPoint)`.
 * Notes outside the window are hidden/silent but their data is preserved, so a
 * later enlarge reveals them again.
 */
export function isNoteStartInWindow(clip: Pick<MidiClipWindow, 'inPoint' | 'outPoint'>, note: Pick<MidiNote, 'start'>): boolean {
  return note.start >= clip.inPoint - EPSILON && note.start < clip.outPoint - EPSILON;
}
