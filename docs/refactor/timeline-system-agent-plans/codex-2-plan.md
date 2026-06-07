# Codex Agent 2 Timeline System Architecture Proposal

Date: 2026-06-06

This is an independent proposal. It treats the current
`Timeline-System-Refactor-Plan.md` as useful input, not as the destination.

## Executive Read

The deleted `TimelineClip.tsx` renderer should stay deleted. The current
timeline no longer has an active legacy full DOM clip-body renderer. The
remaining problem is architectural gravity: rendering, geometry, resource
resolution, shell mounting, hit testing, drag/drop, menus, and runtime media
ownership are still too implicit and are concentrated in:

- `src/components/timeline/Timeline.tsx`
- `src/components/timeline/TimelineTrack.tsx`
- `src/components/timeline/TimelineClipCanvas.tsx`
- `src/components/timeline/hooks/useExternalDrop.ts`
- `src/services/layerBuilder/VideoSyncManager.ts`
- `src/services/layerBuilder/AudioTrackSyncManager.ts`
- large timeline store slices and edit-operation files

The elegant target is not "split the big files." The target is a small pure
timeline kernel plus thin hosts. Components should host DOM and canvas.
Services should own caches and runtime resources. Pure timeline modules should
own derivation, geometry, hit testing, paint planning, and command resolution.

My main disagreement with the current plan: keeping the durable contracts under
`src/components/timeline/renderModel/` is a short-term convenience, but not the
best long-term architecture. Render models, geometry, commands, and visual
resource demand are not component concerns. They should move to a pure
`src/timeline/` kernel. Existing `renderModel/` contracts can be migrated or
re-exported during the transition.

## Target Architecture

### 1. Pure Timeline Kernel

Create a pure, React-free, store-free package:

```text
src/timeline/
  domain/
    timelineIds.ts
    timelineSchema.ts
    timelineFacts.ts
  capabilities/
    timelineCapabilityTypes.ts
    sourceCapabilities.ts
    videoCapability.ts
    audioCapability.ts
    imageCapability.ts
    midiCapability.ts
    compositionCapability.ts
    dataCapability.ts
  derivation/
    timelineFrameInput.ts
    buildTimelineFrame.ts
    buildTrackPlan.ts
    buildClipAtom.ts
  geometry/
    timelineGeometryTypes.ts
    buildTimelineGeometry.ts
    buildTrackGeometry.ts
    buildClipGeometry.ts
    spatialIndex.ts
    hitTest.ts
    dropTargets.ts
  paint/
    timelinePaintTypes.ts
    buildTimelinePaintScene.ts
    painters/
      drawTimelinePaintScene.ts
      drawClipBody.ts
      drawWaveform.ts
      drawSpectrogram.ts
      drawThumbnails.ts
      drawBadges.ts
  resources/
    visualResourceTypes.ts
    planVisualResourceDemand.ts
    resolveVisualResources.ts
    planCacheWarmups.ts
  commands/
    timelineCommandTypes.ts
    resolvePointerCommand.ts
    resolveMenuCommands.ts
    resolveDropCommand.ts
    resolveKeyboardCommand.ts
```

Rules:

- No React imports.
- No Zustand store imports.
- No DOM objects, `File`, object URLs, media elements, workers, `ImageBitmap`,
  WebGPU, WebCodecs players, or callbacks in exported data.
- Pure builders accept explicit input and return explicit output.
- All exported frame/render/geometry/paint data must be structured-clone-safe
  unless a type is explicitly marked as a transferable resource.

### 2. Capability Facets Instead Of Switch Sprawl

MasterSelects is moving toward "every file becomes a visual signal." The
timeline should stop accumulating source-specific conditionals in canvas,
track, store, and layer-builder files.

Introduce `TimelineSourceCapability` adapters. Each adapter can contribute:

- semantic render facets: label, palette, source timing, clip badges, markers
- passive visual facets: thumbnails, waveform, spectrogram, MIDI notes,
  composition segments, vector preview, document page preview, model preview,
  point-cloud summary, data table summary
- active shell facets: trim, fade, keyframes, audio region, spectral region,
  video bake, stem controls, source-specific handles
- resource demand: cache refs, thumbnail ranges, waveform refs, spectrogram
  tiles, document page rasters, 3D preview thumbnails, data summaries
- runtime demand: playback provider, image/document/model hydration, export
  preparation
- menu and command contributions

