# Codex Agent 3 Timeline System Architecture Plan

Independent proposal for the MasterSelects timeline refactor.

This plan optimizes for the best long-term architecture, not the smallest safe
patch. The old DOM clip body renderer is gone and should stay gone. The next
problem is more subtle: clip semantics, geometry, visual resources, hit testing,
canvas painting, active shell mounting, edit commands, and runtime media
ownership are still coupled through large React files and rich clip objects.

## Core Opinion

The timeline should become a pipeline of small pure engines with React hosts at
the edge:

```text
timeline store plain state
  -> projection
  -> geometry and spatial index
  -> visual demand
  -> visual resource resolution
  -> paint packets
  -> canvas host / worker host / shell host / overlays

pointer, keyboard, menu, drop input
  -> geometry hit test
  -> command descriptor
  -> typed edit operation or local UI state change

playback, export, cache, RAM preview, thumbnails
  -> runtime/resource demand
  -> reservation handle
  -> release
```

File splitting should be a consequence of this architecture. It should not be
the primary strategy.

## Assessment Of The Current Plan

The existing `Timeline-System-Refactor-Plan.md` is directionally right:

- keep passive clip bodies canvas-only
- keep DOM for active affordances through `ClipInteractionShell`
- build render and geometry contracts
- add a visual resource resolver
- share worker and main-thread paint logic
- adopt existing runtime coordinator infrastructure instead of rebuilding it

The plan still reads too much like a refactor of files under
`src/components/timeline`. My strongest change is to move the durable timeline
core out of React component ownership.

The durable contracts should live under `src/timeline/`, not under
`src/components/timeline/`. React components should import the timeline core.
The timeline core should never import React, Zustand stores, DOM elements,
browser workers, cache services, or layer-builder services.

## Target Architecture

### Directory Shape

```text
src/timeline/
  projection/
    TimelineProjection.ts
    buildTimelineProjection.ts
    buildTrackProjection.ts
    buildClipProjection.ts
    featureRegistry.ts
    features/
      baseClipFeature.ts
      thumbnailFeature.ts
      waveformFeature.ts
      spectrogramFeature.ts
      compositionFeature.ts
      fadeFeature.ts
      transcriptFeature.ts
      analysisFeature.ts
      midiFeature.ts
      sourceTimingFeature.ts
      badgeFeature.ts
  geometry/
    TimelineGeometrySnapshot.ts
    buildTimelineGeometry.ts
    buildSectionGeometry.ts
    buildTrackGeometry.ts
    buildClipGeometry.ts
    spatialIndex.ts
    hitTesting.ts
  demand/
    TimelineVisualDemand.ts
    collectTimelineVisualDemand.ts
    collectTrackVisualDemand.ts
  resources/
    TimelineVisualResources.ts
    resourceResolverTypes.ts
    resourceCoverage.ts
  paint/
    TimelinePaintPacket.ts
    buildTimelinePaintPackets.ts
    painters/
      paintClipBody.ts
      paintThumbnails.ts
      paintWaveform.ts
      paintSpectrogram.ts
      paintComposition.ts
      paintFade.ts
      paintBadges.ts
      paintMarkers.ts
      paintMidi.ts
    canvas2d/
      drawTimelinePaintPackets.ts
      canvasContextAdapter.ts
  commands/
    TimelineCommand.ts
    buildTimelineCommand.ts
    executeTimelineCommand.ts
    commandTargets.ts
  runtime/
    TimelineRuntimeDemand.ts
    timelineRuntimeReservations.ts

src/components/timeline/
  root/
    TimelineRoot.tsx
    useTimelineStoreInputs.ts
    useTimelineMeasurements.ts
  sections/
    TimelineSectionView.tsx
    TimelineSplitLayout.tsx
    sectionScrollController.ts
  tracks/
    TimelineTrackRow.tsx
    TimelineTrackHeaderLayer.tsx
    TimelinePropertyRows.tsx
  canvas/
    TimelineCanvasLayer.tsx
    useTimelineCanvasHost.ts
    useTimelineCanvasWorker.ts
    useTimelineCanvasDiagnostics.ts
  shells/
    TimelineInteractionShellLayer.tsx
    buildShellModel.ts
  overlays/
    TimelineOverlayLayer.tsx
    TimelineMenuLayer.tsx
    TimelineDropPreviewLayer.tsx
```

