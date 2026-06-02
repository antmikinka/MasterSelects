// ClipMidiPreview — Cubase-style mini note view drawn inside a MIDI clip on the
// timeline (issue #232). Each note is a thin horizontal bar: X = note time, Y =
// pitch. The pitch axis is normalized to the clip's own min..max range (DAW
// "fit notes to view") so the used register fills the height instead of being
// squashed into the full 0–127 span.
//
// Canvas-based and memoized, mirroring ClipWaveform: one fillRect per note,
// redrawn only when notes / size / zoom / trim change. Only notes inside the
// visible render window are drawn, so long clips stay cheap.

import { memo, useEffect, useRef } from 'react';
import type { MidiNote } from '../../../types/midiClip';

interface ClipMidiPreviewProps {
  notes: MidiNote[];
  /** Full clip pixel width (content space, before render-window clipping). */
  width: number;
  height: number;
  pixelsPerSecond: number;
  /** Clip trim origin (seconds): notes before this are scrolled off the left. */
  inPoint: number;
  /** Visible portion of the clip in content px [startPx, startPx + windowWidth]. */
  renderStartPx: number;
  renderWidth: number;
  /** Bar color (defaults to a light blue that reads on the MIDI clip body). */
  color?: string;
}

const MIN_BAR_HEIGHT = 1.5;
const MAX_BAR_HEIGHT = 4;
const MIN_BAR_WIDTH = 1;
const PITCH_PADDING = 1; // semitones of headroom above/below the used range
const VERTICAL_INSET = 3; // px breathing room top/bottom inside the canvas

function ClipMidiPreviewImpl({
  notes,
  width,
  height,
  pixelsPerSecond,
  inPoint,
  renderStartPx,
  renderWidth,
  color = 'rgba(173, 198, 255, 0.92)',
}: ClipMidiPreviewProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Size and position the canvas to the visible render window only (not the full
  // clip), so deep-zoomed or very long clips never allocate a giant canvas.
  const clipWidth = Math.max(1, Math.round(width));
  const canvasLeft = Math.max(0, Math.min(clipWidth, Math.floor(renderStartPx)));
  const canvasWidth = Math.max(1, Math.min(Math.ceil(renderWidth) || clipWidth, clipWidth - canvasLeft));
  const cssHeight = Math.max(1, Math.round(height));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(canvasWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    // Translate so note positions are in clip-content px while the canvas itself
    // is offset by canvasLeft within the clip.
    ctx.setTransform(dpr, 0, 0, dpr, -canvasLeft * dpr, 0);
    ctx.clearRect(canvasLeft, 0, canvasWidth, cssHeight);

    if (notes.length === 0 || pixelsPerSecond <= 0) return;

    // Pitch range fit to this clip's notes (DAW "fit to view").
    let minPitch = Infinity;
    let maxPitch = -Infinity;
    for (const note of notes) {
      if (note.pitch < minPitch) minPitch = note.pitch;
      if (note.pitch > maxPitch) maxPitch = note.pitch;
    }
    minPitch -= PITCH_PADDING;
    maxPitch += PITCH_PADDING;
    const pitchSpan = Math.max(1, maxPitch - minPitch);

    const usableHeight = Math.max(1, cssHeight - VERTICAL_INSET * 2);
    const barHeight = Math.min(
      MAX_BAR_HEIGHT,
      Math.max(MIN_BAR_HEIGHT, usableHeight / pitchSpan),
    );

    // Only draw notes overlapping the visible canvas window.
    const windowStartPx = canvasLeft;
    const windowEndPx = canvasLeft + canvasWidth;

    ctx.fillStyle = color;
    for (const note of notes) {
      const noteStartPx = (note.start - inPoint) * pixelsPerSecond;
      const noteWidthPx = Math.max(MIN_BAR_WIDTH, note.duration * pixelsPerSecond);
      const noteEndPx = noteStartPx + noteWidthPx;
      if (noteEndPx < windowStartPx || noteStartPx > windowEndPx) continue;

      // High pitch on top: invert the normalized position.
      const norm = (note.pitch - minPitch) / pitchSpan;
      const y = VERTICAL_INSET + (1 - norm) * usableHeight - barHeight / 2;
      ctx.fillRect(noteStartPx, y, noteWidthPx, barHeight);
    }
  }, [notes, canvasLeft, canvasWidth, cssHeight, pixelsPerSecond, inPoint, color]);

  return (
    <canvas
      ref={canvasRef}
      className="clip-midi-preview-canvas"
      style={{ left: canvasLeft, width: canvasWidth, height: cssHeight }}
      aria-hidden="true"
    />
  );
}

export const ClipMidiPreview = memo(ClipMidiPreviewImpl);
