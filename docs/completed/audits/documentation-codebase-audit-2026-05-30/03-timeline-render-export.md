# Agent 03 - Timeline / Render / Export Audit

## Scope

Timeline editing, playback/scrubbing, WebGPU/render pipeline, export, effects, transitions, video scopes, preview, multi-preview, output routing, and output manager documentation/code alignment.

## Sources inspected

- Docs: `README.md`, `docs/Features/Timeline.md`, `docs/Features/Preview.md`, `docs/Features/Export.md`, `docs/Features/Effects.md`, `docs/Features/UI-Panels.md`, `docs/Features/Playback-Debugging.md`.
- Code: `src/components/timeline/`, `src/stores/timeline/`, `src/engine/WebGPUEngine.ts`, `src/engine/render/`, `src/engine/export/`, `src/effects/`, `src/transitions/`, `src/components/export/`, `src/components/preview/`, `src/components/outputManager/`, `src/engine/analysis/`, `src/stores/renderTargetStore.ts`, `src/stores/exportStore.ts`, `src/stores/historyStore.ts`.

## Confirmed accurate claims

- Effects docs are broadly current: docs claim 33 GPU effects and categories in `docs/Features/Effects.md:10-12`; code registers category modules in `src/effects/index.ts:64-72`, and `rg "export const .*: EffectDefinition" src/effects` finds 33 definitions. Category counts in `docs/Features/Effects.md:31-35` also match the current exports.
- Effect pipeline notes are accurate: disabled effects and `audio-` effects are filtered in `src/effects/EffectsPipeline.ts:298-300`; feedback binding 3 is implemented in `src/effects/EffectsPipeline.ts:99-103` and used during application at `src/effects/EffectsPipeline.ts:333-387`.
- Transition docs are accurate but should keep the "experimental/limited" framing: only `crossfade` is imported and registered in `src/transitions/index.ts:11-34`; applying a transition moves clip B earlier to create overlap in `src/stores/timeline/transitionSlice.ts:16-17` and `src/stores/timeline/transitionSlice.ts:55-83`.
- Preview target docs are accurate: Preview registers canvases through `engine.registerTargetCanvas()` and `renderTargetStore` in `src/components/preview/Preview.tsx:661-705`; multi-preview slots do the same in `src/components/preview/MultiPreviewSlot.tsx:55-95`.
- Output routing docs are accurate: render targets are centralized in `src/stores/renderTargetStore.ts:1-3`, with active-comp and independent target selectors at `src/stores/renderTargetStore.ts:169-205`; popup focus avoidance during playback is implemented in `src/engine/managers/OutputWindowManager.ts:36-38` and `src/engine/managers/OutputWindowManager.ts:162-171`.
- Scope docs are accurate: histogram, vectorscope, and waveform are GPU compute/render implementations in `src/engine/analysis/HistogramScope.ts:2-3`, `src/engine/analysis/VectorscopeScope.ts:2-3`, and `src/engine/analysis/WaveformScope.ts:2-3`, with GPU submits at `HistogramScope.ts:291`, `VectorscopeScope.ts:313`, and `WaveformScope.ts:437`.
- Export zero-copy/fallback wording is mostly correct: `FrameExporter` initializes an export `OffscreenCanvas` at `src/engine/export/FrameExporter.ts:190-199`, captures `VideoFrame`s at `src/engine/export/FrameExporter.ts:308-325`, and falls back to `engine.readPixels()` at `src/engine/export/FrameExporter.ts:326-340`.
- Export settings persistence/undo claims are supported: export store exposes project data helpers in `src/stores/exportStore.ts:294-299`; history snapshots include export state at `src/stores/historyStore.ts:948-961` and restore it at `src/stores/historyStore.ts:1060-1061`.
- Timeline export locking is accurate: operation-kernel edits are blocked during export in `src/stores/timeline/editOperations/applyTimelineEditOperation.ts:89-91`; many direct timeline actions are wrapped by `lockTimelineEditActions` in `src/stores/timeline/index.ts:356-389` and blocked in `src/stores/timeline/exportEditLock.ts:273-289`.

## Stale or inaccurate claims with code/file evidence