The generic builder loops tracks and clips. Capability modules own source-kind
details. This prevents `buildTimelineRenderModel(...)`, canvas drawing, and
context menus from becoming source-specific god objects.

### 3. Frame Plan, Geometry, Paint Scene

The durable artifacts should be:

1. `TimelineFrameInput`
   Explicit plain snapshot from stores, UI session state, media metadata, and
   viewport measurements. This is the only place React/store selectors feed the
   kernel.

2. `TimelineFrame`
   Derived semantic state: ordered tracks, clip atoms, selection, hover, tool
   preview, visible sections, capability facets, resource refs. It is "what is
   true," not "where pixels are."

3. `TimelineGeometrySnapshot`
   Rects and spatial indexes for tracks, clip bodies, handles, shell modules,
   keyframe rows, transitions, drop targets, marquee exclusions, ruler regions,
   new-track zones, and split sections. It is the only source of hit testing.

4. `TimelineVisualResourceDemand`
   Bounded, viewport-aware demand for thumbnails, waveform pyramids,
   spectrogram tiles, analysis overlays, composition strips, MIDI previews, and
   future file-type resources.

5. `TimelineVisualResourceSnapshot`
   Draw-ready resources and missing/queued states. This can contain
   transferables such as `ImageBitmap`, but it is owned by the resolver layer,
   not by timeline data or render models.

6. `TimelinePaintScene`
   Canvas-independent paint commands built from frame, geometry, and visual
   resources. Main-thread canvas and OffscreenCanvas worker both draw this same
   scene with the same painter modules.

This keeps one owner per fact:

- timeline store owns edit state
- frame derivation owns semantic clip/track facets
- geometry owns pixels and hit testing
- resource resolver owns decoded/draw-ready payloads
- paint scene owns draw order and paint commands
- canvas hosts own canvas lifecycle only
- shell hosts own active DOM only
- runtime broker owns media elements/providers

### 4. Thin UI Hosts

The component tree should become:

```text
src/components/timeline/
  TimelineRoot.tsx
  root/
    useTimelineFrameInput.ts
    useTimelineLivePlayheadDomSync.ts
    TimelineMenusHost.tsx
    TimelineOverlayHost.tsx
  sections/
    TimelineSectionLayout.tsx
    useTimelineSectionScroll.ts
    useTimelineSplitFocus.ts
    TimelineSectionPane.tsx
  track/
    TimelineTrackRowHost.tsx
    TimelineTrackHeaderRow.tsx
    TimelineTrackClipLayer.tsx
    TimelineTrackPropertyRows.tsx
  shell/
    ActiveClipShellLayer.tsx
    buildActiveShellPlan.ts
  canvas/
    TimelineClipCanvasHost.tsx
    useTimelineCanvasWorker.ts
    useTimelineCanvasDiagnostics.ts
```

`TimelineRoot.tsx` should orchestrate store subscriptions and layout hosts. It
should not know clip drawing, shell geometry, drop target math, or menu item
business logic.

`TimelineTrackRowHost.tsx` should receive one track plan plus geometry records.
It should not derive `CanvasClip`, recompute clip rects, scan all clips for hit
testing, or build shell modules inline.

`TimelineClipCanvasHost.tsx` should size a canvas, choose main-thread vs worker,
and publish diagnostics. It should not collect cache demand, decode resources,
decide clip visuals, or contain source-specific painters.

### 5. Runtime And Resource Ownership

The current runtime coordinator, lazy media/image helpers, and reporting files
are valuable. The missing step is adoption and enforcement.

Target:

```text
src/services/timeline/
  timelineRuntimeBroker.ts
  timelineRuntimeReservation.ts
  visualResourceResolver/
  cacheDemandScheduler/
```

Required API shape:

```ts
const reservation = timelineRuntimeBroker.reserve({
  policyId: 'interactive-preview',
  owner,
  demands,
});

try {
  const provider = await reservation.resolveProvider(clipRef, timeRange);
} finally {
  reservation.release();
}
```

Rules:

- UI never creates or stores media elements.
- Timeline store never persists media elements, object URLs, decoded bitmaps, or
  provider instances.
- Layer builder and export code ask a broker for providers; they do not read
  `clip.source.videoElement`, `clip.source.audioElement`, or
  `clip.source.imageElement` except through audited compatibility adapters.
- Diagnostics/reporting must not allocate resources.
- Warmups report demand to a scheduler; they do not run from canvas host effects
  that know clip internals.

