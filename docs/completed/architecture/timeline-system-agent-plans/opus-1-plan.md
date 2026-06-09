> Status: Completed archive. This file is kept for historical context and must not be treated as active work unless explicitly reopened.

# Timeline System Refactor — Opus Agent 1 Independent Plan

> Independent proposal for synthesis. Not the canonical plan. Written after
> reading the canonical `Timeline-System-Refactor-Plan.md`, the handoff, the
> existing `renderModel/`, `interactionShell/`, worker model, runtime
> coordinator, and the three god files. Where I agree with the canonical plan I
> say so plainly; where I diverge I say why. Every cited line number, file size,
> symbol location, and policy id in this document was verified against the
> current `staging` HEAD, not carried over from the canonical plan's older
> baseline.

## 1. Assessment Of What Exists (so we do not rebuild it)

The codebase is further along than a "big file split" framing suggests. The
hard part — the *contracts* — is mostly done and is genuinely good:

- `renderModel/types.ts` — `TimelineRenderModel`/`TimelineRenderClip` are plain,
  cache-ref-only, and already carry a runtime-reference guard
  (`findTimelineRuntimeReferences`, `isPlainTimelineRenderData`). This is the
  right shape. Keep it.
- `renderModel/geometry.ts` — `TimelineGeometrySnapshot` covers lanes, clip
  bodies, handles, keyframe rows, transition junctions, marquee exclusions, drop
  targets, ruler. This is comprehensive. Keep it.
- `interactionShell/types.ts` — the shell already has a typed mount model,
  geometry, active-module union, command context, and a parity matrix. Strong.
- `timelineClipCanvasWorkerModel.ts` / `…WorkerContract.ts` — a real prepared
  resource model and draw-message builder already exist.
- `services/timeline/timelineRuntimeCoordinator.ts` + descriptors — policy
  registry, budgets, admission decisions are shipped.

The problem is **not missing contracts. It is that the builders that should
produce those contracts live as inline closures inside the god files**, and the
god files are *still growing* despite the canonical plan existing:

| File | Plan-cited | Actual today | Trend |
|---|---:|---:|---|
| `Timeline.tsx` | 3748 | **4122** | growing |
| `TimelineClipCanvas.tsx` | 3246 | **3544** | growing |
| `TimelineTrack.tsx` | 1713 | **1819** | growing |

Concrete evidence of the real coupling (not "files are big" — *why* they are big):

1. **God-prop.** `TimelineTrackProps` (`components/timeline/types.ts:252`) has
   ~50 fields: track data, every interaction state (`clipDrag`, `clipTrim`,
   `clipFade`, region selections, stem jobs, external drag), ~30 callbacks, and
   keyframe machinery. A row host cannot get thin while this is its contract.
2. **Runtime-bearing render input.** `CanvasClip`
   (`TimelineClipCanvas.tsx:128`) carries `file?: File`, raw `waveform`/
   `waveformChannels`/`mixdownWaveform` arrays, and rich nested source data. The
   passive renderer is fed a runtime/payload object, not a ref-only model.
3. **Builders-as-closures.** The shell mount/geometry/module builders are inline
   in `TimelineTrack.tsx` (`getClipShellMountState` `:1163`, `getClipShellGeometry`
   `:1196`, `getClipShellActiveModules` `:1231`). The *types* are in
   `interactionShell/types.ts`; only the *pure functions* are missing.
4. **Geometry computed in four places.** `timeToPixel`-based clip-rect math
   recurs in the canvas draw path, the worker draw builder, the shell geometry
   closure, and `Timeline.tsx` hit/scroll handlers. `TimelineGeometrySnapshot`
   exists but nothing builds or consumes it yet.

**Conclusion that shapes my plan:** this is a *builder-extraction and
single-authority* refactor, not a contract-design refactor. The single biggest
risk is not "wrong architecture" — the target shape is right — it is
**(a) drift/duplication while extracting, and (b) per-tick re-derivation killing
canvas performance.** My plan optimizes hardest against those two risks, because
risk-of-bad-architecture is low (contracts are good) and risk-of-bad-execution
is high (three 1.8k–4.1k-line files, multiple agents, growing).

