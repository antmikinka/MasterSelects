import { useCallback, type ChangeEvent } from 'react';
import type { MediaPanelContextMenu } from '../context/types';
import type { MediaPanelViewMode } from './types';
import type { MediaFolder, useMediaStore } from '../../../../stores/mediaStore';
import type { MeshPrimitiveType } from '../../../../stores/mediaStore/types';
import type { ShapePrimitive } from '../../../../types/motionDesign';

type MediaStoreState = ReturnType<typeof useMediaStore.getState>;

interface UseMediaPanelAddImportCommandsInput {
  fileInputRef: { current: HTMLInputElement | null };
  fileSystemSupported: boolean;
  contextMenu: MediaPanelContextMenu | null;
  viewMode: MediaPanelViewMode;
  gridFolderId: string | null;
  selectedIds: string[];
  folders: MediaFolder[];
  compositionCount: number;
  importFiles: MediaStoreState['importFiles'];
  importFilesWithPicker: MediaStoreState['importFilesWithPicker'];
  createComposition: MediaStoreState['createComposition'];
  createFolder: MediaStoreState['createFolder'];
  createTextItem: MediaStoreState['createTextItem'];
  getOrCreateTextFolder: MediaStoreState['getOrCreateTextFolder'];
  createSolidItem: MediaStoreState['createSolidItem'];
  getOrCreateSolidFolder: MediaStoreState['getOrCreateSolidFolder'];
  createMeshItem: MediaStoreState['createMeshItem'];
  getOrCreateMeshFolder: MediaStoreState['getOrCreateMeshFolder'];
  createCameraItem: MediaStoreState['createCameraItem'];
  getOrCreateCameraFolder: MediaStoreState['getOrCreateCameraFolder'];
  createSplatEffectorItem: MediaStoreState['createSplatEffectorItem'];
  getOrCreateSplatEffectorFolder: MediaStoreState['getOrCreateSplatEffectorFolder'];
  createMathSceneItem: MediaStoreState['createMathSceneItem'];
  getOrCreateMathSceneFolder: MediaStoreState['getOrCreateMathSceneFolder'];
  createMotionShapeItem: MediaStoreState['createMotionShapeItem'];
  getOrCreateMotionShapeFolder: MediaStoreState['getOrCreateMotionShapeFolder'];
  importGaussianSplat: MediaStoreState['importGaussianSplat'];
  closeContextMenu: () => void;
}

