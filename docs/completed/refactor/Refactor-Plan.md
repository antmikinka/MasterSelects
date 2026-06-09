# Refactor Plan Index

Status: Completed archive
Last updated: 2026-06-09

This index records the completed large-file and maintainability cleanup pass.
All plan documents are currently archived under `docs/completed/`; `docs/ongoing/`
is intentionally empty until new work is opened.

## Completed Architecture Refactors

| Area | Current state | Archive |
|---|---:|---|
| Timeline system | Done; timeline target files are all <= 700 LOC | `docs/completed/architecture/Timeline-System-Refactor-Plan.md` |
| Timeline legacy split | Superseded by the completed timeline-system refactor | `docs/completed/architecture/Timeline-Refactor-Plan.md` |
| LayerBuilder | Done for the old god-file plan; old `src/services/layerBuilder.ts` no longer exists | `docs/completed/architecture/LayerBuilder-Refactor-Plan.md` |
| WebGPU engine | Done | `docs/completed/architecture/WebGPUEngine-Refactor-Plan.md` |
| FrameExporter | Done | `docs/completed/architecture/FrameExporter-Refactor-Plan.md` |
| MediaStore | Done | `docs/completed/architecture/MediaStore-Refactor-Plan.md` |
| ClipSlice | Done | `docs/completed/architecture/ClipSlice-Refactor-Plan.md` |

## Residual Large-File Snapshot

The latest local LOC scan still shows large source files outside the completed
timeline/LayerBuilder refactor scope. They are recorded here as context only,
not as active work:

| File | LOC | Status |
|---|---:|---|
| `src/components/panels/MediaPanel.tsx` | 5544 | Context only |
| `src/components/panels/flashboard/FlashBoardComposer.tsx` | 3565 | Context only |
| `src/components/export/ExportPanel.tsx` | 3108 | Context only |
| `src/components/panels/flashboard/FlashBoard.css` | 3054 | Context only |
| `src/services/proxyFrameCache.ts` | 2909 | Context only |
| `src/services/aiTools/handlers/timelineCanvasSmoke.ts` | 2907 | Context only |
| `src/services/aiTools/bridge.ts` | 2779 | Context only |
| `src/components/preview/Preview.tsx` | 2561 | Context only |
| `src/engine/render/RenderDispatcher.ts` | 2331 | Context only |
| `src/engine/WebCodecsPlayer.ts` | 2224 | Context only |

## Timeline/LayerBuilder Closure Snapshot

These formerly high-pressure files are below the current 700 LOC target:

| File | LOC |
|---|---:|
| `src/components/timeline/Timeline.tsx` | 676 |
| `src/components/timeline/TimelineTrack.tsx` | 633 |
| `src/components/timeline/TimelineClipCanvas.tsx` | 415 |
| `src/components/timeline/TimelineHeader.tsx` | 326 |
| `src/services/layerBuilder/LayerBuilderService.ts` | 439 |
| `src/services/layerBuilder/VideoSyncManager.ts` | 579 |
| `src/services/layerBuilder/AudioTrackSyncManager.ts` | 607 |
| `src/stores/timeline/index.ts` | 356 |
| `src/stores/timeline/clipSlice.ts` | 533 |
| `src/stores/timeline/keyframeSlice.ts` | 522 |
| `src/stores/timeline/editOperations/applyTimelineEditOperation.ts` | 555 |
| `src/stores/timeline/types.ts` | 69 |

## Archived Refactor Plans

- `docs/completed/refactor/Code-Cleanup-Plan.md`
- `docs/completed/refactor/Agent-Context-Performance-Maintainability-Plan.md`
- Broader implementation and feature plans under `docs/completed/plans/`
- Feature-specific plans under `docs/completed/features/`

## Rule

Do not use archived completed plans as active work instructions. Use them only
for historical context, final architecture decisions, and verification evidence.
