# Timeline Cross-Team Final Synthesis

Date: 2026-06-07

Source memory:

- `codex-team-consensus.md`
- `opus-team-consensus.md`
- `cross-team-dialogue.md` (40 turns)
- first-round individual plans in this folder

## Final Consensus

Refactor the timeline into a pure `src/timeline/` kernel feeding a
layout/projection/geometry/demand/resolution/paint-packet pipeline. React
components become hosts. Services own cache/runtime allocation. Store slices own
state application. The architecture is enforced by an executable gate matrix
rooted in `P1_ARCHITECTURE_REGISTRY_COHERENT`.

This is not a file split. The large files shrink because timeline truth moves
into narrow, testable, pure contracts and small engines.

## Clean Rebuild And Legacy Policy

The default implementation posture is a clean rebuild of the timeline
architecture, not preservation of old runtime/render paths.

Do not keep compatibility modes inside the new timeline pipeline. In particular:

- no legacy passive DOM renderer
- no runtime-bearing render/project models
- no long-lived `CanvasClip` bridge
- no old `source.videoElement` / `source.audioElement` /
  `source.imageElement` access in UI, render, worker, projection, or paint
- no project-load path that mutates the new runtime shape to satisfy old data

If opening older saved projects remains useful, handle it as a quarantined,
one-way import migrator at the project-load boundary:

```text
old project JSON -> import/migration adapter -> new data-only timeline schema
```

That migrator is optional, separately owned, and not allowed to leak into
`src/timeline/**`, canvas rendering, runtime allocation, or editor interaction.
The timeline refactor is not blocked by old-project compatibility. If the team
chooses a fully fresh cut, old projects can be treated as unsupported until a
separate importer is written.

## Target Shape

```text
src/types/                         app-wide type tier; needs runtime-field split
src/timeline/
  contracts/
    schema/                        timeline descriptor views over src/types
    editOps/                       operation vocabulary
    cache/                         cache-lane/resource-demand vocabulary
    runtime/                       resource-kind/policy/reservation vocabulary
    demand/                        pure visual/resource status vocabulary
    commands/                      command descriptor vocabulary
  projection/
    TimelineProjection             semantic model
    TimelineProjectionLayout       lane/row/section structural sub-view
    TimelineProjectionTiming       timing/range/linkage sub-view
  geometry/
    TimelineGeometrySnapshot
    TimelineSpatialIndex
    VisibleSet
  resources/
    TimelineVisualResourceDemand     avoid existing service VisualDemand name
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

src/services/timeline/             cache/runtime implementations and leases
src/components/timeline/           thin React/canvas/shell hosts
src/stores/timeline/               state application and edit appliers
```

`src/timeline/**` may import only `src/timeline/**` and clean runtime-free type
schema modules. Today `src/types/index.ts` still exposes runtime-bearing fields,
so the first packets must either split those fields out or introduce a narrowed
runtime-free schema view before kernel code depends on them. Timeline-owned
vocabularies currently sitting in store/service folders should move into
`src/timeline/contracts/**`. Store/service implementations import the kernel,
not the other way around.

## Key Decisions

1. **One canonical projection model.**
   Use `TimelineProjection` as the semantic artifact. It contains exported,
   budgeted sub-contracts: `TimelineProjectionLayout` and
   `TimelineProjectionTiming`. This avoids a fourth top-level model while still
   making layout stability testable.

2. **Scroll does not rebuild geometry.**
   `geometryEpoch = hash(layoutVersion, timingVersion, zoomVersion)`. Raw scroll
   drives only visible-window queries and paint-time translation.

3. **One `VisibleSet`, many keys.**
   A single membership query returns `VisibleSet { clipIds, rowIds, facetIds,
   tileBands }`. Demand, shell, and paint keys are pure projections of that one
   set, preventing drift.

4. **Facet ownership is explicit.**
   `facetId` is opaque and namespaced by `facetKind`. Every `facetKind` has one
   owning capability/contributor. Core geometry/window/demand code never
   switches on source kind.

