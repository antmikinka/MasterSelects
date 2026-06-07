# Timeline System Refactor — Opus Agent 3 Independent Proposal

> Independent design input for synthesis. The canonical plan remains
> `docs/refactor/Timeline-System-Refactor-Plan.md`. This document is my own
> assessment after reading the live code, not a rewrite of that plan. Where I
> agree with the canonical plan I say so; where I diverge I say why.

## 0. Verdict On The Existing Plan

The canonical plan is mostly right and unusually well-grounded. After reading the
real files I can confirm its core premises hold:

- The `renderModel/` contracts (`types.ts`, `geometry.ts`) are genuinely good and
  worth building on. `TimelineSourceKind` already lists `model`,
  `gaussian-splat`, `vector-animation`, `midi`, and `data`, so the contract was
  drafted with the June-2026 "everything is a signal" goal in mind.
- The runtime coordinator is real and complete: `TIMELINE_RUNTIME_POLICY_IDS`
  ships eight policies and `runtimeCoordinatorTypes.ts` is a full admission/
  reporting contract. Phase "runtime" is adoption and audit, not construction.
- The edit-operation kernel (`applyTimelineEditOperation.ts` plus
  `editOperations/*`) is already a typed command kernel. The missing piece is the
  UI-side routing into it, not the kernel itself.
- The `interactionShell/` types and parity matrix are mature; DOM is correctly
  scoped to active-only.

So I keep the keystones: two durable artifacts, a first-class resource resolver,
no `viewModel/` mega-package, no resurrection of `TimelineClip.tsx`, builders
that never import stores.

**Where I diverge** (detailed below):

1. **Split time-domain layout from pixel-domain projection.** A single
   `TimelineGeometrySnapshot` rebuilt every scroll/zoom frame is a performance
   regression waiting to happen. Geometry must be a cheap *projection* of an
   edit-stable layout model, not a per-frame rebuild.
2. **Make the per-clip visual a discriminated union by source kind**, so adding
   PDF / 3D / point-cloud / CAD clips is additive, not a core-type edit. This is
   the direct lever for the project goal and the canonical plan does not address
   it.
3. **Two-stage resource resolver** (pure key derivation, then allocation-free
   acquisition) so demand, warmup, worker, and main thread all share stage one.
4. **Coherence epoch** stamped across artifacts so a consumer can never mix a
   stale render model with fresh geometry.
5. **Phase by vertical seam, not by file.** Prove the whole stack on one real
   track before dissolving any god-file. File dissolution is then de-risked
   widening, not exploration.
6. **No-god-object safeguards become enforced tests/lint**, not prose.

---

## 1. Target Architecture

### 1.1 The core idea: layout is time-domain, geometry is pixel-domain

Today, `TimelineTrack` and `TimelineClipCanvas` both recompute clip rectangles
from `timeToPixel(...)` plus trim/drag math on every render. `Timeline.tsx`
keeps parallel geometry for overlays, playhead, marquee, and drop targets. That
duplication is the real disease; the file sizes are a symptom.

The cure is one directional pipeline with a deliberate split at the pixel
boundary:

```text
store plain state ─┐
media metadata ────┤  thin selectors (collect plain inputs only)
transient UI state ┘
        │
        ▼
TimelineLayoutModel        time-domain, edit-stable, memoized
  per-track layout intent  (changes only on edits, track order, height)
  per-clip layout intent   (timeRange, lane, stacking, link role)
        │
        ├───────────────► TimelineRenderModel   semantic "what to draw"
        │                   per-clip visual descriptor (union by source kind)
        │
        ▼
TimelineViewProjection     pure { pxPerSecond, scrollX, scrollY, viewport }
        │
        ▼
projectTimelineGeometry(layout, projection)  → TimelineGeometrySnapshot
  cheap: rect = timeRange * pps - scroll      "where to draw / hit-test"
        │
        ▼
TimelineSpatialIndex       hit testing, marquee, drop targets
```

The win: **scroll and zoom never rebuild the layout model or the render model.**
They only re-run `projectTimelineGeometry`, which is a pure arithmetic pass over
stable layout intents and produces the existing `TimelineGeometrySnapshot`
shape. Edits rebuild layout (and only the affected tracks). Hover/selection
touch only the render model's transient `state` fields. This is what keeps a
100-clip comp at interactive frame rates and is the single most important
structural decision in this proposal.

