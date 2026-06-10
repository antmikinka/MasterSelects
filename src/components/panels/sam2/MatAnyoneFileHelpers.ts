import { useMediaStore } from '../../../stores/mediaStore';

type FileWithPath = File & { path?: string };

type MatAnyoneClipSourceLike = {
  type?: string;
  file?: File;
  filePath?: string;
  mediaFileId?: string;
  nativeDecoder?: { fps?: number };
  naturalDuration?: number;
};

export type MatAnyoneClipLike = {
  id: string;
  name: string;
  mediaFileId?: string;
  file?: File;
  source?: MatAnyoneClipSourceLike | null;
  inPoint: number;
  outPoint: number;
};

export type MatAnyoneResultLike = {
  foregroundPath: string;
  alphaPath: string;
  sourceClipId: string;
};

export type MatAnyoneFileClient = {
  getProjectRoot(timeoutMs?: number): Promise<string | null>;
  createDir(path: string, recursive?: boolean): Promise<boolean>;
};

export type MatAnyoneImportFileClient = {
  getDownloadedFile(path: string): Promise<ArrayBuffer | null>;
};

const VIDEO_EXTENSION_CANDIDATES = ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'];
const INVALID_NATIVE_FILE_NAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
const MATANYONE_PROJECT_OUTPUT_FOLDER = 'MatAnyone2';
const MATANYONE_MEDIA_ROOT_FOLDER = 'AI Gen';
const MATANYONE_MEDIA_SUBFOLDER = 'Matting';

function isAbsolutePath(path: string | null | undefined): path is string {
  if (!path) return false;
  if (/^[A-Za-z]:[\\/]fakepath[\\/]/i.test(path)) return false;
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\\\');
}

function getBaseName(path: string | null | undefined): string {
  const trimmed = path?.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || '';
}

