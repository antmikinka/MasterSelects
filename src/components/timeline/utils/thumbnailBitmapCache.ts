// ImageBitmap cache for the canvas timeline (issue #228, Phase 1).
//
// thumbnailCacheService stores thumbnails as blob-URL strings (consumed by the
// DOM clip path as CSS background-images). The canvas clip layer needs GPU-
// uploadable bitmaps it can `ctx.drawImage` with zero per-frame decode, so we
// decode each blob URL to an ImageBitmap once and cache it (LRU by count).

const MAX_BITMAPS = 600;
const cache = new Map<string, ImageBitmap>(); // insertion order = LRU order
const inflight = new Set<string>();

/** Returns the decoded bitmap for a URL if ready, else null. Refreshes LRU. */
export function getThumbnailBitmap(url: string): ImageBitmap | null {
  const bmp = cache.get(url);
  if (bmp) {
    cache.delete(url);
    cache.set(url, bmp);
    return bmp;
  }
  return null;
}

/** Kicks off async decode of a URL (once); calls onReady when it lands. */
export function ensureThumbnailBitmap(url: string, onReady: () => void): void {
  if (cache.has(url) || inflight.has(url)) return;
  inflight.add(url);
  fetch(url)
    .then((r) => r.blob())
    .then((blob) => createImageBitmap(blob))
    .then((bmp) => {
      inflight.delete(url);
      cache.set(url, bmp);
      if (cache.size > MAX_BITMAPS) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) {
          const evicted = cache.get(oldest);
          cache.delete(oldest);
          evicted?.close();
        }
      }
      onReady();
    })
    .catch(() => {
      inflight.delete(url);
    });
}
