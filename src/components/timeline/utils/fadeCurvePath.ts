import { normalizeEasingType } from '../../../utils/easing';

export interface FadeCurveKeyframe {
  id?: string;
  time: number;
  value: number;
  easing: string;
  handleIn?: { x: number; y: number };
  handleOut?: { x: number; y: number };
}

export interface FadeCurvePoint {
  x: number;
  y: number;
}

export interface FadeCurvePath {
  curvePath: string;
  fillPath: string;
  points: FadeCurvePoint[];
}

export function buildFadeCurvePath({
  keyframes,
  clipDuration,
  width,
  height,
}: {
  keyframes: readonly FadeCurveKeyframe[];
  clipDuration: number;
  width: number;
  height: number;
}): FadeCurvePath | null {
  if (keyframes.length < 2 || width <= 0 || height <= 0 || clipDuration <= 0) {
    return null;
  }

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  const timeToX = (time: number) => (time / clipDuration) * width;
  const valueToY = (value: number) => height - value * height;
  const pathSegments: string[] = [];
  const points: FadeCurvePoint[] = [];

  const firstKeyframe = sorted[0];
  const firstPoint = {
    x: timeToX(firstKeyframe.time),
    y: valueToY(firstKeyframe.value),
  };
  points.push(firstPoint);
  pathSegments.push(`M ${firstPoint.x} ${firstPoint.y}`);

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index];
    const next = sorted[index + 1];

    const x1 = timeToX(current.time);
    const y1 = valueToY(current.value);
    const x2 = timeToX(next.time);
    const y2 = valueToY(next.value);
    const duration = next.time - current.time;

    let cp1x: number;
    let cp1y: number;
    let cp2x: number;
    let cp2y: number;
    const easing = normalizeEasingType(current.easing, 'linear');

    if (easing === 'bezier' && current.handleOut && next.handleIn) {
      cp1x = timeToX(current.time + current.handleOut.x);
      cp1y = valueToY(current.value + current.handleOut.y);
      cp2x = timeToX(next.time + next.handleIn.x);
      cp2y = valueToY(next.value + next.handleIn.y);
    } else {
      switch (easing) {
        case 'ease-in':
          cp1x = x1 + duration * 0.42 * (width / clipDuration);
          cp1y = y1;
          cp2x = x2;
          cp2y = y2;
          break;
        case 'ease-out':
          cp1x = x1;
          cp1y = y1;
          cp2x = x1 + duration * 0.58 * (width / clipDuration);
          cp2y = y2;
          break;
        case 'ease-in-out':
          cp1x = x1 + duration * 0.42 * (width / clipDuration);
          cp1y = y1;
          cp2x = x1 + duration * 0.58 * (width / clipDuration);
          cp2y = y2;
          break;
        case 'linear':
        default:
          cp1x = x1 + (x2 - x1) / 3;
          cp1y = y1 + (y2 - y1) / 3;
          cp2x = x1 + (x2 - x1) * 2 / 3;
          cp2y = y1 + (y2 - y1) * 2 / 3;
          break;
      }
    }

    pathSegments.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`);
    points.push({ x: x2, y: y2 });
  }

  const curvePath = pathSegments.join(' ');
  const lastPoint = points[points.length - 1];
  const fillPath = `${curvePath} L ${lastPoint.x} ${height} L ${firstPoint.x} ${height} Z`;

  return { curvePath, fillPath, points };
}
