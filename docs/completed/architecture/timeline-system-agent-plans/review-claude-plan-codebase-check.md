> Status: Completed archive. This file is kept for historical context and must not be treated as active work unless explicitly reopened.

# Independent Claude Review — Timeline Refactor Plan vs Codebase

Date: 2026-06-08
Reviewer: independent Claude review agent (read-only, no source edits, no build/lint/test)
Base: `staging` @ HEAD (worktree dirty with unrelated active work)

Inputs read:

- `AGENTS.md` (esp. §6A)
- `docs/completed/architecture/timeline-system-agent-plans/cross-team-final-synthesis.md`
- `docs/completed/architecture/Timeline-System-Refactor-Plan.md`
- `docs/completed/architecture/Timeline-System-Refactor-Handoff.md`
- Code under `src/components/timeline/**`, `src/services/timeline/**`,
  `src/services/layerBuilder/**`, `src/stores/timeline/**`, `src/types/**`

---

## Verdict

**Coherent and implementable in substance — but not yet internally consistent
across its own governing documents.** The codebase strongly supports the plan's
direction: the render-model and geometry contracts already exist in the exact
shape the plan needs, the runtime coordinator and its policy ids are real and
correctly cited, the legacy claims (`TimelineClip.tsx` deleted, `domClipBodyCount`
diagnostic) are accurate, and every targeted test + the verification script the
plan names actually exists and is runnable.

The blocking issue is **doc divergence, not code mismatch**: the
`Timeline-System-Refactor-Plan.md` and `cross-team-final-synthesis.md` describe
two different kernels (different location, different names, different first
packet), and `AGENTS.md §6A` points the "first implementation packet" at a third
thing. Two compliant agents can start in two different module trees. Reconcile
before any code moves.

---

## Best confirmations from code

1. **Render-model + geometry contracts exist and are well-shaped.**
   `src/components/timeline/renderModel/types.ts` defines `TimelineRenderModel`,
   `TimelineRenderClip`, `TimelineRenderTrack`, and crucially
   `TimelineClipCacheRefs` (cache *refs*, not payloads — exactly the resolver
   boundary the plan wants), plus `TimelinePassiveBadgeState`,
   `TimelineMarkerSummary`, `TimelineFadeSummary`, and clone-safety helpers
   `findTimelineRuntimeReferences` / `isPlainTimelineRenderData`.
   `renderModel/geometry.ts` defines a comprehensive `TimelineGeometrySnapshot`
   (viewport, track lanes, clip bodies, trim previews, handles, keyframe rows,
   transition junctions, marquee exclusions, drop targets, ruler). The Gap Map's
   "contract exists / builder missing" is accurate: `buildTimelineRenderModel`,
   `buildTimelineRenderClip`, `buildTimelineGeometrySnapshot`,
   `buildTimelineSpatialIndex` are **absent from `src/`** (only in docs).

2. **Runtime policy ids are real and exactly as cited — no ghost policies.**
   `src/services/timeline/runtimeCoordinatorTypes.ts`:
   `TIMELINE_RUNTIME_POLICY_IDS = ['interactive','background','slot-deck',
   'composition-render','thumbnail','render-target','ram-preview','export']`.
   The plan's 8 "known shipped policy families" match 1:1.

3. **Legacy stance is grounded.** `TimelineClip.tsx` is gone (only
   `TimelineClip.css` remains). `domClipBodyCount` exists in
   `src/services/timeline/timelineCanvasDiagnostics.ts` and `TimelineTrack.tsx`.
   `interactionShell/` is real and populated (`ClipInteractionShell.tsx`,
   `ClipTrimHandles.tsx`, `ClipFadeHandles.tsx`, `ClipKeyframeTicks.tsx`, …),
   so "active DOM = shell only" is already partly realized.

4. **`CanvasClip` is the single transitional bridge, as described.** Defined at
   `src/components/timeline/TimelineClipCanvas.tsx:128`, consumed by
   `TimelineTrack.tsx` and `tests/unit/TimelineClipCanvasWorkerRuntime.test.tsx`.
   This is exactly the gate-bound deletion target (`P3_CANVASCLIP_DELETED`).