This is fully compatible with the existing `geometry.ts` contract: its
`TimelineViewportGeometry` already carries `pxPerSecond`, `scrollX`, `scrollY`,
and `timelineTimeRangeToRect(range, trackRect, pxPerSecond)` is already the exact
projection primitive. I am formalizing a boundary the contract already implies.

### 1.2 Module homes (evolve `renderModel/` in place — do not fork it)

The canonical plan warns against a second competing contract area, and it is
right. I deliberately grow the existing `renderModel/` folder rather than adding
a parallel `model/` or top-level `geometry/`:

```text
src/components/timeline/renderModel/
  types.ts            (exists) semantic render contract
  geometry.ts         (exists) geometry contract + rect helpers
  index.ts            (exists) barrel
  layout/
    timelineLayoutTypes.ts          time-domain contract (new)
    buildClipLayoutIntent.ts        per-clip pure builder
    buildTrackLayoutIntent.ts       per-track pure builder
    buildTimelineLayoutModel.ts     thin composer of the two above
  render/
    visual/
      timelineClipVisualTypes.ts    discriminated union by source kind
      videoVisualDescriptor.ts
      audioVisualDescriptor.ts
      compositionVisualDescriptor.ts
      signalVisualDescriptor.ts     fallback for model/splat/data/midi/...
    buildTimelineRenderClip.ts
    buildTimelineRenderTrack.ts
    buildTimelineRenderModel.ts     thin composer
  projection/
    buildTimelineViewProjection.ts  pure { pps, scrollX, scrollY, viewport }
    projectTimelineGeometry.ts      (layout, projection) -> geometry snapshot
    buildTimelineSpatialIndex.ts
    timelineHitTesting.ts
    timelineDropTargets.ts
    timelineMarqueeExclusions.ts
  frame/
    timelineFrameTypes.ts           coherence envelope
    buildTimelineFrame.ts           composes refs + stamps one epoch

src/components/timeline/canvas/resources/
  resolveTimelineResourceKeys.ts    stage 1: pure key derivation
  acquireTimelineCanvasResources.ts stage 2: allocation-free acquisition
  acquireTimelineWorkerResources.ts stage 2 for worker payloads
  timelineResourceTypes.ts
  timelineResourceCoverage.ts       field-coverage oracle vs CanvasClip
```

### 1.3 Extensible per-clip visual descriptor (forward capability)

The current `TimelineRenderClip` bakes video/audio fields (`cacheRefs` with
thumbnails, waveform, spectrogram) into the base type. That does not scale to
PDF, glTF, DXF, point clouds, or arbitrary data signals.

Replace the flat visual fields with a discriminated union:

```ts
type TimelineClipVisual =
  | { kind: 'video'; thumbnails?: TimelineThumbnailCacheRef; /* ... */ }
  | { kind: 'audio'; waveform?: TimelineWaveformCacheRef; spectrogram?: ...; }
  | { kind: 'composition'; segmentRefs?: ...; mixdown?: ...; }
  | { kind: 'signal'; previewKind: 'midi' | 'model' | 'splat' | 'data' | 'vector';
      summary?: TimelineSignalPreviewRef };

interface TimelineRenderClip {
  /* identity, timing, state, badges, markers, fade unchanged */
  visual: TimelineClipVisual;     // replaces the flat cacheRefs surface
}
```

Adding a new media type (a PDF strip, a 3D turntable poster, a point-cloud
density bar) becomes: add a union arm + a `*VisualDescriptor` builder + a draw
module + a resolver case. The core clip type, projection, hit-testing, and
command bus never change. This is the architectural expression of the project
goal, and it is cheap to introduce now while the consumer count is still zero.

`cacheRefs` stays as the underlying ref vocabulary; `visual` is the typed,
per-kind packaging of those refs.

### 1.4 Coherence epoch

Two independently built artifacts can desync within a frame (clip present in
render model, absent in geometry mid-edit). Introduce a thin envelope:

```ts
interface TimelineFrame {
  epoch: number;                  // monotonically bumped on rebuild
  layout: TimelineLayoutModel;    // by reference
  render: TimelineRenderModel;    // by reference, stamped with same epoch
  geometry: TimelineGeometrySnapshot;
  projection: TimelineViewProjection;
}
```

`buildTimelineFrame` only *composes references and stamps one epoch*. It must
contain no per-clip loops beyond assembly — enforced by a budget test so it can
never grow into the new god object. Consumers assert `render.epoch ===
geometry.epoch` in dev builds. This is a coherence wrapper, not a re-derivation,
so it does not violate the "no parallel viewModel package" rule.