**Scope boundary (what this plan does and does not own).** This plan owns the
*render/interaction* stack — root, track row, passive canvas, active shell,
the per-frame builders, hit-testing, and the command/session layer — plus the
*runtime-ownership* boundary. The store-slice god files the handoff also flags,
`keyframeSlice.ts` (2185) and `clipSlice.ts` (2030), are touched here **only**
at their seam with the command layer: every desktop commit routes through
`applyTimelineEditOperation`, which lets those slices shed ad-hoc mutation
actions incrementally. A full store-slice decomposition is a *separate* refactor
that should follow this one. Mixing UI dissolution with store-shape changes in a
single wave would couple two already-large blast radii for no benefit; I
deliberately keep them apart.

## 2. Target Architecture

### 2.1 The one-sentence shape

> Plain store data → **one composed per-frame snapshot** (semantic + spatial +
> resolved resources) produced by pure leaf builders → consumed by a thin canvas
> host, a thin shell layer, and a single hit-test authority → all mutations flow
> back through typed interaction sessions and edit operations → runtime media is
> owned only by policy-governed runtime services.

### 2.2 Layered module map (dependency flows strictly downward)

```text
 stores/timeline (plain data)        services/* (runtime, cache, layerBuilder)
        │                                   │  (runtime objects live ONLY here)
        ▼                                   ▼
 ┌─────────────────────────────────────────────────────────┐
 │ LAYER 1  selectors/  (plain input collection, no derive) │
 └─────────────────────────────────────────────────────────┘
        ▼
 ┌─────────────────────────────────────────────────────────┐
 │ LAYER 2  frame/  pure composed builders                  │
 │   buildTimelineRenderModel  ← buildRenderTrack/Clip       │
 │   buildTimelineGeometrySnapshot ← per-track/clip geom     │
 │   buildTimelineSpatialIndex                               │
 │   resolveTimelineResources  (cache refs → draw resources) │
 │   buildTimelineFrame()  = thin fan-out + assemble         │
 │   → TimelineFrame { model, geometry, resources, revision }│
 └─────────────────────────────────────────────────────────┘
        ▼ (one subscription)                  ▲ (interaction sessions / commands)
 ┌─────────────────────────────────────────────────────────┐
 │ LAYER 3  useTimelineFrame()  single provider hook        │
 └─────────────────────────────────────────────────────────┘
        ▼
 ┌──────────────┬───────────────┬──────────────┬───────────┐
 │ canvas/ host │ track/ host   │ root/ shell  │ hit-test  │
 │ (passive)    │ shell layer   │ section/menu │ authority │
 └──────────────┴───────────────┴──────────────┴───────────┘
        ▼ commits
 ┌─────────────────────────────────────────────────────────┐
 │ LAYER 4  commands/ + interactionSession/                 │
 │   begin → update* → commit|cancel → typed edit operation │
 └─────────────────────────────────────────────────────────┘
        ▼
 stores/timeline editOperations kernel  +  runtime coordinator policies
```

### 2.3 The `TimelineFrame` — my central divergence from the canonical plan

The canonical plan correctly rejects a parallel `viewModel/` package and keeps
*two* artifacts (render model + geometry snapshot). I agree with rejecting a
re-derivation package. **I add one thing: name and own the bundle.**

```ts
interface TimelineFrame {
  revision: number;                 // monotonically increasing build id
  model: TimelineRenderModel;       // semantic: what to draw  (existing contract)
  geometry: TimelineGeometrySnapshot; // spatial: where        (existing contract)
  resources: TimelineResolvedResources; // draw-ready payloads (new, see 2.5)
  index: TimelineSpatialIndex;      // hit-test acceleration over geometry
}
```

This is **not a third data shape with its own clip/track fields.** It is a
container over the two existing artifacts plus resolved resources, produced by
**one** entry point `buildTimelineFrame(inputs)` that fans out to the leaf
builders. Why this matters:

- **One seam to test, one seam to memoize, one seam to pass down.** Today
  geometry and model would drift independently. The frame makes "a clip in the
  model must have geometry and resolved resources (or an explicit missing
  state)" a single enforceable invariant.