## No-God-Object Safeguards

1. Boundary import tests:
   - `src/timeline/**` cannot import React, Zustand stores, components, DOM
     runtime services, or layer-builder services.
   - canvas draw modules cannot import stores or timeline components.
   - store slices cannot import DOM/media element helpers.
   - command resolvers cannot mutate stores directly.

2. Module budgets:
   - React host components: target under 400 LOC.
   - Pure builder modules: target under 250 LOC.
   - Painter modules: target under 250 LOC each.
   - Capability modules: target under 300 LOC per source kind.
   - If a module exceeds budget, it needs either a clear reason or a split
     before the phase is considered done.

3. Builder composition:
   - No single `buildTimelineFrame(...)` function may contain source-kind
     branches beyond adapter dispatch.
   - Per-track and per-clip builders must be exported and tested directly.
   - Geometry builders are split by track, clip body, handles, transitions,
     keyframes, drop targets, and section layout.

4. Paint convergence:
   - Main-thread canvas and worker rendering must use the same
     `TimelinePaintScene` and shared painter modules.
   - No second worker-only painter language and no main-thread-only fallback
     painter with separate visual logic.

5. Data plainness:
   - Structured-clone tests for `TimelineFrame`, `TimelineGeometrySnapshot`,
     `TimelineVisualResourceDemand`, and worker paint messages.
   - Field-coverage tests from current `CanvasClip` visuals so no thumbnail,
     waveform, spectrogram, badge, transcript, analysis, fade, trim, MIDI, stem,
     or composition visual disappears during migration.

6. Interaction convergence:
   - Pointer move/click, marquee, drag/drop, context menus, keyboard, and tool
     palette all resolve through command descriptors.
   - Command descriptors produce edit operations, preview state, or runtime
     requests. They do not write store state themselves.

7. Runtime audit:
   - New direct access to `source.videoElement`, `source.audioElement`, and
     `source.imageElement` fails an audit test unless it is in an allowlisted
     compatibility adapter.

8. Documentation guard:
   - Stale docs that present deleted `TimelineClip.tsx` as current architecture
     must be corrected or marked historical.

## Phase Order

### Phase 0: Guardrails And Baseline

Goal: make the boundaries executable before moving code.

Work:

- Add import-boundary tests for the future `src/timeline/` kernel.
- Add a deleted-renderer guard: no source import of `TimelineClip.tsx`, no
  passive DOM clip body, diagnostics keep `domClipBodyCount === 0`.
- Add direct-runtime-access audit with an initial allowlist for current
  compatibility files.
- Capture current field coverage from `CanvasClip`, worker messages, shell
  modules, and external drag state.
- Mark old docs that reference `TimelineClip.tsx` as historical or stale.

Focused checks:

```bash
npm run test -- tests/unit/timelineRenderModel.test.ts tests/unit/timelineCanvasDiagnostics.test.ts tests/unit/TimelineTrack.test.tsx
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

### Phase 1: Pure Kernel Contracts And Capability Registry

Goal: define the long-term shape without moving UI yet.

Work:

- Add `src/timeline/domain`, `capabilities`, `derivation`, `geometry`,
  `paint`, `resources`, and `commands` contract files.
- Create source capability adapters for current clip classes with only plain
  facet output.
- Build `TimelineFrameInput` from explicit plain values, not store imports.
- Implement `buildClipAtom(...)`, `buildTrackPlan(...)`, and
  `buildTimelineFrame(...)` as small composition functions.
- Re-export or migrate existing `renderModel` types into the kernel.

Focused checks:

```bash
npm run test -- tests/unit/timelineRenderModel.test.ts
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

### Phase 2: Geometry Kernel And Spatial Index

Goal: make one geometry source real before dissolving components.

Work:

- Implement `buildTimelineGeometry(...)` from `TimelineFrame` plus viewport and
  section measurements.
- Implement `TimelineSpatialIndex` for clip bodies, handles, drop targets,
  keyframe diamonds, transitions, ruler markers, and marquee exclusions.
- Migrate `TimelineTrack` hit testing to the spatial index.
- Migrate marquee selection and external drop target resolution next.
- Keep current canvas input through an adapter during this phase.

Focused checks:

```bash
npm run test -- tests/unit/TimelineTrack.test.tsx tests/unit/timelineGrid.test.ts tests/components/timeline/clipDragTrackTargeting.test.ts tests/unit/externalDragNewTrackGesture.test.ts
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

### Phase 3: Visual Resource Demand And Resolver

Goal: remove cache/resource decisions from canvas components.

Work:

- Implement `planVisualResourceDemand(...)` from frame plus geometry.
- Implement `resolveVisualResources(...)` with adapters for thumbnail cache,
  waveform pyramids, spectrogram tiles, analysis overlays, composition segment
  strips, MIDI summaries, and fade/trim resources.
- Move visible thumbnail, waveform, spectrogram, audio-analysis, and generation
  warmup planning behind demand scheduler modules.
- Keep resource resolver mutation-free; scheduling happens in a separate
  service based on explicit demand.

Focused checks:

```bash
npm run test -- tests/unit/timelineThumbnailDbWarmup.test.ts tests/unit/timelineThumbnailGenerationWarmup.test.ts tests/unit/timelineWaveformArtifactWarmup.test.ts tests/unit/timelineSpectrogramArtifactWarmup.test.ts tests/unit/timelineAudioAnalysisArtifactWarmup.test.ts tests/unit/timelineCacheSchedulerContracts.test.ts
```

### Phase 4: Paint Scene And Shared Painters

Goal: kill duplicate main-thread and worker painting logic.

Work:

- Build `TimelinePaintScene` from frame, geometry, and resolved resources.
- Extract painter modules from `TimelineClipCanvas.tsx` and the worker into
  shared pure draw functions.
- Worker draw messages carry paint-scene data plus transferables, not rich
  source-shaped clips and independent geometry.
- Main-thread fallback and worker path both call `drawTimelinePaintScene(...)`.
- `TimelineClipCanvas.tsx` becomes `TimelineClipCanvasHost.tsx` plus worker and
  diagnostics hooks.

Focused checks:

```bash
npm run test -- tests/unit/timelineClipCanvasWorkerModel.test.ts tests/unit/TimelineClipCanvasWorkerRuntime.test.tsx tests/unit/timelineSpectrogramCanvas.test.ts tests/unit/waveformLod.test.ts
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

Run bridge/browser canvas smoke only after the first real painter migration.

### Phase 5: Track Row And Active Shell Plan

Goal: make `TimelineTrack.tsx` a host, not a derivation engine.

Work:

- Replace `TimelineTrackProps` with:
  - `trackPlan`
  - `trackGeometry`
  - `trackInteractionState`
  - `trackCommands`
- Extract active shell planning into `buildActiveShellPlan(...)`.
- Move fade/keyframe/special active module derivation out of the row component.
- Move property rows into `TimelineTrackPropertyRows.tsx`.
- Move external preview rendering into a `TimelineDropPreviewLayer`.
- Use geometry snapshot for shell rects and handle rects.

Focused checks:

```bash
npm run test -- tests/unit/TimelineTrack.test.tsx tests/unit/TimelineKeyframes.test.tsx tests/unit/timelineToolPointerDispatcher.test.ts
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

### Phase 6: Root Layout And Section System

Goal: shrink `Timeline.tsx` into a composition root.

Work:

- Extract section split/focus sizing into `useTimelineSplitFocus`.
- Extract video/audio section scrolling into `useTimelineSectionScroll`.
- Extract surface pan/right-drag scrub/playhead DOM sync into focused root
  hooks.
- Extract menus into `TimelineMenusHost`.
- Extract overlays into `TimelineOverlayHost`.
- Extract section rendering into `TimelineSectionPane`.
- The root builds `TimelineFrameInput`, calls kernel derivation, and passes
  plans to hosts.

Focused checks:

```bash
npm run test -- tests/unit/useTimelineKeyboard.test.tsx tests/unit/useTimelineZoom.test.ts tests/unit/timelineCanvasSmokeHandlers.test.ts tests/unit/TimelineContextMenu.test.tsx tests/unit/TimelineEmptyContextMenu.test.tsx tests/unit/TrackContextMenu.test.tsx
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

### Phase 7: Command Convergence

Goal: make all timeline interactions use one typed command path.

Work:

- Pointer tools call `resolvePointerCommand(...)`.
- Context menus call `resolveMenuCommands(...)`.
- External drop calls `resolveDropCommand(...)`.
- Keyboard calls `resolveKeyboardCommand(...)`.
- Commands produce edit operations, preview state, runtime requests, or UI menu
  intents.
