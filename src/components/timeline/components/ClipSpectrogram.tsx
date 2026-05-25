import { memo, useEffect, useRef } from 'react';
import type { TimelineSpectrogramTileSet } from '../../../services/audio/timelineSpectrogramCache';

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function lerp(start: number, end: number, mix: number): number {
  return start + (end - start) * mix;
}

function mixColor(a: RgbColor, b: RgbColor, mix: number): RgbColor {
  return {
    r: Math.round(lerp(a.r, b.r, mix)),
    g: Math.round(lerp(a.g, b.g, mix)),
    b: Math.round(lerp(a.b, b.b, mix)),
  };
}

function spectralColor(value: number): RgbColor {
  const intensity = Math.pow(clamp01((value - 0.015) * 1.08), 0.72);
  const stops: Array<{ at: number; color: RgbColor }> = [
    { at: 0, color: { r: 3, g: 7, b: 14 } },
    { at: 0.16, color: { r: 11, g: 24, b: 48 } },
    { at: 0.34, color: { r: 21, g: 70, b: 112 } },
    { at: 0.54, color: { r: 35, g: 154, b: 165 } },
    { at: 0.72, color: { r: 218, g: 183, b: 86 } },
    { at: 0.88, color: { r: 232, g: 83, b: 52 } },
    { at: 1, color: { r: 245, g: 248, b: 255 } },
  ];

  for (let index = 0; index < stops.length - 1; index += 1) {
    const current = stops[index];
    const next = stops[index + 1];
    if (intensity <= next.at) {
      return mixColor(current.color, next.color, (intensity - current.at) / Math.max(0.001, next.at - current.at));
    }
  }

  return stops[stops.length - 1].color;
}

function positiveFinite(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getFrameIndexForTime(tileSet: TimelineSpectrogramTileSet, sourceTime: number): number {
  if (tileSet.frameCount <= 1) return 0;
  const secondsPerFrame = tileSet.hopSize / Math.max(1, tileSet.sampleRate);
  const frameIndex = Math.round(sourceTime / Math.max(0.000001, secondsPerFrame));
  return Math.max(0, Math.min(tileSet.frameCount - 1, frameIndex));
}

function getFrequencyBinForY(tileSet: TimelineSpectrogramTileSet, y: number, height: number): number {
  if (tileSet.frequencyBinCount <= 1) return 0;
  const highToLow = 1 - (y / Math.max(1, height - 1));
  const perceptual = Math.pow(clamp01(highToLow), 2.15);
  return Math.max(0, Math.min(tileSet.frequencyBinCount - 1, Math.round(perceptual * (tileSet.frequencyBinCount - 1))));
}

export const ClipSpectrogram = memo(function ClipSpectrogram({
  tileSet,
  width,
  height,
  inPoint,
  outPoint,
  naturalDuration,
  renderStartPx = 0,
  renderWidth,
  variant = 'source',
}: {
  tileSet: TimelineSpectrogramTileSet | null;
  width: number;
  height: number;
  inPoint: number;
  outPoint: number;
  naturalDuration: number;
  renderStartPx?: number;
  renderWidth?: number;
  variant?: 'source' | 'processed';
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const channel = tileSet?.channels[0];
    if (!canvas || !tileSet || !channel || width <= 0 || height <= 0 || naturalDuration <= 0) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const clipWidth = Math.max(1, width);
    const startPx = Math.max(0, Math.min(clipWidth, renderStartPx));
    const targetWidth = Math.max(1, Math.min(
      clipWidth - startPx,
      renderWidth ?? clipWidth,
    ));
    const maxCanvasWidth = 8192;
    const cssCanvasWidth = Math.min(targetWidth, maxCanvasWidth);
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const effectiveDpr = Math.max(1, Math.min(2, dpr, maxCanvasWidth / cssCanvasWidth));
    const drawWidth = Math.max(1, Math.floor(cssCanvasWidth * effectiveDpr));
    const drawHeight = Math.max(1, Math.floor(height * effectiveDpr));

    canvas.width = drawWidth;
    canvas.height = drawHeight;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, drawWidth, drawHeight);

    const sourceSpan = Math.max(0.000001, outPoint - inPoint);
    const visibleInPoint = inPoint + sourceSpan * (startPx / clipWidth);
    const visibleOutPoint = inPoint + sourceSpan * ((startPx + cssCanvasWidth) / clipWidth);
    const image = ctx.createImageData(drawWidth, drawHeight);
    const pixels = image.data;
    const values = channel.values;
    const frameCount = tileSet.frameCount;
    const binCount = tileSet.frequencyBinCount;
    const tileDuration = positiveFinite(tileSet.duration, naturalDuration);

    for (let y = 0; y < drawHeight; y += 1) {
      const binIndex = getFrequencyBinForY(tileSet, y, drawHeight);
      for (let x = 0; x < drawWidth; x += 1) {
        const timeMix = drawWidth <= 1 ? 0 : x / (drawWidth - 1);
        const sourceTime = Math.max(0, Math.min(
          tileDuration,
          visibleInPoint + (visibleOutPoint - visibleInPoint) * timeMix,
        ));
        const frameIndex = getFrameIndexForTime(tileSet, sourceTime);
        const value = values[frameIndex * binCount + binIndex] ?? 0;
        const color = spectralColor(value);
        const offset = (y * drawWidth + x) * 4;
        pixels[offset] = color.r;
        pixels[offset + 1] = color.g;
        pixels[offset + 2] = color.b;
        pixels[offset + 3] = 236;
      }
    }

    ctx.putImageData(image, 0, 0);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    const nyquistLineCount = Math.min(8, Math.max(3, Math.floor(height / 18)));
    for (let index = 1; index < nyquistLineCount; index += 1) {
      const y = (index / nyquistLineCount) * drawHeight;
      ctx.fillRect(0, Math.round(y), drawWidth, 1);
    }
    ctx.restore();

    if (frameCount > 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 1; x < drawWidth; x += Math.max(48, Math.floor(drawWidth / 18))) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, drawHeight);
      }
      ctx.stroke();
      ctx.restore();
    }
  }, [height, inPoint, naturalDuration, outPoint, renderStartPx, renderWidth, tileSet, width]);

  if (!tileSet || width <= 0 || height <= 0 || renderWidth === 0) return null;

  const clipWidth = Math.max(1, width);
  const canvasLeft = Math.max(0, Math.min(clipWidth, renderStartPx));
  const canvasWidth = Math.max(1, Math.min(
    clipWidth - canvasLeft,
    renderWidth ?? clipWidth,
  ));

  return (
    <canvas
      ref={canvasRef}
      className={`spectrogram-canvas spectrogram-canvas-${variant}`}
      data-spectrogram-variant={variant}
      style={{ left: canvasLeft, width: canvasWidth, height }}
    />
  );
});
