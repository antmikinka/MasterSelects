
import type { TimelineClip } from '../../types/timeline';
import type {
  MotionLayerDefinition,
  ReplicatorDefinition,
  ReplicatorLayout,
} from '../../types/motionDesign';
import {
  createDefaultMotionLayerDefinition,
  createDefaultReplicatorDefinition,
  isMotionProperty,
} from '../../types/motionDesign';
import type { PropertyDescriptor, PropertyValueType } from '../../types/propertyRegistry';

function cloneMotion(motion: MotionLayerDefinition | undefined): MotionLayerDefinition {
  return structuredClone(motion ?? createDefaultMotionLayerDefinition('shape')) as MotionLayerDefinition;
}

function withMotion(clip: TimelineClip, updater: (motion: MotionLayerDefinition) => MotionLayerDefinition): TimelineClip {
  return {
    ...clip,
    motion: updater(cloneMotion(clip.motion)),
  };
}

function ensureReplicator(motion: MotionLayerDefinition): ReplicatorDefinition {
  return motion.replicator ? structuredClone(motion.replicator) : createDefaultReplicatorDefinition();
}

function createGridLayout(layout: ReplicatorLayout): Extract<ReplicatorLayout, { mode: 'grid' }> {
  if (layout.mode === 'grid') return structuredClone(layout);
  return createDefaultReplicatorDefinition().layout as Extract<ReplicatorLayout, { mode: 'grid' }>;
}

