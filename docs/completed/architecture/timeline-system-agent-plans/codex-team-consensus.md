> Status: Completed archive. This file is kept for historical context and must not be treated as active work unless explicitly reopened.

# Codex Team Timeline Consensus

Date: 2026-06-07

## Current Consensus

Final Codex Team consensus: build the refactor around a first-class timeline
domain package and a one-directional projection pipeline, not around moving code
out of large files. The large files shrink because the boundaries become real.
Risk and churn are not constraints for this planning exercise, so the target
architecture should not preserve component-owned contracts, construction flags,
or runtime-bearing frame payloads for short-term convenience.

### Target Architecture

```text
plain store/media/overlay inputs
  -> TimelineProjectionInput
  -> TimelineLayoutModel
  -> TimelineRenderModel
  -> TimelineViewProjection
  -> TimelineGeometrySnapshot + TimelineSpatialIndex
  -> TimelineResourceDemand + ResourceSnapshot
  -> TimelineFrame (pure epoch/coherence envelope)
  -> TimelineCanvasResourceLeaseSet
  -> TimelinePaintIR
  -> thin canvas host + thin active shell + one hit-test authority
  -> typed interaction sessions / intents
  -> edit-operation kernel or named runtime command
```

The existing `renderModel/`, `geometry.ts`, `interactionShell/`, edit-operation
kernel, worker contract, and runtime coordinator are the raw material. The pure
contracts should be promoted into a dedicated `src/timeline/` domain package
during the contract phase, with compatibility barrels under
`src/components/timeline/` only as short-lived adapter debt. No parallel
`viewModel/` package should be created, and no second copy of the contracts
should exist.

### Final Decisions

1. **Promote pure timeline contracts out of React components.**
   Agent 1 kept the contracts under `src/components/timeline/renderModel/`.
   That is expedient but architecturally wrong for the final system: layout,
   projection, source-kind contributors, resource demand, hit testing, command
   descriptors, and runtime demand are domain contracts, not component internals.
   The final source of truth is a moved package:

   ```text
   src/timeline/
     model/
       layout/       time-domain layout intents and builders
       render/       semantic render model and visual descriptors
       projection/   viewport projection, geometry, spatial index, picks
       frame/        epoch/coherence envelope and invariants
     sources/        source-kind contributor contracts and registry
     resources/      pure demand keys, resource snapshots, lease contracts
     interaction/    picks, shell mount records, session contracts
     commands/       intents and command routing contracts
     runtime/        runtime-demand and reservation-facing contracts
     revisions/      invalidation impact and revision-index contracts
   ```

   Existing `src/components/timeline/renderModel/**` and pure
   `interactionShell` type paths may re-export during migration, but those
   compatibility barrels are adapter debt. They may contain only re-exports, no
   logic. Each barrel ships with a debt entry and a deletion test. Pure shell
   mount/module/pick/session contracts move to `src/timeline/interaction`; the
   React shell components, DOM refs, styling, and host composition stay under
   `src/components/timeline/`.

2. **Reject a long-lived construction flag.**
   Opus 3's default-off `timelineRenderModelPath` would preserve two runtime
   paths through the highest-conflict code and invite permanent parity debt.
   The final policy is direct seam migration: when one normal track is wired
   through the new path, that seam uses the new path by default. Temporary
   adapters are allowed; a product/runtime construction flag is not. Old-vs-new
   comparison belongs in fixture tests, test-only differential harnesses, and
   adapter parity assertions, not in a shipped dual branch. If an emergency
   kill-switch becomes unavoidable during implementation, it must be owned,
   default-on for the new path, dev-only or build-stripped, and paired with a
   deletion test in the next phase.

3. **Split layout from projection.**
   Accept Opus 3's strongest idea: introduce a time-domain
   `TimelineLayoutModel` that changes on edits, ordering, lane assignment, and
   track sizing, then project it through a cheap `TimelineViewProjection` into
   the existing `TimelineGeometrySnapshot`. Scroll and zoom must not rebuild the
   semantic render model.