Existing `src/components/timeline/renderModel/*` can be re-exported from the new
core during migration, then deleted once imports are moved. Keeping the durable
core outside `components` is worth the churn because playback, export, workers,
tests, and future non-React surfaces should not depend on a component path.

### Projection Engine

Projection is the semantic timeline snapshot: what exists and what it means
before pixels are assigned.

It owns:

- track rows and section membership
- clip timing, source kind, labels, state, palette
- feature summaries and cache refs
- interaction overlays as semantic states
- selected, hovered, disabled, muted, locked, hidden states

It must not own:

- `File`
- object URLs
- DOM elements
- `ImageBitmap`
- WebCodecs players
- HTML media elements
- workers
- cache payloads
- callbacks

The projection builder must be feature-sliced, not a single large switch.

Each visual feature contributes through a small static spec:

```ts
export interface TimelineProjectionFeature {
  id: string;
  buildClip(input: TimelineClipProjectionInput): TimelineClipFeatureState | null;
  collectDemand?(input: TimelineFeatureDemandInput): TimelineVisualDemand[];
  buildPaint?(input: TimelineFeaturePaintInput): TimelinePaintContribution[];
}
```

This is not a plugin system for users. It is a static internal registry that
keeps waveform, thumbnails, transcript, composition, fade, MIDI, and future data
visuals from becoming one giant builder.

### Geometry Engine

Geometry is the only source of pixel truth.

It drives:

- canvas clip rects
- shell placement
- hit testing
- trim/fade handles
- keyframe rows
- transition drop zones
- marquee exclusions
- external drop targets
- new-track previews
- overlay alignment
- worker draw messages

The current duplication of `timeToPixel`, `pixelToTime`, row offsets,
viewport slicing, trim ghost math, shell handle rects, and hit-test loops should
collapse into `src/timeline/geometry`.

The geometry engine should return:

- `TimelineGeometrySnapshot`
- `TimelineSpatialIndex`
- stable lookup maps by clip id, track id, handle id, drop target id
- structural version keys for cheap invalidation

The spatial index should be per section and per track. Use sorted arrays first:
clips sorted by start/end time, handles by rect, drop targets by rect. Do not
introduce a tree unless tests show sorted arrays are not enough.

### Visual Demand Engine

Visual demand is a first-class stage between geometry and resources.

It answers:

- which clip visual regions are visible
- which thumbnails are needed for which source time ranges
- which waveform refs are needed
- which spectrogram tiles are needed
- which transcript/analysis marker buffers are visible
- which composition segment strips are visible
- which demand is interactive, background, or worker-transferable

It does not fetch, decode, allocate, mutate stores, or create media elements.

This is where viewport overscan belongs. Today overscan is duplicated in
`TimelineTrack.tsx` and `TimelineClipCanvas.tsx`; it should be centralized here.

### Visual Resource Resolver

The resolver maps demand to draw-ready resources.

It owns:

- reading thumbnail cache state
- requesting missing thumbnail warmups through an adapter
- reading waveform/spectrogram artifact caches
- preparing transferable worker resources
- returning missing, queued, ready, and stale states explicitly

It must not:

- create HTML media elements
- import timeline stores
- mutate timeline clips
- hide missing resource states by returning ad hoc fallbacks

This module is the bridge between pure timeline core and existing
`src/services/timeline/*Warmup.ts` services. The core defines interfaces. The
service adapter implements them.

