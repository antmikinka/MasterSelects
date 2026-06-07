# Timeline System Refactor — Independent Proposal (Claude Opus Agent 2)

> Independent architecture proposal. Input for synthesis, not the canonical plan.
> The canonical plan remains `docs/refactor/Timeline-System-Refactor-Plan.md`.
>
> This document was written after reading the current plan/handoff, the shipped
> `renderModel/` and `interactionShell/` contracts, the canvas/worker model, the
> runtime coordinator, the edit-operation kernel, and the real coupling seams in
> `Timeline.tsx`, `TimelineTrack.tsx`, and `TimelineClipCanvas.tsx`.

---

## 0. Assessment Of The Current Plan

The current plan is strong and I keep most of it. I do **not** restart from a
blank design. What I verified and agree with:

- The two-artifact split — semantic `TimelineRenderModel` plus spatial
  `TimelineGeometrySnapshot` — is the right backbone. Both contracts already
  exist and are well shaped (`renderModel/types.ts`, `renderModel/geometry.ts`),
  including a runtime-reference detector (`findTimelineRuntimeReferences`,
  `isPlainTimelineRenderData`).
- The visual resource resolver as the keystone between cache refs and draw
  payloads is correct and missing today.
- `interactionShell/` is already a mature, typed, slot-based active-DOM layer
  with a parity matrix. Active-only DOM + canvas-only passive rendering is the
  right closed decision. Keep it.
- One shared paint IR for main-thread fallback and worker is correct.
- Pull runtime adoption/audit forward as a parallel lane.

Where I diverge or push further — the substance of this proposal:

1. **Reframe phases around contracts/boundaries, not file names.** Phases named
   "Dissolve `X.tsx`" invite "move code, keep coupling." I organize around the
   pipeline boundary each phase introduces; the file shrinkage falls out.
2. **Make derivation incremental and windowed, not whole-timeline-per-frame.**
   The shipped model is a flat clip array. For the June-2026 all-media goal
   (thousands of clips of every type) the projector must be viewport-windowed
   with dirty-region invalidation and structural sharing. This is the largest
   gap in the current plan.
3. **Add a demand/supply resource reconciler with epochs**, not just a resolver
   function. Async bitmaps/waveforms need redraw coalescing and stale-scroll
   cancellation as a first-class concern.
4. **Introduce a source-kind contributor registry from the contract phase.**
   The project's whole purpose is "every file becomes a signal." Closed
   `switch (sourceKind)` blocks in builders/resolvers/runtime are the thing that
   will rot. A registry is the keystone for future capability and the strongest
   no-god-object safeguard. The current plan's `TimelineSourceKind` is a closed
   enum; I make extension first-class.
5. **Commit to reservation handles as the real runtime target.** The shipped
   coordinator is retain/release (`canRetainResource`/`retainResource`/
   `releaseResource`). The current plan only says "prefer" handles. I make
   `reserve() -> { accepted, descriptor, release() }` the target and retain/
   release the legacy adapter.
6. **Mechanize the no-god-object rules.** Replace prose rules with enforced
   import-boundary lint, dependency-direction tests, purity property tests, and
   line/complexity budget gates.

### The coupling, concretely (what we are paying for today)

- `TimelineTrackProps` is a true god-prop: ~50 fields mixing track data,
  selection, drag/trim/fade/region state, and ~20 callbacks
  (`src/components/timeline/types.ts:252`).
- `TimelineTrack` builds canvas input by spreading the **entire**
  `TimelineClip` (`...clip`) into `CanvasClip`
  (`TimelineTrack.tsx:1057`), and `CanvasClip` legitimately carries runtime
  payloads — `file?: File`, `source`, raw `waveformChannels`
  (`TimelineClipCanvas.tsx:128`). Live `File` handles flow straight into the
  passive renderer. This is exactly the boundary we are closing.
- Geometry is recomputed inline in components — e.g. `canvasContentWidth` and
  the full trim-preview extension math live in a `TimelineTrack` memo
  (`TimelineTrack.tsx:1066`), duplicating logic the geometry snapshot should own.
- The runtime coordinator exposes retain/release, not reservation handles
  (`runtimeCoordinatorTypes.ts:417`).

---

## 1. Target Architecture