4. **Use a pure frame as a coherence envelope, not a god object.**
   Accept Opus 1's `TimelineFrame` concept, modified by Opus 3's epoch rule and
   Agent 2's resource-ownership challenge. `TimelineFrame` should contain
   clone-safe references and resource status, not raw graphics/runtime handles:

   ```ts
   interface TimelineFrame {
     epoch: number;
     layout: TimelineLayoutModel;
     render: TimelineRenderModel;
     projection: TimelineViewProjection;
     geometry: TimelineGeometrySnapshot;
     index: TimelineSpatialIndex;
     resourceSnapshot: TimelineResourceSnapshot; // ids, status, demand, missing
   }
   ```

   `buildTimelineFrame` is composition-only: it stamps one epoch and assembles
   independently built artifacts. It must not contain per-source or per-clip
   field logic. Actual `ImageBitmap`, `OffscreenCanvas`, transferred buffers,
   waveform columns, GPU-adjacent handles, and cache leases live outside the
   frame in a `TimelineCanvasResourceLeaseSet` owned by the resource layer.

5. **Use explicit per-entity revision tokens.**
   Incremental projection should not depend on deep equality or structural
   hashing. Add an explicit `TimelineEntityRevisionIndex` maintained by the
   timeline mutation gateway. It is store-owned but non-persisted, so persisted
   clip records do not gain noisy `rev` fields. Edit operations emit a
   `TimelineMutationImpact` describing affected clips, tracks, keyframes,
   property rows, layout domains, and render/resource hints. The mutation
   gateway applies the edit and bumps the revision index atomically.

   Legacy direct mutation actions are not allowed to mutate silently. Until they
   are migrated, they must go through a legacy adapter that records either exact
   affected entities or an explicit broad invalidation. Overlay/session state
   owns overlay revisions, viewport/scroll/zoom owns projection revisions, and
   cache/resource arrivals own resource epochs. Builders consume one combined
   `TimelineInvalidationSnapshot` and key caches from revision tokens plus
   viewport/window inputs.

6. **Make projection incremental and windowed.**
   Accept Opus 1 and Opus 2's structural-sharing and dirty-region emphasis.
   Builders should use per-entity revision tokens, visible-window plus overscan
   inputs, and stable object identity for unchanged clips/tracks. Resource demand
   should be O(visible), not O(all clips).

7. **Use an open typed source-kind registry, not a closed union.**
   Accept Opus 2's registry as the primary extensibility mechanism and keep Opus
   3's discriminated visual descriptors, but combine them as an open descriptor
   map instead of a central closed union. The final TypeScript mechanism is
   interface augmentation plus a checked registry:

   ```ts
   export interface TimelineSourceKindMap {
     video: { visual: TimelineVideoVisual; resources: TimelineVideoResourceDemand };
     audio: { visual: TimelineAudioVisual; resources: TimelineAudioResourceDemand };
     image: { visual: TimelineImageVisual; resources: TimelineImageResourceDemand };
     signal: { visual: TimelineSignalVisual; resources: TimelineSignalResourceDemand };
     unknown: { visual: TimelineUnknownVisual; resources: TimelineUnknownResourceDemand };
   }

   export type TimelineSourceKind = keyof TimelineSourceKindMap & string;

   export type TimelineClipVisual<K extends TimelineSourceKind = TimelineSourceKind> =
     { kind: K } & TimelineSourceKindMap[K]['visual'];
   ```

   Future source packages augment `TimelineSourceKindMap` and register a
   `TimelineSourceKindContributor<K>`. The app-level registry is built with
   `defineTimelineSourceContributor(...)` and `satisfies` checks so built-in
   kinds are covered at compile time. Runtime/project-load coverage tests fail
   when a encountered kind has no contributor. Truly untyped file formats map to
   the built-in `unknown` or `signal` contributor with a format subtype; core
   code does not weaken to arbitrary string switches.

   Core builders, projection, hosts, hit testing, and command code must not gain
   new closed switches for PDF, glTF, STEP, CSV, point clouds, or other formats.
   The registry owns:

   - render summary / visual descriptor creation
   - resource demand description
   - optional geometry decorations
   - optional runtime-need description
   - optional passive badges and format status

