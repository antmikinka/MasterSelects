# Timeline System Refactor Plan

> Supersedes `docs/refactor/Timeline-Refactor-Plan.md` and all older timeline
> extraction notes.
>
> Canonical architecture source:
> `docs/refactor/timeline-system-agent-plans/cross-team-final-synthesis.md`.
>
> Agent execution source:
> `AGENTS.md` / `CLAUDE.md`, section
> `6A. Timeline Refactor Agent Execution Protocol`.

## Goal

Rebuild the timeline around a pure `src/timeline/**` kernel and thin hosts. This
is not a file split and not a compatibility patch. The large files shrink because
timeline truth moves into narrow contracts, small pure engines, and explicit
service/store/host boundaries.

Risk and churn are acceptable when they move toward the clean long-term
architecture. Do not preserve old runtime/render paths for convenience.

## Non-Negotiables

- New durable timeline logic lives under `src/timeline/**`.
- `src/components/timeline/**` becomes host code: React, DOM, canvas lifecycle,
  shell mounting, and event wiring only.
- `src/services/timeline/**` owns cache/runtime allocation, leases, workers,
  warmups, and resource acquisition.
- `src/stores/timeline/**` owns state application and edit appliers.
- No full passive DOM clip renderer. Do not restore `TimelineClip.tsx`.
- No long-lived `CanvasClip` bridge.
- No runtime-bearing projection/render/paint data.
- No new god objects or broad helper bags.
- Full build/lint/test is not the normal slice loop. Gate-specific and
  touched-area checks are the default.

## Current Baseline

Current large timeline-related files at this planning checkpoint:

| File | Lines | Refactor Pressure |
|---|---:|---|
| `src/components/timeline/Timeline.tsx` | 4122 | Root orchestration, section layout, menus, split focus, overlays, pointer behavior. |
| `src/components/timeline/TimelineClipCanvas.tsx` | 3544 | Passive canvas drawing, cache demand, worker prep/lifecycle, diagnostics. |
| `src/services/layerBuilder/VideoSyncManager.ts` | 3487 | Video playback/runtime sync and source-field handling. |
| `src/stores/timeline/keyframeSlice.ts` | 2452 | Keyframe state/actions and compatibility logic. |
| `src/services/layerBuilder/AudioTrackSyncManager.ts` | 2218 | Audio playback/runtime sync and source-field handling. |
| `src/stores/timeline/clipSlice.ts` | 2212 | Clip mutations and compatibility actions. |
| `src/components/timeline/hooks/useExternalDrop.ts` | 2171 | External drop/import/new-track placement. |
| `src/components/timeline/TimelineTrack.tsx` | 1819 | Track row, hit testing, shell mounting, canvas shaping, keyframe rows. |
| `src/stores/timeline/editOperations/applyTimelineEditOperation.ts` | 1550 | Typed edit operation execution. |
| `src/stores/timeline/serializationUtils.ts` | 1369 | Timeline load/save restore helpers. |
| `src/stores/timeline/types.ts` | 1330 | Timeline state/action contracts. |

Important existing facts:

- `src/components/timeline/TimelineClip.tsx` is deleted.
- Passive clip bodies render through `TimelineClipCanvas`.
- Active clip DOM goes through `ClipInteractionShell`.
- `src/components/timeline/renderModel/types.ts` and `geometry.ts` contain useful
  contracts to migrate, not permanent component-owned homes.
- `TimelineClipCanvas.tsx` still defines broad `CanvasClip` data. That type is
  transitional debt and must be deleted through Phase 3 gates.
- `src/types/index.ts` still contains runtime-bearing source fields. The first
  implementation packets must account for this before treating `src/types/**` as
  a clean kernel input.
- `src/services/timeline/timelineVisualDemand.ts` already exists with a
  render-loop-gating meaning. Do not reuse that name for kernel resource demand
  without renaming/isolation.

## Target Architecture

```text
src/types/                         app-wide type tier; needs runtime-field split
src/timeline/
  contracts/
    schema/                        runtime-free timeline descriptor views
    editOps/                       edit operation vocabulary
    cache/                         cache/resource demand vocabulary
    runtime/                       resource-kind/policy/reservation vocabulary
    demand/                        pure visual/resource status vocabulary
    commands/                      command descriptor vocabulary
  projection/
    TimelineProjection
    TimelineProjectionLayout
    TimelineProjectionTiming
  geometry/
    TimelineGeometrySnapshot
    TimelineSpatialIndex
    VisibleSet
  resources/
    TimelineVisualResourceDemand   avoids service timelineVisualDemand collision
    RuntimeProviderDemand
    ResourceResolution             pure { facetId, status }
  paint/
    TimelinePaintPacket
  commands/
    classifyTimelineCommand
    planTimelineEditCommand
    planTimelineServiceCommand
  architecture/
    gateRegistry
    laneWriteManifest
    adapterDebtLedger
    exitCriteriaCoverage

src/components/timeline/           thin hosts
src/services/timeline/             cache/runtime implementation and leases
src/stores/timeline/               state application and edit appliers
```

