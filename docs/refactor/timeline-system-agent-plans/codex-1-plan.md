# Codex Agent 1 Timeline System Architecture Plan

## Position

The issue #228 refactor removed the active full-DOM clip renderer. The current
timeline problem is not legacy visual rendering; it is that timeline concerns are
still coupled through large UI files and raw `TimelineClip` objects:

- `Timeline.tsx` owns root layout, section scrolling, split focus, menus,
  timeline surface gestures, overlays, composition-switch rendering, and many
  command paths.
- `TimelineTrack.tsx` owns row rendering, viewport culling, canvas input shaping,
  shell mount rules, shell geometry, keyframe property rows, hit testing, and
  tool dispatch.
- `TimelineClipCanvas.tsx` owns drawing, resource collection, cache warmup,
  worker preparation, worker lifecycle, diagnostics, and main-thread fallback.
- Runtime media elements still leak through playback, layer sync, history,
  serialization, slot grid, lazy media helpers, and layer building.

The elegant long-term target is not a bigger `viewModel`, one `timelineCommandBus`,
or one `TimelineRenderModel` builder. The target is a set of narrow contracts and
small pure pipelines that are independently testable, structured-clone-safe, and
usable by UI, workers, export, RAM preview, and future non-video file types.

## Target Architecture

### 1. Timeline Data Plane

Persisted timeline state remains a plain project data model:

- tracks, clips, compositions, markers, keyframes, transitions, ranges
- source identity, media ids, project paths, cache refs, edit history identity
- no DOM elements, `File`, object URLs, `ImageBitmap`, decoder/player instances,
  GPU resources, callbacks, or worker transferables

Store slices become write-side domain modules. They should not be the read-side
presentation API for timeline rendering. Reads should flow through selectors and
pure builders.

Target modules:

- `src/stores/timeline/schema/`
- `src/stores/timeline/editOperations/`
- `src/stores/timeline/history/`
- `src/stores/timeline/selectors/`

### 2. Presentation Plane

Rendering and interaction consume presentation artifacts, not raw `TimelineClip`
objects.

The durable artifacts are:

- `TimelineRenderModel`: semantic visual state, built from plain timeline data,
  media metadata, UI state, and cache refs.
- `TimelineGeometrySnapshot`: measured spatial state for tracks, clips, handles,
  rows, overlays, previews, drop targets, and ruler.
- `TimelineSpatialIndex`: query API over the geometry snapshot for hit testing,
  selection, drag/drop, and guide resolution.

Important constraint: these are artifacts, not managers. Builders are small,
per-domain functions:

- `buildRenderTrack`
- `buildRenderClip`
- `buildRenderKeyframeRows`
- `buildRenderTransitions`
- `buildRenderPreviews`
- `buildGeometryTrackLanes`
- `buildGeometryClipBodies`
- `buildGeometryHandles`
- `buildGeometryDropTargets`
- `buildSpatialIndex`

There should be no single function that knows every timeline feature.

Target modules:

```text
src/components/timeline/renderModel/
  builders/
    clips/
    tracks/
    keyframes/
    transitions/
    previews/
  geometry/
  hitTesting/
  selectors/
```

### 3. Visual Resource Plane

The render model contains refs and summaries. It does not contain draw payloads.

A visual resource resolver maps refs into bounded draw resources:

- thumbnail strip resources
- waveform columns
- spectrogram rasters
- transcript and analysis marker buffers
- composition segment strips and mixdown waveform columns
- MIDI preview bars
- fade curve geometry
- progress and badge payloads

The resolver is the only code allowed to translate cache refs into canvas/worker
payloads. It may query cache registries through adapters. It must not create
media elements, mutate stores, or allocate playback/runtime resources.

Target modules:

```text
src/components/timeline/visualResources/
  resolveTimelineVisualResources.ts
  collectTimelineVisualDemand.ts
  timelineVisualResourceTypes.ts
  adapters/
    thumbnailAdapter.ts
    waveformAdapter.ts
    spectrogramAdapter.ts
    compositionAdapter.ts
    midiAdapter.ts
```

### 4. Paint Plane

Canvas drawing should use one paint IR shared by main-thread canvas and
OffscreenCanvas worker. Main thread and worker may have separate hosts, but they
must not have separate painter logic.

Flow:

```text
TimelineRenderModel + TimelineGeometrySnapshot + TimelineVisualResources
  -> TimelinePaintScene
  -> shared painters
  -> main-thread Canvas2D host or worker Canvas2D host
```

The paint scene is a bounded draw command list, not another source of timeline
truth. It should be chunked by track and visible window so large compositions do
not rebuild the whole scene on small changes.

Target modules:

```text
src/components/timeline/paint/
  buildTimelinePaintScene.ts
  paintSceneTypes.ts
  painters/
    clipBodyPainter.ts
    thumbnailPainter.ts
    waveformPainter.ts
    spectrogramPainter.ts
    compositionPainter.ts
    decorationPainter.ts
    fadePainter.ts
    midiPainter.ts
  hosts/
    TimelineCanvasHost.tsx
    useTimelineCanvasWorkerHost.ts
    timelineCanvasWorkerBridge.ts
```

### 5. Active Interaction Plane

DOM remains for active affordances only:

- hovered clip shell
- active drag/trim/fade shell
- selected keyframe handles
- audio/spectral/video-bake/stem controls
- context-menu anchoring and inline rename

Shell mounting is driven by a `TimelineShellMountModel` built from interaction
state and geometry. Shell components receive geometry records and command
descriptors, not raw clip objects and store callbacks.

Target modules:

```text
src/components/timeline/activeShell/
  buildTimelineShellMountModel.ts
  TimelineShellLayer.tsx
  ClipShellPortal.tsx
  modules/
```

### 6. Command Plane

User gestures become typed timeline commands. Commands either:

- produce a pure edit operation,
- update ephemeral interaction state,
- request visual demand,
- or request runtime leases.

There should not be a global mutable command bus. Use a catalog of typed command
descriptors and pure handlers, then inject the narrow executor at the UI edge.

Target modules:

```text
src/components/timeline/commands/
  timelineCommandTypes.ts
  buildClipCommands.ts
  buildTrackCommands.ts
  buildDropCommands.ts
  buildKeyframeCommands.ts
  executeTimelineCommand.ts
```

External drop belongs here after import/media resolution. `useExternalDrop.ts`
should eventually become a thin hook around:

- media/import resolver
- geometry drop-target resolver
- placement command builder
- timeline edit executor

### 7. Runtime Resource Plane

Runtime media ownership becomes explicit leases:

```ts
const lease = timelineRuntimeRegistry.reserve(descriptor);
lease.release();
```

The existing runtime coordinator is useful, but the current code still has
direct `source.videoElement`, `source.audioElement`, and `source.imageElement`
access in playback, layer sync, serialization, slot grid, and layer builder
paths. Those become compatibility inputs behind runtime providers:

- `VideoFrameProvider`
- `AudioClockProvider`
- `ImageFrameProvider`
- `ModelRuntimeProvider`
- `DataSignalProvider`

Layer building should ask providers for renderable resources. It should not know
whether a resource came from HTML media, WebCodecs, native decoder, cached image,
composition render, model loader, or future arbitrary-file visual signal.

Target modules:

```text
src/services/timeline/runtime/
  TimelineRuntimeRegistry.ts
  leases.ts
  providers/
    videoFrameProvider.ts
    audioClockProvider.ts
    imageFrameProvider.ts
    modelRuntimeProvider.ts
    dataSignalProvider.ts
```

## No-God-Object Safeguards

1. Hard import boundaries:
   - render-model builders cannot import stores, React, canvas, workers, or
     runtime services
   - geometry builders cannot import canvas, stores, or runtime services
   - painters cannot import stores, React, runtime services, or timeline edit
     operations
   - visual resource resolvers cannot import React or mutate timeline state
   - UI hosts can import contracts and executors, but not cache internals

2. Builder fan-out rule:
   - `buildTimelineRenderModel` and `buildTimelineGeometrySnapshot` are
     assemblers only
   - each feature has a local builder with its own tests
   - no assembler should contain business-specific clip feature logic

3. Stable indexes instead of giant object graphs:
   - use `byTrackId`, `byClipId`, and ordered id arrays
   - preserve object identity for unchanged tracks/clips where practical
   - rebuild per track and visible window rather than globally when possible

4. Typed ports over prop bags:
   - replace `TimelineTrackProps` with `TrackRowView`, `TrackRowGeometry`,
     `TrackRowInteractions`, and `TrackRowCommands`
   - replace `CanvasClip` with `PaintClip` derived from render, geometry, and
     visual resources

5. One source per concern:
   - one geometry source
   - one hit-test source
   - one paint IR
   - one shell mount model
   - one runtime lease registry
   - one edit-operation kernel

6. File-size budgets as smoke alarms:
   - contract/types files can be larger but must stay data-only
   - feature modules should stay small enough to review in one pass
   - any file trending past roughly 700 lines needs a named subdomain split
   - any module named `manager`, `service`, `model`, or `builder` must declare
     what it does not own

7. Runtime-free contract tests:
   - render model, geometry snapshot, spatial index, paint scene, worker message,
     and history serialization must reject runtime objects and object URLs unless
     the URL is explicitly media-owned and represented by a media ref

