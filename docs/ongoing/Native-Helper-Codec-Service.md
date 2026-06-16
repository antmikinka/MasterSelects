# Native Helper Codec Service Plan

Status: draft plan  
Created: 2026-06-16

## Goal

Turn the Native Helper into a real local codec service for browser-foreign and
professional media formats, starting with ProRes and DNxHR/DNxHD video decode
and later extending to encode/export.

Native decode is only available when the helper advertises codec capability and
the source file has a resolvable absolute local path inside a helper-granted or
allowed root.

The target is not to replace browser-native playback for H.264, HEVC, VP9, or
AV1 when WebCodecs/HTML video can already handle those well. The target is a
selective frame-provider path that lets MasterSelects import, scrub, preview,
composite, bake, and export media the browser cannot decode directly.

## Current Reality

The current Rust helper does not implement video decode or encode commands.
It supports downloads, file-system commands, folder picking, the AI bridge, and
MatAnyone2. The TypeScript side already has planned codec-service client code,
but that path is only UI-dormant because the server protocol does not handle it.
If persisted or future UI state sets `nativeDecodeEnabled` to true while the
helper is connected, current import code can still attempt the old unversioned
codec commands.

Relevant current files:

- `docs/Features/Native-Helper.md` documents that decode/encode protocol types
  are retained for future use and are not implemented server-side.
- `tools/native-helper/src/protocol/commands.rs` defines the real Rust command
  enum and currently has no `open`, `decode`, `prefetch`, `start_encode`, or
  related codec commands.
- `src/services/nativeHelper/NativeDecoder.ts` defines the browser-side decoder
  wrapper, frame buffer, scaled scrub path, and `ImageBitmap` output shape.
- `src/services/nativeHelper/nativeHelperVideoCommands.ts` sends the planned
  `open`, `decode`, `decode_range`, `prefetch`, `start_encode`,
  `encode_frame`, `finish_encode`, `cancel_encode`, and `close` commands.
- `src/stores/timeline/clip/addVideoClip.ts` can choose `NativeDecoder` when
  native decode is enabled and the helper is connected, then falls back to the
  browser path on failure. It currently targets any video when enabled, not only
  browser-foreign codecs.
- `src/stores/timeline/clip/upgradeToNativeDecoder.ts` can also target all
  video clips, though the watcher path is not part of normal helper capability
  negotiation today.
- `src/services/nativeHelper/protocol.ts` still declares older FFmpeg/cache
  fields and a binary frame header, while the current Rust server reports only
  download/fs/AI/MatAnyone fields and treats binary WebSocket messages as
  unexpected.
- `src/components/common/NativeHelperStatus.tsx` currently forces
  `nativeDecodeEnabled` back to `false`. `NativeHelperSettings.tsx` has no
  active decode toggle, but the setting is persisted and must still be guarded
  at action level.
- `src/services/timeline/nativeDecoderRuntimeRegistry.ts` is clip-keyed
  (`clipId` map, clip-owned runtime demand), not source/session-keyed.
- `src/services/layerBuilder/videoSyncNativeDecoderSync.ts` is a clip-keyed
  seek coordinator with a single `isPending` boolean, no request ids, no
  generations, and no cancellation.
- `docs/ongoing/Worker-First-Playback-Renderer.md` already identifies native
  decoder output as a future frame-provider variant.

## Product Scope

Initial user-visible promise:

- ProRes `.mov` files can be placed on the timeline when a compatible Native
  Helper is running, the helper advertises `codec_decode: true`, and the source
  file has a resolvable absolute local path within a helper-granted or allowed
  root.
- Scrubbing produces responsive preview frames, using lower-resolution nearest
  frames while dragging and exact full-resolution frames when the scrub settles.
- Playback uses native decode only when the browser path cannot handle the file
  or when the user explicitly selects the native path for a supported file.
- Existing browser-native media continues to use WebCodecs/HTML video by
  default.