8. **Use a two-stage resource system with explicit leases.**
   Accept Opus 3's pure key derivation plus acquisition split, and Opus 2's
   reconciler epochs/cancellation. Stage 1 derives resource keys/demand from the
   frame window and contributor registry in `src/timeline/resources`; it is
   pure, clone-safe, and imports no React, stores, caches, DOM, media globals, or
   services. Stage 2 lives behind resource providers/cache adapters under the
   services/canvas resource layer. It resolves cache-backed draw resources,
   schedules prepare requests, and returns leases; it never allocates media
   elements, mutates the timeline store, or reaches into React components.

   `TimelineFrame.resourceSnapshot` carries keys, status, missing/queued states,
   demand reason, and resource epoch only. Actual `ImageBitmap`, transferred
   buffers, waveform columns, worker handles, and GPU-adjacent payloads live in
   `TimelineCanvasResourceLeaseSet`:

   ```ts
   interface TimelineCanvasResourceLeaseSet {
     frameEpoch: number;
     resourceEpoch: number;
     resources: ReadonlyMap<TimelineResourceKey, TimelineResourceLease>;
     release(): void;
   }
   ```

   The cache owns allocation, eviction, and disposal. A lease pins a handle until
   release. Worker transfer is an explicit ownership transition on the lease and
   requires worker acknowledgement before final release. Async arrivals are
   epoch-checked; stale arrivals are dropped and released, while current arrivals
   coalesce into one redraw/resource-epoch update.

9. **Keep one geometry and hit-test authority.**
   Accept all three Opus plans here. No component should compute clip rectangles
   from threaded `timeToPixel`/`pixelToTime` closures once the projection path is
   live. Pointer dispatch, drop targets, marquee, context menus, shell mounts,
   and transition zones use `TimelineSpatialIndex` and typed pick results.

10. **Use one paint IR and one painter set.**
    Accept all three Opus plans. Main-thread canvas and worker rendering consume
    the same `TimelinePaintIR` and painter modules. Worker parity is verified by a
    draw-call recorder or equivalent mock context. `CanvasClip` is transitional
    debt and must be deleted after the canvas host consumes frame records and
    resolved resources directly.

11. **Include hit-test and shell proof in the first vertical slice.**
    Agent 1 left this as "where practical." The consensus now makes it required
    for a bounded subset. The first slice is accepted only when one normal track
    uses the new path by default for passive canvas input, body/trim/fade handle
    picking, and shell mount records from the new geometry/spatial index. It must
    flow through:
    `ProjectionInput -> LayoutModel -> RenderModel -> Projection -> Geometry ->
    SpatialIndex -> ResourceDemand/ResourceSnapshot -> resource leases ->
    temporary CanvasClip adapter`.

    The slice may keep legacy callbacks behind a temporary pick-to-callback
    adapter and does not need to migrate every drag, drop, marquee, keyframe, or
    menu command. It is not accepted if it only lands unused pure builders, if it
    spreads rich `TimelineClip` data into the adapter, if runtime objects enter
    the frame, or if the new path is hidden behind a default-off flag. Required
    proof: old-vs-new geometry and hit-test differential fixtures for the slice,
    clone-safety/runtime-leak fuzzing, field coverage for any `CanvasClip`
    visual still bridged by the adapter, and adapter-debt deletion tracking.

12. **Pull commands/sessions before track/root dissolution.**
    Accept Opus 1's ordering over Opus 2/3's later command phase. `TimelineTrack`
    and `Timeline.tsx` cannot become thin while they still thread raw interaction
    state and dozens of callbacks. After the vertical slice proves the frame path,
    introduce typed sessions/intents so previews remain transient and commits
    route through `applyTimelineEditOperation` or named runtime commands.

13. **Runtime convergence is a parallel lane.**
    Accept Opus 2's reservation-handle target and Opus 1/3's timing. Runtime
    allocation should move toward `reserve() -> { accepted, descriptor, release }`
    while retain/release remains a legacy adapter. UI/render/shell code expresses
    demand only; playback/export/RAM-preview/background services own allocation
    under coordinator policies.

14. **Mechanize no-god-object rules.**
    Accept all three Opus plans. Add CI-grade guards early: import boundaries,
    dependency-direction tests, clone-safety fuzzing, frame invariants, geometry
    import-absence tests, prop-count caps, line/complexity budgets, source-kind
    registry coverage, field coverage for retiring `CanvasClip`, and adapter
    debt deletion tests. Budgets are role-based and ratcheting: legacy god files
    get explicit temporary exceptions owned by their dissolution phase, while new
    files must fit their role from day one. Final caps: `Timeline.tsx <= 700`,
    track row host `<= 400`, canvas host `<= 350`, `buildTimelineFrame <= 80`,
    composer modules `<= 120`, leaf builders `<= 250`, paint modules `<= 220`,
    and public host prop contracts `<= 12` fields. Type-only contract files can
    have separate symbol-count checks so the budget does not encourage empty
    wrapper files.