Dependency rule: `src/timeline/**` may import only `src/timeline/**` and clean
runtime-free type/schema modules. If `src/types/**` still exposes DOM/runtime
source fields, introduce a narrowed schema view before kernel code depends on
it.

## First Implementation Packet

Do not begin by splitting `Timeline.tsx`, `TimelineTrack.tsx`, or
`TimelineClipCanvas.tsx`.

The first packet creates the architecture registry and root coherence gate:

- `src/timeline/architecture/gateRegistry*`
- `src/timeline/architecture/laneWriteManifest*`
- `src/timeline/architecture/adapterDebtLedger*`
- `src/timeline/architecture/exitCriteriaCoverage*`
- `src/timeline/architecture/testMigrationLedger*`
- `src/timeline/architecture/retiredPathLedger*`
- `P1_ARCHITECTURE_REGISTRY_COHERENT`

The first packet exits only when these gates are green:

- `P1_ARCHITECTURE_REGISTRY_COHERENT`
- `P1_KERNEL_IMPORT_BOUNDARY`
- `P1_LOC_BUDGET_ENFORCED`
- `P1_SCHEMA_RUNTIME_FREE_BOUNDARY`
- `P1_VISUAL_DEMAND_NAME_ISOLATED`
- `P1_HIGH_CONFLICT_OWNERSHIP_COMPLETE`
- `P1_TEST_AND_RETIRED_PATH_CLASSIFICATION`

`P1_ARCHITECTURE_REGISTRY_COHERENT` is an always-on test. It proves:

- every gate id is registered exactly once
- every gate is `active`, `satisfied`, or `retired`
- retired gates have `retiredByGate`
- every lane has a write set and exit gates
- every high-conflict file has exactly one active owning lane
- every adapter debt entry has owner, write set, introduced phase, and delete
  gate
- every `activeUntilGate`, `acceptanceTests`, and `deleteBy` tag resolves to a
  registered gate
- every retired old path has a delete gate, importer owner, or explicit keep
  reason
- every affected old test has `port`, `replace`, `split`, `delete`, or `keep`
  classification

The other P1 gates make the registry match reality:

- `P1_KERNEL_IMPORT_BOUNDARY`: `src/timeline/**` imports only
  `src/timeline/**` and runtime-free schema/type modules. It may not import
  React, components, stores, services, workers, DOM/runtime allocation code, or
  broad helper bags.
- `P1_LOC_BUDGET_ENFORCED`: architecture tests enforce the no-god-object file
  budgets and forbidden names/patterns below, with temporary exceptions only
  through debt entries.
- `P1_SCHEMA_RUNTIME_FREE_BOUNDARY`: the kernel schema view excludes `File`,
  DOM elements, `VideoFrame`, `GPUTexture`, WebCodecs/native decoder handles,
  blob URLs, functions, and runtime ids.
- `P1_VISUAL_DEMAND_NAME_ISOLATED`: the kernel visual-resource demand concept
  cannot collide with existing render-loop gating in
  `src/services/timeline/timelineVisualDemand.ts`.
- `P1_HIGH_CONFLICT_OWNERSHIP_COMPLETE`: the lane manifest covers all current
  god files, dirty overlapping files, and write-set transfers before parallel
  work starts.
- `P1_TEST_AND_RETIRED_PATH_CLASSIFICATION`: known affected tests and old paths
  are classified before code movement.

This packet is intentionally small. It exists so parallel agents can work from
machine-checkable coordination instead of prose.

## No-God-Object Safeguards

The plan explicitly accounts for preventing new god objects and big files.
These safeguards are enforced by `P1_LOC_BUDGET_ENFORCED` and subsequent
change-triggered architecture checks:

| Area | Budget / Rule |
|---|---|
| React host components | Target <= 400 LOC each; root shell <= 700 LOC. |
| Pure builders/planners | Target <= 250 LOC per file and no source-kind switches outside registries. |
| Paint modules | Target <= 200 LOC per painter/facet module. |
| Registry/contributor modules | Target <= 300 LOC per source/capability module. |
| `buildTimelineFrame` / equivalent envelope | Composition-only, target <= 80 LOC, no per-clip feature logic. |
| Shared helpers | No generic `helpers.ts` / `utils.ts` dumping ground; helpers live beside their domain. |
| Import direction | Kernel cannot import React, stores, components, service implementations, workers, or runtime allocation code. |
| Fan-in | Any new module imported by many lanes must be reviewed as a potential new god object. |
| High-conflict files | One owner at a time through `laneWriteManifest`. |

Explicitly forbidden new god-object names/patterns:

- broad `viewModel/`
- stateful `timelineCommandBus`
- giant `buildTimelineRenderModel`
- generic `timelineHelpers`
- canvas worker/main renderer split with duplicated feature logic
- contributor registry that becomes a source-kind switch in disguise

## Retired Code And Unused Path Deletion Policy

The plan explicitly accounts for deleting old unused code. Each legacy path
touched by the refactor must be classified in the architecture registry or
handoff as one of:

- `delete now`: no new-path dependency remains, remove it in the current slice.
- `delete at gate`: transitional debt with owner, write set, introduced phase,
  delete gate, and replacement coverage.
- `move to importer`: old-project compatibility only, isolated at the load
  boundary and forbidden from runtime/editor/render paths.
- `keep`: still part of the target architecture, with a named reason.

Deletion candidates include:

- `CanvasClip` and the temporary adapter once paint packets are direct.
- passive DOM/render helper paths after shell/canvas ownership is replaced.
- duplicated worker/main painter logic after paint packets converge.
- manual `timeToPixel` geometry scattered in root, track, canvas, or shell code
  after geometry snapshots own mapping.
- direct callback plumbing replaced by command planners and host dispatch.
- runtime-bearing restore/source compatibility inside editor/runtime paths.
- stale refactor docs that point agents back to superseded `renderModel/**`
  ownership.
- orphan tests that only assert deleted compatibility behavior.

No old path may survive a phase exit by being hidden behind a flag or unused
fallback. It must either pass its delete gate, move to the importer lane, or be
recorded as explicit keep/debt with an owner and next removal gate.

## Test Migration And Deletion Policy

Tests move with behavior, not old file names. For each retired module/path, the
owning lane must classify affected tests as:

- `port`: same user-visible behavior, rewritten against new kernel contracts,
  hosts, stores, or services.
- `replace`: old implementation test replaced by a gate/parity/integration
  test that proves the new architecture.
- `split`: test contains both target behavior and rejected legacy internals;
  port/replace target behavior and delete legacy assertions at the owning gate.
- `delete`: test only asserts removed compatibility, fallback, adapter, or
  legacy internals.
- `keep`: still valid for target behavior and not coupled to retired internals.

Deletion is allowed and expected for tests that only protect legacy behavior
the plan has rejected, such as permanent `CanvasClip` semantics, passive DOM
clip rendering, flag-disabled alternate paths, or old-project restore logic
inside the editor/runtime pipeline. User-visible behavior coverage should be
ported or replaced before the old test is removed.

Initial known classifications:

| Test | Classification | Replacement / Gate |
|---|---|---|
| `tests/unit/timelineRenderModel.test.ts` | `port` | Move to kernel projection/geometry tests for `P2_GEOMETRY_HIT_PARITY` and `P2_CLONE_SAFE_PROJECTION`. |
| `tests/unit/timelineClipCanvasWorkerModel.test.ts` | `replace` | Replace worker message/eligibility structure assertions with contributor/paint-packet gates. |
| `tests/unit/TimelineClipCanvasWorkerRuntime.test.tsx` | `split` | Port host/runtime behavior; delete assertions that preserve `CanvasClip` shape or worker/main fallback split after Phase 3. |
| `tests/stores/timeline/trackSlice.test.ts` | `keep` | Store behavior coverage; keep outside kernel. |
| `tests/unit/blobUrlManager.test.ts` | `keep` | Runtime/resource service coverage; never move into `src/timeline/**`. |

The first architecture packet may add more rows, but it may not remove these
classifications without replacing them with stricter entries.

## Initial Debt Ledger Seeds

The first registry packet should seed at least these debt entries:

| Debt | Owner Lane | Delete / Split Gate |
|---|---|---|
| `CanvasClip` data-shape and field-coverage matrix | Projection/Canvas adapter | `P2_CANVASCLIP_FIELD_COVERAGE`, `P3_CANVASCLIP_DELETED` |
| `CanvasClip` runtime-bearing fields such as `File` and source handles | Schema/runtime cleanup | `P1_SCHEMA_RUNTIME_FREE_BOUNDARY`, `P3_CANVASCLIP_ADAPTER_REMOVED` |
| `CanvasClip` worker message, fallback lifecycle, resource warmups, diagnostics | Paint/runtime host | `P3_WORKER_TO_PAINT_PACKET_PARITY`, `P3_ADAPTER_DEBT_LEDGER_CLEARED` |
| `timelineClipCanvasWorkerModel.ts` source-kind switches and LOC overage | Paint contributors | `P2_NO_SOURCE_KIND_SWITCH`, `P3_WORKER_TO_PAINT_PACKET_PARITY` |
| `interactionShell/**` callback bags and app/store-shaped refs | Shell/commands | `P2_SHELL_CONTRACT_NARROW` |
| `useExternalDrop.ts` direct clip/track creation and source-specific branches | Commands/import | `P2_DROP_COMMAND_PLANNER_PARITY`, `P4_IMPORTER_LEGACY_QUARANTINE` |
| `serializationUtils.ts` runtime restore compatibility | Importer quarantine | `P4_IMPORTER_LEGACY_QUARANTINE` |
| `VideoSyncManager.ts` and `AudioTrackSyncManager.ts` direct source handles | Runtime provider | `P4_RUNTIME_PROVIDER_DEMAND_ADOPTED`, `P4_TIMELINE_STATE_RUNTIME_HANDLES_REMOVED` |

## Phase 2: First Real Vertical Slice

After the full P1 gate suite exists, prove one normal track end-to-end:

```text
store/media/overlay inputs
  -> TimelineProjection
  -> TimelineGeometrySnapshot + TimelineSpatialIndex
  -> VisibleSet
  -> TimelineVisualResourceDemand/ResourceResolution
  -> temporary CanvasClip adapter
  -> current canvas draw path
```

Also prove geometry-driven hit testing and shell mounting for that same track.

Phase 2 exits only when these gates are green:

- `P2_PROJECTION_LAYOUT_TIMING_KEYS`
- `P2_CLONE_SAFE_PROJECTION`
- `P2_CANVASCLIP_FIELD_COVERAGE`
- `P2_CANVASCLIP_RUNTIME_FIELD_MATRIX`
- `P2_CANVASCLIP_ADAPTER_NARROW`
- `P2_GEOMETRY_HIT_PARITY`
- `P2_GEOMETRY_SINGLE_SOURCE_NO_SCATTERED_TIME_TO_PIXEL`
- `P2_SCROLL_NO_GEOMETRY_REBUILD`
- `P2_EDIT_DISPATCH_BODY_TRIM_FADE`
- `P2_DROP_COMMAND_PLANNER_PARITY`
- `P2_DISPATCH_PURITY`
- `P2_NO_SOURCE_KIND_SWITCH`
- `P2_SOURCE_TYPE_TO_FACET_NORMALIZATION`
- `P2_SHELL_CONTRACT_NARROW`
- `P2_LANE_TRANSFER_BLOCKED`

`P2_CLONE_SAFE_PROJECTION` and `P2_CANVASCLIP_RUNTIME_FIELD_MATRIX` should reuse
the existing runtime-reference detection ideas from
`src/components/timeline/renderModel/types.ts` rather than inventing a weaker
clone-safety check.

## Phase 3: Remove Passive Render Adapter

Move canvas rendering to paint packets and delete `CanvasClip`.

Phase 3 exits only when these gates are green:

- `P3_CANVAS_HOST_DIRECT_PAINT_PACKET`
- `P3_PAINT_RESOURCE_TABLE_HOST_JOIN`
- `P3_RESOURCE_RESOLUTION_CLONE_SAFE`
- `P3_LEASE_RELEASE_TRANSFER_ACK`
- `P3_WORKER_TO_PAINT_PACKET_PARITY`
- `P3_PAINT_PACKET_STRUCTURAL_PARITY`
- `P3_PAINT_RASTER_PARITY`
- `P3_WORKER_TRANSFER_MEMORY_BOUNDED`
- `P3_CANVASCLIP_DELETED`
- `P3_CANVASCLIP_ADAPTER_REMOVED`
- `P3_ADAPTER_DEBT_LEDGER_CLEARED`

Expensive raster/memory gates are `phase-exit` and `change-triggered`, not
required after every tiny edit.

## Phase 4: Runtime, Store, And Importer Cleanup

Phase 4 exists so the refactor does not stop after canvas cleanup while the
largest runtime/store files remain god objects.