export function useMediaPanelAddImportCommands({
  fileInputRef,
  fileSystemSupported,
  contextMenu,
  viewMode,
  gridFolderId,
  selectedIds,
  folders,
  compositionCount,
  importFiles,
  importFilesWithPicker,
  createComposition,
  createFolder,
  createTextItem,
  getOrCreateTextFolder,
  createSolidItem,
  getOrCreateSolidFolder,
  createMeshItem,
  getOrCreateMeshFolder,
  createCameraItem,
  getOrCreateCameraFolder,
  createSplatEffectorItem,
  getOrCreateSplatEffectorFolder,
  createMathSceneItem,
  getOrCreateMathSceneFolder,
  createMotionShapeItem,
  getOrCreateMotionShapeFolder,
  importGaussianSplat,
  closeContextMenu,
}: UseMediaPanelAddImportCommandsInput): {
  getActiveParentId: () => string | null;
  handleImport: () => Promise<void>;
  handleFileChange: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleNewComposition: () => void;
  handleNewFolder: () => void;
  handleNewText: () => void;
  handleNewText3D: () => void;
  handleNewSolid: () => void;
  handleNewMesh: (meshType: MeshPrimitiveType) => void;
  handleNewCamera: () => void;
  handleNewSplatEffector: () => void;
  handleNewMathScene: () => void;
  handleNewMotionShape: (primitive: ShapePrimitive) => void;
  handleImportGaussianSplat: () => void;
} {
  const getActiveParentId = useCallback((): string | null => {
    if (contextMenu && contextMenu.parentId !== undefined) return contextMenu.parentId;
    if (viewMode === 'icons' && gridFolderId) return gridFolderId;
    if (selectedIds.length === 1) {
      const sel = folders.find(f => f.id === selectedIds[0]);
      if (sel) return sel.id;
    }
    return null;
  }, [contextMenu, viewMode, gridFolderId, selectedIds, folders]);

  const handleImport = useCallback(async () => {
    if (fileSystemSupported) {
      await importFilesWithPicker();
    } else {
      fileInputRef.current?.click();
    }
  }, [fileInputRef, fileSystemSupported, importFilesWithPicker]);

  const handleFileChange = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await importFiles(e.target.files);
      e.target.value = '';
    }
  }, [importFiles]);

  const handleNewComposition = useCallback(() => {
    createComposition(`Comp ${compositionCount + 1}`, { parentId: getActiveParentId() });
    closeContextMenu();
  }, [compositionCount, createComposition, getActiveParentId, closeContextMenu]);

  const handleNewFolder = useCallback(() => {
    createFolder('New Folder', getActiveParentId());
    closeContextMenu();
  }, [createFolder, getActiveParentId, closeContextMenu]);

  const handleNewText = useCallback(() => {
    const textFolderId = getOrCreateTextFolder();
    createTextItem(undefined, textFolderId);
    closeContextMenu();
  }, [createTextItem, getOrCreateTextFolder, closeContextMenu]);

  const handleNewText3D = useCallback(() => {
    const textFolderId = getOrCreateTextFolder();
    createMeshItem('text3d', undefined, textFolderId);
    closeContextMenu();
  }, [createMeshItem, getOrCreateTextFolder, closeContextMenu]);

  const handleNewSolid = useCallback(() => {
    const solidFolderId = getOrCreateSolidFolder();
    createSolidItem(undefined, '#ffffff', solidFolderId);
    closeContextMenu();
  }, [createSolidItem, getOrCreateSolidFolder, closeContextMenu]);

  const handleNewMesh = useCallback((meshType: MeshPrimitiveType) => {
    const meshFolderId = getOrCreateMeshFolder();
    createMeshItem(meshType, undefined, meshFolderId);
    closeContextMenu();
  }, [createMeshItem, getOrCreateMeshFolder, closeContextMenu]);

  const handleNewCamera = useCallback(() => {
    const cameraFolderId = getOrCreateCameraFolder();
    createCameraItem(undefined, cameraFolderId);
    closeContextMenu();
  }, [createCameraItem, getOrCreateCameraFolder, closeContextMenu]);

  const handleNewSplatEffector = useCallback(() => {
    const effectorFolderId = getOrCreateSplatEffectorFolder();
    createSplatEffectorItem(undefined, effectorFolderId);
    closeContextMenu();
  }, [createSplatEffectorItem, getOrCreateSplatEffectorFolder, closeContextMenu]);

  const handleNewMathScene = useCallback(() => {
    const mathFolderId = getOrCreateMathSceneFolder();
    createMathSceneItem(undefined, mathFolderId);
    closeContextMenu();
  }, [createMathSceneItem, getOrCreateMathSceneFolder, closeContextMenu]);

  const handleNewMotionShape = useCallback((primitive: ShapePrimitive) => {
    const motionFolderId = getOrCreateMotionShapeFolder();
    createMotionShapeItem(primitive, undefined, motionFolderId);
    closeContextMenu();
  }, [createMotionShapeItem, getOrCreateMotionShapeFolder, closeContextMenu]);

  const handleImportGaussianSplat = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ply,.compressed.ply,.splat,.ksplat,.spz,.sog,.lcc,.zip';
    input.onchange = async (e) => {
      const fileList = (e.target as HTMLInputElement).files;
      if (fileList && fileList.length > 0) {
        await importGaussianSplat(fileList[0]);
      }
    };
    input.click();
    closeContextMenu();
  }, [importGaussianSplat, closeContextMenu]);

  return {
    getActiveParentId,
    handleImport,
    handleFileChange,
    handleNewComposition,
    handleNewFolder,
    handleNewText,
    handleNewText3D,
    handleNewSolid,
    handleNewMesh,
    handleNewCamera,
    handleNewSplatEffector,
    handleNewMathScene,
    handleNewMotionShape,
    handleImportGaussianSplat,
  };
}
