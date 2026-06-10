
import type { TimelineClip } from '../../types/timeline';
import type { MotionLayerDefinition } from '../../types/motionDesign';
import {
  DEFAULT_MOTION_SHAPE_SIZE,
  createDefaultMotionLayerDefinition,
} from '../../types/motionDesign';
import type { PropertyDescriptor } from '../../types/propertyRegistry';

function cloneMotion(motion: MotionLayerDefinition | undefined): MotionLayerDefinition {
  return structuredClone(motion ?? createDefaultMotionLayerDefinition('shape')) as MotionLayerDefinition;
}

function withMotion(clip: TimelineClip, updater: (motion: MotionLayerDefinition) => MotionLayerDefinition): TimelineClip {
  return {
    ...clip,
    motion: updater(cloneMotion(clip.motion)),
  };
}

function updateShape(
  clip: TimelineClip,
  updater: (motion: MotionLayerDefinition) => MotionLayerDefinition,
): TimelineClip {
  return withMotion(clip, updater);
}

export function createMotionShapeDescriptor(
  path: 'shape.size.w' | 'shape.size.h' | 'shape.cornerRadius',
  label: string,
): PropertyDescriptor<number> {
  return {
    path,
    label,
    group: 'Motion / Shape',
    valueType: 'number',
    animatable: true,
    defaultValue: path === 'shape.size.w'
      ? DEFAULT_MOTION_SHAPE_SIZE.w
      : path === 'shape.size.h'
        ? DEFAULT_MOTION_SHAPE_SIZE.h
        : 0,
    ui: {
      min: 0,
      step: 1,
      aliases: ['motion', 'shape'],
    },
    read: (clip) => {
      if (path === 'shape.size.w') return clip.motion?.shape?.size.w ?? DEFAULT_MOTION_SHAPE_SIZE.w;
      if (path === 'shape.size.h') return clip.motion?.shape?.size.h ?? DEFAULT_MOTION_SHAPE_SIZE.h;
      return clip.motion?.shape?.cornerRadius ?? 0;
    },
    write: (clip, value) => updateShape(clip, (motion) => ({
      ...motion,
      shape: {
        ...(motion.shape ?? createDefaultMotionLayerDefinition('shape').shape!),
        size: {
          ...(motion.shape?.size ?? DEFAULT_MOTION_SHAPE_SIZE),
          ...(path === 'shape.size.w' ? { w: value as number } : {}),
          ...(path === 'shape.size.h' ? { h: value as number } : {}),
        },
        ...(path === 'shape.cornerRadius' ? { cornerRadius: value as number } : {}),
      },
    })),
  };
}