### Paint Engine

`TimelineClipCanvas.tsx` should not contain paint logic.

The paint engine should build domain-specific paint packets:

```text
TimelineProjection + TimelineGeometrySnapshot + TimelineVisualResources
  -> TimelinePaintPacket[]
  -> drawTimelinePaintPackets(ctx)
```

Paint packets should be higher-level than generic canvas commands. They should
describe domain visuals such as clip body, thumbnail strip, waveform columns,
spectrogram raster, badges, markers, fade curve, MIDI bars, and composition
segments. Generic draw-command lists often become slow and hard to debug.

The main thread and worker should use the same packet builder and same painter
modules. The worker may receive serialized packets and transferable resources,
but it should not implement a second visual language.

Worker fallback should mean "same packet could not be drawn in worker", not
"the main thread has a separate renderer".

### React Hosts

React should host outputs from the core.

`TimelineRoot.tsx`:

- reads store selectors
- reads measurements
- builds projection, geometry, demand
- passes models to sections, overlays, and menus

`TimelineSectionView.tsx`:

- owns video/audio section DOM
- owns section scroll controller
- receives section geometry

`TimelineTrackRow.tsx`:

- receives `TrackRowModel`
- renders canvas layer, shell layer, property rows, and drop previews
- does not shape `CanvasClip`
- does not compute geometry

`TimelineCanvasLayer.tsx`:

- owns `<canvas>` lifecycle
- schedules draw/worker draw from paint packets
- reports diagnostics
- does not know rich `TimelineClip`

`TimelineInteractionShellLayer.tsx`:

- mounts shells from `ShellMountModel`
- consumes geometry records
- does not recompute clip rects

### Commands And Input

Do not build a broad event bus.

Use stateless command descriptors:

```text
DOM/pointer/keyboard/menu event
  -> normalized input
  -> geometry hit test
  -> TimelineCommand
  -> executeTimelineCommand
  -> edit operation or local UI action
```

The command executor should route to existing typed edit operations. It must not
become a second timeline store or a second edit-operation implementation.

External drop should be decomposed into:

- input extraction
- media import/adoption
- target resolution from geometry
- placement command
- preview model

`useExternalDrop.ts` should eventually be a hook wrapper around those pure
modules, not the owner of import, placement, preview, and geometry.

### Runtime Ownership

The existing runtime coordinator is the right base, but the public shape should
move from scattered `retain/report/release` calls to reservation handles:

```ts
const reservation = runtimeReservations.reserve(request);
try {
  // use reserved resource
} finally {
  reservation.release();
}
```

Layer builder, sync managers, export, RAM preview, thumbnail generation, and
cache warmups should all express demand through the same reservation vocabulary.

Timeline persisted state and projection must never hold runtime objects. Rich
source fields such as `source.videoElement`, `source.audioElement`,
`source.imageElement`, `file`, and object URLs should be treated as compatibility
debt and pushed behind runtime/source adapters.

## No-God-Object Safeguards

### Import Boundaries

Add tests or lint rules for these import directions:

- `src/timeline/**` must not import `react`, `zustand`, `src/components/**`,
  `src/stores/**`, browser worker files, or runtime services.
- `src/timeline/projection/**` must not import `src/timeline/resources/**`,
  `src/timeline/paint/**`, or `src/timeline/runtime/**`.
- `src/timeline/geometry/**` must not import resources, paint, React, stores,
  or services.
- `src/timeline/paint/**` may import projection, geometry, resources, and
  canvas context adapters only.
- `src/components/timeline/**` may import timeline core and services, but
  should not contain semantic visual logic.

### File And Function Budgets

These are guardrails, not style preferences:

- core aggregator files stay under 200 lines
- feature modules stay under 350 lines
- React host components stay under 400 lines
- painter modules stay under 350 lines
- no single projection, geometry, resource, paint, or command file owns more
  than one feature family