Move runtime handle ownership out of timeline state and editor/render paths.
Runtime allocation flows from `RuntimeProviderDemand` into services and leases.
Project-load compatibility, if kept, becomes a quarantined one-way importer.

Phase 4 exits only when these gates are green:

- `P4_RUNTIME_PROVIDER_DEMAND_ADOPTED`
- `P4_VIDEO_SYNC_SOURCE_HANDLES_REMOVED`
- `P4_AUDIO_SYNC_SOURCE_HANDLES_REMOVED`
- `P4_TIMELINE_STATE_RUNTIME_HANDLES_REMOVED`
- `P4_STORE_SLICE_GOD_FILES_SPLIT`
- `P4_EDIT_OPERATION_APPLIER_NARROW`
- `P4_IMPORTER_LEGACY_QUARANTINE`
- `P4_SERIALIZATION_RUNTIME_FREE_EDITOR_PATH`
- `P4_DROP_IMPORT_COMMANDS_ROUTED`
- `P4_RUNTIME_RESOURCE_TESTS_KEPT_OUT_OF_KERNEL`

Primary write scopes:

- `src/services/layerBuilder/VideoSyncManager.ts`
- `src/services/layerBuilder/AudioTrackSyncManager.ts`
- `src/stores/timeline/clipSlice.ts`
- `src/stores/timeline/keyframeSlice.ts`
- `src/stores/timeline/editOperations/**`
- `src/stores/timeline/serializationUtils.ts`
- `src/components/timeline/hooks/useExternalDrop.ts`
- runtime/project-load restore modules
- runtime/resource helpers such as `src/stores/timeline/helpers/blobUrlManager.ts`

## Parallel Agent Model

Use the execution protocol in `AGENTS.md` / `CLAUDE.md` section 6A.

Parallel agents must state:

- lane name
- intended write set
- forbidden files
- gates to satisfy
- focused checks to run
- progress marker

High-conflict files are single-owner:

- `src/components/timeline/Timeline.tsx`
- `src/components/timeline/TimelineTrack.tsx`
- `src/components/timeline/TimelineClipCanvas.tsx`
- `src/components/timeline/types.ts`
- `src/components/timeline/hooks/useExternalDrop.ts`
- `src/stores/timeline/clipSlice.ts`
- `src/stores/timeline/keyframeSlice.ts`
- `src/stores/timeline/editOperations/**`
- `src/services/layerBuilder/VideoSyncManager.ts`
- `src/services/layerBuilder/AudioTrackSyncManager.ts`
- runtime/project-load restore modules once the legacy/importer lane starts

Do not let two agents race these files. Sequence ownership through
`laneWriteManifest`.

## Verification Budget

Run checks to prove gates.

Default loop:

1. Gate-specific tests.
2. Unit tests for touched builders/contracts/hosts/stores/services.
3. Touched-file ESLint only for lint-sensitive React/TS edits.
4. `npx tsc -p tsconfig.app.json --noEmit --pretty false` only after public
   contract, import-boundary, or cross-lane type changes.
5. Bridge/browser smokes only for rendering, worker, hit-test, playback, export,
   or project-load behavior changes.
6. Full `npm run build`, `npm run lint`, and `npm run test` only for normal
   commit, push, merge, release, final readiness, or explicit user request.

Do not repeat broad checks that already passed on the exact same HEAD.

## Clean Rebuild And Legacy Policy

The new timeline architecture is a clean rebuild, not a compatibility layer for
old runtime/render shapes. Old saved projects do not justify keeping legacy code
inside the new timeline pipeline.

Allowed:

- active DOM shells
- lightweight drag/drop previews
- an optional one-way project importer:
  `old project JSON -> new data-only timeline schema`

Not allowed:

- full passive DOM clip bodies
- selected-only DOM clip bodies
- `TimelineClip.tsx`
- ongoing legacy runtime/render compatibility paths
- `source.videoElement`, `source.audioElement`, `source.imageElement`, `File`,
  blob URL, cache handle, or transferable values in projection/render/paint
- old-project restore logic inside `src/timeline/**`, canvas hosts, worker draw
  code, runtime allocation, or editor interaction

## Current Pre-Implementation Fixes

Before large implementation lanes start:

1. Create architecture registry files and `P1_ARCHITECTURE_REGISTRY_COHERENT`.
2. Decide the clean `src/types` / runtime-field split or narrowed schema view.
3. Rename/isolate the new resource-demand concept to avoid collision with
   `src/services/timeline/timelineVisualDemand.ts`.
4. Add `CanvasClip` field-coverage matrix/test.
5. Add the current runtime/project-load restore files to lane ownership before
   enforcing data-only state.