## Phase Order

### Phase 0: Boundary Baseline

- Add or audit guard tests for deleted `TimelineClip.tsx` imports.
- Assert `domClipBodyCount === 0` remains true for passive clip bodies.
- Add import-boundary tests for render model, geometry, painters, and visual
  resources.
- Inventory direct `source.*Element` access by owner and mark compatibility
  paths.

### Phase 1: Presentation Contracts

- Expand current `renderModel/` contracts into normalized render, geometry, and
  spatial-index contracts.
- Add small per-feature builders.
- Add tests proving runtime objects are stripped from builder outputs.
- Build geometry from measured layout inputs, not from duplicated `timeToPixel`
  calls in each component.

### Phase 2: Visual Resource Resolver

- Add resource-ref-to-draw-resource resolver with adapters to current thumbnail,
  waveform, spectrogram, MIDI, composition, transcript, and analysis caches.
- Move visible demand collection out of `TimelineClipCanvas.tsx`.
- Return explicit missing, queued, and degraded states instead of mutating UI
  state from resource resolution.

### Phase 3: Shared Paint IR And Canvas Hosts

- Extract pure painters from `TimelineClipCanvas.tsx`.
- Convert worker and main-thread fallback to consume the same paint scene.
- Move worker lifecycle into a host hook.
- Keep the current canvas component as a compatibility wrapper until the new
  host fully covers normal track rendering and composition-switch rendering.

### Phase 4: Track Row And Shell Split

- Split `TimelineTrack.tsx` into:
  - `TimelineTrackRow`
  - `TimelineTrackCanvasLayer`
  - `TimelineShellLayer`
  - `TimelinePropertyRows`
  - `TimelineTrackDropPreviewLayer`
- Replace shell geometry and hit testing with geometry snapshot records.
- Replace shell store callbacks with command descriptors.

### Phase 5: Root Layout And Section System

- Split `Timeline.tsx` into:
  - `TimelineRoot`
  - `TimelineSectionLayout`
  - `TimelineSplitController`
  - `TimelineSectionScrollController`
  - `TimelineOverlayStack`
  - `TimelineContextMenuLayer`
  - `TimelineNewTrackPreviewLayer`
  - `TimelinePlayheadLayer`
- Move section metrics, split focus, scroll snapping, and track-header width
  resizing into dedicated hooks with tests.

### Phase 6: Command Convergence

- Route clip, keyframe, context-menu, external-drop, tool-pointer, and keyboard
  actions through typed command builders.
- Keep edit operations as the store write kernel.
- Reduce direct `useTimelineStore.getState()` calls in UI gesture code to the
  smallest possible edge.

### Phase 7: Runtime Provider Migration

- Replace direct `source.videoElement`, `source.audioElement`, and
  `source.imageElement` reads with runtime provider calls in layer builder,
  sync managers, slot grid, playback loop, serialization restore, and lazy media
  paths.
- Convert existing retain/report/release helpers into lease handles where
  possible.
- Make visual resource warmups share runtime budget policy but never allocate
  playback resources.

### Phase 8: Future Capability Pass

- Add generic `TimelineSourceKind = data | document | geometry | signal` support
  in render/resource/runtime contracts.
- Make non-video assets produce visual signals through providers rather than
  special-casing every file type in UI components.
- Ensure timeline placement, rendering, export, and cache warmup all consume the
  same source capability descriptors.

### Phase 9: Delete Compatibility Adapters

- Remove `CanvasClip`.
- Remove manual clip geometry from track/canvas/shell files.
- Remove old canvas worker source-clip model after paint IR adoption.
- Remove runtime-bearing clip source access outside explicit compatibility
  modules.
- Collapse obsolete docs into the handoff and mark historical plans clearly.

## Parallel Agent Strategy

Use parallel agents only with disjoint write ownership.

| Agent | Owns | Delivers | Avoids |
|---|---|---|---|
| Contracts | `renderModel/`, geometry, spatial index, contract tests | normalized artifacts and import-boundary tests | UI components and runtime services |
| Visual Resources | `visualResources/`, cache adapters, demand collection tests | resource resolver and visible demand API | canvas drawing and store writes |
| Paint | `paint/`, worker bridge, painter tests | shared paint IR, pure painters, canvas hosts | track/root layout and cache services |
| Track/Shell | track row modules, shell mount model, active shell layer | thin row host and geometry-driven shell | root section layout and paint internals |
| Root/Layout | root timeline modules, section scroll/split hooks, overlay stack | thin `Timeline.tsx` composition shell | track/canvas internals |
| Commands | `commands/`, external drop placement, context-menu/keyframe command tests | typed UI command catalog | runtime/provider code |
| Runtime | runtime providers, layerBuilder/sync migration, lease tests | provider-based media ownership | React timeline files |
| Verifier | test harnesses, diagnostics, bridge smokes, handoff updates | focused verification and regression docs | production code unless assigned |