### 1.5 Data / runtime / command boundaries (kept from canonical, sharpened)

- **Persisted timeline data** stays runtime-free exactly as the canonical plan
  states. No `File`, no object URLs, no media elements, no players.
- **Runtime allocation** stays behind `timelineRuntimeCoordinator` policies. UI
  emits *demand* (`hasTimelineVisualRenderDemand`-style), services *allocate*.
- **Commits** route through `applyTimelineEditOperation`. The new UI command bus
  is a router to that kernel, never a second store.

---

## 2. No-God-Object Safeguards (enforced, not aspirational)

The canonical plan says "compose pure builders." That is necessary but not
self-enforcing. I add machine-checked guards so the architecture cannot rot
silently. All live in `tests/unit/` and run in the focused loop.

| Safeguard | Mechanism | Test file |
|---|---|---|
| **Size budgets** | Assert max source lines per role: `Timeline.tsx` ≤ 900, `TimelineTrack.tsx` ≤ 500, canvas host ≤ 400, each builder ≤ 250, each draw module ≤ 200, `buildTimelineFrame` ≤ 80. | `timelineArchitectureBudgets.test.ts` |
| **Import direction** | `renderModel/**` (layout/render/projection/frame) must not import `stores/**`, `components/**`, React, or runtime services. Resolver stage 1 must not import the coordinator. | `timelineLayering.test.ts` (static import scan) + ESLint `no-restricted-imports` zones |
| **Fan-in cap** | No new shared module may be imported by more than 3 host files. Stops a "helpers" file becoming the next center of gravity. | `timelineLayering.test.ts` |
| **Purity / clone-safety** | Every builder output passes `findTimelineRuntimeReferences(...) === []` even with adversarial inputs (live `File`, `HTMLVideoElement`, blob URLs, WebCodecs handles, native decoder stubs). | extend `timelineRenderModel.test.ts` + per-builder tests |
| **Frame is composition-only** | `buildTimelineFrame` output must deep-equal the independently built parts; it may not introduce fields. | `timelineFrame.test.ts` |
| **Contract drift** | `schemaVersion` pinned; a shape snapshot fails if a field is added/removed without a version bump. | contract tests |
| **Single visible renderer** | `domClipBodyCount === 0`; canvas input count === store clip count for the track. | `timelineCanvasDiagnostics.test.ts` (exists) |

The size budgets are deliberately set as *tests*, not docs, because the success
criteria in the canonical plan ("under 900 lines", etc.) are otherwise unowned
and will drift the moment the refactor lands.

---

## 3. Phase Order (vertical seam first, then horizontal dissolution)

I reorder the canonical phases. The canonical order is file-by-file
(model → canvas → track → root). The risk: dissolving `TimelineClipCanvas`
before geometry drives hit-testing means extracting draw code that still depends
on `timeToPixel`, then re-plumbing it again in the track phase. That is double
work on the highest-conflict files.

Instead, prove the **entire seam on one track**, then widen.

### Phase A — Contracts, projection split, guardrails (foundation)
- Land `layout/`, `projection/`, `frame/` contracts and the visual-descriptor
  union. Extend `render/` and `resources/` contracts.
- Land all no-god-object guard tests (§2) seeded against current files.
- **Freeze the contracts.** This freeze is the gate that unlocks parallelism.

### Phase B — Vertical slice: one normal track, end to end, behind a dev flag
- Wire store inputs → `buildTimelineLayoutModel` → `buildTimelineRenderModel`
  (+ visual descriptors) → `projectTimelineGeometry` → resource resolver →
  temporary `CanvasClip` adapter for drawing, **and** geometry-driven hit-test +
  shell mount for that one track.
- Dev flag `timelineRenderModelPath` (default off). Old path stays default.
- Golden differential test: old vs new geometry and draw-call IR must match for
  a fixture set.
- This single slice exercises layout, render, projection, resolver, hit-test,
  and shell — proving every contract before any god-file is cut.

### Phase C — Widen + dissolve `TimelineClipCanvas.tsx` (canvas owner)
- All tracks on the projection path. Extract pure draw modules. **One paint IR**
  for worker and main thread, proven by a draw-call recorder. Delete
  `CanvasClip`. Keep the exported component name stable.

### Phase D — Dissolve `TimelineTrack.tsx` (track owner)
- Row host consumes a `TimelineFrame` slice + a command dispatcher. Shell mount
  model and commands built from geometry, not closures. Collapse the ~50-prop
  `TimelineTrackProps` into: track view model, interaction view model, command
  dispatcher, measured refs.