5. **The verification budget is executable as written.** Every targeted test
   named across Phases 0–6 exists (`timelineRenderModel`, `timelineGrid`,
   `timelineCanvasDiagnostics`, `timelineClipCanvasWorkerModel`,
   `TimelineClipCanvasWorkerRuntime`, `ClipInteractionShell.contract`,
   `timelineEditOperations(+Contracts)`, `clipContextMenu`, `trackContextMenu`,
   `lazyMediaElements`, `historyRuntimeRehydration`, `exportRuntimeReporting`,
   `compositionAudioMixdownCache`, `audioScrubSync`, `videoSyncManager`, …), and
   `scripts/run-timeline-canvas-verification.mjs` exists.

6. **The "data-only" target is genuine, large work.** Runtime-bearing fields
   (`videoElement` / `audioElement` / `imageElement`) appear in 20+ files
   including both sync managers and the shared barrel `src/types/index.ts`
   (lines 173, 181, 736–738). Phase 6 is real, not speculative.

---

## Incorrect assumptions / stale parts

1. **Baseline line counts are stale (understated).** Plan/handoff vs HEAD:
   - `Timeline.tsx` 3748 → **4122**
   - `TimelineClipCanvas.tsx` 3246 → **3544**
   - `TimelineTrack.tsx` 1713 → **1819**
   The god-files grew ~6–10% since the plan was written (consistent with the
   dirty worktree). Success targets (`Timeline.tsx` <900, the other two <500) are
   now even more ambitious, and the targets are moving *under* the refactor.