High-conflict files should be single-owner per phase:

- `Timeline.tsx`
- `TimelineTrack.tsx`
- `TimelineClipCanvas.tsx`
- `TimelineClip.css`
- `TimelineTracks.css`
- `useExternalDrop.ts`
- `src/components/timeline/types.ts`
- `src/stores/timeline/types.ts`
- `applyTimelineEditOperation.ts`
- `LayerBuilderService.ts`
- `VideoSyncManager.ts`
- `AudioTrackSyncManager.ts`

## Focused Test Strategy

Use narrow verification during implementation. Full `npm run build`,
`npm run lint`, and `npm run test` are for normal commit, push, merge, release,
or explicit final readiness.

Core contract tests:

- `timelineRenderModel`
- `timelineGeometrySnapshot`
- `timelineSpatialIndex`
- `timelineVisualResources`
- `timelinePaintScene`
- `timelineCanvasWorkerModel`
- `timelineCanvasDiagnostics`

UI/component tests:

- `TimelineTrack` for shell mount count, no DOM body regression, hit testing,
  and geometry adoption
- `ClipInteractionShell.contract` for command descriptor input/output
- section layout tests for split focus, section scroll, collapsed sections, and
  track height math
- context-menu and external-drop command tests

Runtime tests:

- lazy media/image provider lease creation and release
- history rehydration does not restore live runtime objects
- layerBuilder provider resolution for video/audio/image/model paths
- export, RAM preview, thumbnail, and waveform budget reporting

Performance and browser smokes:

- run canvas/worker smoke only after paint or worker changes
- run bridge playback/export smokes only after runtime, layerBuilder, or sync
  changes
- add one large-composition scroll/playback smoke after Phase 3 and again after
  Phase 5

Type checks:

- run `npx tsc -p tsconfig.app.json --noEmit --pretty false` after broad
  contract or prop migration changes
- run targeted ESLint on touched React files after hook/component extraction

## First Implementation Slice

The first slice should create the narrow waist without touching root layout.

1. Add normalized presentation input types:
   - `TimelinePresentationInput`
   - `TimelineLayoutMeasurementInput`
   - `TimelineInteractionInput`

2. Add pure builders:
   - `buildRenderClip`
   - `buildRenderTrack`
   - `buildTimelineRenderModel`
   - `buildClipBodyGeometry`
   - `buildTrackLaneGeometry`
   - `buildTimelineGeometrySnapshot`
   - `buildTimelineSpatialIndex`

3. Add runtime-free tests:
   - builder output is structured-clone-safe
   - `File`, DOM elements, object URLs, functions, symbols, cyclic data, and
     non-plain objects are rejected or stripped
   - geometry/hit testing matches current `timeToPixel` behavior for normal
     clips, trimmed clips, hovered clips, and offscreen clips

4. Add `resolveTimelineVisualResources` with a temporary adapter from current
   `CanvasClip` fields to resource payloads.

5. Wire one normal `TimelineTrack` canvas seam through:

```text
raw store/media/UI input
  -> TimelineRenderModel
  -> TimelineGeometrySnapshot
  -> TimelineVisualResources
  -> current TimelineClipCanvas compatibility adapter
```

6. Do not start by splitting `Timeline.tsx`. Do not migrate composition-switch
   canvas rendering in the first slice. Do not change runtime provider ownership
   in the first slice unless a direct dependency blocks the presentation seam.

Suggested focused checks for this slice:

```bash
npm run test -- tests/unit/timelineRenderModel.test.ts tests/unit/timelineCanvasDiagnostics.test.ts tests/unit/TimelineTrack.test.tsx tests/unit/timelineClipCanvasWorkerModel.test.ts
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

## Success Criteria

- `Timeline.tsx`, `TimelineTrack.tsx`, and `TimelineClipCanvas.tsx` become thin
  hosts rather than places where timeline truth is computed.
- Passive visual rendering stays canvas-only.
- Active DOM shells mount only from a shell mount model.
- Canvas worker and main-thread fallback share one paint scene and painter set.
- Hit testing, drag/drop, selection, shell placement, and canvas drawing use the
  same geometry snapshot.
- Runtime media resources are leased through providers, not stored or resurrected
  through timeline clips.
- New source kinds can enter through source capabilities, visual resources, and
  runtime providers without editing root timeline UI.