### Phase E — Dissolve `Timeline.tsx` (root owner)
- Root shell + focused hooks/components for section layout, split focus, overlay
  stack, menu layer, new-track zones, composition-switch, playhead DOM sync.
  `renderTrackSection` becomes a `TimelineSection` component fed by the frame.

### Phase F — Interaction command convergence (commands lane)
- UI command bus routes pointer/menu/drop/keyframe descriptors into
  `applyTimelineEditOperation`. Previews stay local; commits are typed. Stale
  targets no-op without closing menus or mutating the wrong clip.

### Phase G — Runtime boundary convergence (runtime lane, can start early)
- Audit residual `source.videoElement/audioElement/imageElement` access. Move
  new allocations behind coordinator policies; prefer reservation handles
  (`reserve() -> { accepted, release() }`). Diagnostics refresh stays
  allocation-free. Adoption/audit only — the infra exists.

### Phase H — Docs, dead paths, flag removal, final gates
- Remove `timelineRenderModelPath` (the path becomes the only path). Update
  `docs/Features/Timeline.md`, supersede stale refactor docs, delete orphan
  tests after replacement coverage exists. Full build/lint/test + browser
  verification.

**Ordering rationale:** A unlocks parallelism; B de-risks the whole stack on one
track; C/D/E are now mechanical widening on disjoint god-files; F/G are
independent lanes. The dev flag is a short-lived *construction-path* toggle (old
`CanvasClip` mapping vs new pipeline), not a DOM-vs-canvas visual fallback, so it
does not violate the canonical "no incomplete-parity fallback" rule. It is
deleted in Phase H.

---

## 4. Parallel Agent Strategy

Parallelism is gated, not assumed. The gate is **the Phase A contract freeze plus
the Phase B vertical slice.** Before that gate, one lane owns contracts and
everyone else reviews. After it, lanes fan out behind frozen interfaces so their
write sets cannot collide.

| Lane | Owns | Starts | Must avoid |
|---|---|---|---|
| **L0 Contracts/Integration** | `renderModel/**` contracts, `frame/`, guard tests, the dev flag, golden fixtures, handoff | Phase A | god-files |
| **L1 Canvas** | `canvas/**`, draw modules, worker model, resolver stage 2 | after gate | `Timeline.tsx`, stores |
| **L2 Track/Shell** | `track/**`, `interactionShell/**`, `TimelineTrack.tsx` | after gate | `TimelineClipCanvas.tsx` |
| **L3 Root/Layout** | `root/**`, `Timeline.tsx`, section CSS | after gate | `TimelineTrack.tsx`, canvas internals |
| **L4 Commands** | `commands/**`, context-menu helpers, edit-op tests | after gate | runtime/layerBuilder files |
| **L5 Runtime** | `services/timeline/**`, `services/layerBuilder/**` | **may start in Phase A** | UI component files |

Rules:
- **Single owner per god-file per phase.** High-conflict files
  (`Timeline.tsx`, `TimelineTrack.tsx`, `TimelineClipCanvas.tsx`, the two CSS
  files, `useExternalDrop.ts`, `types.ts`, `applyTimelineEditOperation.ts`,
  `VideoSyncManager.ts`, `AudioTrackSyncManager.ts`) have exactly one owner.
- **Contract-change RFC.** Any change to a frozen contract requires updating the
  contract file, bumping `schemaVersion`, and notifying L0. No lane edits a
  contract silently.
- **L5 runs early.** Runtime adoption/audit is infra that already exists and
  touches services, not UI — it parallelizes from day one *except* on currently
  dirty files (`VideoSyncManager.ts`, `AudioTrackSyncManager.ts`,
  `blobUrlManager.ts`, `trackSlice.ts`, `LayerCollector.ts`) until the user
  confirms those are free.
- L0 is also the integration owner: it runs the golden differential suite and
  resolves cross-lane geometry/parity disputes.

---

## 5. Focused Test Strategy

The refactor is high-risk because it moves rendering and hit-testing. The safety
net is **differential and parity testing against the current behavior**, plus the
architecture guards. The full chain stays reserved for commit/merge readiness.

1. **Contract / property tests.** Clone-safety and purity for every builder with
   adversarial runtime inputs. Field-coverage oracle: every `CanvasClip` field
   maps to a render-model or visual-descriptor home, so deleting `CanvasClip`
   cannot silently drop a visual.