Out of initial scope:

- Remote/cloud decode.
- Zero-copy GPU texture sharing between helper and browser.
- Replacing WebCodecs for browser-native codecs by default.
- Full worker-first renderer migration.
- Full professional color-management parity for the first milestone.

## Codec Priority

Phase 1 decode should target formats that unlock real workflows and are friendly
to interactive editing:

1. ProRes 422 family in MOV: Proxy, LT, Standard, HQ.
2. ProRes 4444/4444 XQ with alpha surfaced as a later alpha-capable milestone.
3. DNxHR/DNxHD in MOV/MXF where FFmpeg support is straightforward.
4. FFV1, UTVideo, MJPEG, PNG-in-MOV, and other intra-frame formats.
5. HAP only after texture/compressed-frame strategy is decided.

Long-GOP formats such as H.264, HEVC, VP9, and AV1 should stay browser-first
unless a specific file fails browser decode or the user requests native decode.

## Architecture Target

Native Helper remains a local companion service bound to `127.0.0.1`.

```text
Timeline / Source Monitor / Export
  -> Frame Provider Controller
     -> Browser providers: HTML video, WebCodecs, proxy images, stills
     -> Native helper provider
        -> WebSocket command channel
        -> Rust session registry
        -> FFmpeg/native decode session
        -> helper-side frame cache + prefetch
        -> encoded preview frame or raw frame payload
  -> WebGPU compositor
```

The helper is a codec and file service, not a compositor. MasterSelects keeps
editing, layer evaluation, effects, masks, blend modes, 3D, and final preview
composition in the browser.

## Protocol Shape

The protocol should be versioned and capability-advertised before decode is
enabled in UI.

Minimum capabilities:

- `protocol_version`: number
- `codec_decode`: boolean
- `codec_encode`: boolean
- `decode_codecs`: string[]
- `encode_codecs`: string[]
- `frame_payloads`: `jpeg`, `rgba8`, `bgra8`, and optionally `yuv420p`
- `max_frame_cache_mb`
- `max_decode_sessions`
- `codec_min_helper_version`: string when decode is available

Minimum commands:

- `codec_capabilities`: return protocol version, codec flags, payload support,
  limits, FFmpeg/native backend version, and platform acceleration notes.
- `codec_open`: open a local path and return metadata, stream layout, duration,
  timebase, fps guess, frame count if known, and supported output formats.
- `codec_decode`: request one frame by timestamp or frame index with mode
  `exact`, `nearest`, or `keyframe`. Every request carries a unique string
  `request_id`; every response echoes it so stale responses can be discarded.
- `codec_prefetch`: hint an upcoming range or direction.
- `codec_cancel`: cancel stale requests by request id, generation, or session.
- `codec_close`: close a decode session and release caches.
- `codec_probe`: metadata-only path used during import before committing a
  timeline clip.
- `codec_session_status`: return open session count, memory/cache usage,
  pending request count, cache hit rate, and recent errors for diagnostics.

Avoid reusing the old unversioned `open` and `decode` names in the Rust server
unless they are explicitly wrapped by a version/capability check. The current
TypeScript names are useful scaffolding, but a new server implementation should
not make old optimistic UI claims true by accident.

The first implementation must choose a payload transport before single-frame
decode starts. WebSocket binary frames require request correlation, max payload
limits, cancellation semantics, and backpressure. HTTP payloads require auth,
parallel request handling, timeout/cancel semantics, and cleanup. The plan must
not assume the old TypeScript 16-byte frame header works with the current Rust
server.

## Frame Payload Policy

Payload choice determines whether native decode feels fast.

Interactive scrub:

- Prefer scaled preview frames while dragging.
- Use JPEG or another browser-decodable preview payload for reduced transfer
  size, unless quality artifacts become unacceptable. A full 1080p RGBA8 frame
  is about 8.3 MB; the 40 ms p95 scrub target requires JPEG-sized payloads,
  scale <= 0.5, or a later zero-copy path.
