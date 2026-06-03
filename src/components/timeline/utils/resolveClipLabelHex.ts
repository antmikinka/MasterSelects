import type { TimelineClip } from '../../../types';
import { indexById } from '../../../stores/mediaStore/mediaIndex';
import { getLabelHex } from '../../panels/media/labelColors';
import type { LabelColor } from '../../../stores/mediaStore/types';

type LabelableMediaStoreItem = {
  id: string;
  name?: string;
  labelColor?: LabelColor;
  meshType?: string;
};

interface ClipLabelMediaState {
  files: readonly LabelableMediaStoreItem[];
  compositions: readonly LabelableMediaStoreItem[];
  solidItems?: readonly LabelableMediaStoreItem[];
  textItems?: readonly LabelableMediaStoreItem[];
  meshItems?: readonly LabelableMediaStoreItem[];
  cameraItems?: readonly LabelableMediaStoreItem[];
  splatEffectorItems?: readonly LabelableMediaStoreItem[];
}

const EMPTY_LABELABLE_MEDIA_ITEMS: readonly LabelableMediaStoreItem[] = [];

function resolveLabelHex(item: LabelableMediaStoreItem | null | undefined): string | null {
  if (!item?.labelColor || item.labelColor === 'none') return null;
  return getLabelHex(item.labelColor);
}

export function resolveClipLabelHex(clip: TimelineClip, state: ClipLabelMediaState): string | null {
  const mediaFileId = clip.mediaFileId || clip.source?.mediaFileId;
  if (clip.compositionId) {
    const compositionHex = resolveLabelHex(indexById(state.compositions).get(clip.compositionId));
    if (compositionHex) return compositionHex;
  }

  if (mediaFileId) {
    const fileHex = resolveLabelHex(indexById(state.files).get(mediaFileId));
    if (fileHex) return fileHex;
  }

  if (clip.source?.type === 'solid') {
    const solidItems = state.solidItems ?? EMPTY_LABELABLE_MEDIA_ITEMS;
    const solid = mediaFileId
      ? solidItems.find(item => item.id === mediaFileId)
      : solidItems.find(item => item.name === clip.name);
    return resolveLabelHex(solid);
  }

  if (clip.source?.type === 'text') {
    const textItems = state.textItems ?? EMPTY_LABELABLE_MEDIA_ITEMS;
    const text = mediaFileId
      ? textItems.find(item => item.id === mediaFileId)
      : textItems.find(item => item.name === clip.name);
    return resolveLabelHex(text);
  }

  if (clip.source?.type === 'model') {
    const meshItems = state.meshItems ?? EMPTY_LABELABLE_MEDIA_ITEMS;
    const mesh = mediaFileId
      ? meshItems.find(item => item.id === mediaFileId)
      : meshItems.find(item => item.name === clip.name || item.meshType === clip.meshType);
    return resolveLabelHex(mesh);
  }

  if (clip.source?.type === 'camera') {
    const cameraItems = state.cameraItems ?? EMPTY_LABELABLE_MEDIA_ITEMS;
    const camera = mediaFileId
      ? cameraItems.find(item => item.id === mediaFileId)
      : cameraItems[0];
    return resolveLabelHex(camera);
  }

  if (clip.source?.type === 'splat-effector') {
    const splatEffectorItems = state.splatEffectorItems ?? EMPTY_LABELABLE_MEDIA_ITEMS;
    const effector = mediaFileId
      ? splatEffectorItems.find(item => item.id === mediaFileId)
      : splatEffectorItems.find(item => item.name === clip.name);
    return resolveLabelHex(effector);
  }

  return null;
}