export function getReplicatorDescriptorForPath(path: string, clip?: TimelineClip): PropertyDescriptor | undefined {
  if (!isMotionProperty(path) || !path.startsWith('replicator.')) return undefined;

  const defaultReplicator = createDefaultReplicatorDefinition();
  const current = clip?.motion?.replicator ?? defaultReplicator;
  const grid = createGridLayout(current.layout);

  const specs: Record<string, {
    label: string;
    valueType: PropertyValueType;
    defaultValue: number | boolean | string;
    animatable: boolean;
    read: (replicator: ReplicatorDefinition) => number | boolean | string;
    write: (replicator: ReplicatorDefinition, value: unknown) => ReplicatorDefinition;
    ui?: PropertyDescriptor['ui'];
  }> = {
    'replicator.enabled': {
      label: 'Enabled',
      valueType: 'boolean',
      defaultValue: false,
      animatable: false,
      read: (replicator) => replicator.enabled,
      write: (replicator, value) => ({ ...replicator, enabled: Boolean(value) }),
    },
    'replicator.layout.mode': {
      label: 'Layout',
      valueType: 'enum',
      defaultValue: 'grid',
      animatable: false,
      read: (replicator) => replicator.layout.mode,
      write: (replicator, value) => ({
        ...replicator,
        layout: String(value) === 'grid' ? createGridLayout(replicator.layout) : replicator.layout,
      }),
      ui: { options: [{ value: 'grid', label: 'Grid' }] },
    },
    'replicator.count.x': {
      label: 'Count X',
      valueType: 'number',
      defaultValue: grid.count.x,
      animatable: true,
      read: (replicator) => createGridLayout(replicator.layout).count.x,
      write: (replicator, value) => {
        const layout = createGridLayout(replicator.layout);
        return { ...replicator, layout: { ...layout, count: { ...layout.count, x: Math.max(1, Math.round(value as number)) } } };
      },
      ui: { min: 1, step: 1 },
    },
    'replicator.count.y': {
      label: 'Count Y',
      valueType: 'number',
      defaultValue: grid.count.y,
      animatable: true,
      read: (replicator) => createGridLayout(replicator.layout).count.y,
      write: (replicator, value) => {
        const layout = createGridLayout(replicator.layout);
        return { ...replicator, layout: { ...layout, count: { ...layout.count, y: Math.max(1, Math.round(value as number)) } } };
      },
      ui: { min: 1, step: 1 },
    },
    'replicator.spacing.x': {
      label: 'Spacing X',
      valueType: 'number',
      defaultValue: grid.spacing.x,
      animatable: true,
      read: (replicator) => createGridLayout(replicator.layout).spacing.x,
      write: (replicator, value) => {
        const layout = createGridLayout(replicator.layout);
        return { ...replicator, layout: { ...layout, spacing: { ...layout.spacing, x: value as number } } };
      },
      ui: { step: 1 },
    },
    'replicator.spacing.y': {
      label: 'Spacing Y',
      valueType: 'number',
      defaultValue: grid.spacing.y,
      animatable: true,
      read: (replicator) => createGridLayout(replicator.layout).spacing.y,
      write: (replicator, value) => {
        const layout = createGridLayout(replicator.layout);
        return { ...replicator, layout: { ...layout, spacing: { ...layout.spacing, y: value as number } } };
      },
      ui: { step: 1 },
    },
    'replicator.offset.position.x': {
      label: 'Offset X',
      valueType: 'number',
      defaultValue: defaultReplicator.offset.position.x,
      animatable: true,
      read: (replicator) => replicator.offset.position.x,
      write: (replicator, value) => ({ ...replicator, offset: { ...replicator.offset, position: { ...replicator.offset.position, x: value as number } } }),
      ui: { step: 1 },
    },
    'replicator.offset.position.y': {
      label: 'Offset Y',
      valueType: 'number',
      defaultValue: defaultReplicator.offset.position.y,
      animatable: true,
      read: (replicator) => replicator.offset.position.y,
      write: (replicator, value) => ({ ...replicator, offset: { ...replicator.offset, position: { ...replicator.offset.position, y: value as number } } }),
      ui: { step: 1 },
    },
    'replicator.offset.rotation': {
      label: 'Offset Rotation',
      valueType: 'number',
      defaultValue: defaultReplicator.offset.rotation,
      animatable: true,
      read: (replicator) => replicator.offset.rotation,
      write: (replicator, value) => ({ ...replicator, offset: { ...replicator.offset, rotation: value as number } }),
      ui: { unit: 'deg', step: 0.1 },
    },
    'replicator.offset.scale.x': {
      label: 'Offset Scale X',
      valueType: 'number',
      defaultValue: defaultReplicator.offset.scale.x,
      animatable: true,
      read: (replicator) => replicator.offset.scale.x,
      write: (replicator, value) => ({ ...replicator, offset: { ...replicator.offset, scale: { ...replicator.offset.scale, x: value as number } } }),
      ui: { step: 0.01 },
    },
    'replicator.offset.scale.y': {
      label: 'Offset Scale Y',
      valueType: 'number',
      defaultValue: defaultReplicator.offset.scale.y,
      animatable: true,
      read: (replicator) => replicator.offset.scale.y,
      write: (replicator, value) => ({ ...replicator, offset: { ...replicator.offset, scale: { ...replicator.offset.scale, y: value as number } } }),
      ui: { step: 0.01 },
    },
    'replicator.offset.opacity': {
      label: 'Offset Opacity',
      valueType: 'number',
      defaultValue: defaultReplicator.offset.opacity,
      animatable: true,
      read: (replicator) => replicator.offset.opacity,
      write: (replicator, value) => ({ ...replicator, offset: { ...replicator.offset, opacity: value as number } }),
      ui: { min: 0, max: 1, step: 0.01 },
    },
  };

  const spec = specs[path];
  if (!spec) return undefined;

  return {
    path,
    label: spec.label,
    group: 'Motion / Replicator',
    valueType: spec.valueType,
    animatable: spec.animatable,
    defaultValue: spec.defaultValue,
    ui: { aliases: ['motion', 'replicator'], ...spec.ui },
    read: (targetClip) => spec.read(targetClip.motion?.replicator ?? defaultReplicator),
    write: (targetClip, value) => withMotion(targetClip, (motion) => {
      const replicator = ensureReplicator(motion);
      return {
        ...motion,
        replicator: spec.write(replicator, value),
      };
    }),
  };
}