- Coalesce to latest-wins. Stale scrub requests must be cancelable or ignored.
- Return nearest/fast frames during motion, then exact frame on settle.
- While a native request is in flight, render the last successfully decoded
  native frame or an approved proxy/placeholder. Do not blank the layer during
  decode latency.

Paused exact preview:

- Request full-resolution exact frames.
- Use raw RGBA/BGRA only when the transfer budget is acceptable.
- Keep a helper-side LRU cache around the current playhead and recent seeks.

Playback:

- Use bounded decode-ahead, not an unbounded request queue.
- Prefer all-intra and fast-seek codecs for the first milestone.
- Drop late frames for live preview if they miss the render deadline.
- Never block UI on exact-frame decode during active playback.

Export/bake:

- Use exact ordered frame delivery.
- Do not drop or replace frames.
- Report deterministic errors, frame indexes, and codec metadata.

## Performance Targets To Validate

Native decode is not automatically faster end to end than browser-native
WebCodecs. Browser codecs often decode directly into efficient `VideoFrame`
surfaces. Native helper decode has additional costs:

- FFmpeg/native decode.
- Pixel conversion.
- Helper-side cache copy.
- Local WebSocket/HTTP transfer.
- Browser-side payload decode if compressed.
- Upload/import into WebGPU.

The target performance claim should therefore be:

- For browser-foreign intra-frame codecs, native helper decode can be fast
  enough for responsive editing and may scrub better than browser paths that do
  not exist.
- For browser-native H.264/HEVC/AV1, WebCodecs remains the expected fast path.
- For 4K, scaled interactive previews are required. Full raw 4K RGBA frames are
  too large to treat as the default interactive payload.

Initial budgets to prove with measurements:

- 1080p ProRes HQ scrub preview p95 under 40 ms while dragging.
- 1080p exact settle p95 under 120 ms after scrub stop.
- 4K scaled scrub preview p95 under 60 ms at scale 0.5 or lower.
- Request queue depth stays bounded during rapid drag.
- No leaked helper sessions after clip delete, project close, or helper
  disconnect.

## Security And File Access

The codec service must keep the current Native Helper security posture:

- Bind to `127.0.0.1`.
- Require the startup auth token unless explicitly launched with `--no-auth`.
- Treat unauthenticated `/startup-token` as local discovery only; codec commands
  remain behind the authenticated WebSocket/HTTP path.
- Only open absolute local paths that pass the existing allowed-root/granted-path
  policy. Reuse `AppState::is_path_allowed` and existing canonical path
  behavior rather than adding new string-prefix checks.
- Do not use authenticated `grant_path` as a shortcut for arbitrary codec roots.
  Codec access should come from picker/restored project roots or already allowed
  project/media locations.
- Do not accept arbitrary path traversal through media metadata or sidecar
  references.
- Do not allow remote URLs in codec commands; downloads remain separate
  `yt-dlp` commands.
- Constrain FFmpeg to local file protocols. Explicitly decide how to handle
  sidecars, image sequences, concat inputs, subtitles/fonts, and network-capable
  demuxers before decode ships.
- Include decode-session cleanup on WebSocket disconnect.

## Phased Plan

### Phase 0 - Contract, UI Truth, And Action Gates

Purpose: stop the product and the code paths from implying or attempting native
decode before the server can prove it.

Tasks:

- Add explicit helper capability fields for codec decode/encode.
- Decide the helper version boundary: feature fields stay authoritative, but the
  minimum helper version for codec decode must be documented before Packet B
  ships.
- Update TypeScript helper info handling to require capability checks before any
  native decode UI is shown or enabled.
- Keep `nativeDecodeEnabled` off until a connected helper reports
  `codec_decode: true`, and migrate stale persisted `nativeDecodeEnabled: true`
  so old local state cannot trigger old codec commands.
