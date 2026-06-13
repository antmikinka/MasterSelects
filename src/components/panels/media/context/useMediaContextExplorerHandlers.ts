import { useCallback } from 'react';
import type { MediaFile } from '../../../../stores/mediaStore';

type MediaExplorerTarget = 'raw' | 'proxy';

interface MediaExplorerResult {
  success: boolean;
  message: string;
}

interface UseMediaContextExplorerHandlersInput {
  showInExplorer: (target: MediaExplorerTarget, mediaFileId: string) => Promise<MediaExplorerResult>;
  pickProxyFolder: () => Promise<unknown>;
  closeContextMenu: () => void;
}

export interface MediaContextExplorerHandlers {
  onDownloadMediaFile: (mediaFile: MediaFile) => void;
  onShowRawInExplorer: (mediaFile: MediaFile) => Promise<void>;
  onShowProxyInExplorer: (mediaFile: MediaFile) => Promise<void>;
  onPickProxyFolder: () => Promise<void>;
}

export function downloadMediaFileInBrowser(item: Pick<MediaFile, 'file' | 'name' | 'url'>): boolean {
  const anchor = document.createElement('a');
  anchor.download = item.name;
  anchor.rel = 'noopener';

  let objectUrl: string | null = null;
  if (item.file) {
    objectUrl = URL.createObjectURL(item.file);
    anchor.href = objectUrl;
  } else if (item.url) {
    anchor.href = item.url;
  } else {
    return false;
  }

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
  }

  return true;
}

export function useMediaContextExplorerHandlers({
  showInExplorer,
  pickProxyFolder,
  closeContextMenu,
}: UseMediaContextExplorerHandlersInput): MediaContextExplorerHandlers {
  const onDownloadMediaFile = useCallback((item: MediaFile) => {
    downloadMediaFileInBrowser(item);
    closeContextMenu();
  }, [closeContextMenu]);

  const onShowRawInExplorer = useCallback(async (item: MediaFile) => {
    const result = await showInExplorer('raw', item.id);
    if (result.success) {
      alert(result.message);
    } else if (item.file) {
      downloadMediaFileInBrowser(item);
    }
    closeContextMenu();
  }, [closeContextMenu, showInExplorer]);

  const onShowProxyInExplorer = useCallback(async (item: MediaFile) => {
    const result = await showInExplorer('proxy', item.id);
    alert(result.message);
    closeContextMenu();
  }, [closeContextMenu, showInExplorer]);

  const onPickProxyFolder = useCallback(async () => {
    await pickProxyFolder();
    closeContextMenu();
  }, [closeContextMenu, pickProxyFolder]);

  return {
    onDownloadMediaFile,
    onShowRawInExplorer,
    onShowProxyInExplorer,
    onPickProxyFolder,
  };
}