15. **Use CSV/JSON data signal as the first non-core source proof.**
    The first proof beyond video/audio/image should be a data-signal contributor
    that renders CSV/JSON as a sparkline or heat-strip preview. It exercises the
    universal-media goal, contributor registry, visual descriptors, resource
    demand, missing-state handling, and paint IR without requiring a heavyweight
    document or 3D runtime. PDF/SVG and glTF/model previews remain important
    follow-up proofs, but data-signal is the cleanest first architecture test.

### Phase Plan

1. **Domain contracts and guardrails.**
   Promote pure timeline contracts into `src/timeline/` without forking them.
   Add layout, projection, frame, spatial-index, resource-demand/snapshot/lease,
   source-kind contributor, intent/session, revision-index, and reservation
   contracts. Add architecture guard tests before widening the implementation.
   Compatibility barrels under component paths are allowed only with deletion
   tests or adapter-debt entries.

2. **Direct vertical slice on one normal track.**
   Wire one real track through:
   `ProjectionInput -> LayoutModel -> RenderModel -> Projection -> Geometry ->
   SpatialIndex -> ResourceDemand/ResourceSnapshot -> resource lease ->
   temporary CanvasClip adapter`. Include geometry-driven body/handle picking
   and shell mount records for that track. Do not hide the new path behind a
   default-off runtime flag; use differential tests and temporary adapters for
   safety.

3. **Resource ownership and canvas convergence.**
   Complete the epoch-aware resource reconciler, formalize cache/lease ownership
   for `ImageBitmap`, waveform buffers, worker transfer handles, and eviction,
   introduce paint IR, make worker and main-thread painting share implementation,
   then delete `CanvasClip` and duplicate draw paths.

4. **Interaction sessions and command bus.**
   Migrate drag, trim, fade, marquee, region select, playhead scrub, keyframe,
   context-menu, and external drop workflows to typed preview/commit/cancel
   lifecycles. Previews are overlay/frame input; commits are edit operations or
   runtime commands.

5. **Track row dissolution.**
   Collapse `TimelineTrackProps` into grouped contracts:
   `trackView`, `frameSlice`, `interactionView`, `dispatch`, and measured refs.
   Extract shell mount/module builders from the current inline closures and make
   them consume geometry records.

6. **Root dissolution.**
   Split `Timeline.tsx` into root shell, section layout, overlay/menu/playhead,
   new-track zones, composition-switch, and focused hooks. Root consumes frame
   sections and dispatches intents; it does not own per-clip math.

7. **Runtime reservation sweep.**
   Continue in parallel but close here: audit `source.*Element` access, adapt
   retain/release call sites, keep diagnostics allocation-free, and ensure
   runtime policy reporting covers new demand paths.

8. **Source-kind proof and cleanup.**
   Prove the all-media architecture by migrating remaining source switches into
   contributors and adding at least one non-video/audio/image contributor path
   as a real contract proof. Remove transitional adapters and compatibility
   barrels, update docs, and run final gates when the user asks for readiness.

### Explicit Opus Idea Disposition

- **Opus 1 accepted:** frame envelope, incremental derivation, resource resolver
  as keystone, single hit-test authority, early interaction sessions, paint IR,
  vertical slice, mechanical guardrails.
- **Opus 1 modified:** `TimelineFrame` should also carry the time-domain layout
  and projection epoch, but it should not carry raw draw handles. The resource
  resolver should become an epoch-aware reconciler with pure key derivation and
  explicit resource leases.
- **Opus 1 rejected:** a source-kind model that relies mostly on adding resolver
  branches and paint ops without a contributor registry is not enough for the
  June 2026 universal-media target.

- **Opus 2 accepted:** contract-first phase framing, windowed/incremental
  projection, source-kind contributor registry, resource epochs/cancellation,
  reservation handles, dependency-direction enforcement, adapter-debt discipline.
- **Opus 2 modified:** command/intent convergence should move earlier than its
  Phase G, because it is required to shrink track/root contracts cleanly. The
  contracts should move to `src/timeline/` instead of remaining component-owned.
- **Opus 2 rejected:** "no edits to resolver for new source kinds" is too strong
  unless the resolver delegates entirely through contributors. The consensus
  version allows the resource system to stay stable while contributors provide
  per-kind resource descriptions.