5. **Visual resource demand and runtime demand are separate.**
   Use a distinct kernel name such as `TimelineVisualResourceDemand` to avoid
   colliding with existing `src/services/timeline/timelineVisualDemand.ts`,
   which means render-loop gating today. The kernel visual-resource demand is
   provider-agnostic: `{ facetKind, facetId, missingState }`. Runtime allocation
   flows only through `RuntimeProviderDemand`. Unknown or unsupported facets
   downgrade to missing-state visuals without entering the scheduler or
   coordinator.

6. **Resource status is pure; handles are leased outside the kernel.**
   Kernel contracts own `ResourceResolution { facetId, status }`. Service/canvas
   code owns `TimelineCanvasResourceLeaseSet`, keyed by the same ids, carrying
   `ImageBitmap`, typed arrays, transferables, and release/ACK behavior.

7. **Commands are pure until the host dispatch seam.**
   Kernel exports `classifyTimelineCommand` and pure planners. The host owns
   `dispatchTimelinePlan(plan)`. Edit plans route to store appliers; service
   intents route to existing service adapters. Runtime provider leases still
   originate from demand, not command planners.

8. **No long-lived construction flag.**
   Temporary adapters are allowed only as visible debt. A shipped default-off
   alternate path is rejected. Differential behavior belongs in tests.

9. **`CanvasClip` deletion is gate-bound.**
   `CanvasClip` is transitional debt. It is deleted once the canvas host consumes
   `TimelinePaintPacket + TimelinePaintResourceTable` directly and field
   coverage is green. Debt entries carry owner, lane, write set, introduced
   phase, and delete gate.

10. **Parallel work is manifest-controlled.**
    `laneWriteManifest` plus `laneConflictMatrix` prevents two lanes from
    writing the same god-file concurrently. Ownership transfers through the
    manifest, not chat memory.

11. **Retired paths are deleted, not hidden.**
    Old unused render/runtime/editor paths are classified as `delete now`,
    `delete at gate`, `move to importer`, or `keep`. A phase cannot exit with an
    old path surviving as a flag-disabled fallback or quiet compatibility mode.

12. **Tests migrate by behavior, not filename.**
    Old implementation tests are ported, replaced, split, deleted, or kept
    explicitly. Tests that only assert rejected legacy fallback behavior are
    deleted once the replacement behavior/parity gate exists.

13. **P1 gates must match the codebase, not only the registry.**
    The first packet includes executable import-boundary, LOC-budget,
    runtime-free-schema, high-conflict-ownership, visual-demand-name, and
    test/retired-path classification gates. A coherent registry alone is not
    enough to start broad implementation.

14. **Runtime/store cleanup is a required phase.**
    Canvas cleanup is not the end of the refactor. `VideoSyncManager`,
    `AudioTrackSyncManager`, timeline store slices, edit appliers,
    `serializationUtils`, and external-drop/import paths get their own
    runtime-provider/importer phase.

## First Implementation Packet

Build the executable architecture registry before moving large code:

- `gateRegistry`
- `laneWriteManifest`
- `adapterDebtLedger`
- `exitCriteriaCoverage`
- `testMigrationLedger`
- `retiredPathLedger`
- `P1_ARCHITECTURE_REGISTRY_COHERENT`

The first packet exits only when the P1 gate suite is green:

- `P1_ARCHITECTURE_REGISTRY_COHERENT`
- `P1_KERNEL_IMPORT_BOUNDARY`
- `P1_LOC_BUDGET_ENFORCED`
- `P1_SCHEMA_RUNTIME_FREE_BOUNDARY`
- `P1_VISUAL_DEMAND_NAME_ISOLATED`
- `P1_HIGH_CONFLICT_OWNERSHIP_COMPLETE`
- `P1_TEST_AND_RETIRED_PATH_CLASSIFICATION`

`P1_ARCHITECTURE_REGISTRY_COHERENT` is an `always` gate. It asserts:

- every `activeUntilGate`, `acceptanceTests` id, and `deleteBy` tag resolves to
  exactly one registered gate
- every god-file has one owning lane
- every gate id is exactly one of `active`, `satisfied`, or `retired`
- retired gates have `retiredByGate`
- no active lane lacks registered exit gates
- no adapter debt lacks owner/write-set/delete gate
- no retired old path lacks delete gate, importer owner, or explicit keep reason
- no affected test lacks `port`, `replace`, `split`, `delete`, or `keep`
  classification