A one-directional projection pipeline with versioned contracts at every seam.
Data flows down; intents flow up through a typed command layer. No layer reaches
"sideways" or "up."

```text
                       ┌─────────────────────────────────────────────┐
   persisted/runtime   │  Timeline store (plain data)  +  Media store │
   sources             │  +  Cache registries  +  Runtime coordinator │
                       └───────────────┬─────────────────────────────┘
                                       │ thin selectors → PLAIN inputs
                                       ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │ PROJECTION PIPELINE  (pure, store-free, incremental, windowed)          │
   │   ProjectionInput  ──►  buildTimelineRenderModel  ──► TimelineRenderModel│
   │   (+ viewport/window)──►  buildTimelineGeometrySnapshot ──► Geometry     │
   │                       ──►  buildTimelineSpatialIndex   ──► SpatialIndex   │
   │   composed from per-track / per-clip pure builders                       │
   │   + SourceKindContributor registry (no closed source switches)          │
   │   + DerivationCache (dirty regions, structural sharing)                  │
   └───────────────┬───────────────────────────────┬───────────────────────┘
                   │ render model + geometry         │ geometry + spatial index
                   ▼                                 ▼
   ┌───────────────────────────────┐   ┌───────────────────────────────────┐
   │ RESOURCE RECONCILER           │   │ INTERACTION / HIT TESTING          │
   │  demand (from window+index)   │   │  hit test, drop targets, marquee,  │
   │  → resolve cache refs         │   │  handles, transitions — ALL from   │
   │  → draw resources + states    │   │  one geometry source               │
   │  epochs + cancellation        │   └──────────────┬────────────────────┘
   └───────────────┬───────────────┘                  │ typed intents
                   │ paint IR + resources              ▼
                   ▼                       ┌───────────────────────────────┐
   ┌───────────────────────────────┐      │ COMMAND / INTENT LAYER         │
   │ CANVAS RENDERER               │      │  intent → edit operation /     │
   │  one paint IR, one painter set│      │  named runtime command         │
   │  main-thread == worker        │      │  preview vs commit in the types│
   └───────────────────────────────┘      └──────────────┬────────────────┘
                                                          │ commits only
   ┌───────────────────────────────┐                     ▼
   │ ACTIVE SHELL (DOM, active-only)│      ┌───────────────────────────────┐
   │  mount model + commands from   │      │ EDIT OPERATION KERNEL          │
   │  geometry/projection           │─────►│ (single writer of store)       │
   └───────────────────────────────┘      └───────────────────────────────┘

   RUNTIME BOUNDARY (orthogonal): UI requests visual/cache DEMAND only.
   Playback/export/RAM-preview/background allocate via reservation handles
   from the runtime coordinator; never from render/canvas/shell code.
```

### 1.1 Layer contracts (the frozen seams)

| # | Boundary | Contract artifact(s) | Home |
|---|---|---|---|
| 1 | Store → projection | `TimelineProjectionInput` (plain) | `renderModel/projectionInput.ts` |
| 2 | Projection out | `TimelineRenderModel`, `TimelineGeometrySnapshot`, `TimelineSpatialIndex` | `renderModel/` (exists, extend) |
| 3 | Source-kind extension | `TimelineSourceKindContributor` registry | `renderModel/sourceKinds/` |
| 4 | Refs → resources | `TimelineCanvasResourceRequest` / `…Resolved` + epoch | `canvas/resources/` |
| 5 | Resources → pixels | `TimelinePaintIR` + painter set | `canvas/draw/` |
| 6 | Geometry → interaction | `timelineHitTesting`, `timelineDropTargets` | `renderModel/` |
| 7 | UI → mutation | `TimelineIntent` + `CommandLifecycle` | `commands/` |
| 8 | Mutation → store | edit-operation kernel (exists) | `stores/timeline/editOperations/` |
| 9 | Demand → allocation | `TimelineRuntimeReservation` handle | `services/timeline/` |

The contract set is the synchronization primitive for parallel agents
(Section 4) and the thing the enforcement harness protects (Section 2).

### 1.2 Projection pipeline (the part that is genuinely new)

`buildTimelineRenderModel(input)` and `buildTimelineGeometrySnapshot(input,
viewport)` are **pure and composed**, never monolithic:

- `buildTimelineRenderClip(clipInput, ctx)` — one clip → one `TimelineRenderClip`.
  Source-specific summary fields come from `ctx.contributors.get(sourceKind)`,
  not an inline switch.
- `buildTimelineRenderTrack(trackInput, ctx)` — one track → one
  `TimelineRenderTrack`.
- `buildTimelineRenderModel` only iterates and composes; it must import no
  source-kind-specific module (enforced by test).

**Windowing:** geometry/resource builders take a `viewport` (visible time range +
scroll + px/sec) and emit the visible set plus a small overscan. The spatial
index covers the whole timeline but is built incrementally; only window-scoped
records carry full geometry. At 10k clips this is O(visible), not O(all).

**Incremental derivation:** a `DerivationCache` keyed by stable clip/track
revision tokens. On a store change the projector recomputes only dirty clips/
tracks and reuses prior records by reference (structural sharing), so React/
canvas memoization stays effective. Revision tokens come from the store slices
(a per-entity `rev` counter), not deep equality.

### 1.3 Source-kind contributor registry (the all-media keystone)

A registry indexed by `TimelineSourceKind` (and open to new kinds) supplying the
per-kind logic that today hides in switches:

```ts
interface TimelineSourceKindContributor<TInput = unknown> {
  kind: TimelineSourceKind;                 // 'video' | 'glTF' | 'pdf' | 'point-cloud' | …
  buildRenderSummary(clip: TInput, ctx): TimelineClipSourceSummary;   // badges, palette hints, cache refs
  describeResources(clip: TInput, ctx): TimelineCanvasResourceRequest[];
  buildGeometryDecorations?(clip, geom, ctx): TimelineClipDecoration[];
  describeRuntimeNeeds?(clip, ctx): TimelineRuntimeResourceNeed[];    // for the runtime boundary
}
```

Adding glTF/PDF/STEP/CSV later means registering one contributor — no edits to
the god builders, the resolver, or the runtime coordinator. Exhaustiveness is
checked at compile time (`satisfies Partial<Record<TimelineSourceKind, …>>`) and
coverage at runtime (a test fails if a kind appears in data with no contributor).
This is the single most important investment for the June-2026 goal and the
strongest structural defense against new god objects.

### 1.4 Resource reconciler (epochs + cancellation)

`resolveTimelineCanvasResources(renderModel, geometry, registry, epoch)` is the
**only** place that maps `TimelineClipCacheRefs` → draw payloads. It:

- collects demand from the windowed spatial index, not from rich clips;
- reads cache registries through explicit adapters (never allocates media
  elements, never mutates store);
- returns `{ resources, missing, queued }` plus a monotonically increasing
  `epoch`;
- cancels demand for clips that left the window before their async resource
  resolved, and coalesces "resource arrived" notifications into one redraw.

### 1.5 Canvas renderer & active shell

- `TimelineClipCanvasHost` owns only canvas DOM lifecycle + worker transfer.
- Pure painters consume `TimelinePaintIR` (geometry rects + resolved resources).
  Main-thread fallback and worker call the **same** painters — no parallel
  `drawCanvas*`/`drawWorker*`. Worker draw messages consume geometry-snapshot
  rects; they never recompute `timeToPixel`/trim math.
- `TimelineTrack` becomes a thin row host. `ClipInteractionShell` (kept) gets its
  mount model and commands from typed records built off geometry/projection, not
  ad-hoc closures. `TimelineTrackProps` collapses to: `trackViewModel`,
  `interactionViewModel`, `commandDispatcher`, `measuredRefs`.

### 1.6 Command/intent layer

UI emits typed `TimelineIntent`s with an explicit lifecycle so previews can never
accidentally write history:

```ts
type CommandLifecycle = 'preview' | 'commit' | 'cancel';
```

The bus translates intent → existing edit operation (`applyTimelineEditOperation`,
which already supports `previewOnly`/`deferHistoryCommit`) or a named runtime
command. The bus routes; it does not reimplement operations or become a second
store. Stale targets no-op without closing menus or mutating the wrong clip.

### 1.7 Runtime boundary

Timeline UI/render/shell request **demand only**. Allocation happens behind
reservation handles owned by playback/export/RAM-preview/background/etc.:

```ts
reserve(need: TimelineRuntimeResourceNeed): TimelineRuntimeReservation;
// { accepted, descriptor, release(): void }
```

Existing retain/release becomes a thin legacy adapter. Persisted timeline state
and new UI paths stay data-only; legacy runtime-bearing `source.*Element` fields
are tolerated only in cleanup/restore behind adapters. Diagnostics refresh must
be allocation-free.

---

## 2. No-God-Object Safeguards (mechanized, not prose)

The defense is structural and enforced in CI, so coupling cannot silently
return.

1. **Import-boundary lint.** ESLint `no-restricted-imports` zones:
   - `renderModel/**`, `canvas/draw/**`, `canvas/resources/**`,
     `commands/**` (pure parts) **must not** import `stores/**`, `react`,
     component files, or `services/**` except declared adapter modules.
   - A dependency-direction test (graph walk over imports) is the backup that
     also catches transitive violations.
2. **Composition-only god functions.** A test asserts `buildTimelineRenderModel`
   imports no source-kind-specific module and only calls per-track/per-clip
   builders + the contributor registry. Same for `resolveTimelineCanvasResources`.
3. **Budget gates (CI-failing).** Line/symbol ceilings for thin hosts and a
   cyclomatic-complexity ceiling for builders/painters:
   - `Timeline.tsx` < 900, `TimelineTrack(Row).tsx` < 500, canvas host < 500.
   - any single builder/painter function under a complexity cap.
   Budgets ratchet down per phase and never up.
4. **Runtime purity (property-based).** `isPlainTimelineRenderData` runs over
   fuzzed projection inputs seeded with live `File`, `HTMLVideoElement`,
   `ImageBitmap`, WebCodecs players, and `blob:` URLs. Output must be plain and
   structured-clone-safe every time.
5. **Single writer.** A lint/test forbids `useTimelineStore.setState` and direct
   slice mutation from `components/timeline/**` outside the command/operation
   layer. Mutations route through the edit-operation kernel or a named runtime
   command.
6. **No parallel geometry.** A forbidden-pattern test asserts clip-rect math
   (`timeToPixel(...) * ...`, trim-extension math) appears only under
   `renderModel/`. Components consume geometry records.
7. **Registry closedness.** A coverage test fails when timeline data contains a
   `TimelineSourceKind` with no registered contributor — adding a media type
   forces adding its contributor.
8. **Field-coverage net.** Every current `CanvasClip` visual field maps to a
   resolver output asserted by test, so deleting `CanvasClip` cannot drop a
   visual.

---

## 3. Phase Order

Each phase introduces one boundary, is independently shippable, and leaves the
system strictly better. File shrinkage is a *consequence*, not the goal.

**Phase A — Contract Freeze & Enforcement Harness.** Freeze all Section-1.1
contracts (extend existing `renderModel/`; add projection input, source-kind
contributor, resource request/resolved + epoch, intent/lifecycle, reservation
handle). Stand up the Section-2 harness (import-boundary lint, dependency-
direction + purity + budget tests, draw-call IR recorder). Small, mostly serial,
single-owner. This is the synchronization primitive for everything after.

**Phase B — Projection Pipeline.** Pure composed builders + contributor registry
(seed video/audio/image) + `DerivationCache` + spatial index + windowing. Wire
**one** normal `TimelineTrack` canvas seam (the `canvasClips` memo at
`TimelineTrack.tsx:1057`) through projection → temporary `CanvasClip` adapter.
Do not touch `Timeline.tsx` or composition-switch mounting.

**Phase C — Resource Reconciler.** First-class `resolveTimelineCanvasResources`
with epochs/cancellation; worker resource prep consumes resolved resources, not
rich clips. Field-coverage net green.

**Phase D — Canvas Renderer.** One paint IR + one painter set for main thread and
worker; thin `TimelineClipCanvasHost`; delete duplicate draw paths once painter
parity (draw-call recorder) is proven.

**Phase E — Track Row & Active Shell.** Collapse `TimelineTrackProps` to grouped
view models + dispatcher; shell mount model and command builder from typed
records; delete inline geometry now that the snapshot owns it.

**Phase F — Root & Section Layout.** Thin `TimelineRoot`, `TimelineSection`,
overlay/menu/new-track/playhead layers and focused hooks. Composition-switch uses
the same host + projection path.

