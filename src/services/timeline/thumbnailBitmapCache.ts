// Decoded ImageBitmap cache for timeline thumbnails.
//
// thumbnailCacheService owns blob URLs for source thumbnails. Canvas renderers
// need decoded ImageBitmaps, but those decoded resources must be closed when
// source thumbnails are evicted or the media source is deleted.

const MAX_BITMAPS = 600;

const cache = new Map<string, ImageBitmap>(); // insertion order = LRU order
const inflight = new Set<string>();
const invalidatedUrls = new Set<string>();
const sourceUrls = new Map<string, Set<string>>();
const urlSources = new Map<string, Set<string>>();

export function getThumbnailBitmap(url: string): ImageBitmap | null {
  const bmp = cache.get(url);
  if (bmp) {
    cache.delete(url);
    cache.set(url, bmp);
    return bmp;
  }
  return null;
}

export function ensureThumbnailBitmap(
  url: string,
  onReady: () => void,
  mediaFileId?: string,
): void {
  registerThumbnailBitmapSource(url, mediaFileId);
  if (cache.has(url) || inflight.has(url) || invalidatedUrls.has(url)) return;

  inflight.add(url);
  fetch(url)
    .then((r) => r.blob())
    .then((blob) => createImageBitmap(blob))
    .then((bmp) => {
      inflight.delete(url);
      if (invalidatedUrls.has(url)) {
        invalidatedUrls.delete(url);
        bmp.close();
        return;
      }

      cache.set(url, bmp);
      enforceBitmapLimit();
      onReady();
    })
    .catch(() => {
      inflight.delete(url);
    });
}

export function registerThumbnailBitmapSource(
  url: string,
  mediaFileId: string | undefined,
): void {
  if (!mediaFileId) return;

  let urls = sourceUrls.get(mediaFileId);
  if (!urls) {
    urls = new Set();
    sourceUrls.set(mediaFileId, urls);
  }
  urls.add(url);

  let sources = urlSources.get(url);
  if (!sources) {
    sources = new Set();
    urlSources.set(url, sources);
  }
  sources.add(mediaFileId);
}

export function closeByThumbnailUrls(urls: Iterable<string>): void {
  for (const url of [...urls]) {
    if (inflight.has(url)) {
      invalidatedUrls.add(url);
    }
    inflight.delete(url);
    closeCachedUrl(url);
    unlinkUrl(url);
  }
}

export function closeSource(mediaFileId: string): void {
  const urls = sourceUrls.get(mediaFileId);
  if (!urls) return;
  closeByThumbnailUrls([...urls]);
}

export function clearThumbnailBitmapCache(): void {
  closeByThumbnailUrls([...cache.keys()]);
  for (const url of inflight) {
    invalidatedUrls.add(url);
  }
  inflight.clear();
  sourceUrls.clear();
  urlSources.clear();
}

export function getThumbnailBitmapCacheSize(): number {
  return cache.size;
}

function enforceBitmapLimit(): void {
  while (cache.size > MAX_BITMAPS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    closeCachedUrl(oldest);
    unlinkUrl(oldest);
  }
}

function closeCachedUrl(url: string): void {
  const bmp = cache.get(url);
  cache.delete(url);
  bmp?.close();
}

function unlinkUrl(url: string): void {
  const sources = urlSources.get(url);
  if (sources) {
    for (const mediaFileId of sources) {
      const urls = sourceUrls.get(mediaFileId);
      urls?.delete(url);
      if (urls?.size === 0) {
        sourceUrls.delete(mediaFileId);
      }
    }
  }
  urlSources.delete(url);
}
