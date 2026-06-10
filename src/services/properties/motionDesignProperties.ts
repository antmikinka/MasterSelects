
import type { TimelineClip } from '../../types/timeline';
import { isMotionProperty } from '../../types/motionDesign';
import type { PropertyDescriptor } from '../../types/propertyRegistry';
import { createAppearanceDescriptor } from './motionAppearanceProperties';
import { getReplicatorDescriptorForPath } from './motionReplicatorProperties';
import { createMotionShapeDescriptor } from './motionShapeProperties';

export function getMotionDescriptorForPath(path: string, clip?: TimelineClip): PropertyDescriptor | undefined {
  if (!isMotionProperty(path)) return undefined;

  if (path === 'shape.size.w') return createMotionShapeDescriptor(path, 'Width');
  if (path === 'shape.size.h') return createMotionShapeDescriptor(path, 'Height');
  if (path === 'shape.cornerRadius') return createMotionShapeDescriptor(path, 'Corner Radius');
  if (path.startsWith('appearance.') && clip) return createAppearanceDescriptor(path, clip);
  return getReplicatorDescriptorForPath(path, clip);
}

export function getMotionDescriptorsForClip(clip: TimelineClip): PropertyDescriptor[] {
  const descriptors: PropertyDescriptor[] = [
    createMotionShapeDescriptor('shape.size.w', 'Width'),
    createMotionShapeDescriptor('shape.size.h', 'Height'),
    createMotionShapeDescriptor('shape.cornerRadius', 'Corner Radius'),
  ];

  clip.motion?.appearance?.items.forEach((item) => {
    [
      `appearance.${item.id}.opacity`,
      ...(item.kind === 'color-fill' || item.kind === 'stroke'
        ? [
            `appearance.${item.id}.color.r`,
            `appearance.${item.id}.color.g`,
            `appearance.${item.id}.color.b`,
            `appearance.${item.id}.color.a`,
          ]
        : []),
      ...(item.kind === 'stroke'
        ? [
            `appearance.${item.id}.stroke.width`,
            `appearance.${item.id}.stroke.alignment`,
          ]
        : []),
    ].forEach((path) => {
      const descriptor = createAppearanceDescriptor(path, clip);
      if (descriptor) descriptors.push(descriptor);
    });
  });

  [
    'replicator.enabled',
    'replicator.layout.mode',
    'replicator.count.x',
    'replicator.count.y',
    'replicator.spacing.x',
    'replicator.spacing.y',
    'replicator.offset.position.x',
    'replicator.offset.position.y',
    'replicator.offset.rotation',
    'replicator.offset.scale.x',
    'replicator.offset.scale.y',
    'replicator.offset.opacity',
  ].forEach((path) => {
    const descriptor = getReplicatorDescriptorForPath(path, clip);
    if (descriptor) descriptors.push(descriptor);
  });

  return descriptors;
}