- Store mutation remains in edit operations and narrow UI state setters.
- Split `useExternalDrop.ts` into payload parsing, preview derivation, placement
  command resolution, and async materialization.

Focused checks:

```bash
npm run test -- tests/unit/timelineEditOperationContracts.test.ts tests/unit/timelineEditOperations.test.ts tests/unit/timelinePlacementCommands.test.ts tests/unit/timelineToolPointerDispatcher.test.ts tests/unit/useTimelineKeyboard.test.tsx
```

### Phase 8: Runtime Boundary Adoption

Goal: stop treating clip source fields as runtime owners.

Work:

- Create/adopt `timelineRuntimeBroker` around existing coordinator and lazy
  media/image services.
- Replace layer-builder direct element reads with provider handles in
  `VideoSyncManager`, `AudioTrackSyncManager`, `LayerBuilderService`, export,
  RAM preview, and composition render paths.
- Keep an explicit compatibility adapter for remaining source-field access
  during migration.
- Move diagnostics to provider/session health, not only element health.
- Tighten serialization/history tests so runtime-bearing fields never survive
  save, load, undo, redo, nested restore, or split.

Focused checks:

```bash
npm run test -- tests/unit/lazyMediaElements.test.ts tests/unit/historyRuntimeRehydration.test.ts tests/unit/exportRuntimeReporting.test.ts tests/unit/ramPreviewRuntimeReporting.test.ts tests/unit/timelineRuntimeCoordinatorContracts.test.ts tests/unit/layerBuilderService.test.ts
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

### Phase 9: Future File Capability Lane

Goal: prove the architecture supports "everything becomes a visual signal."

Work:

- Add capability stubs and test fixtures for PDF/SVG/document page previews,
  glTF/model preview summaries, JSON/CSV table previews, binary/hexdump
  summaries, point-cloud summaries, and CAD/technical-file placeholders.
- These adapters should output facets, resource demand, and paint commands
  without editing core hosts.
- Do not add UI one-offs in `Timeline.tsx` or `TimelineClipCanvasHost.tsx`.

Focused checks:

```bash
npm run test -- tests/unit/timelineRenderModel.test.ts tests/unit/timelineClipCanvasWorkerModel.test.ts
```

### Phase 10: Cleanup, Docs, And Final Gates

Goal: remove transitional adapters and make the architecture enforce itself.

Work:

- Delete transitional `CanvasClip` adapters.
- Delete old component-local geometry utilities made obsolete by kernel
  geometry.
- Remove stale docs or mark them historical.
- Verify file-size budgets.
- Verify import-boundary tests.
- Verify diagnostics and bridge smokes.

Normal final readiness checks:

```bash
npm run build
npm run lint
npm run test
```

## Parallel Agent Strategy

Parallelism is valuable only after Phase 1 creates stable contract names.

| Lane | Owns | Avoids |
|---|---|---|
| A: Kernel/Contracts | `src/timeline/domain`, `capabilities`, `derivation`, contract tests | UI components, runtime services |
| B: Geometry | `src/timeline/geometry`, spatial index tests, hit-test adapters | canvas painters, store slices |
| C: Resources/Paint | `src/timeline/resources`, `src/timeline/paint`, canvas worker model/runtime tests | `Timeline.tsx`, store slices |
| D: Track/Shell | `src/components/timeline/track`, `shell`, `TimelineTrack.tsx` migration | canvas resource resolver internals |
| E: Root/Layout | `TimelineRoot`, section hooks, menus/overlays hosts, `Timeline.tsx` migration | track/canvas internals |
| F: Commands/Drop | `src/timeline/commands`, tool/menu/drop resolvers, `useExternalDrop` split | runtime/layerBuilder |
| G: Runtime | runtime broker, layerBuilder/audio/video sync adoption | UI hosts except integration points |
| V: Verifier | boundary tests, smoke scripts, docs/handoff updates | implementation files unless assigned |

Single-owner hot files per phase:

- `src/components/timeline/Timeline.tsx`
- `src/components/timeline/TimelineTrack.tsx`
- `src/components/timeline/TimelineClipCanvas.tsx`
- `src/components/timeline/hooks/useExternalDrop.ts`
- `src/components/timeline/TimelineTracks.css`
- `src/components/timeline/TimelineClip.css`
- `src/stores/timeline/types.ts`
- `src/stores/timeline/editOperations/applyTimelineEditOperation.ts`
- `src/services/layerBuilder/VideoSyncManager.ts`
- `src/services/layerBuilder/AudioTrackSyncManager.ts`

Integration rule: one lane may add adapters for another lane's contract, but it
must not redesign that contract without a handoff entry and owner agreement.

## Focused Test Strategy

Do not run full build/lint/test after every slice. Use narrow checks tied to
changed boundaries:

- Pure kernel/contracts: `timelineRenderModel`, new kernel contract tests,
  TypeScript.
- Geometry/hit testing: `TimelineTrack`, `timelineGrid`,
  `clipDragTrackTargeting`, external drag gesture tests.
- Resources/warmups: thumbnail, waveform, spectrogram, audio-analysis,
  cache-scheduler tests.
- Paint/worker: worker model/runtime, spectrogram canvas, waveform LOD,
  canvas diagnostics.
- Track/shell: `TimelineTrack`, `TimelineKeyframes`,
  tool pointer dispatcher, shell contract tests.
- Root/layout: keyboard, zoom, context menus, canvas smoke handlers, new
  split-section tests.
- Commands: edit-operation contracts, edit operations, placement commands,
  pointer dispatcher, keyboard.
- Runtime: lazy media/image, history rehydration, runtime coordinator,
  export/RAM preview reporting, layer builder.
- Browser/bridge smokes only after rendering, worker, layout, playback, export,
  project-load, or drag/drop behavior changes.
- Full `npm run build`, `npm run lint`, and `npm run test` only for normal
  commit/push/merge/final readiness.

## First Implementation Slice

The first slice should prove the architecture with one narrow vertical seam. It
should not start by moving JSX out of `Timeline.tsx`.

Scope:

1. Add `src/timeline/` contracts for:
   - `TimelineFrameInput`
   - `TimelineClipAtom`
   - `TimelineTrackPlan`
   - `TimelineFrame`
   - `TimelineGeometrySnapshot`
   - `TimelineVisualResourceDemand`
   - `TimelinePaintScene`

2. Add capability adapters for current video/audio/image/MIDI/composition clips
   that output plain facets matching current `CanvasClip` visual coverage.

3. Implement `buildClipAtom(...)`, `buildTrackPlan(...)`, and
   `buildTimelineFrame(...)` as pure functions with no store imports.

4. Implement `buildTrackGeometry(...)` for one normal track row using the
   existing measured row width, `scrollX`, `zoom`, and base height.

5. Add an adapter:

```text
TimelineFrame + TrackGeometry + current resolved resource placeholders
  -> existing CanvasClip[]