2. **Plan vs synthesis kernel divergence (the main problem).**
   - Plan keeps everything under `src/components/timeline/renderModel/` and
     *explicitly forbids* a competing top-level `geometry/` contract.
   - Synthesis mandates a new top-level **`src/timeline/**` kernel** with
     different names: `TimelineProjection` / `…Layout` / `…Timing`, `VisibleSet`,
     `VisualDemand`, `RuntimeProviderDemand`, `ResourceResolution`,
     `TimelinePaintPacket`, plus an `architecture/` registry.
   `src/timeline/` **does not exist**; none of those kernel artifacts exist
   (the single `VisibleSet` grep hit in `VideoSyncManager.ts` is the substring
   `needsVisibleSettle`, not a contract). The two documents are not reconciled,
   and the handoff "Recommended First Slice" (render-model builders under
   `renderModel/`) contradicts `AGENTS.md §6A` ("first packet = create
   `src/timeline/architecture/gateRegistry*` + `P1_ARCHITECTURE_REGISTRY_COHERENT`").

3. **Naming collision: `VisualDemand`.** The synthesis introduces `VisualDemand`
   as a provider-agnostic kernel contract, but
   `src/services/timeline/timelineVisualDemand.ts` already exists with a
   *different* meaning (boolean "is there a visual clip / render demand under the
   playhead"). Same name, different concept — will confuse lanes.

4. **`src/types/` is not the "pure schema tier" the synthesis assumes.** The
   synthesis grants `src/timeline/**` import access to `src/types/**` and calls it
   pure, but `src/types/index.ts` carries `videoElement?: HTMLVideoElement`,
   `audioElement?: HTMLAudioElement`, `imageElement?: HTMLImageElement`. Importing
   the barrel into the pure kernel drags DOM/runtime-typed source shapes in. The
   synthesis's "non-blocking tradeoff" note understates this — it is a
   precondition, not a later cleanup.

---

## Missing risks / gaps

1. **No single source of truth.** `AGENTS.md §6A` cites the synthesis paths as
   authoritative for the first packet; the Plan + handoff describe a different
   first slice. Nothing says which wins.
2. **Kernel import-boundary is born violated.** The synthesis's "kernel imports
   only `src/types`" rule needs (a) a `src/types` purity split and (b) inverting
   `timelineVisualDemand.ts`'s `stores/timeline/clipDragPreview` import before
   demand can move into `src/timeline/**`. No gate currently enforces builder
   store-freedom (only clone-safety of *output* is checked).
3. **Concurrent-growth has no policy.** The dirty worktree is actively editing
   high-conflict files (`AudioTrackSyncManager.ts`, `VideoSyncManager.ts`,
   `trackSlice.ts`, `blobUrlManager.ts`). The single-owner rule covers refactor
   lanes but says nothing about coexisting with non-refactor work on the same
   files (rebase cadence / temporary freeze).
4. **`CanvasClip` deletion is cross-lane.** Defined in the 3544-line
   `TimelineClipCanvas.tsx`, consumed by `TimelineTrack.tsx` and a runtime test.
   The `adapterDebtLedger` must record all three consumers against
   `P3_CANVASCLIP_DELETED`, not just the canvas file.

---

## Legacy / old-project stance — codebase implications

- The "clean rebuild, no legacy compat inside the new pipeline" stance is
  internally consistent and code-supported: `TimelineClip.tsx` deleted,
  shell-only active DOM, `domClipBodyCount` diagnostic present.
- The quarantined one-way importer is sound and nothing in code blocks it.
- **Caveat:** the importer/"data-only" boundary cannot be truly clean until the
  runtime source fields are split out of the shared `src/types/index.ts` barrel.
  Today those fields are consumed by render/runtime/store paths across 20+ files,
  so the migration surface for Phase 6 is large and centered on a shared type the
  whole app imports. The plan should name this explicitly.

---

## Parallel-agent / testing / handoff protocol — sufficient or weak?

**Strong:**
- The single-owner high-conflict file list matches reality — those are in fact
  the largest, most-coupled files.
- Targeted-test lists are real and runnable; the tiered verification budget
  (gate test → touched unit → tsc → bridge smoke → full chain) is sensible and
  matches the check-budget rules in `AGENTS.md §6A`.
- Handoff template, progress markers, and debt/ownership fields are concrete.

**Weak:**
- The manifest/gate registry the protocol *depends on* does not exist yet, so
  until `P1_ARCHITECTURE_REGISTRY_COHERENT` ships, **all** coordination is prose
  in the handoff — during precisely the bootstrapping window when the foundational
  kernel files are created and conflict risk is highest.
- The protocol does not resolve which document wins, so two protocol-compliant
  agents can still build divergent kernels (`renderModel/` vs `src/timeline/`).

---

## Top 5 recommendations before implementation

1. **Reconcile the two doc trees into one canonical target first.** Decide kernel
   location + naming once: either adopt synthesis `src/timeline/**` +
   Projection/VisibleSet/PaintPacket and update the Plan, the handoff "first
   slice", and `AGENTS.md §6A` to match — or keep `renderModel/` and demote the
   synthesis to vision. Today §6A, the Plan, and the handoff name three different
   first packets.

2. **Ship the architecture registry + `P1_ARCHITECTURE_REGISTRY_COHERENT` as the
   literal first commit** (per §6A), before any conflict-prone kernel file is
   created, so parallel lanes are manifest-governed instead of prose-governed
   during bootstrap.

3. **Add a `src/types` purity precondition.** Split the runtime-bearing source
   fields (`videoElement`/`audioElement`/`imageElement`) out of
   `src/types/index.ts` into a runtime-only module (or import a narrowed pure
   sub-path into the kernel), and invert `timelineVisualDemand.ts`'s store import,
   so the kernel boundary is not violated on day one.

4. **Refresh baseline + add a concurrent-change policy.** Update the line-count
   table to HEAD (4122 / 3544 / 1819) and state how refactor lanes coexist with
   the active non-refactor edits already in the dirty worktree.

5. **Make `CanvasClip` debt + builder purity enforceable.** Record all three
   `CanvasClip` consumers in the `adapterDebtLedger` tied to
   `P3_CANVASCLIP_DELETED`, and add an import-boundary test asserting the new
   builders import neither stores, React, nor runtime/cache services (today only
   output clone-safety is enforced).

---

## Confidence

High on code-grounded findings (file existence, symbols, line counts, policy
ids, test presence — all directly verified). Medium on the doc-reconciliation
recommendation being the team's intent vs an accepted two-tier vision/plan split;
either way the three first-packet descriptions should be made to agree before
parallel work starts.