The remaining P1 gates make the registry executable against the filesystem:
kernel import boundaries, LOC budgets/forbidden names, runtime-free schema,
visual-demand naming isolation, high-conflict ownership coverage, and known
test/retired-path classifications must all be machine-checked.

Initial test classifications:

| Test | Classification |
|---|---|
| `tests/unit/timelineRenderModel.test.ts` | `port` |
| `tests/unit/timelineClipCanvasWorkerModel.test.ts` | `replace` |
| `tests/unit/TimelineClipCanvasWorkerRuntime.test.tsx` | `split` |
| `tests/stores/timeline/trackSlice.test.ts` | `keep` |
| `tests/unit/blobUrlManager.test.ts` | `keep` |

This gate suite is the first packet's entry test for later work.

## Phase 2 Exit Gates

The vertical slice exits only when all of these are green:

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

The Phase 2 slice must prove one real normal track end-to-end:

```text
store/media/overlay inputs
  -> TimelineProjection
  -> TimelineGeometrySnapshot + TimelineSpatialIndex
  -> VisibleSet
  -> TimelineVisualResourceDemand + ResourceResolution
  -> temporary CanvasClip adapter
  -> current canvas draw path
```

It must also prove geometry-driven hit testing and shell mounting for that same
track. `Timeline.tsx` is not the starting point.

## Phase 3 Exit Gates

Phase 3 removes the passive-render adapter and moves canvas to paint packets:

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

Each gate is tagged `always`, `phase-exit`, or `change-triggered` so focused
local loops stay fast while expensive raster/memory checks still run when the
phase or changed files require them.

## Phase 4 Exit Gates

Phase 4 removes runtime handles and compatibility behavior from editor/render
paths:

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

## Non-Blocking Tradeoffs

- The contributor/feature registry has real weight. The teams accepted it
  because the universal-media roadmap makes closed source-kind switches worse.
- A scroll-translate fast path is useful but not required for the first packet.

## Pre-Implementation Corrections

Before implementation lanes move large code:

- Reconcile all docs to this `src/timeline/**` target and registry-first packet.
- Add the architecture registry and `P1_ARCHITECTURE_REGISTRY_COHERENT`.
- Split or narrow `src/types/index.ts` so the kernel imports only runtime-free
  schema.
- Rename/isolate the new visual-resource demand concept so it does not collide
  with `src/services/timeline/timelineVisualDemand.ts`.
- Add a `CanvasClip` field-coverage matrix/test before deleting or narrowing the
  adapter.

## Implementation Stance

Start with gates and contracts, then one vertical slice. Do not begin by
splitting `Timeline.tsx`. Do not let adapter debt remain informal. Do not create
another god object named `buildTimelineFrame`, `timelineCommandBus`, `helpers`,
or `viewModel`.

## Spawned-Agent Prompt Contract

Every spawned agent working on this refactor should receive this contract in its
prompt:

```text
You are working on the MasterSelects timeline refactor. Risk/churn is acceptable;
the target is the clean long-term architecture in
docs/refactor/timeline-system-agent-plans/cross-team-final-synthesis.md.

Before editing, read:
- docs/refactor/timeline-system-agent-plans/cross-team-final-synthesis.md
- docs/refactor/Timeline-System-Refactor-Handoff.md
- AGENTS.md / CLAUDE.md section 6A

In your first response, state:
- lane name
- intended write set
- forbidden files
- gates you intend to satisfy
- focused checks you intend to run
- starting progress marker:
  Progress: <lane> 0% | Gate: <gate> | Status: active

Rules:
- Do not edit high-conflict files outside your lane.
- Do not run full build/lint/test unless assigned final readiness, commit/push,
  verifier full-check duty, or explicitly requested.
- Run gate-specific and touched-area checks only.
- Update Timeline-System-Refactor-Handoff.md before ending.
- Final response must list changed files, gates, checks run, skipped checks, and
  next pickup.
- During long runs, report the current progress marker regularly:
  Progress: <lane> <percent>% | Gate: <gate> | Status: <blocked/active/done>
```

This contract exists to prevent repetitive broad checks and uncoordinated
parallel edits even when agents try to be generically "safe." If a higher
priority instruction requires a broader check, the agent should run it and record
why.