```

This lets `TimelineTrack` use the new frame/geometry seam while
`TimelineClipCanvas.tsx` remains unchanged for the first slice.

6. Change only the normal `TimelineTrack` canvas mount path to use that seam.
   Do not touch composition-switch overlays, root section layout, or runtime
   sync in the first slice.

7. Add tests:
   - frame output is plain/structured-clone-safe when input clips contain
     runtime objects
   - clip atom field coverage against current `CanvasClip` visual fields
   - geometry parity for clip body rect, visible rect, handle rects, and
     hit-test order
   - `TimelineTrack` still mounts canvas, still routes primary click/right click,
     and diagnostics keep `domClipBodyCount === 0`

Focused checks:

```bash
npm run test -- tests/unit/timelineRenderModel.test.ts tests/unit/TimelineTrack.test.tsx tests/unit/timelineCanvasDiagnostics.test.ts
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

Expected result:

- No visible behavior change.
- No new god object.
- One real architecture seam exists.
- Later agents can independently replace the canvas, shell, commands, and root
  layout behind that seam.

## Final Shape Success Criteria

- `Timeline.tsx` is a root composition host, not the timeline system.
- `TimelineTrack.tsx` is a row host, not a clip planner.
- `TimelineClipCanvas.tsx` is gone or reduced to a small host wrapper.
- Main-thread and worker canvas use one paint scene and one painter set.
- Geometry is computed once and shared by canvas, shell, hit testing, marquee,
  drop targets, keyframes, transitions, and overlays.
- Passive clip bodies remain canvas-only.
- Active DOM exists only for active shells and lightweight previews.
- Runtime media objects are owned by runtime services and provider handles.
- Store/history/serialization remain plain-data boundaries.
- Source-kind capability adapters can add new media/document/3D/data formats
  without editing root timeline components.
- Import-boundary and runtime-audit tests make regression hard.