- **No god function.** `buildTimelineFrame` is a ~40-line fan-out: it calls
  `buildTimelineRenderModel` (which maps per-track/per-clip leaf builders),
  `buildTimelineGeometrySnapshot` (per-track/per-clip leaf geometry),
  `resolveTimelineResources` (per-clip resolver), and `buildTimelineSpatialIndex`.
  Every leaf is pure and independently tested. The bundle owns no field logic.

### 2.4 Incremental build is a first-class concern (the perf spine)

The canonical plan says "thin selectors to collect plain inputs" but does not
address **invalidation granularity**, which is exactly where canvas timelines
die. A 4000-line component re-deriving a 500-clip model on every playhead tick
or hover is a regression even with perfect module boundaries.

Architecture rule: **the frame is built incrementally with structural sharing.**

- Each `TimelineRenderClip` is memoized by `(clipId, clipRevision, uiStateHash)`.
  A clip whose store revision and UI flags are unchanged returns the *same
  object reference*. Hover/selection changes touch only the affected clips.
- Geometry recomputes only when viewport/zoom/scroll/track-measure inputs change
  — independent of model identity. Playhead movement never rebuilds clip
  geometry.
- Resource resolution is keyed by cache-ref identity + status, so a thumbnail
  arriving invalidates one clip's resources, not the frame.
- `revision` bumps only when a referenced sub-object actually changes, so canvas
  redraw / worker re-post can be gated on `frame.revision` deltas and on
  per-clip dirty sets, not on object inequality of the whole frame.

This makes "passive visuals never cause per-clip React subscriptions" (a stated
non-negotiable) *structurally true*: there is one subscription
(`useTimelineFrame`), and propagation cost is proportional to what changed.

### 2.5 Visual resource resolver (keystone — agree with canonical, sharpened)

`resolveTimelineResources(model, cacheAdapters)` is the **only** place that maps
`TimelineClipCacheRefs` → draw-ready payloads:

- thumbnail refs → decoded strip handles / explicit `missing|queued|generating`
- waveform/spectrogram refs → column / tile resources
- analysis & transcript refs → bounded marker buffers
- composition refs → segment strips / boundaries / mixdown payload
- fade summary → curve geometry; MIDI summary → preview bars
- passive badges/progress → draw payloads

Hard rules (mechanically enforced, see §3):

- Resolver may read cache registries through **explicit adapter interfaces**
  only; it may **not** allocate media elements, mutate store, or import React.
- Output is `{ resources, byClipId, missing[] }` — never throws on a missing
  resource; missing is a *value*, drawn as a documented placeholder.
- Coverage is driven by a **field manifest** generated from `CanvasClip` (see
  §6) so deleting `CanvasClip` cannot silently drop a visual.

### 2.6 Hit-testing has a single authority

The spatial index is the **only** hit-test authority. Every consumer — pointer
dispatch, drop targeting, marquee, context-menu target, shell mount decisions,
guided actions — resolves through:

```ts
type TimelinePick =
  | { kind: 'clip-body'; clipId; trackId; localX; localY }
  | { kind: 'trim-handle' | 'fade-handle'; clipId; edge }
  | { kind: 'keyframe'; keyframeId; clipId }
  | { kind: 'transition-zone'; trackId; time }
  | { kind: 'track-empty'; trackId; time }
  | { kind: 'ruler' | 'new-track-zone' | 'none'; … };
pickTimeline(index, point, opts): TimelinePick;
```

This deletes the scattered `timeToPixel`-based hit math in `Timeline.tsx` and
`TimelineTrack.tsx`. An import-absence guard (see §3) prevents it from coming
back.

### 2.7 Interaction sessions + commands (pulled earlier than canonical Phase 5)

The canonical plan puts command convergence at Phase 5, after dissolving the
track and root. I disagree on ordering: **`TimelineTrackProps` and `Timeline.tsx`
are bloated primarily by interaction state + ~30 callbacks.** Dissolving those
files while still threading raw callbacks is wasted motion — you move the soup,
then move it again when commands land.

Formalize one lifecycle for every gesture (drag, trim, fade, marquee,
keyframe-drag, region select, playhead scrub, external drop/import,
transition drop):

```ts
interface InteractionSession<TPreview, TCommit> {
  begin(target: TimelinePick, evt): SessionHandle;
  update(handle, evt): TPreview;     // transient overlay only, no store writes
  commit(handle): TCommit;           // → typed edit operation / runtime command
  cancel(handle): void;
}
```