- `docs/Features/Export.md:54` and `docs/Features/Export.md:64-65` say fast export can fall back/retry into HTMLVideo precise mode. Current code explicitly does not auto-switch: `FrameExporter.export()` catches and rethrows in `src/engine/export/FrameExporter.ts:83-99`; large files throw "Select HTMLVideo Precise explicitly" in `src/engine/export/ClipPreparation.ts:403-408`; fast failures log "strict export will not auto-switch to PRECISE mode" in `src/engine/export/ClipPreparation.ts:413-419`.
- `docs/Features/Preview.md:54-58` frames Source Monitor transport/scrubbing as video-only and omits current audio behavior. Code treats audio as playable in `src/components/preview/SourceMonitor.tsx:215-218`, generates audio waveforms in `SourceMonitor.tsx:258-264`, renders an `<audio>` element plus waveform canvas in `SourceMonitor.tsx:594-612`, and exposes placement commands in `SourceMonitor.tsx:34-40`.
- `docs/Features/UI-Panels.md:176-183` under-documents the current Export panel. It says encoder selection is WebCodecs or HTML Video, but code has `webcodecs`, `htmlvideo`, and `ffmpeg` encoder settings in `src/stores/exportStore.ts:95` and FFmpeg loading/controls in `src/components/export/useExportState.ts:166-183`. The panel also routes image sequence, audio-only, XML, browser GIF, WebCodecs/HTMLVideo, and FFmpeg paths in `src/components/export/ExportPanel.tsx:1588-1619`.
- `docs/Features/Timeline.md:313-342` omits `stemSeparationSlice` from the timeline store architecture list. Code imports and combines it in `src/stores/timeline/index.ts:23`, `src/stores/timeline/index.ts:86`, and `src/stores/timeline/index.ts:371`.
- `README.md:95` says nested composition rendering is "all in a single `device.queue.submit()`." The normal main render path batches command buffers into one submit in `src/engine/render/RenderDispatcher.ts:987-1097`, but native gaussian-splat processing can submit separately in `src/engine/render/RenderDispatcher.ts:1563-1680`, and nested output caching can submit in `src/engine/render/NestedCompRenderer.ts:1211-1233`. The README should qualify this as the normal 2D/nested compositor path, not a universal render invariant.

## Recommended README changes

- Qualify the single-submit nested-composition statement around `README.md:95` to account for native gaussian/3D auxiliary submits and cached nested output copies.
- Keep the "zero-copy export pipeline" language around `README.md:87`, but mention that `FrameExporter` still has a pixel-readback fallback when export canvas VideoFrame creation is unavailable.
- Consider adding a short current-state note that fast WebCodecs export is strict and users must explicitly select HTMLVideo Precise when fast mode refuses/fails a source.

## Recommended docs/Features changes by file

- `docs/Features/Export.md`: Replace the automatic fallback/retry claims at lines 54 and 64-65 with the current strict behavior: large/failed fast mode reports an error and asks the user to select HTMLVideo Precise explicitly. Keep the zero-copy plus readback fallback process notes at lines 274-280.
- `docs/Features/Preview.md`: Update Source Monitor behavior to include audio source playback, waveform display, audio scrubbing, In/Out, and placement buttons. Clarify that video uses `<video>`, audio uses `<audio>` plus waveform canvas, and images use `<img>`.
- `docs/Features/UI-Panels.md`: Update Export Panel bullets to include the FFmpeg workflow selector, image frame/sequence export, audio-only export, XML/FCPXML, browser GIF, and project-persistent presets.
- `docs/Features/Timeline.md`: Add `stemSeparationSlice` to the store architecture list. Optionally link Source Monitor placement behavior back to the updated Preview doc.
- `docs/Features/Effects.md`: No required correction found. Optional: note that the blend-mode shader lives both in `src/shaders/composite.wgsl` and the `CompositorPipeline` embedded shader path.

## Suggested follow-up checks

- Run a small browser export smoke test through `debugExport` to confirm current strict fast/precise behavior before changing Export docs.
- Verify UI copy in `ExportPanel`: `src/components/export/ExportPanel.tsx:2614-2617` still says image export renders only the current playhead frame even when sequence mode exists.
- Check whether `Playback-Debugging.md` should mention the current strict export path and `debugExport` failure interpretation alongside `docs/Features/Export.md`.
