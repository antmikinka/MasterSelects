> Status: Completed archive. This file is kept for historical context and must not be treated as active work unless explicitly reopened.

# Codex Plan Codebase Check

## Verdict: is the plan coherent and implementable against the current codebase?

Yes, with one sequencing correction. The plan is coherent and matches the main
codebase pressures: the timeline already has pure render/geometry contracts, a
canvas-only passive renderer, active DOM shells, cache warmup services, and a
runtime coordinator. It is implementable as a contract-first rebuild.

The required first implementation step should be the architecture registry gate
from `cross-team-final-synthesis.md` and `AGENTS.md` section 6A:
`src/timeline/architecture/gateRegistry*`, `laneWriteManifest*`,
`adapterDebtLedger*`, `exitCriteriaCoverage*`, plus
`P1_ARCHITECTURE_REGISTRY_COHERENT`. `src/timeline/` does not exist yet, so large
code movement before that gate would be under-coordinated.

## Best confirmations from code

- `src/components/timeline/TimelineClip.tsx` is absent. `TimelineTrack.tsx`
  imports `TimelineClipCanvas` and `ClipInteractionShell`, and reports
  `domClipBodyCount: 0` through
  `src/services/timeline/timelineCanvasDiagnostics.ts`.
- `src/components/timeline/renderModel/types.ts` already defines clone-safe
  `TimelineRenderModel`, `TimelineRenderClip`, cache refs, marker summaries, and
  runtime-reference detection via `findTimelineRuntimeReferences`.
- `src/components/timeline/renderModel/geometry.ts` already defines
  `TimelineGeometrySnapshot`, clip body rects, handles, keyframe rows, transition
  junctions, drop targets, marquee exclusions, and rect helpers.
- `tests/unit/timelineRenderModel.test.ts` proves the current render and
  geometry contract shapes are structured-clone-safe, but only with fixture data.
- `TimelineClipCanvas.tsx` still has a broad `CanvasClip` and owns drawing,
  thumbnail/waveform/spectrogram preparation, worker transfer, diagnostics, and
  warmups. This strongly confirms the resource resolver and canvas dissolution
  phases.
- `src/components/timeline/utils/timelineClipCanvasWorkerModel.ts` already emits
  a plain worker draw message, but it still computes `x` and `width` from
  `timeToPixel`, confirming the need for geometry-snapshot adoption.
- `src/services/timeline/runtimeCoordinatorTypes.ts` and
  `runtimeCoordinatorContracts.ts` already define the shipped policy ids:
  `interactive`, `background`, `slot-deck`, `composition-render`, `thumbnail`,
  `render-target`, `ram-preview`, and `export`.
- `src/services/timeline/cacheSchedulerContracts.ts` and the warmup services give
  a useful cache-lane base for resource demand and coalescing.

## Incorrect assumptions or stale parts

- The baseline line counts in `Timeline-System-Refactor-Plan.md` are stale. For
  example, current counts are `Timeline.tsx` 4122 lines,
  `TimelineClipCanvas.tsx` 3544, `VideoSyncManager.ts` 3487,
  `keyframeSlice.ts` 2452, `clipSlice.ts` 2212, `AudioTrackSyncManager.ts` 2218,
  `useExternalDrop.ts` 2171, and `TimelineTrack.tsx` 1819.
- The handoff's "Recommended First Slice" says to start with Phase 1 plus 1.5,
  but the synthesis and `AGENTS.md` require the architecture registry first. Use
  the registry-first rule.
- There is a folder-location mismatch: the synthesis targets pure contracts under
  `src/timeline/**`, while the plan still says to keep geometry under
  `src/components/timeline/renderModel/`. The first gate should codify the
  intended migration path and import rules.
- `src/services/timeline/timelineVisualDemand.ts` is currently render-loop demand
  gating, not the planned provider-agnostic `VisualDemand`. Reusing that name
  risks a same-name/different-concept collision.
- `TimelineClipCanvas.CanvasClip` still includes `file?: File`, waveform arrays,
  rich `audioState`, `analysis`, `midiData`, and `source`. The temporary adapter
  must be explicit debt, not treated as already clean.