- **Previews are transient overlay state**, not store mutations and not 8
  separate `TimelineTrackProps` fields. They live in a small
  `timelineInteractionOverlay` model the frame reads to draw ghosts.
- **Commits are typed descriptors** routed by `timelineCommandBus` to the
  existing `applyTimelineEditOperation` kernel or a named runtime command.
- The command bus *routes*; it never reimplements an edit operation and never
  becomes a second store (explicit non-goal).

**External drop/import is the single largest beneficiary of this ordering.**
`useExternalDrop.ts` (1954 lines) today fuses four concerns: drop-target
resolution, file import/decode, placement math, and new-track creation. The
session model splits them cleanly along seams that already exist: drop *targets*
come from the spatial index (`TimelineDropTargetGeometry` is already in the
geometry contract); drop *placement* is a `DropSession` (begin on dragenter →
update a ghost in the overlay model → commit a typed placement / new-track edit
operation); and *import* (decode, media-store registration, runtime hydration)
moves behind runtime/media services. The 1954-line hook collapses into a session
plus a thin import-service call — it does not become a fourth god file, and it
stops being the place where new source kinds bolt on ad-hoc placement logic.

Net effect: `TimelineTrackProps` collapses to four grouped contracts —
`{ trackView, frameSlice, dispatch, measuredRefs }` — because the ~30 callbacks
become one `dispatch`, and the interaction-state fields become overlay reads
from the frame.

### 2.8 Component responsibilities after refactor

- `TimelineClipCanvasHost` (target < 350 lines): owns canvas DOM lifecycle +
  worker handoff; receives a frame slice; calls shared painters. **Zero**
  cache/draw decisions, zero media allocation, zero store writes.
- `TimelineTrackRow` (target < 350): mounts canvas layer + shell layer +
  preview/property layers from typed view models + `dispatch`. Decides nothing
  about passive drawing.
- `TimelineRoot` (target < 700): builds high-level section view models, renders
  `TimelineSection` repeats, hosts toolbar/overlay/menu layers. Knows no
  per-clip drawing detail.
- Painters (`canvas/paint/*`): pure draw functions consuming **paint IR**, used
  identically by main thread and worker (one implementation — see §5).
- Runtime services: the only owners of `HTMLVideoElement`, decoders, players,
  `ImageBitmap`, under runtime-coordinator policies.

### 2.9 Extensibility for universal media (the June 2026 North Star)

CLAUDE.md's project goal is that *every* file becomes a timeline-placeable
visual signal — 3D (OBJ/FBX/glTF), documents (PDF/SVG), CAD (DXF/STEP), data
(JSON/CSV, point clouds), the TouchDesigner "no unsupported files" principle.
This architecture is the right substrate for that goal **only if** adding a
source kind is a bounded, mechanically-checked change instead of a new branch
threaded through three god files. I make that an explicit design property, not a
hope:

- `TimelineSourceKind` already enumerates `model`, `gaussian-splat`,
  `vector-animation`, `midi`, `data`, `unknown`. Treat the union as *open*: a new
  kind must compile against it and nothing else needs to know it is "new."
- Onboarding a source kind is exactly **three local additions**, each forced by
  the coverage manifest (§6):
  1. a **resolver branch** in `resolveTimelineResources` mapping its cache refs
     to a draw payload — or an explicit `missing`/`unsupported` value. It never
     throws: an unrecognized file still resolves to a labeled bar, which is how
     "no unsupported files" is honored at the render layer.
  2. one or more **paint ops** in the paint IR + painters
     (`{op:'pointCloudPreview',…}`, `{op:'docThumbnail',…}`,
     `{op:'meshPreview',…}`), automatically shared by worker and main thread
     because there is one painter implementation (§5).
  3. an optional **badge/summary** field on the passive-badge model for
     format-specific status (e.g. tessellation progress, page count).
- It requires **zero** edits to the canvas host, track host, root, hit-test
  authority, or command bus. The frame container, spatial index, and
  `pickTimeline` are source-kind-agnostic: a clip is a rect with refs whether it
  decodes to video frames, a glTF preview, or a CSV sparkline.