- if a module needs "audio, video, MIDI, composition, transcript, analysis" in
  one file, it is almost certainly becoming a god object

### Feature Slicing

Cross-cutting visual features must own their own small slice:

- projection contribution
- geometry contribution, if needed
- demand contribution
- resource coverage
- paint contribution
- focused tests

Example: waveform logic should not be spread across `TimelineTrack`,
`TimelineClipCanvas`, worker model, and cache warmups. It should have one
feature slice with narrow adapters to resource services and painters.

### Plain Data Contracts

Keep clone-safety tests for:

- projection
- geometry
- visual demand
- resource descriptors
- worker draw packets
- command descriptors

Explicitly reject:

- functions
- symbols
- DOM elements
- `File`
- object URLs
- `ImageBitmap` except inside resource payloads owned by resolver/paint host
- cycles

### Diagnostics As Invariant Checks

Diagnostics should enforce architecture, not just report numbers:

- `domClipBodyCount === 0`
- no active import path to deleted `TimelineClip.tsx`
- worker and main-thread paint packet parity
- projection and geometry are structured-clone-safe
- canvas resource resolution coverage for every current `CanvasClip` visual
- no draw path receives rich `TimelineClip`
- no projection path receives runtime source objects

## Phase Order

### Phase 0: Guardrails And New Core Skeleton

Create the `src/timeline/` skeleton and re-export current render-model types
from the new core. Add import-boundary tests before broad movement starts.

Deliverables:

- `src/timeline/projection`, `geometry`, `demand`, `resources`, `paint`,
  `commands`, `runtime` directories
- compatibility exports from old `components/timeline/renderModel`
- import-boundary tests
- deleted DOM renderer guard
- `domClipBodyCount === 0` guard

### Phase 1: Projection And Feature Registry

Build the semantic projection from plain inputs. Do not touch the big React
files first.

Deliverables:

- `TimelineProjection`
- `buildTimelineProjection`
- base track and clip projection builders
- static feature registry
- feature specs for current canvas visuals
- coverage matrix from old `CanvasClip` fields to projection fields

Exit criteria:

- projection is structured-clone-safe
- rich clips with runtime fields produce clean projection output
- projection covers thumbnails, waveforms, spectrograms, composition visuals,
  fades, source timing, badges, transcript, analysis, MIDI

### Phase 2: Geometry And Spatial Index

Build geometry from projection plus measured layout inputs.

Deliverables:

- section geometry
- track geometry
- clip body geometry
- shell handle geometry
- keyframe row geometry
- drop target geometry
- marquee exclusion geometry
- spatial hit-testing helpers

Exit criteria:

- `TimelineTrack` hit testing can use spatial index
- shell geometry can be built without local `timeToPixel` recomputation
- worker draw messages can consume geometry rects

### Phase 3: Visual Demand And Resource Resolver

Move viewport and cache-demand logic out of canvas host.

Deliverables:

- visible demand collector
- thumbnail range demand
- waveform/spectrogram demand
- transcript/analysis marker demand
- composition segment demand
- resource resolver interfaces
- adapters to existing warmup/cache services
- explicit ready/missing/queued/stale states

Exit criteria:

- canvas host no longer decides which resources to warm
- resolver has tests for every old `CanvasClip` visual payload
- demand is visible-window and overscan based

### Phase 4: Shared Paint Packets And Painter Modules

Replace the duplicated main-thread/worker renderer with one packet language and
one painter set.

Deliverables:

- `TimelinePaintPacket`
- packet builder
- shared canvas 2D painter modules
- worker serialization of paint packets
- main-thread draw path using the same packets
- parity tests against representative visuals

Exit criteria:

- `TimelineClipCanvas.tsx` no longer owns draw functions
- worker and main thread use the same feature painters
- `CanvasClip` is reduced to a temporary adapter or deleted

### Phase 5: Track Row And Shell Host Extraction