function guessMimeTypeFromPath(path: string): string {
  const extension = getBaseName(path).toLowerCase().split('.').pop();
  switch (extension) {
    case 'mp4':
    case 'm4v':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'webm':
      return 'video/webm';
    case 'mkv':
      return 'video/x-matroska';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

function hasFileExtension(name: string): boolean {
  return /\.[^./\\]+$/.test(getBaseName(name));
}

function sanitizeNativeFileName(name: string): string {
  const cleaned = Array.from(name, char =>
    char.charCodeAt(0) < 32 || INVALID_NATIVE_FILE_NAME_CHARS.has(char) ? '_' : char
  )
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const fallback = cleaned || 'video.mp4';
  if (fallback.length <= 180) return fallback;

  const dotIndex = fallback.lastIndexOf('.');
  const extension = dotIndex > 0 ? fallback.slice(dotIndex, Math.min(fallback.length, dotIndex + 16)) : '';
  return `${fallback.slice(0, 180 - extension.length)}${extension}`;
}

export function joinNativePath(root: string, ...parts: string[]): string {
  const separator = root.includes('\\') ? '\\' : '/';
  const base = root.replace(/[\\/]+$/, '');
  const cleanedParts = parts.map(part => part.replace(/^[\\/]+|[\\/]+$/g, ''));
  return [base || root, ...cleanedParts].filter(Boolean).join(separator);
}

export function getOrCreateMattingMediaFolder(): string {
  const mediaStore = useMediaStore.getState();
  let rootFolder = mediaStore.folders.find(folder => folder.name === MATANYONE_MEDIA_ROOT_FOLDER && !folder.parentId);
  if (!rootFolder) {
    rootFolder = mediaStore.createFolder(MATANYONE_MEDIA_ROOT_FOLDER);
  }

  const latestMediaStore = useMediaStore.getState();
  let mattingFolder = latestMediaStore.folders.find(folder =>
    folder.name === MATANYONE_MEDIA_SUBFOLDER && folder.parentId === rootFolder.id
  );
  if (!mattingFolder) {
    mattingFolder = latestMediaStore.createFolder(MATANYONE_MEDIA_SUBFOLDER, rootFolder.id);
  }

  return mattingFolder.id;
}

export function buildMatAnyoneProjectFileName(result: MatAnyoneResultLike, filePath: string): string {
  const safeClipId = sanitizeNativeFileName(result.sourceClipId || 'clip');
  const fileName = sanitizeNativeFileName(getBaseName(filePath) || 'matanyone-result.mp4');
  return `${MATANYONE_PROJECT_OUTPUT_FOLDER}/${safeClipId}/${fileName}`;
}

export async function readNativeFileAsFile(nativeHelper: MatAnyoneImportFileClient, path: string): Promise<File> {
  const buffer = await nativeHelper.getDownloadedFile(path);
  if (!buffer) {
    throw new Error(`Could not read MatAnyone2 output: ${path}`);
  }

  const fileName = getBaseName(path) || 'matanyone-result.mp4';
  return new File([buffer], fileName, {
    type: guessMimeTypeFromPath(path),
    lastModified: Date.now(),
  });
}

export function getMatAnyoneFrameRange(clip: MatAnyoneClipLike): { startFrame?: number; endFrame?: number } {
  const source = clip.source;
  if (!source || source.type !== 'video') return {};

  const mediaFileId = source.mediaFileId ?? clip.mediaFileId;
  const mediaFile = mediaFileId
    ? useMediaStore.getState().files.find(file => file.id === mediaFileId)
    : undefined;
  const fps =
    source.nativeDecoder?.fps ??
    mediaFile?.fps ??
    30;
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const naturalDuration = source.naturalDuration ?? mediaFile?.duration ?? clip.outPoint;
  const frameToleranceSeconds = 0.5 / safeFps;

  const hasTrimIn = clip.inPoint > frameToleranceSeconds;
  const hasTrimOut = Number.isFinite(naturalDuration)
    && naturalDuration > 0
    && clip.outPoint < naturalDuration - frameToleranceSeconds;

  if (!hasTrimIn && !hasTrimOut) {
    return {};
  }

  const startFrame = Math.max(0, Math.floor(clip.inPoint * safeFps));
  const endFrame = Math.max(startFrame + 1, Math.ceil(clip.outPoint * safeFps));
  return { startFrame, endFrame };
}

export async function resolveMatAnyoneVideoPath(selectedClip: MatAnyoneClipLike): Promise<string | null> {
  const source = selectedClip.source;
  if (!source) return null;

  const [{ useMediaStore }, { NativeHelperClient }] = await Promise.all([
    import('../../../stores/mediaStore'),
    import('../../../services/nativeHelper/NativeHelperClient'),
  ]);

  const mediaFileId = source.mediaFileId ?? selectedClip.mediaFileId;
  const mediaFile = mediaFileId
    ? useMediaStore.getState().files.find(file => file.id === mediaFileId)
    : undefined;
  const sourceFile = source.file as FileWithPath | undefined;
  const clipFile = selectedClip.file as FileWithPath | undefined;
  const mediaStoreFile = mediaFile?.file as FileWithPath | undefined;

  const directCandidates = [
    source.filePath,
    mediaFile?.absolutePath,
    mediaFile?.filePath,
    sourceFile?.path,
    clipFile?.path,
    mediaStoreFile?.path,
  ];

  for (const candidate of directCandidates) {
    if (isAbsolutePath(candidate)) return candidate;
  }

  const locateCandidates = new Set<string>();
  const addLocateCandidate = (value: string | null | undefined) => {
    const name = getBaseName(value);
    if (name && name !== '.' && name !== '..') {
      locateCandidates.add(name);
    }
  };

  addLocateCandidate(source.filePath);
  addLocateCandidate(mediaFile?.filePath);
  addLocateCandidate(mediaFile?.name);
  addLocateCandidate(sourceFile?.name);
  addLocateCandidate(clipFile?.name);
  addLocateCandidate(mediaStoreFile?.name);
  addLocateCandidate(selectedClip.name);

  for (const candidate of [...locateCandidates]) {
    if (!hasFileExtension(candidate)) {
      VIDEO_EXTENSION_CANDIDATES.forEach(extension => locateCandidates.add(`${candidate}${extension}`));
    }
  }

  for (const candidate of locateCandidates) {
    const located = await NativeHelperClient.locateFile(candidate).catch(() => null);
    if (located) return located;
  }

  const fileForUpload = sourceFile ?? clipFile ?? mediaStoreFile;
  if (!fileForUpload) return null;

  const projectRoot = await NativeHelperClient.getProjectRoot().catch(() => null);
  if (!projectRoot) return null;

  const tempDir = joinNativePath(projectRoot, 'matanyone-temp');
  const tempDirReady = await NativeHelperClient.createDir(tempDir, true).catch(() => false);
  if (!tempDirReady) return null;

  const safeClipId = sanitizeNativeFileName(selectedClip.id || 'clip');
  const safeFileName = sanitizeNativeFileName(fileForUpload.name || selectedClip.name || 'video.mp4');
  const stagedPath = joinNativePath(tempDir, `${safeClipId}-${safeFileName}`);
  const uploaded = await NativeHelperClient.writeFileBinary(stagedPath, fileForUpload).catch(() => false);
  return uploaded ? stagedPath : null;
}

export async function createMatAnyoneJobDir(
  nativeHelper: MatAnyoneFileClient,
  clipId: string,
): Promise<string | null> {
  const projectRoot = await nativeHelper.getProjectRoot().catch(() => null);
  if (!projectRoot) return null;

  const safeClipId = sanitizeNativeFileName(clipId || 'clip');
  const jobName = sanitizeNativeFileName(`job-${safeClipId}-${Date.now().toString(36)}`);
  const jobDir = joinNativePath(projectRoot, MATANYONE_PROJECT_OUTPUT_FOLDER, jobName);
  const created = await nativeHelper.createDir(jobDir, true).catch(() => false);
  return created ? jobDir : null;
}