- **Opus 3 accepted:** layout/projection split, coherence epoch, two-stage
  resource resolver, vertical seam first, golden differential/hit-test parity,
  and extending `renderModel/` rather than forking it.
- **Opus 3 modified:** the discriminated visual model should be contributor-led
  and extensible through an open descriptor map. Avoid a closed union that forces
  central type edits for every new file kind.
- **Opus 3 rejected:** a default-off construction flag is no longer accepted as a
  consensus requirement. It preserves dual runtime paths in exactly the files the
  refactor is meant to simplify.

## Resolved Questions

Agent 3 resolves the remaining Codex Team questions as follows:

1. **`src/timeline/` migration shape.**
   Move pure contracts and builders into `src/timeline/` during the contract
   phase. Component-path barrels are temporary re-export-only adapter debt with
   deletion tests. Pure interaction shell contracts move; React shell hosts and
   styles stay under `src/components/timeline/`.

2. **Construction flag policy.**
   Do not ship a default-off construction flag. The first migrated seam uses the
   new path by default. Old-vs-new comparison is handled by tests and temporary
   adapters. Any emergency kill-switch is dev/build-stripped, default-new-path,
   owner-assigned, and deleted in the next phase.

3. **Hybrid contributor/visual typing.**
   Use module-augmentable `TimelineSourceKindMap` plus
   `defineTimelineSourceContributor(...)` and `satisfies` registry checks. The
   built-in `unknown`/`signal` contributors handle untyped formats; core code
   does not switch on arbitrary format strings.

4. **First-slice acceptance.**
   The first slice must be a real one-track vertical seam: canvas input,
   resource snapshot/leases, geometry-driven body/handle picking, and shell
   mount records. It may bridge to legacy callbacks and `CanvasClip`, but only
   through debt-tracked adapters that do not carry runtime objects or rich clip
   spreads.

5. **Revision/invalidation ownership.**
   The edit-operation mutation gateway owns persisted edit invalidation and
   maintains a non-persisted `TimelineEntityRevisionIndex` from emitted
   `TimelineMutationImpact` records. Overlay, projection, and resources own
   their own revision/epoch domains and feed a combined invalidation snapshot to
   builders.

6. **Resource resolver boundaries.**
   Stage 1 pure demand derivation lives in `src/timeline/resources`. Stage 2
   acquisition lives behind resource providers/cache adapters, returns explicit
   lease sets, owns worker transfer acknowledgement, and never imports React,
   mutates store, or allocates media elements.

7. **Budget and source proof.**
   Enforce role-based ratcheting budgets with temporary legacy exceptions only
   for god files under active dissolution. Use CSV/JSON data-signal preview as
   the first non-core source-kind proof.

No remaining Codex Team dissent is recorded. Implementation may still discover
local code constraints, but the architecture direction above is the final Codex
Team output for the cross-team synthesis.

## Turn Log

### 2026-06-07 - Codex Team Agent 1

Replaced the pending consensus with the first draft.

Accepted decisions:

- Existing `renderModel/`, `geometry`, `interactionShell`, edit-operation,
  worker, and runtime-coordinator contracts are the foundation.
- Add `TimelineLayoutModel` plus `TimelineViewProjection` so scroll/zoom only
  project stable layout into pixel geometry.
- Use `TimelineFrame` as an epoch-stamped coherence envelope, not a derivation
  god object.
- Make builders incremental, windowed, structurally shared, and store-free.
- Use a source-kind contributor registry as the universal-media extension seam.
- Use a two-stage, epoch-aware resource reconciler.
- Enforce one geometry authority, one spatial-index hit-test authority, one
  paint IR, and one painter set.
- Pull interaction sessions and command routing before track/root dissolution.
- Run runtime reservation adoption as a parallel lane.
- Add mechanical architecture guards at the start.

Changes to consensus architecture:

- Combined Opus 1's frame, Opus 2's registry/reconciler, and Opus 3's
  layout/projection split into one pipeline.
- Reframed the phase order around contracts, one-track vertical proof,
  canvas/resource convergence, commands, track/root dissolution, runtime sweep,
  and source-kind proof.
- Made transitional adapters explicit debt with deletion tests.

What Agent 2 should challenge next:

- Whether the vertical slice should use a default-off construction flag.
- Whether the source-kind contributor typing is actually extensible and still
  type-safe.