- `ClipInteractionShellClipRef` still picks `source`, `waveform`, `audioState`,
  and `videoState` from `TimelineClip`, so active shells are not yet independent
  of rich clip state.

## Missing risks/gaps

- No field-coverage map exists from current `CanvasClip` visuals to
  `TimelineRenderModel`, `TimelineGeometrySnapshot`, resource resolution, and
  paint packets. This is the biggest deletion risk for `CanvasClip`.
- No `VisibleSet`, `TimelineSpatialIndex`, `ResourceResolution`,
  `RuntimeProviderDemand`, `facetId`, or `facetKind` code exists yet.
- `src/types/index.ts` still defines `TimelineClip.file: File` and
  `TimelineClip.source` with `videoElement`, `audioElement`, `imageElement`,
  `webCodecsPlayer`, `nativeDecoder`, `textCanvas`, blob URLs, and runtime ids.
  The data-only schema needs an explicit type strategy, not only UI extraction.
- Runtime-bearing source access also remains in timeline hooks:
  `src/components/timeline/hooks/useLayerSync.ts` and
  `src/components/timeline/hooks/usePlaybackLoop.ts`, not just in
  `src/services/layerBuilder/*`.
- `src/stores/timeline/serializationUtils.ts`, `nestedRestore.ts`,
  `restoredMediaSource.ts`, and `historyTimelineRestoreState.ts` still create or
  restore `File`, blob URL, and runtime source shapes. These are load-boundary
  dependencies for the clean rebuild.
- Worker parity is not only a canvas issue. `TimelineClipCanvas.tsx` creates and
  transfers `ImageBitmap` resources; Phase 3 gates need explicit release/ACK and
  memory-bounded coverage before deleting the adapter.

## Legacy/old-project stance: any codebase implications

The clean-rebuild stance is correct, but current legacy/project-load support is
not quarantined. Project restore and nested restore paths still create
placeholder `File` objects, managed blob URLs, and runtime-bearing source shapes.
If old-project support is kept, it must become a separate one-way importer before
the new timeline schema reaches `src/timeline/**`, canvas hosts, worker draw
code, runtime allocation, or editor interaction. If the team chooses a fresh cut,
tests and docs that currently expect legacy restore behavior need to be retired
or moved to importer coverage.

## Parallel-agent/testing/handoff protocol: sufficient or weak?

Mostly sufficient. The high-conflict file list, lane ownership, focused checks,
and handoff template are strong. The weak points are:

- The lane registry files do not exist yet, so parallel implementation should not
  begin before `P1_ARCHITECTURE_REGISTRY_COHERENT`.
- Current dirty files include `VideoSyncManager.ts`,
  `AudioTrackSyncManager.ts`, `trackSlice.ts`, and blob URL helper/test files.
  Lanes touching those areas need explicit ownership transfer.
- The high-conflict list should include `useLayerSync.ts`, `usePlaybackLoop.ts`,
  `serializationUtils.ts`, and project-load restore modules once runtime/legacy
  convergence starts.
- The protocol says no broad checks during slices, which fits this refactor.
  Review-only work here ran no build, lint, or tests as requested.

## Top 5 recommendations before implementation

1. Create the architecture registry files and
   `P1_ARCHITECTURE_REGISTRY_COHERENT` before moving source code.
2. Resolve the contract namespace decision: either move kernel contracts into
   `src/timeline/**` now or define an explicit transition from
   `src/components/timeline/renderModel/**`.
3. Rename or isolate the planned `VisualDemand` concept to avoid collision with
   existing `src/services/timeline/timelineVisualDemand.ts`.
4. Add a `CanvasClip` field-coverage matrix/test before adapting the normal
   track seam, including thumbnails, waveform, spectrogram, composition, fade,
   MIDI, transcript, analysis, badges, trim ghosts, and missing states.
5. Treat runtime and legacy load paths as first-class lanes: include
   `src/types/index.ts`, `useLayerSync.ts`, `usePlaybackLoop.ts`,
   `serializationUtils.ts`, `nestedRestore.ts`, and layer-builder services in the
   ownership and gate plan before enforcing data-only timeline state.