- Add action-level guards in `NativeDecoder.open`, `nativeHelperVideoCommands`,
  `addVideoClip`, and `upgradeToNativeDecoder`; UI gating alone is not enough.
- Refuse old unversioned codec commands from app code unless a compatibility
  adapter explicitly maps them to versioned `codec_*` commands after capability
  negotiation.
- Define the label split: Native Helper/Turbo remains connection, downloads,
  Firefox projects, AI bridge, and MatAnyone2. A separate codec badge/control
  appears only when `codec_decode: true`.
- Add documentation language that native decode is planned until the Rust
  server implements it.

Acceptance:

- A current helper connects without exposing native decode controls.
- A future helper can advertise codec capability without hardcoded app-side
  version assumptions.
- A current helper connects and no TypeScript path calls `open`, `decode`,
  `prefetch`, or other codec commands regardless of stale settings.
- Importing ProRes with the current helper falls back cleanly and explains that
  decode is unavailable.
- A connected helper with `codec_decode: false` yields an actionable user
  message, not a silent fallback or hidden failure.

### Phase 1 - Metadata Probe And Session Lifecycle

Purpose: prove safe local file opening without frame transfer.

Tasks:

- Add Rust commands for `codec_probe`, `codec_open`, and `codec_close`.
- Update `server.rs` routing, command-id extraction, auth-gated dispatch,
  connection-owned cleanup, and disconnect teardown for the new codec commands.
- Decide FFmpeg integration and distribution before merge: Rust bindings, C ABI,
  bundled sidecar process, or system/path subprocess. Capture packaging,
  licensing, installer size, signing/notarization, and cross-platform build
  consequences.
- Integrate FFmpeg/ffprobe probing via the chosen maintainable strategy.
- Add required helper dependencies to `tools/native-helper/Cargo.toml` only
  after the integration strategy is chosen.
- Return normalized video stream metadata, audio stream metadata, duration,
  frame-rate guess, timebase, rotation, pixel format, and codec/profile.
- Return codec variant support at stream level, so ProRes 422 can be accepted
  while ProRes 4444 or unsupported variants produce structured errors.
- Register decode sessions with per-session ids, owner connection, memory
  budget, and cleanup on disconnect.
- Add helper-side tests or smoke scripts for supported and unsupported files.
- Update Native Helper docs and README protocol tables for metadata-only codec
  commands.

Acceptance:

- MasterSelects can probe a local ProRes file through the helper.
- Unsupported or unreadable files return structured errors.
- A file without a resolvable granted absolute path fails at import/probe time
  with a per-clip explanation.
- Opening more sessions than the helper budget allows returns a structured
  budget error and does not silently evict or leak sessions.
- Closing the socket releases sessions.
- Existing downloads, file operations, AI bridge, and MatAnyone2 still work.

### Phase 2 - Single-Frame Decode

Purpose: decode exact still frames into a browser-renderable payload.

Tasks:

- Decide and implement the frame payload transport: WebSocket binary with
  request correlation, HTTP payload fetch, temp-file handoff, or another
  explicit strategy.
- Implement `codec_decode` for one requested timestamp/frame.
- Support `nearest` and `exact` modes.
- Return at least one payload type: JPEG preview or raw RGBA/BGRA.
- Include returned frame metadata: source time, frame index if known, width,
  height, scale, pixel format, color info, and request generation.
- Wire the TypeScript `NativeDecoder` to the new versioned command names.
- Add request-id tracking before full cancellation lands; every Rust response
  must echo the browser request id.
- Define the compositor integration point: either wrap native frames in a
  provider-compatible object or add a named native branch in layer collection.
- Render decoded frames through the existing layer source path without storing
  runtime handles in durable timeline state.
- Add cleanup paths for clip delete, project close, helper disconnect, and
  settings toggle before the first native frame path is considered usable.

Acceptance:

- Source Monitor or timeline preview can show a still from a ProRes file.
- Exact frame on paused scrub stop is visually stable.
- A stale decode response arriving after the requested source time/generation
  changed is discarded without writing to the compositor.
- A pending request is observable in playback diagnostics with request id and
  elapsed wait time.
- Save, history, export snapshots, and durable project data contain no
  `NativeDecoder`, `ImageBitmap`, helper session, DOM media element, `File`,
  `Blob`, or object URL handles.
- Failed decode falls back or reports without poisoning the project state.

### Phase 3 - Interactive Scrub Provider

Purpose: make scrubbing usable rather than technically possible.

Tasks:

- Replace `VideoSyncNativeDecoderSync` and the current `NativeDecoder`
  buffer-ahead behavior with the provider request model. Do not keep the old
  clip-keyed `isPending` path as a parallel scrub path.
- Move native decoder ownership toward source/session keyed providers; Phase 3
  must not treat the current clip-keyed registry as final architecture.
- Add latest-wins request coalescing.
- Add helper-side LRU frame cache around the current playhead.
- Add `codec_prefetch` for direction/range hints.
- Add scaled preview requests for drag scrub and full-resolution settle frames.
- Add cancellation by request id and generation.
- Define hold-frame behavior while native decode is pending.
- Integrate with playback health/debug traces: provider wait, decode wait,
  transfer wait, stale responses, cache hit rate, and queue depth.

Acceptance:

- Rapid timeline drag does not build an unbounded request backlog.
- Late responses are ignored and released.
- Scrub preview updates responsively on 1080p ProRes and 4K scaled preview.
- Payload type and scale used to hit the p95 scrub target are measured and
  recorded; the budget is not accepted by assumption.
- Outstanding decode request count per session is reported and returns to zero
  after scrub stop.
- `getStats` and `getPlaybackTrace` expose native provider fields:
  `decode_queue_depth`, `decode_wait_ms`, `transfer_wait_ms`,
  `helper_cache_hit`, `native_session_id`, stale response counts, and payload
  bytes.
- Session budget exceeded behavior is user-visible and deterministic: reject
  with a clear error, queue within budget, or evict by documented policy.

### Phase 4 - Playback Provider

Purpose: support live playback for native-decoded clips with bounded latency.

Tasks:

- Add bounded decode-ahead for intra-frame codecs.
- Define frame deadlines and drop/hold policy for live preview.
- Define audio behavior explicitly before implementation: browser audio when
  possible, helper-extracted/proxy audio, silent video-clock playback, or muted
  video-only. The chosen clock authority must be documented for mixed native and
  browser-native timelines.
- Integrate with runtime provider budgets so native sessions are source/session
  keyed rather than clip keyed.
- Add project-close, clip-delete, helper-disconnect, and settings-toggle
  teardown tests.

Acceptance:

- A ProRes clip can play in preview without blocking the UI.
- Dropped frames are counted, not hidden.
- Native decode lateness is reported distinctly from HTML video stalls, for
  example as `NATIVE_FRAME_LATE`.
- Audio from ProRes source files is explicitly muted, absent, or proxy-backed
  with a per-clip/status indicator. Playback does not hang.
- Helper disconnect during active scrub or playback results in a clean fallback
  or stop with user-visible status, not a silent stall.
- A timeline mixing native ProRes and browser-native clips has documented clock
  authority and does not confuse audio/video drift handling.
- Native decode sessions stay within configured budget.

### Phase 5 - Export And Bake Decode Input

Purpose: allow browser compositing/export paths to consume native-decoded source
frames deterministically.

Tasks:

- Add exact ordered frame requests for export/bake.
- Ensure no latest-wins dropping is used for deterministic jobs.
- Add cancellation and cleanup for export aborts.
- Add checks for frame count, duplicate frames, and missing frame errors.
- Use the same source timing rules as WebCodecs export mode.