2. **Golden differential fixtures.** A fixture set covering the real range:
   empty timeline, single video, 100-clip composition, linked A/V pair, nested
   composition with mixdown, MIDI clip, audio with spectrogram, and in-progress
   trim/fade/drag. Snapshot geometry + draw-call IR. During migration assert
   `old === new`; after, assert `new === golden`.
3. **Painter parity.** A draw-call recorder against a mock 2D context shared by
   worker and main paint IR — the oracle that prevents divergent draw paths.
4. **Hit-test parity.** For each fixture, sweep a grid of points and assert the
   spatial-index result equals the legacy hit result (clip body, handles,
   keyframe diamonds, transition drop zones, marquee exclusions).
5. **Architecture guards (§2).** Size budgets, import direction, fan-in,
   frame-composition, contract drift.
6. **Diagnostics assertions.** `domClipBodyCount === 0`; canvas input count ===
   store count; runtime allocation reported per policy; diagnostics refresh
   allocates nothing.
7. **Browser/bridge smokes** only when drawing, worker handoff, hit-testing,
   playback, export, or project-load actually change
   (`scripts/run-timeline-canvas-verification.mjs`, the AI bridge repros).

Per-slice default loop:
```bash
npm run test -- <narrow files for the slice>
npx tsc -p tsconfig.app.json --noEmit --pretty false
```
Full `npm run build && npm run lint && npm run test` + verification script only
at commit/merge/final readiness, reusing the last green result on the same HEAD.

---

## 6. First Implementation Slice

A precise, self-contained packet that lands the foundation and proves the seam on
one track. Ordered so each step compiles and tests green before the next.

1. **Layout contracts + builders.** `renderModel/layout/timelineLayoutTypes.ts`,
   `buildClipLayoutIntent.ts`, `buildTrackLayoutIntent.ts`,
   `buildTimelineLayoutModel.ts` — time-domain, pure, store-free. Tests:
   clone-safety; *edit-stability* (same edit set → identical layout; changing
   scroll/zoom → byte-identical layout).
2. **Projection.** `buildTimelineViewProjection.ts` + `projectTimelineGeometry.ts`
   producing the existing `TimelineGeometrySnapshot`. Test: projecting a fixture
   at two `(scrollX, pps)` values matches today's `timeToPixel` /
   `timelineTimeRangeToRect` output from `TimelineTrack` (differential).
3. **Render model + visual union.** `render/visual/*` + per-clip/per-track
   builders + `buildTimelineRenderModel.ts`. Field-coverage test mapping every
   `CanvasClip` field to a render-model / visual home.
4. **Resource resolver, two stages.** `resolveTimelineResourceKeys.ts` (pure) +
   `acquireTimelineCanvasResources.ts` (allocation-free), with a temporary
   adapter back to `CanvasClip` so existing draw code is untouched. Cover
   thumbnail / waveform / spectrogram / composition / fade / midi / missing.
5. **Frame envelope.** `frame/buildTimelineFrame.ts` + budget test (≤ 80 lines,
   composition-only).
6. **Vertical wiring behind `timelineRenderModelPath` (default off).** Route one
   normal `TimelineTrack` canvas mount through layout → render → projection →
   resolver → adapter, plus geometry-driven hit-test/shell mount for that track.
   Leave composition-switch and all other tracks on the old path. Add the parity
   assertion and diagnostics counts.
7. **Guard seeds.** `timelineLayering.test.ts` (import direction + fan-in),
   `timelineArchitectureBudgets.test.ts`, and the `TimelineClip.tsx` absence
   guard.

Focused checks for this slice:
```bash
npm run test -- tests/unit/timelineRenderModel.test.ts \
  tests/unit/timelineLayoutProjection.test.ts \
  tests/unit/timelineResourceResolver.test.ts \
  tests/unit/timelineLayering.test.ts \
  tests/unit/timelineCanvasDiagnostics.test.ts \
  tests/unit/TimelineTrack.test.tsx
npx tsc -p tsconfig.app.json --noEmit --pretty false
```
Do not run the full build/lint/test chain for this slice unless the user asks for
commit/push/final readiness.

**Why start here, not at `Timeline.tsx`:** the root file is the *consequence* of
the missing pipeline, not the cause. Build the pipeline, prove it on one track
with differential and hit-test parity, and the three god-files then dissolve into
hosts almost mechanically — with the guard tests preventing any of them from
becoming the next god object.

---

## 7. Delete / Collapse Inventory

