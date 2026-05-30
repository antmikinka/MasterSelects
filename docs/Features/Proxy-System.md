# Proxy System

[Back to Index](./README.md)

JPEG image proxy generation and playback for smoother scrubbing of large video files.

---

## Overview

Proxies are stored inside the project folder and are used only when proxy mode is enabled. The current implementation does not generate a separate proxy folder picker or a detached proxy library.

### Current Behavior

- Proxy mode mutes and pauses the original video elements when enabled.
- Video proxies are stored as packed JPEG frame data in the project folder.
- The editor falls back to the original media when proxy data is missing.
- Audio proxy files are optional and non-fatal.
- The all-intra MP4 proxy path remains in the codebase for quick reactivation, but it is not the active generation or playback path.
- Existing `mp4-all-intra` proxy status does not count as complete for the active JPEG path; enabling proxy mode can regenerate the JPEG proxy frames.

---

## Proxy Generation

Proxy generation is handled by `ProxyGeneratorWebCodecs`.

### Current Pipeline

1. MP4Box parses the source file.
2. Codec configuration is extracted from the sample entry (`avcC`, `hvcC`, `vpcC`, or `av1C`) and passed to WebCodecs.
3. WebCodecs `VideoDecoder` decodes frames.
4. Decoded `VideoFrame` objects are transferred to a bounded Dedicated Worker pool.
5. Each worker resizes on `OffscreenCanvas` and encodes a JPEG frame.
6. JPEG frames are saved into project proxy pack files plus an index.

### Current Settings

- Maximum width: 1280 px
- Proxy frame rate: 30 fps
- Decode batch size: 30 samples
- Image format: JPEG
- JPEG quality: 0.82
- Worker encoder pool: up to 8 Dedicated Workers, leaving 2 hardware threads reserved when possible

### Queue Support

- Enabling proxy mode starts the next missing video proxy immediately.
- When proxy mode is already enabled, newly imported videos are added to the proxy generation flow as soon as import finishes.
- The timeline proxy button shows the active queue position while generating, for example `Generating 1/5`.

### Completion Rule

- A proxy is marked ready when the generated JPEG frame index contains at least 98 percent of the expected frame indices.

### Resource Limit

- Only one proxy generation runs at a time.
- Additional videos are processed sequentially by the proxy generation queue.

---

## Storage

Proxies are stored in the project folder under `Proxy/{mediaId}/`.

### Current On-Disk Layout

- Video proxies are written as packed JPEG data: `Proxy/{mediaId}/frames_0000.pack`, `Proxy/{mediaId}/frames_0001.pack`, and `Proxy/{mediaId}/frames.index.json`.
- The index maps each frame index to a pack filename, byte offset, byte size, and MIME type.
- Older `frame_000000.jpg` and `.webp` frame files are still readable for project compatibility, but new active generation writes pack files.
- Audio proxies are written as WAV files under the project audio-proxy folder, using a sanitized storage-key filename such as `<mediaId>.wav`. Older `Proxy/{mediaId}/audio.wav` and `Proxy/{mediaId}/audio.m4a` files are still read for compatibility.

### Backend Caveat

- Image proxy storage currently uses the File System Access project handle path.

### Deduplication

- Storage is keyed by `fileHash` when available.
- If no file hash is available, the media file ID is used.

---

## Proxy Playback

`proxyFrameCache` loads JPEG frame blobs on demand and keeps decoded `HTMLImageElement` objects in memory for scrubbing.

### Current Behavior

- Exact image-frame lookups are cached in memory.
- Nearest-frame and held-frame fallbacks smooth scrubbing while requested frames are still loading.
- Playback can use proxy audio when it exists.
- Missing proxy frames fall back to the original source media.

### Cache Limits

- Image-frame cache size: 900 frames
- Scrubbing preload window: 90 frames around the scrub position in active scrubs
- Parallel preload batch size: 16

### Limitation

- The proxy cache reads image frames from the project folder. It does not use IndexedDB as an alternate store.

---

## Warmup

The warmup button in the proxy cache path does not generate proxy files.

### What It Does

- It seeks the source video elements in 0.5 second steps.
- It is meant to warm browser decode and cache state.
- It includes nested composition clips.

### What It Does Not Do

- It does not create new proxy frames.
- It does not convert media into proxy format.

---

## Audio Proxies

After the video frames finish, the code attempts to extract audio in the background.

### Current Behavior

- Audio extraction is non-blocking after the JPEG proxy frames complete.
- Audio proxy failures are treated as non-fatal.
- If extraction succeeds, the current audio proxy is saved as WAV. Legacy `audio.m4a` proxy files remain readable.
- Scrub audio uses decoded WAV/AudioBuffer data and schedules pitch-stable short grains with minimal overlap.
- Fast scrub jumps fade out older grains before scheduling the new position so stale audio does not stack up.

### Limitation

- Proxy audio is best-effort. The editor keeps working even if audio extraction fails.

---

## Current Limitations

- Native Helper-backed projects do not currently persist image proxy files through the same native path.
- Proxy generation is browser-session based and relies on WebCodecs and OffscreenCanvas support.
- Only one generation can run at a time.

---

## Sources

Key implementation files:

- `src/services/proxyGenerator.ts`
- `src/workers/proxyFrameEncodeWorker.ts`
- `src/services/proxyFrameCache.ts`
- `src/stores/mediaStore/slices/proxySlice.ts`
- `src/stores/timeline/proxyCacheSlice.ts`
- `src/services/project/ProjectFileService.ts`
- `src/services/project/domains/ProxyStorageService.ts`
