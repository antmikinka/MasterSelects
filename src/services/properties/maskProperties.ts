
import type { TimelineClip } from '../../types/timeline';
import type { ClipMask, MaskPathKeyframeValue } from '../../types/masks';
import { parseMaskProperty } from '../../types/animationProperties';
import type { PropertyDescriptor } from '../../types/propertyRegistry';

function getMaskPathValue(mask: ClipMask): MaskPathKeyframeValue {
  return {
    closed: mask.closed,
    vertices: mask.vertices.map((vertex) => ({
      ...vertex,
      handleIn: { ...vertex.handleIn },
      handleOut: { ...vertex.handleOut },
    })),
  };
}

export function getMaskDescriptorForPath(path: string, clip?: TimelineClip): PropertyDescriptor | undefined {
  const parsed = parseMaskProperty(path);
  if (!parsed || !clip?.masks) return undefined;

  const mask = clip.masks.find((candidate) => candidate.id === parsed.maskId);
  if (!mask) return undefined;

  if (parsed.property === 'path') {
    return {
      path,
      label: `${mask.name} Path`,
      group: 'Masks',
      valueType: 'path',
      animatable: true,
      defaultValue: getMaskPathValue(mask),
      ui: { aliases: ['mask path', mask.name] },
      read: (targetClip) => {
        const targetMask = targetClip.masks?.find((candidate) => candidate.id === parsed.maskId);
        return targetMask ? getMaskPathValue(targetMask) : undefined;
      },
      write: (targetClip, value) => {
        const pathValue = value as MaskPathKeyframeValue;
        return {
          ...targetClip,
          masks: targetClip.masks?.map((candidate) => (
            candidate.id === parsed.maskId
              ? {
                  ...candidate,
                  closed: pathValue.closed,
                  vertices: pathValue.vertices.map((vertex) => ({
                    ...vertex,
                    handleIn: { ...vertex.handleIn },
                    handleOut: { ...vertex.handleOut },
                  })),
                }
              : candidate
          )),
        };
      },
    };
  }

  const numericProperty = parsed.property as 'position.x' | 'position.y' | 'feather' | 'featherQuality';
  const labelByProperty: Record<typeof numericProperty, string> = {
    'position.x': `${mask.name} X`,
    'position.y': `${mask.name} Y`,
    feather: `${mask.name} Feather`,
    featherQuality: `${mask.name} Feather Quality`,
  };

  return {
    path,
    label: labelByProperty[numericProperty],
    group: 'Masks',
    valueType: 'number',
    animatable: true,
      defaultValue: numericProperty.startsWith('position.') ? 0 : numericProperty === 'featherQuality' ? 1 : 0,
    ui: {
      min: numericProperty === 'feather' ? 0 : numericProperty === 'featherQuality' ? 1 : undefined,
      max: numericProperty === 'featherQuality' ? 100 : undefined,
      step: numericProperty === 'featherQuality' ? 1 : 0.1,
      aliases: [mask.name, numericProperty],
    },
    read: (targetClip) => {
      const targetMask = targetClip.masks?.find((candidate) => candidate.id === parsed.maskId);
      if (!targetMask) return undefined;
      if (numericProperty === 'position.x') return targetMask.position.x;
      if (numericProperty === 'position.y') return targetMask.position.y;
      return targetMask[numericProperty];
    },
    write: (targetClip, value) => ({
      ...targetClip,
      masks: targetClip.masks?.map((candidate) => {
        if (candidate.id !== parsed.maskId) return candidate;
        if (numericProperty === 'position.x') {
          return { ...candidate, position: { ...candidate.position, x: value as number } };
        }
        if (numericProperty === 'position.y') {
          return { ...candidate, position: { ...candidate.position, y: value as number } };
        }
        return { ...candidate, [numericProperty]: value as number };
      }),
    }),
  };
}

export function getMaskDescriptorsForClip(clip: TimelineClip): PropertyDescriptor[] {
  return (clip.masks ?? []).flatMap((mask) => [
    getMaskDescriptorForPath(`mask.${mask.id}.path`, clip),
    getMaskDescriptorForPath(`mask.${mask.id}.position.x`, clip),
    getMaskDescriptorForPath(`mask.${mask.id}.position.y`, clip),
    getMaskDescriptorForPath(`mask.${mask.id}.feather`, clip),
    getMaskDescriptorForPath(`mask.${mask.id}.featherQuality`, clip),
  ].filter((descriptor): descriptor is PropertyDescriptor => Boolean(descriptor)));
}