This is the deeper reason I insist the resolver and paint IR be first-class,
single-authority seams (§2.5, §5): they are the **two and only two** extension
points for the universal-media roadmap. The coverage manifest then doubles as
the registry of "what a source kind must provide to be drawable," turning format
onboarding into a test-enforced checklist rather than tribal knowledge. Get
these two seams right and "support everything" is purely additive; get them
wrong and every new format reopens the god files.

## 3. No-God-Object Safeguards (mechanical, not prose)

The files grew *while a plan saying "keep them small" existed.* Prose did not
hold the line. These safeguards are tests/lint that fail CI — that is the point.

1. **Line-count budget test** (`tests/unit/timelineArchitectureBudget.test.ts`):
   asserts a hard cap per file. Caps ratchet *down* only. Initial:
   `Timeline.tsx ≤ 700`, `TimelineTrackRow ≤ 350`, `TimelineClipCanvasHost ≤ 350`,
   `buildTimelineFrame ≤ 60`, any single `frame/`/`paint/` module ≤ 400. New file
   added to the timeline tree without a budget entry → test fails.
2. **Import-boundary lint** (eslint `no-restricted-imports` zones, one rule per
   layer):
   - `frame/**` and `canvas/paint/**` may **not** import `stores/**`,
     `services/**`, `react`, or media globals. (Purity.)
   - `selectors/**` may import stores but not React components.
   - canvas/track/root components may not import each other's internals (only
     public hosts).
   - resolver may import only declared cache *adapter* modules.
3. **Single-authority import-absence guards** (extend existing
   `timelineCanvasDiagnostics` test style):
   - no source file outside `frame/geometry*` computes a clip rect from
     `timeToPixel` + trim once geometry is live (regex/import guard).
   - `TimelineClip.tsx` stays absent; no import of deleted modules.
   - `domClipBodyCount === 0` in canvas-mode diagnostics.
4. **Prop-count cap**: a contract test asserts `TimelineTrackProps` no longer
   exists in its flat form and the grouped contracts are present; a generic
   "component prop interface ≤ 12 fields" check for the timeline host components.
5. **Structured-clone fuzz**: generalize `isPlainTimelineRenderData` into a test
   that injects live runtime objects (`File`, `HTMLVideoElement` stub,
   `blob:` URLs, functions, class instances) into builder *inputs* and asserts
   the frame output is clone-safe. This is the runtime-leak tripwire.
6. **Frame invariants** (property test): every `model.clips[i]` has matching
   geometry and a resource entry (resolved or explicit-missing); no orphan
   geometry; `revision` strictly increases; identical inputs → referentially
   equal memoized sub-objects (proves incremental build).
7. **Fan-in discipline**: the only cross-layer entry points are
   `buildTimelineFrame`, `useTimelineFrame`, `pickTimeline`,
   `timelineCommandBus`, and the runtime coordinator. Adding a second public
   entry to any of these layers requires editing the budget test's allowlist —
   making "a new god seam" a visible, reviewed event.

These six-plus guards are the durable answer to "how do we *stay* refactored."

## 4. Phase Order (reordered from canonical, with rationale)

Guiding principle: **prove the whole vertical stack on one track before any
horizontal file dissolution**, and **land the cross-cutting command/session
layer before dissolving the files that are bloated by callbacks.** Runtime is a
continuous parallel lane, not a final phase.