**Phase G — Command/Intent Convergence.** Intent → operation/command translation
with preview/commit lifecycle; stale-target no-op; mobile/direct APIs only where
labeled and still required.

**Phase H — Runtime Reservation Boundary.** Reservation handles as target;
retain/release as legacy adapter; audit remaining `source.*Element` access; align
playback/export/RAM-preview/background/thumbnail/history policies; allocation-free
diagnostics.

**Phase I — Source-Kind Migration & Proof.** Move any remaining closed source
switches into contributors; prove extensibility by adding one or two new-media
contributors end-to-end (render summary + resources + runtime need) toward the
all-media goal. (Most of this is already woven in from Phase B; this is the
sweep + proof.)

**Phase J — Docs, Dead Paths, Final Gates.** Update `docs/Features/Timeline.md`,
supersede stale refactor docs, delete orphan tests/utilities only after
replacements exist, record the final module map, run the full chain.

Dependency notes: A blocks all. B blocks C/D. D needs B+C. E needs B(+D). F is
largely independent (needs B view models). G needs A's intent contract + the
existing kernel. H is orthogonal and can start right after A. I threads through
B→H and proves at the end.

---

## 4. Parallel Agent Strategy

**The frozen contract set (Phase A) is the coordination primitive.** Once a
contract is published and version-pinned, lanes work behind it with near-zero
merge conflict. High-conflict files stay single-owner per phase.

| Lane | Owns (write set) | Starts after | Avoids |
|---|---|---|---|
| Steward | contract index, enforcement harness, source-kind registry shell | — | implementation internals |
| Projection | `renderModel/` builders, derivation cache, spatial index | A | components, stores, services |
| Resources | `canvas/resources/`, resolver, worker resource prep | A (integrates after B) | `Timeline.tsx`, stores |
| Canvas | `canvas/draw/`, paint IR, canvas host, worker | B+C contracts | stores, `Timeline.tsx` |
| Track/Shell | `track/`, `interactionShell/`, `TimelineTrack.tsx` | B geometry | `TimelineClipCanvas.tsx` while Canvas owns it |
| Root/Layout | `root/`, `Timeline.tsx`, section CSS | B view models | `TimelineTrack.tsx`, canvas internals |
| Commands | `commands/`, context-menu helpers, operation tests | A intent contract | runtime/layerBuilder files |
| Runtime | `services/timeline/`, `services/layerBuilder/`, runtime tests | A reservation contract | UI component files |
| Verifier | tests, bridge scripts, docs/handoff | any | implementation unless assigned |

Rules: one owner per high-conflict file per phase (`Timeline.tsx`,
`TimelineTrack.tsx`, `TimelineClipCanvas.tsx`, `*.css`, `types.ts`,
`applyTimelineEditOperation.ts`, `VideoSyncManager.ts`,
`AudioTrackSyncManager.ts`). A contract change is a Steward-reviewed event: bump
the contract version, update the index, notify dependent lanes. The dirty
sync-manager files (`VideoSyncManager.ts`, `AudioTrackSyncManager.ts`,
`LayerCollector.ts`, `trackSlice.ts`, `blobUrlManager.ts`) are someone else's
active work — the Runtime lane coordinates or defers until the user confirms
they are free; never revert them.

---

## 5. Focused Test Strategy

Three fast tiers run during implementation; broad gates only at commit/merge.

**Tier 1 — Contract & purity (pure, milliseconds, run on every change).**
Builder output shape, structural-clone purity (property-based, live-object
fuzzed), geometry math, spatial-index hit/marquee/drop results, intent→operation
mapping, source-kind registry coverage, dependency-direction, budget gates.

**Tier 2 — Painter parity & visual coverage (mock 2D ctx / draw-call recorder).**
Main-thread IR == worker IR per visual; `CanvasClip`-field → resolver-output
coverage net; resolver missing/queued/epoch behavior. This is the anti-
regression net guarding the canvas dissolution.

**Tier 3 — Interaction & runtime (reducer + handle level).** Edit operations and
stale-target no-op; preview never writes history; reservation accept/deny/release
and legacy adapter equivalence; diagnostics refresh allocation-free
(`domClipBodyCount` stays 0).