- Whether hit-test and shell proof belong in the first slice.
- Whether explicit per-entity store revisions are required.
- Whether the resource ownership boundary is sharp enough to delete `CanvasClip`
  without reintroducing runtime objects through worker/cache handles.

### 2026-06-07 - Codex Team Agent 2

Challenged Agent 1's draft and revised the current consensus at the top.

Accepted decisions:

- Kept the one-directional projection pipeline and the layout/projection split.
- Kept `TimelineFrame`, but narrowed it to a pure epoch/coherence envelope.
- Kept incremental/windowed projection and made explicit revision tokens the
  consensus direction.
- Kept the source-kind registry, strengthened with open typed visual descriptor
  maps.
- Kept two-stage resource resolution, but added explicit resource leases and
  ownership rules.
- Kept early command/session convergence before track and root dissolution.
- Kept runtime reservation adoption as a parallel lane.
- Kept mechanical no-god-object guardrails as a Phase 1 requirement.

Rejected or modified decisions:

- Rejected Opus 3's default-off construction flag as a consensus requirement.
  Direct seam migration plus differential tests is cleaner than preserving two
  runtime paths.
- Modified Agent 1's "extend `renderModel/` in place" position. Pure timeline
  contracts should move to `src/timeline/`, with component-path re-exports only
  as temporary adapter debt.
- Modified `TimelineFrame.resources` into `TimelineFrame.resourceSnapshot`.
  Actual `ImageBitmap`, worker-transfer, waveform, GPU-adjacent, and cache
  handles belong to resource leases outside the pure frame.
- Modified the source-kind decision into a hybrid: contributor registry plus
  open discriminated visual descriptor map. A closed union remains rejected.
- Modified the first vertical slice. It must include geometry-driven body/handle
  hit testing and shell mount records for one normal track, but it should not
  migrate every interaction command in that slice.
- Rejected structural hashing as the primary incremental-build mechanism.
  Revision tokens should come from an explicit, non-persisted revision index
  maintained by edit operations and legacy mutation adapters.

What Agent 3 should resolve:

- Finalize the `src/timeline/` package map and compatibility-barrel deletion
  policy.
- Choose the exact TypeScript mechanism for open source-kind visual descriptors.
- Define the `TimelineEntityRevisionIndex` API and how edit operations report
  affected entities.
- Define the canvas resource lease API, especially `ImageBitmap` lifecycle,
  worker transfer ownership, eviction, and release timing.
- Set initial line/complexity budgets that stop god objects without encouraging
  empty wrapper files.
- Choose the first non-core source-kind proof target.

### 2026-06-07 - Codex Team Agent 3

Resolved Agent 2's open questions and made the top section the final Codex Team
consensus.

Accepted decisions:

- Promoted pure timeline contracts/builders to `src/timeline/` with a concrete
  package map. Component-path compatibility barrels are re-export-only adapter
  debt with deletion tests.
- Moved pure interaction shell contracts to `src/timeline/interaction` while
  leaving React shell hosts and styles in the component tree.
- Rejected a shipped default-off construction flag. Direct seam migration plus
  test-only differential comparison is the final policy.
- Settled source-kind typing on a module-augmentable
  `TimelineSourceKindMap`, contributor factory, and `satisfies`-checked registry.
- Defined first-slice acceptance: one real normal-track vertical seam, including
  canvas input, resource snapshot/leases, body/handle picking, and shell mount
  records from the new geometry path.
- Assigned revision ownership to the timeline mutation gateway and a
  non-persisted `TimelineEntityRevisionIndex`, with separate overlay,
  projection, and resource epoch domains.
- Split resource boundaries into pure demand derivation in `src/timeline` and
  lease-backed acquisition behind resource providers/cache adapters.
- Settled role-based ratcheting budgets and selected CSV/JSON data-signal
  preview as the first non-core source proof.

Changes to consensus architecture:

- Replaced the remaining "Open Disagreements" list with resolved decisions and
  an explicit no-dissent statement.
- Added exact migration, invalidation, resource lease, construction-flag, and
  source-kind typing policies to the top-level consensus.
- Clarified that `TimelineFrame` remains pure and that actual draw/runtime
  handles live only in `TimelineCanvasResourceLeaseSet`.

Remaining dissent:

- None recorded for the Codex Team. The remaining work is implementation and
  cross-team synthesis, not an unresolved Codex Team architecture dispute.