The file sizes are a symptom; the disease is **duplicated geometry plus one fat
clip type forced through the entire stack.** This inventory names exactly what
disappears, grounded in the live code. Nothing here is removed before its
replacement has coverage (§5).

### 7.1 Delete outright (once replaced + covered)

| Target | Location | Replaced by | Phase |
|---|---|---|---|
| `CanvasClip` fat type | `TimelineClipCanvas.tsx:128–172` | `TimelineRenderClip` + `TimelineClipVisual` union (§1.3) | C |
| `areTimelineTrackPropsEqual` custom memo comparator | `TimelineTrack.tsx:1757–1818` | trivial ref-equality once `TimelineTrackProps` collapses to 4 grouped contracts | D |
| Duplicate worker-vs-main draw code | worker draw path vs `drawCanvas*` in `TimelineClipCanvas.tsx` | one shared paint IR + `canvas/draw/*` (handoff flags this exact risk) | C |
| `timelineRenderModelPath` dev flag | introduced in Phase B | nothing — the path becomes the only path | H |
| Stale refactor/optimization docs naming the DOM body as active | `docs/refactor/*`, `docs/Features/*` | this plan + updated `Timeline.md` | H |

`CanvasClip` is the keystone deletion: it is the single artifact that forces
rich, runtime-adjacent clip data through the render stack. Almost everything else
in this plan exists to make its removal safe.

### 7.2 Collapse (many call sites → one source of truth)

| What collapses | Today | After |
|---|---|---|
| **Per-frame geometry math** | 212 `timeToPixel`-based computations across 15 files | consumers read `projectTimelineGeometry` output; no component recomputes `time·pps − scroll` |
| **Inline draw functions** | ~25 `drawCanvas*`/`draw*` in `TimelineClipCanvas.tsx:293–2566` | pure `canvas/draw/*` modules (≤200 lines each), one set for both paint paths |
| **Duplicated section JSX** | `renderTrackSection` closure `Timeline.tsx:2972`, invoked at `:3798` + `:3855` | one `TimelineSection` component fed by the frame |
| **Root mega-body** | ~2,500-line `Timeline()` body (`:458–2972`) | thin root shell + focused hooks (`useTimelineSectionLayout`, `useTimelineSplitFocus`, …) |
| **Keyframe-row sub-component** | `TrackPropertyTracks` `TimelineTrack.tsx:264–666` (~400 lines) | `track/TimelineTrackPropertyRows.tsx` driven by snapshot keyframe-row geometry |
| **Shell mount closures** | ad-hoc closures inside `TimelineTrackComponent` | `buildTrackShellMountModel` / `buildTrackShellCommands` from geometry |
| **Scattered hit testing** | marquee/drop/body/handle math in `useMarqueeSelection`, `TimelineTrack`, `Timeline` | `buildTimelineSpatialIndex` + `timelineHitTesting` |
| **External-drop sprawl** | `hooks/useExternalDrop.ts` (1954 lines) | drop descriptors routed through the command bus + placement geometry from the snapshot |

### 7.3 Do NOT delete (cleanup guards)

The dirty worktree (`VideoSyncManager.ts`, `AudioTrackSyncManager.ts`,
`blobUrlManager.ts`, `trackSlice.ts`, `LayerCollector.ts`) is other agents'
active work — leave it. Beyond that:

- **Keep** `interactionShell/**` types and the parity matrix. They are the
  active-DOM contract, not legacy.
- **Keep** `TimelineClip.css`. It is shell/overlay styling, not the retired DOM
  body.
- **Keep, then migrate** legacy `source.videoElement/audioElement/imageElement`
  fields behind runtime adapters. Do not strip them while history, restore,
  playback, and cleanup paths still read them. Phase G audits; it does not
  amputate.
- **Extend, never fork** `renderModel/types.ts` and `geometry.ts`. A second
  competing contract folder is itself a thing to be deleted on sight.

---

## 8. Success Criteria (delta over canonical)

I keep all canonical success criteria (`Timeline.tsx` < 900, `TimelineTrack.tsx`
< 500, canvas host < 500, `domClipBodyCount === 0`, policy-owned runtime, focused
coverage). I add:

- Scroll and zoom rebuild **only** the projection, never the layout or render
  model (asserted by an allocation/rebuild-count test on the fixtures).
- Adding a new source kind requires **zero edits** to projection, hit-testing,
  the command bus, or the core clip type — only a new visual union arm + builder
  + draw module + resolver case.
- Every god-file size limit is enforced by a failing test, not a hope.
- `render.epoch === geometry.epoch` holds for every emitted frame.
