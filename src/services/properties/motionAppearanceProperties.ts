
import type { TimelineClip } from '../../types/timeline';
import type { AppearanceItem, MotionLayerDefinition } from '../../types/motionDesign';
import { createDefaultMotionLayerDefinition } from '../../types/motionDesign';
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

function getAppearanceItem(motion: MotionLayerDefinition | undefined, itemId: string): AppearanceItem | undefined {
  return motion?.appearance?.items.find((item) => item.id === itemId);
}

export function createAppearanceDescriptor(path: string, clip: TimelineClip): PropertyDescriptor | undefined {
  const match = /^appearance\.([^.]+)\.(.+)$/.exec(path);
  if (!match) return undefined;

  const [, itemId, field] = match;
  const item = getAppearanceItem(clip.motion, itemId);
  if (!item) return undefined;

  const common = {
    path,
    group: `Motion / Appearance / ${item.name}`,
    ui: { aliases: ['motion', 'appearance', item.kind, item.name] },
  };

  if (field === 'opacity') {
    return {
      ...common,
      label: `${item.name} Opacity`,
      valueType: 'number',
      animatable: true,
      defaultValue: 1,
      ui: { ...common.ui, min: 0, max: 1, step: 0.01 },
      read: (targetClip) => getAppearanceItem(targetClip.motion, itemId)?.opacity ?? 1,
      write: (targetClip, value) => withMotion(targetClip, (motion) => ({
        ...motion,
        appearance: motion.appearance
          ? {
              ...motion.appearance,
              items: motion.appearance.items.map((candidate) => (
                candidate.id === itemId ? { ...candidate, opacity: value as number } : candidate
              )),
            }
          : motion.appearance,
      })),
    };
  }

  const colorMatch = /^color\.(r|g|b|a)$/.exec(field);
  if (colorMatch && (item.kind === 'color-fill' || item.kind === 'stroke')) {
    const channel = colorMatch[1] as 'r' | 'g' | 'b' | 'a';
    return {
      ...common,
      label: `${item.name} ${channel.toUpperCase()}`,
      valueType: 'number',
      animatable: true,
      defaultValue: channel === 'a' ? 1 : 0,
      ui: { ...common.ui, min: 0, max: 1, step: 0.01 },
      read: (targetClip) => {
        const targetItem = getAppearanceItem(targetClip.motion, itemId);
        return targetItem && (targetItem.kind === 'color-fill' || targetItem.kind === 'stroke')
          ? targetItem.color[channel]
          : undefined;
      },
      write: (targetClip, value) => withMotion(targetClip, (motion) => ({
        ...motion,
        appearance: motion.appearance
          ? {
              ...motion.appearance,
              items: motion.appearance.items.map((candidate) => (
                candidate.id === itemId && (candidate.kind === 'color-fill' || candidate.kind === 'stroke')
                  ? { ...candidate, color: { ...candidate.color, [channel]: value as number } }
                  : candidate
              )),
            }
          : motion.appearance,
      })),
    };
  }

  if (field === 'stroke.width' && item.kind === 'stroke') {
    return {
      ...common,
      label: `${item.name} Width`,
      valueType: 'number',
      animatable: true,
      defaultValue: item.width,
      ui: { ...common.ui, min: 0, step: 0.5 },
      read: (targetClip) => {
        const targetItem = getAppearanceItem(targetClip.motion, itemId);
        return targetItem?.kind === 'stroke' ? targetItem.width : undefined;
      },
      write: (targetClip, value) => withMotion(targetClip, (motion) => ({
        ...motion,
        appearance: motion.appearance
          ? {
              ...motion.appearance,
              items: motion.appearance.items.map((candidate) => (
                candidate.id === itemId && candidate.kind === 'stroke'
                  ? { ...candidate, width: value as number }
                  : candidate
              )),
            }
          : motion.appearance,
      })),
    };
  }

  if (field === 'stroke.alignment' && item.kind === 'stroke') {
    return {
      ...common,
      label: `${item.name} Alignment`,
      valueType: 'enum',
      animatable: false,
      defaultValue: item.alignment,
      ui: {
        ...common.ui,
        options: [
          { value: 'center', label: 'Center' },
          { value: 'inside', label: 'Inside' },
          { value: 'outside', label: 'Outside' },
        ],
      },
      read: (targetClip) => {
        const targetItem = getAppearanceItem(targetClip.motion, itemId);
        return targetItem?.kind === 'stroke' ? targetItem.alignment : undefined;
      },
      write: (targetClip, value) => withMotion(targetClip, (motion) => ({
        ...motion,
        appearance: motion.appearance
          ? {
              ...motion.appearance,
              items: motion.appearance.items.map((candidate) => (
                candidate.id === itemId && candidate.kind === 'stroke'
                  ? { ...candidate, alignment: value as 'center' | 'inside' | 'outside' }
                  : candidate
              )),
            }
          : motion.appearance,
      })),
    };
  }

  return undefined;
}