Only after projection, geometry, demand, and paint exist should `TimelineTrack`
be dissolved.

Deliverables:

- `TimelineTrackRow.tsx`
- `TimelineCanvasLayer.tsx`
- `TimelineInteractionShellLayer.tsx`
- `TimelinePropertyRows.tsx`
- `ShellMountModel`
- shell active-module builder from projection and geometry

Exit criteria:

- track row props are small and model-driven
- no canvas DTO shaping in track row
- no shell geometry recomputation in track row
- `TimelineTrackProps` no longer acts as a cross-system bucket

### Phase 6: Root, Sections, And Overlays

Split `Timeline.tsx` after the lower-level row/canvas architecture is stable.

Deliverables:

- `TimelineRoot.tsx`
- store input hook
- measurement hook
- split-layout controller
- video/audio section components
- section scroll controller
- menu layer
- overlay layer
- drop preview layer

Exit criteria:

- root composes models and hosts layers
- split focus and section scroll are isolated
- overlays consume geometry instead of recomputing positions

### Phase 7: Command Convergence

Move desktop interactions to command descriptors.

Deliverables:

- command target model
- pointer command builder
- menu command builder
- keyboard command builder
- external drop placement command
- command executor to existing edit operations

Exit criteria:

- blade, trim, fade, drag, menu actions, drop, and range selection resolve
  through geometry hit testing and command descriptors
- command executor does not duplicate edit operation logic
- stale targets produce typed no-ops

### Phase 8: Runtime Reservation Adoption

Adopt existing runtime coordinator through reservation handles.

Deliverables:

- runtime reservation API
- layer-builder source adapter
- video sync adapter
- audio sync adapter
- image source adapter
- export/RAM preview/cache warmup adoption
- audit that projection/persistence exclude runtime objects

Exit criteria:

- direct `source.*Element` access is isolated behind adapters
- allocation and release are paired
- diagnostics updates do not allocate or re-admit resources
- persisted timeline/history state remains runtime-free

### Phase 9: Delete Transitional Paths

Remove compatibility that was only needed during migration.

Deliverables:

- delete `CanvasClip`
- delete old render-model re-export path if fully migrated
- remove duplicate geometry helpers from components
- remove duplicate canvas worker model logic
- update docs and handoff

Exit criteria:

- no active legacy DOM renderer
- no parallel canvas painters
- no rich clip input to canvas
- no runtime objects in projection or persisted timeline data

## Parallel Agent Strategy

Use parallel agents with disjoint write sets. Avoid assigning two agents to the
same hot file in the same phase.

| Agent | Owns | Main Output |
|---|---|---|
| A: Projection | `src/timeline/projection/**`, projection tests | semantic model and feature registry |
| B: Geometry | `src/timeline/geometry/**`, hit-test tests | geometry snapshot and spatial index |
| C: Demand/Resources | `src/timeline/demand/**`, `src/timeline/resources/**`, service adapters | visible demand and cache-resource resolver |
| D: Paint/Worker | `src/timeline/paint/**`, canvas worker packet adapter | shared paint packets and painters |
| E: Track/Shell | `src/components/timeline/tracks/**`, `canvas/**`, `shells/**` | thin track row and shell host |
| F: Root/Layout | `src/components/timeline/root/**`, `sections/**`, `overlays/**` | thin root and section layout |
| G: Commands/Drop | `src/timeline/commands/**`, external drop modules | command descriptors and drop placement |
| H: Runtime | `src/timeline/runtime/**`, `src/services/layerBuilder/**`, runtime tests | reservation adoption and source adapters |
| V: Verifier | tests, diagnostics, docs, handoff | guardrails and focused checks |

High-conflict files must be single-owner:

- `src/components/timeline/Timeline.tsx`
- `src/components/timeline/TimelineTrack.tsx`
- `src/components/timeline/TimelineClipCanvas.tsx`
- `src/components/timeline/hooks/useExternalDrop.ts`
- `src/components/timeline/types.ts`
- `src/stores/timeline/types.ts`
- `src/stores/timeline/editOperations/applyTimelineEditOperation.ts`
- `src/services/layerBuilder/LayerBuilderService.ts`
- `src/services/layerBuilder/VideoSyncManager.ts`
- `src/services/layerBuilder/AudioTrackSyncManager.ts`

Recommended sequencing:

1. A, B, C, D start in parallel on new `src/timeline/**` files and tests.
2. A and B agree on projection ids and geometry ids before E starts.
3. C and D agree on resource payload ownership before worker changes.
4. E migrates one normal track row seam after A/B/C/D have stable contracts.
5. F works after E proves row contracts.
6. G works alongside E/F but only touches command modules until adoption.
7. H works in parallel but avoids UI hot files.
8. V continuously adds guard tests and updates handoff entries.

## Focused Test Strategy

Do not run broad checks after every small edit. Run narrow tests for the
contract or behavior touched.

### Phase 0 Checks

```bash
npm run test -- tests/unit/timelineRenderModel.test.ts tests/unit/timelineCanvasDiagnostics.test.ts
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

Add new import-boundary tests and include them here.

### Projection Checks

```bash
npm run test -- tests/unit/timelineProjection.test.ts tests/unit/timelineProjectionFeatureCoverage.test.ts tests/unit/timelineRenderModel.test.ts
```

Key assertions:

- structured clone safe
- no runtime references
- full field coverage from current `CanvasClip`
- feature registry output is deterministic

### Geometry Checks

```bash
npm run test -- tests/unit/timelineGeometry.test.ts tests/unit/timelineSpatialIndex.test.ts tests/unit/timelineGrid.test.ts
```

Key assertions:

- clip rects match current visible behavior
- hit testing respects z order
- marquee exclusions and drop targets are geometry-derived
- shell handle rects match current behavior

### Demand And Resource Checks

```bash
npm run test -- tests/unit/timelineVisualDemand.test.ts tests/unit/timelineVisualResourceResolver.test.ts tests/unit/timelineThumbnailDbWarmup.test.ts tests/unit/timelineWaveformArtifactWarmup.test.ts tests/unit/timelineSpectrogramArtifactWarmup.test.ts
```

Key assertions:

- demand is viewport and overscan bounded
- resource resolver does not allocate media elements
- missing/queued/stale states are explicit
- worker-transferable payloads are owned and released correctly

### Paint And Worker Checks

```bash
npm run test -- tests/unit/timelinePaintPackets.test.ts tests/unit/timelineClipCanvasWorkerModel.test.ts tests/unit/TimelineClipCanvasWorkerRuntime.test.tsx tests/unit/timelineSpectrogramCanvas.test.ts
```

Run canvas verification only after real draw behavior changes:

```bash
npm run timeline:canvas:verify
```

### Track, Shell, Root Checks

```bash
npm run test -- tests/unit/TimelineTrack.test.tsx tests/unit/timelineToolPointerDispatcher.test.ts tests/unit/timelineToolOverlayLayer.test.ts tests/unit/useTimelineKeyboard.test.tsx
```

Add focused tests for:

- shell mount model
- track row model props
- section split layout
- section scroll controller
- overlay geometry consumption

### Commands And Runtime Checks

```bash
npm run test -- tests/unit/timelineEditOperations.test.ts tests/unit/timelineEditOperationContracts.test.ts tests/unit/timelinePlacementCommands.test.ts tests/unit/timelineRuntimeCoordinatorContracts.test.ts tests/unit/lazyMediaElements.test.ts tests/unit/historyRuntimeRehydration.test.ts tests/unit/exportRuntimeReporting.test.ts tests/unit/ramPreviewRuntimeReporting.test.ts
```

Use bridge/browser smokes only when behavior touched rendering, worker mode,
timeline hit testing, playback, export, or project load.

Full `npm run build`, `npm run lint`, and `npm run test` stay reserved for
normal commit, push, merge, release, or explicit final readiness.

## First Implementation Slice

The first slice should prove the new architecture without touching the root
layout monolith.

### Slice Goal

Render one normal track through:

```text
current store data
  -> new projection
  -> new geometry
  -> new visual demand
  -> new resource resolver adapter
  -> temporary adapter into existing TimelineClipCanvas