**Smokes (only when behavior class changes).** Bridge/browser via
`node scripts/run-timeline-canvas-verification.mjs` and the dev-bridge
`debugExport`/`getStats` for rendering, worker handoff, hit testing, playback,
export, or project-load changes.

**Full chain (`npm run build && npm run lint && npm run test` + verification)**
only at normal commit/push/merge/final readiness, reused when HEAD is unchanged.

Representative focused command for the first slices:

```bash
npm run test -- tests/unit/timelineRenderModel.test.ts tests/unit/timelineCanvasDiagnostics.test.ts tests/unit/TimelineTrack.test.tsx tests/unit/timelineClipCanvasWorkerModel.test.ts
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

---

## 6. First Implementation Slice

Goal: prove the whole pipeline end-to-end on **one** real seam, with the
extension seam and enforcement in place from line one — no throwaway scaffold.

1. **Harness micro-foundation (Phase A, minimal-but-real).** Add the contract
   index doc; add the `renderModel/**` import-boundary ESLint zone; add the
   property-based runtime-purity test (fuzz `File`/`HTMLVideoElement`/
   `ImageBitmap`/`blob:`); add a draw-call recorder test stub.
2. **Pure builders.** `buildTimelineRenderClip`, `buildTimelineRenderTrack`,
   `buildTimelineRenderModel` (composing; window-aware signature even if the
   first window is "all"), `buildTimelineGeometrySnapshot`,
   `buildTimelineSpatialIndex`. Plain inputs only; no store/React/service imports.
3. **Source-kind registry + 3 contributors.** Register `video`, `audio`, `image`
   so even slice 1 has **no** source-specific switch in the builders — the seam
   is proven, not promised.
4. **Resource resolver + temporary adapter.** `resolveTimelineCanvasResources`
   as the first-class refs→resources boundary, plus a temporary
   `renderModel → CanvasClip` adapter so the existing `TimelineClipCanvas` keeps
   working unchanged.
5. **Wire one seam only.** Replace the body of the `canvasClips` memo
   (`TimelineTrack.tsx:1057`) with `projection → resolver → adapter`. Move the
   inline `canvasContentWidth`/trim-extension math
   (`TimelineTrack.tsx:1066`) into `buildTimelineGeometrySnapshot` and consume
   the rect. Leave composition-switch mounting and `Timeline.tsx` untouched.
6. **Tests.** Purity (fuzzed live objects incl. `file?: File`); `CanvasClip`→
   resolver field-coverage; geometry rect parity vs the current inline math;
   registry coverage; `domClipBodyCount` + canvas-input-count parity vs store
   counts.
7. **Checks.** The focused vitest set above + `tsc` app project + touched-file
   ESLint. No full chain unless the user asks for commit/push/final readiness.

Exit criteria for the slice: the normal track canvas path is driven by a pure,
windowed, store-free projection through an epoch-aware resolver; live runtime
objects (verified: `file?: File` in `CanvasClip`) cannot reach the renderer; a
new source kind can be added by registering a contributor; and every guardrail
in Section 2 is enforcing in CI.

---

## 7. What To Delete Or Collapse

Concrete removals, each with a verified anchor. A deletion is not "done" until
its replacement is consumer-adopted and the old symbol has zero references. Order
follows the phases; nothing here is deleted before its replacement ships.

| # | Delete / collapse | Anchor (verified) | Becomes | Phase |
|---|---|---|---|---|
| 1 | `CanvasClip` interface (the runtime-leak vector: `file?: File`, `source`, raw `waveformChannels`) | `TimelineClipCanvas.tsx:128` (`file` :162, `waveformChannels` :159, `source` :166) | `TimelineRenderClip` + resolved resources | D |
| 2 | `canvasClips` memo that spreads the **whole** `TimelineClip` (`...clip`) | `TimelineTrack.tsx:1057` | projection output (no spread; plain fields only) | B |
| 3 | Inline `canvasContentWidth` + trim-extension width math | `TimelineTrack.tsx:1066` | `buildTimelineGeometrySnapshot` width/rect field | B/E |
| 4 | Inline shell builders `getClipShellMountState` / `getClipShellGeometry` / `getClipShellActiveModules` | `TimelineTrack.tsx:1163` / `:1196` / `:1231` | `buildTrackShellMountModel`, geometry-from-snapshot, `buildClipActiveModules` (pure, typed) | E |
| 5 | `TimelineTrackProps` god-prop (~50 fields + ~20 callbacks) | `types.ts:252` | `{ trackViewModel, interactionViewModel, commandDispatcher, measuredRefs }` | E |
| 6 | Threaded `timeToPixel` / `pixelToTime` projection closures | `types.ts:297-298`; canvas prop `TimelineClipCanvas.tsx:182` | single `TimelineViewport` authority (see below) | B→E |
| 7 | Parallel main-thread vs worker draw paths (`drawCanvas*` / `drawWorker*` divergence) | `canvas/` worker model + inline draw | one `TimelinePaintIR` + one painter set | D |
| 8 | Per-component pointer hit-test math | scattered in `Timeline.tsx`, `TimelineTrack.tsx` | `TimelineSpatialIndex` as the **sole** hit-test authority | B/E |
| 9 | Closed `switch (sourceKind)` blocks in builders/resolver/runtime | builder + draw + runtime sites | `TimelineSourceKindContributor` registry | B→I |
| 10 | Direct `useTimelineStore.setState` / slice mutation from `components/timeline/**` | UI call sites | edit-operation kernel + named runtime commands | G |
| 11 | Broad retain/release call-sites as the allocation API | `runtimeCoordinatorTypes.ts:420-422` | `reserve() -> { accepted, descriptor, release() }`; keep retain/release only as a thin legacy adapter | H |
| 12 | Temporary `renderModel → CanvasClip` adapter (introduced in the first slice) | new in slice 1 | deleted by end of Phase D | D |

### 7.1 The projection-closure collapse (item 6, expanded)

Today `timeToPixel`/`pixelToTime` are constructed in the root and threaded as
prop closures the whole way down (`TimelineTrackProps` `:297-298`, then into
`TimelineClipCanvasProps.timeToPixel` `:182`, then into shell geometry math).
That is a hidden global coupling and a stale-closure hazard: every layer can
project time→pixel its own way, which is exactly how parallel geometry re-grows.

Collapse all of it onto **one** plain `TimelineViewport` value object
(`{ pxPerSecond, scrollX, scrollY, originTime }`) — which the geometry snapshot
already carries as `TimelineViewportGeometry` (`renderModel/geometry.ts:20`,
`pxPerSecond` field present). `timeToPixel`/`pixelToTime` become pure helpers
derived from that one value object, never passed as props. This makes the
"one geometry source" rule literally true at the projection layer, not just the
hit-test layer, and lets safeguard #6 in Section 2 forbid clip-rect math outside
`renderModel/**` without exceptions for "but the component had `timeToPixel`."

### 7.2 Adapter-debt ledger (so transitional seams actually die)

Every transitional adapter (item 12, and any other introduced during dissolution)
ships **with a paired deletion test** that fails while the adapter still exists
and a one-line entry in an "adapter debt" list in the handoff. This operationalizes
"no temporary seam becomes permanent": the seam is allowed, but CI counts down to
its removal and the phase cannot be called complete while its debt entry stands.

---

## 8. Success Criteria (structural first, line-count second)

Line budgets (Section 2.3) are a smoke signal, not the goal. The real, enforced
definition of done is structural — line counts fall out of these:

- Zero `timeToPixel`/`pixelToTime` closures threaded as props; all projection via
  the single `TimelineViewport`.
- Zero clip-rect / trim-extension geometry math outside `renderModel/**`.
- Zero pointer hit-test math outside the `TimelineSpatialIndex`.
- Zero runtime objects or `blob:` URLs in any render model
  (`isPlainTimelineRenderData` green under live-object fuzzing).
- One painter set; main-thread IR == worker IR (draw-call recorder parity).
- Adding a new source kind touches **zero** god-files — one contributor only.
- Every store mutation from timeline UI routes through the edit-operation kernel
  or a named runtime command (single writer).
- Runtime allocation is reservation-handle owned and reported; diagnostics
  refresh allocates nothing; `domClipBodyCount` stays `0`.
- `Timeline.tsx` < 900, `TimelineTrack(Row).tsx` < 500, canvas host < 500 — as a
  consequence of the above, not as the target. (Today, verified: `4122` / `1819` /
  `3544`, and still growing — which is the case for doing this now.)
