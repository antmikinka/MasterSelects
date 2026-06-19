import { useCallback, useEffect, useRef, useState } from 'react';
import { useMediaStore, type MediaFile } from '../../../stores/mediaStore';
import type { SourceMonitorImageCropApplyRequest } from './SourceMonitorImageCrop';
import { createSourceMonitorCroppedFile } from './sourceMonitorImageCropFile';

export function useSourceMonitorImageCrop(file: MediaFile, isImage: boolean) {
  const sourceMonitorCropRequestId = useMediaStore(state => state.sourceMonitorCropRequestId);
  const handledCropRequestIdRef = useRef(0);
  const [cropMode, setCropMode] = useState(false);
  const [cropBusy, setCropBusy] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);

  useEffect(() => {
    setCropError(null);
    if (!isImage) setCropMode(false);
  }, [file.id, isImage]);

  useEffect(() => {
    if (!isImage || sourceMonitorCropRequestId <= handledCropRequestIdRef.current) return;
    handledCropRequestIdRef.current = sourceMonitorCropRequestId;
    setCropMode(true);
    setCropError(null);
  }, [file.id, isImage, sourceMonitorCropRequestId]);

  const applyImageCrop = useCallback(async ({ image, crop }: SourceMonitorImageCropApplyRequest) => {
    if (!isImage || cropBusy) return;
    setCropBusy(true);
    setCropError(null);

    try {
      const mediaState = useMediaStore.getState();
      const croppedFile = await createSourceMonitorCroppedFile({
        sourceFile: file,
        image,
        crop,
        existingNames: mediaState.files.map((entry) => entry.name),
      });
      const imported = await mediaState.importFile(croppedFile, file.parentId, {
        forceCopyToProject: Boolean(file.projectPath),
      });

      if ('url' in imported) {
        const latestState = useMediaStore.getState();
        latestState.setSelection([imported.id]);
        latestState.setSourceMonitorFile(imported.id);
      }
      setCropMode(false);
    } catch (error) {
      setCropError(error instanceof Error ? error.message : 'Could not crop image');
    } finally {
      setCropBusy(false);
    }
  }, [cropBusy, file, isImage]);

  const cancelImageCrop = useCallback(() => {
    setCropMode(false);
    setCropError(null);
  }, []);

  const toggleImageCrop = useCallback(() => {
    setCropMode((active) => !active);
    setCropError(null);
  }, []);

  return {
    applyImageCrop,
    cancelImageCrop,
    cropBusy,
    cropError,
    cropMode,
    toggleImageCrop,
  };
}