Acceptance:

- ProRes source clips can be used in a browser-rendered export.
- Export cancellation drains queues and releases helper resources.
- Export frame logs identify source decode failures by clip, source time, and
  frame index.
- `debugExport` can exercise a ProRes source clip and report frame-level decode
  errors through the existing AI/debug bridge.

### Phase 6 - Native Encode

Purpose: export professional formats after source decode is stable.

Tasks:

- Add `codec_start_encode`, `codec_encode_frame`, `codec_finish_encode`, and
  `codec_cancel_encode`.
- Start with ProRes 422 HQ MOV output through FFmpeg.
- Decide encode frame input strategy: WebSocket binary framing, HTTP upload,
  temp-file sequence, or another bounded transfer path.
- Stream browser-composited frames to the helper with bounded backpressure,
  request correlation, max payload limits, and cancellation.
- Validate output paths through the same allowed-root policy and write through
  temp files with cleanup on cancel/failure.
- Add audio muxing after video-only encode is reliable. This requires either
  helper-extracted audio, browser-rendered/re-encoded audio sent to the helper,
  or another explicit audio payload path.
- Surface encode progress and output path through existing export UI.

Acceptance:

- MasterSelects can export a short ProRes MOV through the helper.
- Encode cancellation leaves no partial job state except a removable temp file.
- Output validates with `ffprobe` and imports into major NLEs.

## Integration With Worker-First Playback Renderer

This plan should not fork the playback architecture. Native helper decode should
be implemented as one frame-provider variant and later folded into the
worker-first provider controller.

Shared decisions with `docs/ongoing/Worker-First-Playback-Renderer.md`:

- Request ids, generations, deadlines, priority, and exact/nearest/hold modes.
- Latest-wins for scrub and exact ordered frames for export.
- Frame ownership tokens and release/close behavior.
- Provider metrics in `getStats` and `getPlaybackTrace`.
- Source/session keyed providers instead of clip-keyed decoder ownership.

Do not move native decode directly into render code. Keep the boundary at
provider request/response so the same source can feed live preview, source
monitor, thumbnails, RAM/bake, and export.

## Open Decisions

- FFmpeg integration strategy: Rust binding, C ABI, sidecar `ffmpeg` process,
  or a small purpose-built decoder process managed by the helper.
- Frame payload transport: WebSocket binary, HTTP fetch/upload, temp files, or a
  hybrid. This must be resolved before Phase 2.
- Preview payload: JPEG first, raw BGRA/RGBA first, or YUV planes with browser
  conversion.
- Color management minimum: whether the first milestone treats frames as
  display-referred sRGB/Rec.709 or carries more metadata into the compositor.
- ProRes 4444 alpha: separate alpha payload or RGBA output.
- Audio: helper-extracted WAV/proxy audio, browser fallback when possible, or
  native audio frame provider.
- Windows/macOS/Linux acceleration: software FFmpeg first vs platform hardware
  APIs first.
- Project portability UX for native-decoded clips whose absolute path is missing
  or invalid on another machine.

## First Work Packets

Packet A - docs and truth-in-UI:

- Write set: `docs/Features/Native-Helper.md`,
  `README.md`,
  `src/components/common/NativeHelperStatus.tsx`,
  `src/components/common/settings/NativeHelperSettings.tsx`,
  `src/stores/settingsStore.ts`,
  `src/stores/timeline/clip/addVideoClip.ts`,
  `src/stores/timeline/clip/upgradeToNativeDecoder.ts`,
  `src/services/nativeHelper/protocol.ts`,
  `src/services/nativeHelper/NativeHelperClient.ts`,
  `src/services/nativeHelper/NativeDecoder.ts`,
  `src/services/nativeHelper/nativeHelperVideoCommands.ts`,
  `src/services/timeline/nativeDecoderRuntimeRegistry.ts`.