```

Then use the same geometry for `TimelineTrack` hit testing and shell placement.

### Files To Create

```text
src/timeline/projection/TimelineProjection.ts
src/timeline/projection/buildClipProjection.ts
src/timeline/projection/buildTrackProjection.ts
src/timeline/projection/buildTimelineProjection.ts
src/timeline/projection/featureRegistry.ts
src/timeline/projection/features/baseClipFeature.ts
src/timeline/projection/features/fadeFeature.ts
src/timeline/projection/features/sourceTimingFeature.ts
src/timeline/projection/features/thumbnailFeature.ts
src/timeline/projection/features/waveformFeature.ts
src/timeline/geometry/TimelineGeometrySnapshot.ts
src/timeline/geometry/buildTrackGeometry.ts
src/timeline/geometry/buildTimelineGeometry.ts
src/timeline/geometry/spatialIndex.ts
src/timeline/geometry/hitTesting.ts
src/timeline/demand/TimelineVisualDemand.ts
src/timeline/demand/collectTrackVisualDemand.ts
src/timeline/resources/TimelineVisualResources.ts
src/timeline/resources/resourceResolverTypes.ts
src/components/timeline/adapters/timelineProjectionToCanvasClip.ts
```

### Files To Touch Minimally

- `src/components/timeline/TimelineTrack.tsx`
- `src/components/timeline/TimelineClipCanvas.tsx` only if a prop adapter is
  unavoidable
- `src/components/timeline/renderModel/index.ts` for compatibility exports

Do not start by splitting `Timeline.tsx`.

### First Slice Tests

Create or extend:

- `tests/unit/timelineProjection.test.ts`
- `tests/unit/timelineProjectionFeatureCoverage.test.ts`
- `tests/unit/timelineGeometry.test.ts`
- `tests/unit/timelineVisualDemand.test.ts`
- `tests/unit/TimelineTrack.test.tsx`

Run:

```bash
npm run test -- tests/unit/timelineProjection.test.ts tests/unit/timelineProjectionFeatureCoverage.test.ts tests/unit/timelineGeometry.test.ts tests/unit/timelineVisualDemand.test.ts tests/unit/TimelineTrack.test.tsx tests/unit/timelineRenderModel.test.ts tests/unit/timelineCanvasDiagnostics.test.ts
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

### First Slice Acceptance

- Projection contains no runtime references even when source clips do.
- Geometry produces the clip rects currently computed inside `TimelineTrack`.
- `TimelineTrack` can hit-test clips through the spatial index.
- `TimelineTrack` can build shell geometry from the geometry snapshot.
- Existing `TimelineClipCanvas` can still draw through a temporary adapter.
- `domClipBodyCount` remains `0`.
- No worker/main-thread visual parity is regressed.

## End State

The end state is not simply "smaller files".

The end state is:

- timeline semantics are pure and reusable
- geometry is centralized
- visible demand is explicit and budgetable
- visual resources are resolved through adapters, not pulled from React
- main-thread and worker canvas use the same paint packets and painters
- React hosts are thin
- commands are descriptors routed to edit operations
- runtime media ownership is reserved and released explicitly
- future media types add feature slices instead of editing timeline monoliths

This architecture is the clean path to the project goal: every file can become
a visual signal without turning `Timeline.tsx`, `TimelineTrack.tsx`, or
`TimelineClipCanvas.tsx` into the place where every new capability has to land.