| Phase | Name | Output | Why here |
|---|---|---|---|
| **0** | Guardrails | §3 safeguards (budgets, import lint, invariants, clone fuzz, import-absence). | Stop the bleeding first; every later phase is checked by these. |
| **1** | Frame builders | Pure `buildRenderTrack/Clip`, geometry leaf builders, spatial index, `buildTimelineFrame`, `useTimelineFrame`. No consumers yet. | Leaf contracts already exist; only builders missing. Pure + testable in isolation. |
| **2** | Resource resolver | `resolveTimelineResources` + cache adapters + field-manifest coverage. | Keystone between refs and draw payloads; needed before canvas can drop `CanvasClip`. |
| **3** | **Vertical slice** | One normal track: store → frame → resolver → temporary `CanvasClip` adapter → existing canvas; + invariants live. | De-risks the entire design end-to-end before touching big files. Highest-value single step. |
| **4** | Interaction sessions + commands | `interactionSession/`, `timelineCommandBus`, overlay model; migrate drag/trim/fade/marquee. | Pulled earlier: track & root cannot slim while threading ~30 callbacks. |
| **5** | Dissolve canvas | Paint IR + shared painters (worker==main), draw/resource/warmup/worker/diagnostics hooks; `CanvasClip`→frame records. | Now safe: resources (2) + geometry (1) feed it; painter parity testable. |
| **6** | Dissolve track | Extract shell mount/geometry/module builders (from `:1163-1231`), grouped props, `dispatch`, hit-test adapter. | Needs geometry (1) + commands (4) to actually shrink. |
| **7** | Dissolve root | Section/overlay/menu/playhead layers, root state hook, `TimelineSection`. | Needs commands (4) + thin track (6). |
| **R** | Runtime convergence | **Parallel lane, phases 1–7.** Audit `source.*Element` access, move allocation behind coordinator policies, reservation handles. | Infra already shipped; mostly services-layer, disjoint from UI. Finalized last. |
| **8** | Docs / dead paths / final gates | Update `docs/Features/Timeline.md`, delete orphans, full build+lint+test + canvas verification. | Standard close-out. |

Difference vs canonical, summarized: **(a)** add an explicit guardrails phase
with mechanical enforcement; **(b)** add a named *vertical slice* phase (3)
before any dissolution; **(c)** move commands/sessions before file dissolutions
(canonical Phase 5 → my Phase 4); **(d)** make runtime a continuous parallel
lane rather than the penultimate phase.

## 5. Painter IR (one implementation for worker + main thread)

The single most common canvas-refactor failure is two divergent draw paths
(`drawCanvas*` vs `drawWorker*`). Enforce one:

- Define **paint IR**: a serializable list of draw ops
  (`{op:'thumbStrip', rect, handleId}`, `{op:'waveform', rect, columnsRef}`,
  `{op:'label', rect, text, lod}`, …) produced from `frame` + resolved
  resources. IR carries **geometry rects from the snapshot**, never recomputes
  x/width.
- `paintTimeline(ctx, ir, resourceTable)` is one pure function. Main thread calls
  it directly with a `CanvasRenderingContext2D`; worker calls the identical
  function with an `OffscreenCanvasRenderingContext2D`.
- Parity test: a **draw-call recorder** mock context asserts main-thread and
  worker produce identical op streams for a fixture frame. Adding a visual
  without worker parity fails this test — so parity can never silently regress.

## 6. Focused Test Strategy

Match tests to risk; the full chain is reserved for commit/merge/release.

**Tier A — pure unit (fast, run constantly during a slice):**
- Leaf builders: `buildRenderClip/Track`, geometry leaves, resolver per visual.
- Frame invariants + incremental-memoization referential-equality test.
- Clone-safety fuzz (inject runtime objects into inputs).
- Spatial-index `pickTimeline` cases (edges, overlaps, handles vs body, z-order).
- Field-manifest **coverage gate**: enumerate every `CanvasClip` visual field
  and assert a resolver path + a paint op exist for it. Manifest is the contract
  that makes deleting `CanvasClip` safe.

**Tier B — painter parity & worker:**
- Draw-call recorder parity (main == worker) on fixture frames.
- Worker model/contract round-trip (already present — extend to geometry-rect
  consumption).

**Tier C — interaction:**
- Session lifecycle: begin/update(preview-only, asserts no store write)/commit
  (asserts exactly one edit operation)/cancel (asserts clean state).
- Stale-target no-op (commit against a deleted clip is a no-op, does not mutate a
  wrong clip or close menus).

**Tier D — architecture guards (CI-grade, §3):** budgets, import boundaries,
import-absence, prop caps, `domClipBodyCount===0`, deleted-module absence.

**Tier E — browser/bridge smokes (only when behavior changes):**
`node scripts/run-timeline-canvas-verification.mjs` with skip flags; AI-bridge
`simulateScrub`/`simulatePlayback`/`getPlaybackTrace` for playback/runtime
changes; `debugExport` for export-allocation changes.

Targeted command for the first slices:

```bash
npm run test -- tests/unit/timelineRenderModel.test.ts tests/unit/timelineFrame.test.ts \
  tests/unit/timelineResourceResolver.test.ts tests/unit/timelineSpatialIndex.test.ts \
  tests/unit/timelineArchitectureBudget.test.ts tests/unit/timelineCanvasDiagnostics.test.ts
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

## 7. Parallel Agent Strategy

Disjoint write sets, one owner per high-conflict file per phase. The frame's
single-entry design is what *makes* parallelism safe: lanes integrate through
`TimelineFrame`, `TimelinePick`, and `timelineCommandBus`, not through shared
edits to the god files.

| Lane | Owns (write set) | Consumes (read-only contract) | Never touches |
|---|---|---|---|
| **A Frame/Contracts** | `frame/**`, `selectors/**`, builder tests | existing `renderModel/` types | god files, services |
| **B Resolver/Canvas** | `canvas/**` (host, paint IR, painters, worker, hooks), resolver, worker tests | `TimelineFrame`, geometry rects | stores, `Timeline.tsx`, `TimelineTrack.tsx` |
| **C Track/Shell** | `track/**`, `interactionShell/**`, `TimelineTrack.tsx` | `TimelineFrame`, `pickTimeline`, `dispatch` | `TimelineClipCanvas.tsx`, root |
| **D Root/Layout** | `root/**`, `Timeline.tsx`, section CSS | `dispatch`, section view models | track internals, canvas internals |
| **E Commands/Session** | `commands/**`, `interactionSession/**`, overlay model, edit-op tests | edit-op kernel | services/layerBuilder, UI internals |
| **F Runtime** | `services/timeline/**`, `services/layerBuilder/**`, runtime tests | render-model cache refs | UI component files |
| **G Guardrails/Verify** | `tests/unit/timelineArchitecture*`, eslint zone config, bridge scripts, docs/handoff | everything (read) | implementation files |

**Wave schedule (maximizes concurrency, respects dependencies):**

- **Wave 1:** G lands Phase 0 guardrails. A builds frame builders + provider.
  F starts runtime audit (disjoint, services-only). *Caveat: the handoff lists
  `VideoSyncManager.ts`, `AudioTrackSyncManager.ts`, `LayerCollector.ts`,
  `blobUrlManager.ts`, `trackSlice.ts` as dirty with someone else's active work
  — F must coordinate or start on the clean runtime-coordinator/lazy-media files
  first and treat those five as off-limits until the user confirms.*
- **Wave 2:** A+B jointly fix the resolver boundary; B builds the temporary
  `CanvasClip` adapter and lands the **vertical slice** (Phase 3) on one normal
  track. D may scaffold `root/**` shells that do not import `Timeline.tsx`.
- **Wave 3 (parallel):** B dissolves canvas (paint IR/painters/worker) ‖ E
  builds interaction session + command bus ‖ F continues runtime adoption. These
  three have disjoint write sets.
- **Wave 4:** C dissolves track (needs geometry + commands from waves 2–3).
- **Wave 5:** D dissolves root (needs commands + thin track).
- **Wave 6:** F finalizes runtime convergence; G runs full gates + docs.

High-conflict single-owner files (per the handoff): `Timeline.tsx`,
`TimelineTrack.tsx`, `TimelineClipCanvas.tsx`, `TimelineClip.css`,
`TimelineTracks.css`, `useExternalDrop.ts`, `types.ts`,
`applyTimelineEditOperation.ts`, `VideoSyncManager.ts`,
`AudioTrackSyncManager.ts`. Each is owned by exactly one lane in the phase that
touches it.

## 8. First Implementation Slice (concrete, end-to-end, low-blast-radius)

Goal: prove the *entire* vertical stack on one normal video track, behind the
existing canvas, with mechanical guards live — before any god file is dissolved.
This is Phases 0→3 condensed into one shippable packet.

**Packet contents:**

1. `frame/buildTimelineRenderClip.ts` + `buildTimelineRenderTrack.ts` —
   per-entity pure builders from plain inputs (clip + media metadata + UI flags
   + cache refs). No store/React/service imports.
2. `frame/buildTimelineRenderModel.ts` — maps the leaf builders; memoizes per
   clip by `(id, revision, uiHash)`.
3. `frame/buildTimelineGeometrySnapshot.ts` — per-track/clip geometry from
   measured section inputs + `pxPerSecond`; **the only** producer of clip rects.
4. `frame/buildTimelineSpatialIndex.ts` + `pickTimeline.ts`.
5. `frame/resolveTimelineResources.ts` — thumbnail + waveform paths first;
   others return explicit `missing` placeholders (full coverage is Phase 2).
6. `frame/buildTimelineFrame.ts` (≤ 60 lines) + `useTimelineFrame.ts`.
7. `canvas/adapters/frameToCanvasClip.ts` — **temporary** adapter mapping frame
   records back to today's `CanvasClip` so the existing renderer is untouched.
   (Explicitly labeled transitional; deleted in Phase 5.)
8. Wire **only** the normal `TimelineTrack` canvas mount seam (not the
   composition-switch seam, not `Timeline.tsx`) to flow
   `store → useTimelineFrame → frameToCanvasClip → <TimelineClipCanvas>`.
9. Tests: builder purity + clone fuzz; frame invariants; incremental referential
   equality; `pickTimeline` cases; resolver coverage for thumbnail+waveform;
   diagnostics asserting canvas input count == store clip count; the §3
   architecture-budget test seeded with current caps.

**Why this slice:** it exercises selectors → builders → resolver → spatial index
→ provider → adapter → real canvas, plus every guardrail, while changing exactly
one mount seam. If anything in the design is wrong (memoization, clone-safety,
geometry parity, resource gaps), it surfaces here at minimal blast radius. After
it lands and is verified, the three god files can be dissolved in parallel waves
with confidence, each lane integrating only through `TimelineFrame`.

**Checks for the slice (no full chain unless the user asks for readiness):**

```bash
npm run test -- tests/unit/timelineFrame.test.ts tests/unit/timelineRenderModel.test.ts \
  tests/unit/timelineSpatialIndex.test.ts tests/unit/timelineResourceResolver.test.ts \
  tests/unit/timelineArchitectureBudget.test.ts tests/unit/TimelineTrack.test.tsx \
  tests/unit/timelineCanvasDiagnostics.test.ts
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

## 9. Explicit Non-Goals / Do-Not

- Do not restore `TimelineClip.tsx` or any full/selected-only DOM clip body.
- Do not create a parallel `viewModel/` package. The frame is a *container* over
  the two existing artifacts + resolved resources, with one build entry — not a
  re-derivation of clip/track data in a third shape.
- Do not let `buildTimelineFrame` accrete field logic; it stays a fan-out.
- Do not let any `frame/**` or `paint/**` module import stores, services, React,
  or media globals (lint-enforced).
- Do not keep two painter implementations; worker and main thread share paint IR.
- Do not allocate media elements anywhere in `frame/`, `canvas/`, or the
  resolver. Runtime objects live only behind coordinator policies.
- Do not special-case a new source kind (3D, document, CAD, data, point cloud)
  inside the host, track, root, hit-test, or command code; format-specific logic
  lives only in the resolver branch and the paint IR/painters.
- Do not run the full build/lint/test chain after every slice; run §6 tiers by
  risk, full chain only at commit/merge/release/final-readiness.

## 10. Success Criteria

- `Timeline.tsx ≤ 700`, `TimelineTrackRow ≤ 350`, `TimelineClipCanvasHost ≤ 350`,
  `buildTimelineFrame ≤ 60`, all `frame/`/`paint/` modules ≤ 400 — enforced by a
  ratcheting budget test, not by hope.
- One subscription (`useTimelineFrame`); zero per-clip React subscriptions for
  passive visuals; redraw cost proportional to per-frame dirty set.
- One geometry producer, one hit-test authority (`pickTimeline`), one command
  bus, one painter implementation — each protected by import-absence guards.
- `CanvasClip` deleted; canvas consumes frame records + resolved resources.
- Frame output is clone-safe under runtime-object fuzz; `domClipBodyCount === 0`.
- All runtime allocation policy-owned and reported; project load creates no
  timeline-UI-owned media elements.
- Field-manifest coverage gate green (no dropped visual).
- A new `TimelineSourceKind` can be onboarded with edits confined to the resolver,
  the paint IR/painters, and the badge model — enforced by the coverage manifest
  — with zero changes to host, track, root, hit-test, or command code.
- Full build + lint + test + `run-timeline-canvas-verification.mjs` pass before
  normal push/merge readiness.