- Goal: capability-gate native decode UI, docs, and every action path that can
  issue codec commands. Persisted `nativeDecodeEnabled: true` must not trigger
  old `open`/`decode`.
- Checks: `npm run lint` focused if practical, TypeScript build if touched
  protocol types.

Packet B - codec backend and transport decision:

- Write set: `docs/ongoing/Native-Helper-Codec-Service.md`,
  `tools/native-helper/README.md`, packaging/release notes as needed.
- Goal: record the chosen FFmpeg integration strategy, codec binary discovery or
  bundling model, license/distribution policy, and frame payload transport
  before implementing frame decode.
- Checks: no build required unless prototype code is added.

Packet C - Rust protocol probe:

- Write set: `tools/native-helper/src/protocol/**`,
  `tools/native-helper/src/server.rs`, `tools/native-helper/src/session.rs`,
  `tools/native-helper/Cargo.toml`, new codec module under
  `tools/native-helper/src/codec/**`, `tools/native-helper/README.md`,
  `docs/Features/Native-Helper.md`.
- Goal: add `codec_probe`/`codec_open`/`codec_close` with metadata only.
- Checks: `cargo test` or `cargo build --release` in `tools/native-helper`.

Packet D - browser probe client:

- Write set: `src/services/nativeHelper/**`, import/media metadata path.
- Goal: call `codec_probe` during import for browser-foreign files and show
  structured unavailable/unsupported errors.
- Checks: targeted TypeScript build and import-path smoke.

Packet E - single-frame decode:

- Write set: helper codec module, native helper client video commands,
  `NativeDecoder`, `LayerCollector`/layer source integration if needed,
  `src/services/layerBuilder/**` if the chosen integration point requires it.
- Goal: display one decoded ProRes frame in preview/source monitor.
- Checks: helper smoke with fixture media, browser debug bridge still-frame
  probe.

Packet F - scrub provider:

- Write set: provider policy/native decoder runtime modules, helper cache,
  playback diagnostics, `src/services/layerBuilder/videoSyncNativeDecoderSync.ts`
  as replaced or retired.
- Goal: responsive latest-wins scrub with scaled preview and exact settle.
- Checks: `simulateScrub`, `getPlaybackTrace`, leak/session cleanup scans, and
  diagnostics fields for native provider queue/decode/transfer/cache/session.

Packet G - versioning, packaging, and release:

- Write set: `src/version.ts`, `src/changelog-data.json`, `package.json`,
  `package-lock.json`, `tools/native-helper/Cargo.toml`,
  `docs/Features/Native-Helper.md`, release/installer packaging files as
  needed.
- Goal: bump app/helper versions only at the release boundary, document the
  minimum helper version for codec capability, and update packaging for FFmpeg
  or the chosen backend.
- Checks: version consistency scan from `AGENTS.md` section 5, helper build, and
  relevant app build/lint/test chain at normal release boundary.

## Completion Criteria

The plan is complete when:

- Current helper capability reporting prevents false native decode UI claims.
- Current helper capability reporting also prevents old or persisted action
  paths from issuing codec commands.
- A released helper can probe, decode, scrub, and play at least ProRes 422 MOV
  files through a bounded frame-provider path.
- The minimum helper version required for codec decode is documented and
  enforced by capability checks, not by a hardcoded app-side version string.
- Browser-native media still defaults to WebCodecs/HTML video.
- Source decode failures are structured and recoverable.
- Session, frame, and cache lifetimes are observable and leak-free.
- The native decode setting can be enabled/disabled at runtime without page
  reload and without leaking Rust decode sessions.
- Rapid add/delete of a native-decode candidate before `codec_probe` completes
  does not leak helper sessions.
- Outstanding decode request count per session returns to zero after scrub stop,
  project close, helper disconnect, and settings toggle.
- Export/bake can consume native-decoded source frames deterministically.
- Native ProRes encode is either implemented and documented or explicitly split
  into a follow-up plan.
