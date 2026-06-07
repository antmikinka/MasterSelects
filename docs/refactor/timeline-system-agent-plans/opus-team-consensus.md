# Opus Team Timeline Consensus

Date started: 2026-06-07

Source inputs for the Opus team:

- `codex-1-plan.md`
- `codex-2-plan.md`
- `codex-3-plan.md`
- `docs/refactor/Timeline-System-Refactor-Plan.md` (the "current repo plan" that
  all three Codex plans explicitly react to)

Consensus standard (from the protocol): not "least controversial," but the most
maintainable, performant, and capable architecture the team can defend. Risk,
churn, and implementation size are not limiting constraints. Avoid new god
objects.

---

## Current Consensus

**Status: FINAL — Opus Team consensus.** Agent 1 established the architecture and
the open questions; Agent 2 verified it against HEAD and closed OD1/OD3/OD4;
Agent 3 verified the dependency graph behind the kernel boundary and closed the
remaining OD2/OD5/OD6/OD7. Every section below is a team decision, not a draft.
The only residual dissent is recorded at the very end of "Open Disagreements" and
is explicitly non-blocking.

### A. Grounding facts (verified against HEAD, not assumed)

These anchor the plan so we converge on the real codebase, not three different
mental models of it.

1. `src/timeline/` does **not** exist yet. The "pure kernel" proposed by Codex 2
   and Codex 3 is greenfield, not a rename of something shipped.
2. `src/components/timeline/renderModel/` **does** exist and already ships:
   `TimelineRenderModel`/`TimelineRenderClip`/`TimelineRenderTrack` types,
   geometry types (`TimelineGeometrySnapshot`, rects, handles, drop targets,
   marquee exclusions, ruler, trim preview), and clone-safety helpers
   (`findTimelineRuntimeReferences`, `isPlainTimelineRenderData`). So the
   contracts already have a partial home; the question is *where they should
   live long term*, not whether to invent them.
3. `src/services/timeline/` already ships substantial runtime/cache
   infrastructure: `timelineRuntimeCoordinator`, `runtimeCoordinatorContracts`,
   `runtimeCoordinatorTypes`, `cacheSchedulerContracts`, `cacheSchedulerTypes`,
   `lazyMediaElements`, `lazyImageElements`, `imageRuntimeHydrator`, the
   `*Warmup` family (thumbnail DB/generation, waveform, spectrogram, audio
   analysis, source waveform), `timelineCanvasDiagnostics`, and the
   `*RuntimeReporting` family. **Runtime ownership is adoption work, not a
   greenfield build.**
4. A small `src/services/timeline/timelineVisualDemand.ts` already exists, but it
   only answers "is there a visible clip at the playhead" — it is **not** the
   viewport-aware visual-resource demand engine the plans describe. The name is
   partially taken; the concept is mostly greenfield.
5. The current repo plan (`Timeline-System-Refactor-Plan.md`) keeps contracts in
   `src/components/timeline/renderModel/` and proposes a stateful
   `timelineCommandBus.ts`. Per its own baseline table the god-files are
   `Timeline.tsx` (~3748 LOC), `TimelineClipCanvas.tsx` (~3246),
   `VideoSyncManager.ts` (~3122), `useExternalDrop.ts` (~1954),
   `TimelineTrack.tsx` (~1713), `applyTimelineEditOperation.ts` (~1415).
6. The active full-DOM clip renderer (`TimelineClip.tsx`) is already deleted and
   stays deleted; `domClipBodyCount === 0` is an existing invariant. None of the
   three Codex plans, and this consensus, reopen DOM clip bodies.

### A (cont.). Additional facts verified by Agent 2 (turn 2, against HEAD)

These sharpen several open disagreements from "open question" to "decided," so
they belong in the grounding section, not just the turn log.

7. **The `TimelineRenderModel` rename is nearly free, and the contract is not yet
   load-bearing.** `TimelineRenderModel`/`Clip`/`Track` and friends appear in only
   **four** source/test files: `renderModel/types.ts` (the definition),
   `renderModel/index.ts` (re-exports), `stores/timeline/historyTimelineContracts.ts`
   (one reference), and `tests/unit/timelineRenderModel.test.ts`. Every other hit
   (83 of 87) is in `docs/`. Critically, `TimelineClipCanvas.tsx` still draws from
   `CanvasClip`, **not** `TimelineRenderClip` — the shipped render-model contract is
   aspirational scaffolding, not wired into the live draw path. Renaming it while we
   move it to the kernel costs ~4 files. This closes OD1.
8. **The cache scheduler already owns priority, coalescing, and media-element
   policy.** `cacheSchedulerContracts.ts` ships `TIMELINE_CACHE_LANE_DESCRIPTORS`
   with per-lane `priority: 'visible' | 'near-visible' | 'background'`,
   `mediaElementPolicy: 'forbidden' | 'detached-background-only'`, coalescing
   scopes/fields, and key builders. The new demand stage must **not** re-invent
   priority classification or lane taxonomy; it emits demand keyed into this
   shipped vocabulary. This reshapes OD4.
9. **`timelineVisualDemand.ts` is render-loop gating, not resource demand.** Its
   only exports (`hasActiveTimelineVisualClip`, `hasTimelineVisualRenderDemand`)
   answer "is any visible visual clip live at the playhead," and its consumers are
   `usePlaybackLoop`, `useEngine`, and `playbackHealthMonitor` — i.e., "should the
   engine render this frame," a playback concern. The name collides with the new
   stage; the concept does not. This reshapes OD4.
10. **The runtime coordinator already ships a rich resource-kind vocabulary.**
    `RENDER_RESOURCE_KINDS` includes `video-frame-provider`, `audio-source-clock`,
    `image-canvas`, `native-decoder`, `nested-composition-texture`, `gpu-texture`,
    `model`, `gaussian-splat`, `motion-data`, `runtime-binding`, and `job`, plus the
    8 shipped policy descriptors (`interactive`, `background`, `slot-deck`,
    `composition-render`, `thumbnail`, `render-target`, `ram-preview`, `export`).
    Codex 1's provider taxonomy (video/audio/image/model/data) is therefore *partly
    a reinvention*; providers must bind to the shipped `RenderResourceKind`, not a
    parallel list. The "every file is a visual signal" future is already partially
    modeled here (`model`/`gaussian-splat`/`motion-data`). This reshapes B11.
11. **The worker draw contract is already domain-level with transferables.**
    `timelineClipCanvasWorkerContract.ts` defines per-facet resources
    (`...ThumbnailStripResource` carrying `ImageBitmap`; `...WaveformResource`,
    `...SpectrogramResource`, `...MidiPreviewResource` carrying `Float32Array`;
    composition/trim/fade/passive-decoration resources), aggregated per clip in
    `TimelineClipCanvasWorkerClip`, sent in a per-track `...DrawMessage` with a
    `transferables: Transferable[]` list. This is *already* the domain-packet model
    OD6 debates. We adopt it as the seed of `TimelinePaintPacket`; we are not
    inventing a transfer scheme. This largely resolves OD6.
12. **`CanvasClip` is the concrete coverage target and carries runtime fields.**
    `CanvasClip` (in `TimelineClipCanvas.tsx`) enumerates the exact fields the
    coverage gate must map (timing, trim, linking, download, transcript, analysis,
    thumbnails, composition/mixdown, waveform/channels, audioState, midiData, fade),
    and it carries `file?: File` and a `source?: {...}` object — concrete runtime
    payloads the projection's clone-safety guard must strip. Overscan constants
    (`THUMBNAIL_VIEWPORT_OVERSCAN_PX = 600`, `CANVAS_RENDER_OVERSCAN_PX = 1200`)
    live here today and are what the demand stage must centralize.

### A (cont.). Additional facts verified by Agent 3 (turn 3, against HEAD)

These settle the kernel-boundary mechanics (OD7) on the real dependency graph
rather than on the abstract "relocate vs. allowlist" framing.

13. **The canonical data schema lives in `src/types/`, and that barrel is already
    pure.** `TimelineClip` (`src/types/index.ts:709`) and `TimelineTrack`
    (`src/types/index.ts:830`) are defined in the app-wide `src/types/` barrel,
    **not** in `src/stores/timeline/types.ts`. `src/types/index.ts` imports only
    *within* `src/types/` (`./colorCorrection`, `./motionDesign`, `./nodeGraph`) —
    no React, no Zustand, no service implementations. It is therefore *already* a
    framework-free type tier, and one that is **broader than the timeline** (it
    also defines `Composition`, color, motion, node-graph types). This is the fact
    that decides OD7: the kernel does not need to *absorb* the schema, only to be
    *allowed to import it*.
14. **The genuinely-timeline-owned vocabularies are import-light and clean to
    relocate.** `src/services/timeline/runtimeCoordinatorTypes.ts` has **zero
    imports**. The edit-op union (`stores/timeline/editOperations/types.ts` +
    `transactionTypes.ts`) imports only `src/types` + each other.
    `cacheSchedulerTypes.ts` imports only `src/types/audio`. None reach into React,
    stores-as-state, or service *implementations*; they sit in store/service
    folders by historical accident, not by dependency necessity.
15. **The store's `types.ts` is state glue, not schema, and must not move; and the
    persisted schema still carries runtime fields.** `src/stores/timeline/types.ts`
    transitively imports service modules (`src/services/audio/audioSilenceDetection`,
    `audioTransientDetection`, `stemSeparation`) plus `mediaStore` — it is
    store-state container glue, not the persisted data schema, and stays in the
    store. Separately, the canonical `TimelineClip.source` in `src/types/index.ts`
    (lines 736–744) still carries optional `videoElement`/`audioElement`/
    `imageElement`/`file` — the runtime fields the projection guard must strip and
    Phase 8 removes from the persisted shape.

### B. Consensus architecture (the target)

The timeline becomes a **pure pipeline of small engines with thin React hosts at
the edge**. File splitting is a *consequence* of this pipeline, not the strategy.

#### B1. A pure timeline kernel at `src/timeline/` (ACCEPTED)

We adopt the Codex 2 / Codex 3 position: durable timeline logic moves out of
React component ownership into a top-level, React-free, store-free, DOM-free
package `src/timeline/`. Components import the kernel; **the kernel never imports
an *implementation*** — no React, no Zustand store machinery, no
`src/components/**`, no browser workers, no runtime/cache *service implementations*.

Rationale (why this beats Codex 1's `renderModel/`-under-components placement):
playback, export, workers, tests, and future non-React surfaces (the June 2026
"every file is a visual signal" goal) must reuse timeline derivation without
depending on a component path. The kernel boundary is also the single most
enforceable no-god-object safeguard, because it is checkable with an
import-boundary test.

Migration (this is how we honor the current repo plan's "do not create a second
competing geometry contract" warning *without* freezing the worse location): the
existing `src/components/timeline/renderModel/*` is re-exported from the kernel
during transition, then deleted once imports move. There is never a permanent
duplicate — only a migration shim.

**Refinement (Agent 2): "imports no implementations," not "imports nothing."**
Agent 1's draft said the kernel "never imports `src/stores/**` or runtime/cache
services." Taken literally that is *too* strict and is exactly what made OD3/OD4
and the runtime line fuzzy: the kernel's command resolvers must emit
`TimelineEditOperation` values, its demand stage must emit values keyed to the
shipped cache lanes, and its reservation requests must name shipped
`RenderResourceKind`/policy ids. You cannot emit values in a vocabulary you may
not name. The clean resolution is a **four-layer model with a shared contracts
tier**:

```text
src/timeline/                      KERNEL (pure)
  contracts/   schema/ editOps/ cache/ runtime/ demand/ commands/ — plain-data
               vocabularies + tiny pure validators/key builders ONLY (the "shapes")
  projection/ geometry/ demand/ paint/ commands/ editPlanning/ — pure derivation,
               pure edit planners, and dispatch (the "logic"; imports contracts/)
src/stores/timeline/               STATE (Zustand slices; imports kernel)
src/services/timeline/             SIDE EFFECTS (coordinator, scheduler, warmups,
                                   resolvers; implement kernel interfaces, import
                                   kernel vocabularies)
src/components/timeline/           HOSTS (thin; import kernel + stores + services)
```

The **`src/timeline/contracts/` tier** owns the *plain-data vocabularies that more
than one layer must speak*: the canonical timeline **data schema** (`TimelineClip`,
`TimelineTrack`, keyframes, markers, transitions, clip-source *descriptors* —
runtime-free), the `TimelineEditOperation` union, the cache-lane / coalescing-key
vocabulary, and the runtime resource-kind / policy-id / reservation-request
vocabulary. It contains types plus tiny pure helpers (validators, key builders) —
no state, no behavior, no I/O. Its explicit "does not own": no Zustand, no
side-effects, no derivation logic.

This inverts the dependency the right way: **vocabulary and schema live up in the
kernel; state lives in the store; implementations live in services; hosting lives
in components — and nothing the kernel imports has behavior.** The import-boundary
test becomes "`src/timeline/**` imports only `src/timeline/**`," which is *simpler*
to enforce than an allowlist of service exceptions.

**OD7 — DECIDED (Agent 3): relocate the timeline-owned vocabularies; let the
kernel depend on the pre-existing pure type barrel `src/types/`.** Agent 2 framed
this as binary "Option A relocate the type files" vs. "Option B type-only
allowlist from services." The real dependency graph (facts A13–A15) makes the
right answer sharper than either, and it is *cleaner* than Option B because no
service module ever appears in a kernel import:

- **The import rule is two pure roots, no per-module allowlist:**
  **`src/timeline/**` may import only `src/timeline/**` and `src/types/**`.**
  `src/types/` is recognized as the app-wide pure data tier that already exists
  below the timeline (fact A13: it imports nothing outside itself, no React/store/
  service implementations). The kernel layers its *timeline-specific* vocabulary
  on top of that base. This is strictly tighter than Option B's "no service
  *values*, type-only allowed from an allowlist of service modules," because the
  allowlist is gone — services are simply never imported by the kernel.
- **Relocate the genuinely-timeline-owned vocabularies into `contracts/`** (fact
  A14, all import-light): the `TimelineEditOperation` union
  (`editOperations/types.ts` + `transactionTypes.ts`), `runtimeCoordinatorTypes.ts`,
  and `cacheSchedulerTypes.ts`. They live in store/service folders by historical
  accident; moving them makes the kernel the real owner of its own vocabulary, and
  every implementation imports back up. This is Option A *applied only where it is
  clean*.
- **Do NOT absorb `src/types/`** into the kernel. It is broader than the timeline
  (it also owns `Composition`, color, motion, node-graph types), already pure, and
  imported app-wide; dragging it under `src/timeline/contracts/` would be *wrong*
  (the timeline kernel would own non-timeline types), not merely churny. The kernel
  *imports* it.
- **Do NOT relocate `src/stores/timeline/types.ts`** (fact A15): it is store-state
  glue that legitimately imports service audio-option types; it is not the
  persisted schema and stays in the store.
- **Runtime-field entanglement is decoupled, not blocking.** Agent 2 worried the
  schema "can only fully live in the kernel once clips stop carrying `file`/
  `source`." Resolved: the kernel *type-imports* the schema today (the optional
  `HTMLVideoElement`/`File` fields are ambient DOM lib types on a type, not module
  imports, so they do not breach the boundary); the projection guard strips runtime
  *values*; and Phase 8 removes the runtime *fields* from the persisted shape. The
  kernel's own runtime-free **descriptor view** of a clip/source lives in
  `contracts/schema/` from day one, so kernel code never depends on the persisted
  shape's runtime fields even before Phase 8 cleans them.

**`contracts/` is itself tiered, so it cannot become a god-folder (Agent 3,
answering Agent 2's fresh-eye flag).** It is split by vocabulary family, each
independently import-boundary-tested and budget-checked:

```text
src/timeline/contracts/
  schema/     runtime-free clip/track/keyframe/marker/transition + source
              *descriptor* views; re-exports + timeline extensions over src/types
  editOps/    TimelineEditOperation union + transaction types + scope/result/context
  cache/      cache-lane + coalescing-key vocabulary (lifted from cacheSchedulerTypes)
  runtime/    RenderResourceKind + policy ids + reservation-request shape
  demand/     lane-agnostic demand-item shape
  commands/   TimelineCommand descriptor union + command-target shape
```

Explicit **"does not own"** for `contracts/`: no state, no I/O, no derivation, no
dispatch, no behavior beyond tiny pure validators and key builders. Within
`contracts/`, dependencies form a DAG with `schema/` at the base: `editOps`,
`cache`, `runtime`, and `demand` may import `schema/`; `commands/` may import
`editOps`+`demand`+`runtime`+`schema`; **no other cross-imports** (a test enforces
this so the sub-tiers cannot quietly entangle). Churn is explicitly not a
constraint; this is the end-state that makes the kernel a real narrow waist
instead of a component-flavored island.

#### B2. The canonical pipeline (ACCEPTED — all three converge here)

```text
store plain state + media metadata + UI session state + viewport measurements
  -> TimelineProjection        (semantic: what exists and what it means)
  -> TimelineGeometrySnapshot + TimelineSpatialIndex  (pixels and hit testing)
  -> TimelineResourceDemand    (bounded, viewport/overscan-aware: what is needed;
                                lane-agnostic items, not priority classification)
  -> TimelineVisualResources   (draw-ready payloads + missing/queued/stale)
  -> TimelinePaintPackets      (domain-level, chunked by track/visible window)
  -> shared painters
  -> canvas host / worker host / shell host / overlays

pointer / keyboard / menu / drop
  -> normalized input -> spatial-index hit test -> TimelineCommand descriptor
  -> executor -> typed edit operation | ephemeral UI state | runtime request

playback / export / cache / RAM preview / thumbnails
  -> runtime demand -> reservation handle (coordinator + providers) -> release
```

One owner per fact: store owns edit state; projection owns semantic
clip/track/facet state; geometry owns pixels and hit testing; demand owns "what
is needed"; the resolver owns draw-ready payloads; paint owns draw order;
canvas/shell hosts own only DOM/canvas lifecycle; the runtime broker owns media
elements/providers.

#### B3. Naming (DECIDED — Agent 2 closed OD1)

The semantic artifact is named **`TimelineProjection`** (Codex 3), not
`TimelineRenderModel` (Codex 1 / shipped) and not `TimelineFrame` (Codex 2):

- "Render" is the single most overloaded word in this engine codebase — the
  WebGPU output path (`RenderDispatcher`, `RenderLoop`, render targets,
  `LayerCollector`, `OutputPipeline`). Reusing it for timeline semantic state is
  ambiguous.
- "Frame" is dangerously overloaded in a video editor (video frames, animation
  frames, export frames).
- "Projection" reads as "project store state into presentation state." The only
  collision (camera/matrix projection) is in the 3D/engine space and stays
  namespaced under the timeline kernel.

**Closed (was the softest draft decision):** the rename-cost objection is
defused by fact A7 — `TimelineRenderModel` is referenced by only ~4 source/test
files and is **not yet wired into the live draw path** (`TimelineClipCanvas.tsx`
still uses `CanvasClip`). The rename rides the kernel move for ~4 files of churn.
Doing it now, while the contract is non-load-bearing, is far cheaper than after
adoption. Decision: rename on move.

#### B4. Two-axis registry: capabilities x features (SYNTHESIS of Codex 2 + Codex 3)

This is the most important synthesis. Codex 2 slices by **source kind**
(`TimelineSourceCapability`: video, audio, image, MIDI, composition, document,
model, data). Codex 3 slices by **visual feature**
(`TimelineProjectionFeature`: thumbnail, waveform, spectrogram, fade,
transcript, analysis, MIDI, composition, badge). These are **orthogonal axes,
not competing designs**, and we adopt both, composed as an entity-component
pattern:

- **Capability (per source kind)** = *what* a source has: the set of facet flags
  it enables plus source-specific parameters and runtime/shell/menu
  contributions. Adding PDF/glTF/CSV/point-cloud is adding one capability module.
- **Feature (per facet)** = *how* a facet is built/demanded/painted, reused
  across every source that enables it (waveform is one module, not duplicated in
  video/audio/composition).

Both registries are **static internal registries** (resolved at module load, no
dynamic user plugin loading), per Codex 3's explicit framing. The generic
builders only loop tracks/clips and dispatch to capabilities/features; no
assembler contains source-kind or feature-kind `switch` sprawl.

We **reject Codex 1's no-registry stance**: relying only on import boundaries +
a "builder fan-out rule" does not stop the assembler from accreting source-kind
branches over time; an explicit registry makes the extension point first-class.
We **keep** Codex 1's small per-domain pure builders as the *implementation unit
inside* each feature/capability.

**Minimum-viable shape (Agent 2, pressure-testing OD2 for over-abstraction).**
The over-abstraction risk is real: a true entity-component framework (component
storage, queries, system scheduler, dynamic registration) would be heavier than
the problem. We bound the registry to the *least* machinery that still kills
`switch` sprawl:

- A **feature is the only behavioral unit**: a module exporting pure functions
  `buildClipFacet(input) -> facet | null`, optional `collectDemand(input)`,
  optional `buildPaint(input)`, registered in a static array. (Codex 3's
  `TimelineProjectionFeature`, kept lean.)
- A **capability is a thin declarative manifest — data, not behavior**:
  `{ sourceKind, enabledFeatureIds, params }`. It never re-implements feature
  logic; it only declares which features apply to a source kind plus
  source-specific params. Adding PDF/glTF/CSV/point-cloud = adding one manifest
  (and any genuinely new feature modules it needs).
- **Dispatch is a `for` loop**, not a framework: for each clip, read its
  capability manifest, run the enabled features. No DI container, no component
  store, no system scheduler.
- **Source-kind branches live *inside* a feature, scoped to that facet** — never
  in the assembler. A test asserts the dispatch site (`buildClipProjection`,
  `buildTimelinePaintPackets`) contains no `switch (sourceKind)` / `switch
  (clip.type)`.

**Scope bound: only projection, demand, and paint are feature-pluggable.**
Geometry stays a single, non-pluggable engine (rects, lanes, handles, rows are
universal and source-kind-agnostic). This stops the registry from metastasizing
into every stage and keeps geometry — the perf-critical, most-reused engine —
free of dispatch overhead.

**Honest cost/benefit (concede to Codex 1).** At today's ~5 source kinds
(video/audio/MIDI/composition/image) and ~9 facets, the registry's payoff over
Codex 1's plain per-domain builders is modest. Its payoff scales with the
explicit June-2026 roadmap (PDF/SVG/glTF/FBX/STEP/DXF/CSV/JSON/point-cloud →
10+ source kinds). The registry is justified **by the roadmap, not today's
count**: if the goal were "only ever video/audio," plain builders would win;
because the goal is the opposite, the registry is the correct bet. Aligning the
capability `sourceKind` list with the shipped runtime `RenderResourceKind`
vocabulary (fact A10: `model`/`gaussian-splat`/`motion-data` already exist) keeps
us from minting a *third* source taxonomy.

**Ratified + sequencing fixed (Agent 3 — closes OD2).** The minimum-viable bound
stands as written (feature = pure-fn behavior module; capability = declarative
data manifest; dispatch = `for` loop; geometry is not pluggable). Two points
Agent 2 left open are now decided:

- **Build the mechanism + AV population in Phase 1; defer only future-kind
  population to Phase 9.** The registry *mechanism* (feature interface, manifest
  shape, dispatch loop, the no-`switch(sourceKind)` test) and the modules for
  today's ~5 kinds and ~9 facets ship in Phase 1 — because the projection and
  paint builders must dispatch through the registry *from the first slice*, or
  Phase 1 hardcodes the very `switch` sprawl the registry exists to prevent and
  Phase 9 has to rip it out. What is deferred is only *populating* non-AV
  capabilities (PDF/SVG/glTF/CSV/point-cloud); those land in Phase 9 as the proof
  that a new kind = a new manifest (+ any genuinely new feature modules), not a
  host edit. "Stub the registry in Phase 1, populate at Phase 9" is rejected: a
  stub with no real consumers does not constrain the Phase 1–8 builders, so it
  fails to prevent drift during the exact phases that do the most code movement.
- **Source-specific runtime/shell/menu contributions attach by id, never as
  behavior in the manifest (resolving the "where does behavior go" question).**
  The entity-component model has more axes than just visual features. Each axis is
  its own static registry of behavioral modules; the capability manifest only
  *names* which modules apply, as data:
  `{ sourceKind, enabledFeatureIds, shellModuleIds, menuContributionIds,
  runtimeProviderKind, params }`. Visual behavior lives in feature modules; active
  affordance behavior lives in **shell modules** (a static shell registry, B9);
  menu behavior lives in **menu-contribution modules**; runtime behavior lives in
  **providers keyed to `RenderResourceKind`** (B11). A source kind composes
  existing behavioral modules by id and contributes *new* behavior only when it
  needs a genuinely new module (e.g., a PDF page-raster feature). The manifest
  therefore never contains functions — keeping "capability = data" true without
  stranding source-specific behavior.

#### B5. Geometry + spatial index (ACCEPTED)

One geometry source drives canvas rects, shell placement, hit testing,
marquee/range selection, drag/drop targets, trim/fade handles, keyframe rows,
transition zones, new-track previews, ruler, and overlay alignment. Worker draw
messages consume geometry rects; they never recompute `timeToPixel`/trim math.

Sharding + invalidation (taking Codex 3's structural-version idea over a single
monolithic rebuild): geometry is built per section and per track with structural
version keys for cheap invalidation; spatial indexes start as **sorted arrays**
(clips by time, handles/drop-targets by rect) and only escalate to a tree if
tests show arrays are insufficient. Identity is preserved for unchanged
tracks/clips (Codex 1) so small edits don't rebuild the world.

**Concrete invalidation model (Agent 2 — sharpens OD5 toward a defensible perf
claim).** The key move is to make rects **absolute timeline-pixel space, a
function of zoom only, scroll-independent** (matching the shipped split where
`CanvasClip` uses `timeToPixel` for layout and `scrollX` separately for the
visible slice, fact A12). Then invalidation is precise:

- **Scroll change → no geometry rebuild.** Scroll only re-runs the visible-window
  *query* against the sorted spatial index and re-applies a translate at paint.
  This is the common interactive case and must be allocation-free.
- **Zoom change → rebuild geometry** (rects are zoom-dependent); structural keys
  for projection are untouched, so projection/demand need not rebuild facets.
- **Single-clip edit → rebuild only that clip's rect + its track's sorted index;**
  every other track and clip keeps object identity.
- **Track add/remove/resize/reorder → rebuild only that section's lane offsets;**
  clip rects within unaffected tracks keep identity.

Version-key shape: per-track `geometryVersion = hash(orderedClipIds, each clip's
start/duration/inPoint/outPoint, trackHeight, zoom)`; per-section
`layoutVersion = hash(orderedTrackIds, per-track heights, collapsed/split state)`.
A track's geometry is recomputed iff its key changed. This is the mechanism that
backs the large-composition performance claim and feeds the per-clip paint-packet
version in B8.

**Validated against many-clip edits (Agent 3 — closes OD5).** The keys were
pressure-tested against the three edit classes that touch many clips at once, and
none degrade to a *spurious* global rebuild:

- **Ripple:** shifts `start` for all downstream clips on the affected track(s).
  Their per-track `geometryVersion` changes → those tracks rebuild; every
  untouched track keeps identity. A ripple that genuinely spans all tracks
  rebuilds all tracks, which is correct (their clips really moved). Bounded to
  *affected* tracks.
- **Transition apply/adjust:** changes the two adjacent clips' effective
  timing/overlap on one track and adds a transition zone. Only that track's key
  changes. **Sharpening:** the per-track key must include transition records
  (`orderedTransitionIds` + per-transition `{clipA, clipB, duration, type}`) so a
  transition-only change still invalidates the track; transition-zone rects are
  derived from the two clips' timings (already in the key) plus that record.
- **Linked group (A/V sync):** moving the group changes `start` on clips across
  the tracks the group spans → exactly those tracks rebuild; others keep identity.
  Cost = group span, which is intrinsic to the edit.

Conclusion: the key model bounds rebuild to "tracks whose ordered clip set,
timing, transitions, or height actually changed" — the minimal correct set for
all three. The one cheap-to-trigger global rebuild is **zoom** (rects are
zoom-dependent absolute-px, so every track's key changes); this is accepted
because (a) projection/demand/resource layers do *not* rebuild on zoom — only
geometry does, and (b) the rejected alternative (store rects in time-space and
scale at paint) pushes zoom math into the painter and breaks fixed-pixel handle
hit-testing. **Optional fast-path (not required for correctness):** a pure
time-shift (drag/ripple with no duration/zoom change) may translate the affected
clips' cached rects by a constant Δx and keep rect object identity, instead of
re-hashing — an optimization layered on top of the version-key model, gated behind
its own test.

#### B6. Resource demand as a first-class stage (MODIFIED by Agent 2 — closes OD4)

A distinct demand stage sits between geometry and resources. It is the single
home for viewport overscan (today duplicated across `TimelineTrack.tsx` and the
`THUMBNAIL_VIEWPORT_OVERSCAN_PX`/`CANVAS_RENDER_OVERSCAN_PX` constants in
`TimelineClipCanvas.tsx`, fact A12). It computes which thumbnail source-ranges,
waveform refs, spectrogram tiles, transcript/analysis buffers, and composition
strips are *visible (+ overscan)*. It never fetches, decodes, allocates, mutates
stores, or creates media elements.

Agent 2 reconciles it with shipped reality on two points:

1. **Name: `TimelineResourceDemand`, not `TimelineVisualDemand`.** Fact A9: the
   shipped `timelineVisualDemand.ts` is **render-loop gating** ("is any visible
   clip live at the playhead," consumed by `usePlaybackLoop`/`useEngine`/
   `playbackHealthMonitor`) — a *playback* concern, not a *resource-warmup*
   concern. They are genuinely different stages. The kernel stage is named
   `TimelineResourceDemand` to avoid a same-name/different-concept collision; the
   shipped helper keeps its job and is conceptually re-labeled "render gating"
   (an optional file rename to `timelineRenderGating.ts` is low priority — it has
   3 consumers).
2. **The scheduler stays the sole authority for priority, coalescing, and
   media-element policy.** Fact A8: `cacheSchedulerContracts.ts` already owns
   per-lane `priority` (`visible`/`near-visible`/`background`),
   `mediaElementPolicy`, and coalescing keys/scopes. The demand stage must **not**
   re-invent an "interactive/background/worker-transferable" classification (as
   Agent 1's draft implied) — that would be a second priority concept. Instead the
   kernel emits *bounded demand items* describing **what is visible**
   (`{ sourceKind, artifactKind, ref/mediaId, time-range or tile-range, clipId }`),
   pure and lane-agnostic; a **service-side adapter** maps each item to the shipped
   lane + coalescing key + priority and enqueues it. This is the resource-resolver
   pattern applied to demand: kernel owns *shape* ("what is needed"), the existing
   scheduler owns *scheduling* ("when/with what priority/dedup"). No second
   demand concept ships.

#### B7. Visual resource resolver (ACCEPTED)

The resolver is the only code that maps cache refs -> draw-ready resources
(thumbnail strips, waveform columns, spectrogram rasters, marker buffers,
composition strips, fade geometry, MIDI bars). It reads/queues the existing
`*Warmup`/cache services through adapters, returns explicit
ready/missing/queued/stale states, and may hold transferables (`ImageBitmap`).
It must not create HTML media elements, import stores, mutate clips, or hide
missing states behind ad hoc fallbacks. The kernel defines the resolver
*interfaces*; the `src/services/timeline` adapters *implement* them (this keeps
the kernel service-free).

#### B8. Paint: domain packets + shared painters (MODIFIED toward Codex 3)

Both main thread and worker build the **same** `TimelinePaintPacket[]` and draw
them with the **same** painter modules. No second worker-only visual language;
worker fallback means "this packet could not be drawn in the worker," never "the
main thread has a separate renderer."

We adopt Codex 3's **domain-level packets** (clip body, thumbnail strip,
waveform columns, spectrogram raster, badges, markers, fade curve, MIDI bars,
composition segments) over Codex 1/2's framing of a generic primitive
"draw-command list." Rationale: a per-clip immediate-mode primitive list is
slower, heavier to transfer, and harder to debug; coarse domain packets diff
cheaply and chunk naturally. We keep Codex 1's requirement that the packet list
is **chunked by track and visible window** so large compositions rebuild
incrementally.

**Agent 2: this is confirmed by shipped code, and it largely resolves OD6.** Fact
A11 — the shipped `timelineClipCanvasWorkerContract.ts` *already is* the
domain-packet model: per-facet resources (`...ThumbnailStripResource` with
`ImageBitmap`; `...Waveform/Spectrogram/MidiPreviewResource` with `Float32Array`;
composition/trim/fade/passive-decoration resources) aggregated per clip in
`TimelineClipCanvasWorkerClip`, sent per-track in a `...DrawMessage`. So:

- `TimelinePaintPacket` is the **kernel-level promotion of
  `TimelineClipCanvasWorkerClip`**, not a new invention. We lift these resource
  types into kernel `paint/` contracts and make the **main thread build the same
  packets** (today the main-thread fallback path draws differently).
- **Transfer model is the shipped one, not a fresh design.** Transferables are
  `ImageBitmap` (thumbnail strips) + `Float32Array` (waveform/spectrogram/MIDI/
  transcript markers/fade curves), collected into the existing
  `transferables: Transferable[]` list on the draw message (the shipped
  `PendingTimelineClipCanvasWorkerDraw` already carries this). The worker receives
  serialized packets + transfer list; it does not implement a second visual
  language.
- **Per-track chunking already exists** (one canvas + one draw message per track).
  The *new* work is **incremental within a track**: give each clip's packet a
  stable identity + a version key derived from its projection/geometry/resource
  versions (B5/OD5), so an unchanged clip's packet is neither rebuilt nor
  re-transferred across frames.

**Specified (Agent 3 — closes the OD6 tail).** The per-clip packet identity and
the transferable lifecycle are pinned, because they are where naive transfer
silently re-neuters `ImageBitmap`s every frame:

- **Identity:** `clipId` (stable across frames).
- **Version:** `paintVersion = hash(projectionVersion(clip), clipRectVersion(B5),
  resourceVersion(clip))`, where `resourceVersion` folds the resolver's per-facet
  state ids (thumbnail-strip id+ready, waveform ref version, spectrogram tile set,
  etc.). It changes on a facet's missing→ready/stale transition, not on scroll.
- **Transfer discipline (the genuinely new part):** transferables are *moved*
  (neutered) on `postMessage`, so an unchanged packet must **not** re-transfer its
  `ImageBitmap`/`Float32Array`. The worker caches transferred resources keyed by
  `(clipId, facet, version)`. Each frame the main thread sends, per visible clip,
  either (a) a full packet **with** the transferable when `paintVersion` changed,
  or (b) a lightweight `retain(clipId@paintVersion)` reference when unchanged. When
  a clip leaves visible+overscan, demand drops it, the resolver releases its
  resources (paired with B11 reservation/release), and the main thread sends
  `release(clipId)` so the worker frees its cached transferables — keeping worker
  memory bounded by the visible window, not the timeline.
- **Parity is two executable tests, not a hope:** (1) a *structural* parity test
  (runs always, cheap) asserts `buildTimelinePaintPackets` produces an identical
  packet array — same ids, versions, field values, transferables stripped for
  comparison — regardless of main-thread vs. worker target; (2) a *raster* parity
  test (runs after paint changes) feeds the same packets + deterministic fixture
  resources to `drawTimelinePaintPackets` on a main-thread `Canvas2D` and an
  `OffscreenCanvas`, asserting pixel-equivalent output. Together these make "no
  second visual language" an enforced invariant (B12.4).

#### B9. Thin React hosts (ACCEPTED)

`src/components/timeline/` becomes hosts only: `TimelineRoot` (builds kernel
inputs, calls derivation, passes models to layers), section layout + split/scroll
controllers, `TimelineTrackRow` (receives a track plan + geometry, shapes no
`CanvasClip`), `TimelineCanvasLayer` (canvas lifecycle + worker choice +
diagnostics, no rich clip), `TimelineInteractionShellLayer` (mounts shells from a
shell-mount model + geometry records), overlay/menu/drop-preview layers.

#### B10. Commands as stateless descriptors — no bus (ACCEPTED; overrides repo plan)

All three Codex plans independently reject a global mutable command bus. We
adopt: stateless typed `TimelineCommand` descriptors + pure resolvers
(`resolvePointerCommand`, `resolveMenuCommands`, `resolveDropCommand`,
`resolveKeyboardCommand`) + a thin executor that routes to the **existing** typed
edit operations. The executor never reimplements edit-operation logic and never
becomes a second store. Commands yield an edit operation, ephemeral preview
state, or a runtime request — they do not write store state themselves.
`useExternalDrop.ts` decomposes into payload parsing -> media import/adoption ->
geometry target resolution -> placement command -> async materialization.

This explicitly **supersedes** the current repo plan's
`timelineCommandBus.ts`.

**Edit-operation home (Agent 2 — closes OD3 with a precise split, not an
either/or).** Agent 1 left it binary: migrate reducers to the kernel *or* keep
them store-side. The code shows the answer is "both, cut at the right seam." The
`TimelineEditOperation` union and `TimelineEditScope`/`Result`/`Context` are
**already plain data** (verified in `editOperations/types.ts`), and `index.ts`
already exposes **pure planners** (`resolveClipMoveRequest`,
`createResolvedClipMoveOperationPlan`, `applyResolvedMoveOverlapTrims`) sitting
next to the **store-bound** `createTimelineEditOperationSlice` (a Zustand
`set`/`get` slice creator). So:

- The operation **vocabulary** (`TimelineEditOperation` union +
  `transactionTypes`) moves into the kernel `contracts/` tier. This is *mandatory*
  for B10 to work at all — a kernel command resolver cannot emit a
  `TimelineEditOperation` it may not import.
- The **pure planners/resolvers** (move resolution, overlap-trim, placement math,
  ripple math — anything shaped `(operation, context) -> plan` with no
  `set`/`get`) migrate into the kernel `commands/` (or `editPlanning/`). They are
  already pure; this is relocation, and it naturally helps dissolve the ~1415-LOC
  `applyTimelineEditOperation.ts` god-file.
- The **stateful applier** (`createTimelineEditOperationSlice`: history batching,
  abort signals, `set`/`get`, selection side-effects) **stays in the store** and
  imports the kernel's operation vocabulary + planners.

Net: symmetric with the resolver/demand/runtime lines — **pure planning up in the
kernel, stateful applying down in the store, one shared plain-data operation
vocabulary in `contracts/`.** This depends on OD7 (does the vocabulary physically
relocate, or does the kernel type-import it). Decided in principle; physical scope
deferred to Agent 3.

#### B11. Runtime: coordinator + reservations + providers (SYNTHESIS)

We adopt the existing `timelineRuntimeCoordinator` (do not rebuild). We layer two
compatible ideas on top, both corrected by Agent 2 against the shipped contracts:

- **Reservation handles** (Codex 2/3) are a **thin lifecycle wrapper over the
  shipped coordinator**, not a new subsystem. Fact A10: the coordinator already
  exposes `canRetainResource` / `retainResource` / `releaseResource` /
  `clearResources` / `getBudgetReport` over plain-data `RenderResourceDescriptor`s.
  `reserve(request) -> { ..., release() }` is sugar that pairs a `retainResource`
  with its `releaseResource` so callers can't leak; it adds RAII ergonomics, not a
  parallel registry. Used uniformly by layer builder, sync managers, export, RAM
  preview, thumbnail generation, and warmups. Diagnostics refresh must never
  allocate or re-admit.
- **Typed providers bind to the shipped `RenderResourceKind`, not a new list.**
  Agent 1's draft took Codex 1's `VideoFrameProvider`/`AudioClockProvider`/
  `ImageFrameProvider`/`ModelRuntimeProvider`/`DataSignalProvider` as greenfield;
  fact A10 shows the coordinator already enumerates `video-frame-provider`,
  `audio-source-clock`, `image-canvas`, `native-decoder`, `model`,
  `gaussian-splat`, `motion-data`, `nested-composition-texture`, `gpu-texture`,
  `runtime-binding`, `job`. The provider *interfaces* (ask-a-provider-for-a-frame)
  are still mostly to-build, but they must be **keyed to that shipped vocabulary**
  (`VideoFrameProvider` ↔ `video-frame-provider`, `AudioClockProvider` ↔
  `audio-source-clock`, `ImageFrameProvider` ↔ `image-canvas`, model/splat/motion
  for 3D/data), not a parallel taxonomy. Reservation is the *lifecycle* handle;
  the provider is the *typed resource interface*. Layer building asks a provider
  for a renderable resource and does not know its origin (HTML media, WebCodecs,
  native decoder, cached image, composition render, model loader, future signal).

**Kernel/service line for runtime (answers Agent 1's closing question).** Same as
resources and demand: the **request/descriptor *vocabulary*** (`RenderResourceKind`,
policy ids, reservation-request shape) lives in the kernel `contracts/` tier
(B1 refinement); the **coordinator registry + retain/release implementation**
stays in `src/services/timeline/`. The kernel may emit a typed reservation
*request*; only the service may fulfill it.

Policy ids are **pinned to the 8 shipped descriptors** (fact A10: `interactive`,
`background`, `slot-deck`, `composition-render`, `thumbnail`, `render-target`,
`ram-preview`, `export`). We explicitly **reject Codex 2's invented
`policyId: 'interactive-preview'`** as a ghost policy; map it to shipped
`interactive`. Direct `source.videoElement`/`audioElement`/`imageElement` access
is allowed only behind an audited, allowlisted compatibility adapter, and new
access fails an audit test. Persisted timeline/history/projection state stays
runtime-free — enforced concretely because `CanvasClip` today carries `file: File`
and a `source` object (fact A12) that the projection guard must strip.

#### B12. No-god-object safeguards (ACCEPTED, merged)

1. **Import-boundary tests.** `src/timeline/**` cannot import React, Zustand,
   components, stores, DOM, workers, or runtime/cache services. Intra-kernel:
   projection cannot import resources/paint/runtime; geometry cannot import
   resources/paint; paint may import projection + geometry + resources +
   canvas-context adapter only.
2. **Plain-data / structured-clone tests** for projection, geometry, demand,
   resource descriptors, worker packets, and command descriptors. Reject
   functions, symbols, DOM elements, `File`, object URLs, cycles, and
   `ImageBitmap` *except* inside resolver-owned resource payloads.
3. **`CanvasClip` field-coverage tests** (elevated to a hard gate): every current
   `CanvasClip` visual field maps to a projection/resource field, so migration
   cannot silently drop thumbnails, waveform, spectrogram, badges, transcript,
   analysis, fade, trim, MIDI, stem, or composition visuals.
4. **Diagnostics as invariants** (Codex 3): `domClipBodyCount === 0`; no active
   import of deleted `TimelineClip.tsx`; worker/main paint-packet parity; no rich
   `TimelineClip` reaches a draw path; no runtime object reaches projection.
5. **Module budgets as smoke alarms** (not style rules): host components ~<400
   LOC, pure builders ~<250, painters ~<350, capability modules ~<300. Any
   module mixing "audio + video + MIDI + composition + transcript" is almost
   certainly a god object.
6. **Runtime-access audit** with an explicit allowlist for current compatibility
   files.

#### B13. Phase order (ACCEPTED — kernel-first, dissolve god-files last)

Build the pipeline as a kernel first; dissolve the big React files as a
consequence afterward.

0. Guardrails + kernel skeleton + re-export shims from `renderModel/`; deleted-
   renderer guard; import-boundary tests.
1. Projection + capability/feature registries + `CanvasClip` coverage matrix.
2. Geometry + spatial index (migrate `TimelineTrack` hit testing onto it).
3. Visual demand + resource resolver (move overscan + cache decisions off the
   canvas host).
4. Paint packets + shared painters (kill duplicate main/worker draw logic).
5. Dissolve `TimelineTrack.tsx` into row/canvas/shell/property hosts.
6. Dissolve `Timeline.tsx` into root/sections/overlays/menus.
7. Command convergence (descriptors + executor; split `useExternalDrop`).
8. Runtime reservation/provider adoption + audit.
9. Future-capability lane (PDF/SVG/glTF/CSV/point-cloud capability stubs +
   fixtures) proving new kinds add a capability module, not host edits.
10. Delete transitional adapters (`CanvasClip`, re-export shims, duplicate
    geometry/painters); mark stale docs historical.

#### B14. First implementation slice (ACCEPTED — unanimous)

One narrow vertical seam through one normal track:
`store -> projection -> geometry -> demand -> resolver adapter -> temporary
adapter into the existing TimelineClipCanvas`, and reuse the same geometry for
`TimelineTrack` hit testing + shell placement. Do **not** start by splitting
`Timeline.tsx`. Keep `domClipBodyCount === 0`. Tests: projection is
clone-safe even when source clips carry runtime objects; `CanvasClip` field
coverage; geometry parity for body/visible/handle rects and hit-test order.

---

## Accepted Decisions (rolling)

- AD1. Pure `src/timeline/` kernel that **imports no implementations** (not
  "imports nothing"); enforced by an import-boundary test that reduces to
  "`src/timeline/**` imports only `src/timeline/**`." (was Codex 2/3; overrides
  Codex 1 + repo plan placement; refined by Agent 2, see AD15)
- AD2. Canonical 6-stage derivation pipeline + 3-stage input/runtime lanes (B2).
- AD3. Semantic artifact named `TimelineProjection`. **DECIDED** (Agent 2 closed
  OD1: ~4 source files, contract not yet load-bearing).
- AD4. Two-axis static registry: source **capabilities** x visual **features**.
  Minimum-viable (Agent 2): **feature = pure-fn module (behavior); capability =
  declarative manifest (data); dispatch = `for` loop; geometry is NOT
  feature-pluggable.** Justified by the many-source-kinds roadmap, not today's
  count. A test forbids `switch(sourceKind)` at dispatch sites.
- AD5. One geometry source + spatial index; per-section/per-track sharding with
  structural version keys; sorted arrays before trees. **Invalidation model
  (Agent 2):** rects are absolute-px/zoom-only; scroll never rebuilds geometry;
  single edits rebuild only the affected track+clip (B5).
- AD6. Resource demand is a first-class stage and the single home for overscan.
  **Renamed `TimelineResourceDemand`** (Agent 2: `timelineVisualDemand.ts` is
  render-gating, a different concept). Demand emits lane-agnostic items; the
  **shipped `cacheSchedulerContracts` stays the sole authority** for
  priority/coalescing/media-policy; a service adapter maps items→lanes (closes
  OD4).
- AD7. Resolver is the only ref->payload mapper; kernel defines interfaces,
  services implement adapters; explicit ready/missing/queued/stale.
- AD8. Domain-level paint packets (not generic primitive commands), chunked by
  track/window, one painter set for main thread + worker. **Confirmed by the
  shipped worker contract** (Agent 2, fact A11); `TimelinePaintPacket` is the
  kernel promotion of `TimelineClipCanvasWorkerClip`; transfer model
  (`ImageBitmap`+`Float32Array`+transfer list) is the shipped one (largely closes
  OD6).
- AD9. Thin React hosts; no semantic/visual logic in components.
- AD10. Stateless command descriptors + pure resolvers + thin executor to
  existing edit operations. No command bus. (overrides repo plan)
- AD11. Adopt existing runtime coordinator; reservations are a **thin RAII wrapper
  over the shipped `retainResource`/`releaseResource`** (not a new registry);
  typed providers **bind to the shipped `RenderResourceKind` vocabulary** (Agent 2,
  fact A10 — not Codex 1's parallel list); shipped policy ids only; runtime-access
  audit; request vocabulary in `contracts/`, coordinator impl in services.
- AD12. Merged no-god-object safeguards (B12), with `CanvasClip` coverage and
  import boundaries as hard gates.
- AD13. Kernel-first phase order; dissolve `TimelineTrack`/`Timeline.tsx` last.
- AD14. First slice = one narrow track seam into the existing canvas; no
  `Timeline.tsx` split yet.
- AD15. **(Agent 2, new) Four-layer model + `src/timeline/contracts/` tier.**
  Kernel owns schema + plain-data vocabularies (data schema, edit-op union, cache
  lane/coalescing, runtime resource-kind/policy/reservation-request); stores own
  state; services own side-effecting implementations; components host. Resolves
  the recurring kernel-boundary tension behind OD3/OD4/runtime. Physical
  relocation scope decided in AD17 (OD7 closed).
- AD16. **(Agent 2, new) Edit-operation split (closes OD3).** Operation
  vocabulary → kernel `contracts/`; pure planners → kernel `commands/`; stateful
  `createTimelineEditOperationSlice` stays store-side and imports the kernel.
- AD17. **(Agent 3, closes OD7) Kernel boundary = two pure roots.** Import rule:
  `src/timeline/**` imports only `src/timeline/**` and `src/types/**`. Relocate the
  timeline-owned vocabularies (edit-op union, `runtimeCoordinatorTypes`,
  `cacheSchedulerTypes`) into `contracts/`; do **not** absorb the app-wide
  `src/types/` barrel (the kernel imports it — fact A13) and do **not** move
  store-state `stores/timeline/types.ts` (fact A15). `contracts/` is sub-tiered
  (`schema`/`editOps`/`cache`/`runtime`/`demand`/`commands`) as a DAG over
  `schema/`, with an explicit no-behavior "does not own" line. Strictly tighter
  than Agent 2's Option B because no service module is ever a kernel import.
- AD18. **(Agent 3, closes OD2) Registry mechanism + AV population in Phase 1;
  non-AV-kind population in Phase 9.** Minimum-viable bound (AD4) ratified.
  Source-specific runtime/shell/menu behavior attaches *by id* from the data
  manifest to static behavioral registries (features/shells/menus/providers) — the
  manifest never holds functions. "Stub now, populate at Phase 9" rejected (a
  consumer-less stub does not constrain the Phase 1–8 builders).
- AD19. **(Agent 3, closes OD5) Geometry version keys validated** against ripple /
  transition / linked-group edits: rebuild is bounded to tracks whose clip set,
  timing, transitions, or height changed; zoom is the only accepted global
  geometry rebuild. Transition records join the per-track key; an optional
  time-shift translate fast-path is noted but not required.
- AD20. **(Agent 3, closes OD6 tail) Per-clip packet identity = `clipId`,
  `paintVersion = hash(projection, rect, resource)`;** worker caches transferables
  by `(clipId, facet, version)` with main-thread `retain`/`release`; structural +
  raster worker/main parity tests make "one visual language" executable.
- AD21. **(Agent 3) Store slices are kernel-schema state managers,** not the
  read-side presentation API: write-side appliers + history + selection over the
  kernel's plain-data schema and edit-op vocabulary (success-criteria reframing,
  aligned with Codex 1 and B10).

## Resolved This Turn (Agent 2)

- OD1. **`TimelineProjection` rename — CLOSED.** Fact A7: ~4 source/test files,
  contract not yet load-bearing. Rename on move. (B3, AD3)
- OD3. **Edit-operation home — CLOSED in principle.** Precise split: operation
  vocabulary → kernel `contracts/`, pure planners → kernel `commands/`, stateful
  applier slice stays in store. (B10, AD16) Physical relocation = OD7.
- OD4. **Demand vs. shipped services — CLOSED in principle.** Kernel stage renamed
  `TimelineResourceDemand`; it emits lane-agnostic visible-demand items; the
  shipped `cacheSchedulerContracts` remains the sole priority/coalescing/policy
  authority; a service adapter bridges. The shipped `timelineVisualDemand.ts` is a
  different concept (render gating). (B6, AD6)
- OD6. **Paint packets — LARGELY CLOSED.** Domain packets confirmed by the shipped
  worker contract (fact A11); `TimelinePaintPacket` = kernel promotion of
  `TimelineClipCanvasWorkerClip`; transfer model is the shipped
  `ImageBitmap`+`Float32Array`+transfer-list. Remaining: per-clip packet version
  for incremental skip (implementation detail, tied to OD5 keys). (B8, AD8)

## Resolved This Turn (Agent 3)

- OD7. **Kernel-boundary relocation scope — CLOSED.** Decided on the real
  dependency graph (facts A13–A15), not the abstract A/B framing. Import rule =
  "`src/timeline/**` imports only `src/timeline/**` and `src/types/**`." Relocate
  the timeline-owned vocabularies (edit-op union, `runtimeCoordinatorTypes`,
  `cacheSchedulerTypes`); the kernel *imports* the pre-existing pure `src/types/`
  barrel rather than absorbing it; `stores/timeline/types.ts` stays in the store.
  `contracts/` is sub-tiered to prevent a god-folder. Runtime-field entanglement
  decoupled: kernel type-imports the schema now; `contracts/schema/` holds the
  runtime-free descriptor view; Phase 8 strips runtime fields from the persisted
  shape. (B1, AD17)
- OD2. **Registry weight + sequencing — CLOSED.** Bound ratified; mechanism + AV
  features/manifests built in Phase 1, non-AV kinds populated in Phase 9;
  runtime/shell/menu behavior attaches by id to static registries, never as
  manifest functions. (B4, AD18)
- OD5. **Geometry invalidation — CLOSED.** Version keys validated against ripple /
  transition / linked-group edits; rebuild bounded to changed tracks; zoom is the
  only accepted global rebuild; transition records added to the per-track key;
  optional translate fast-path noted. (B5, AD19)
- OD6. **Paint-packet tail — CLOSED.** Per-clip identity/version pinned; worker
  transferable cache with retain/release; structural + raster parity tests. (B8,
  AD20)

## Open Disagreements (rolling)

**None blocking. The Opus Team has converged.** OD1, OD3, OD4 (Agent 2) and OD2,
OD5, OD6, OD7 (Agent 3) are all closed. What remains is accepted tradeoffs and
out-of-scope flags, not unresolved architecture:

- **Accepted tradeoff (not dissent): registry weight at today's ~5 source kinds.**
  Codex 1's plain-builders objection is real *if* the goal were "only ever
  audio/video." The consensus standard is maximum future capability, and the
  June-2026 roadmap is explicitly many-source-kind, so the registry is the correct
  bet (B4). Recorded as a conscious bet, not an open question.
- **Deferred optimization (not architecture): the geometry translate fast-path**
  (B5/AD19) is layered on top of the version-key model and gated behind its own
  test; whether it is worth building is a perf-measurement call during Phase 2, not
  an architectural fork.
- **Out-of-scope flag for cross-team synthesis: `src/types/` is itself a broad
  barrel** (~800+ lines, app-wide). The kernel boundary treats it as the pure base
  tier (AD17), which is correct for this refactor, but a future pass may want to
  split `src/types/` by domain. Explicitly *not* part of the timeline refactor;
  noted so the cross-team synthesis does not mistake it for a timeline concern.

---

## Turn Log

### Turn 1 — Opus Agent 1 — 2026-06-07

**Did:** Read all three Codex plans, the consensus protocol, and the existing
repo plan; verified the actual `src/timeline` (absent), `renderModel/`,
`services/timeline/`, and god-file facts against HEAD; replaced the pending
consensus with a real draft (sections A, B1–B14, AD1–AD14, OD1–OD6).

**Explicit verdicts on Codex ideas:**

- Codex 1 — *Accept:* the plane decomposition (data / presentation / visual
  resource / paint / active interaction / command / runtime), the typed-provider
  taxonomy (video/audio/image/model/data), stable id indexes + identity
  preservation, runtime-free contract tests, chunk-by-track/window painting.
  *Reject:* keeping durable contracts under `src/components/timeline/renderModel/`
  (kernel wins); the "no registry, only fan-out rule" stance (insufficient
  against drift). *Modify:* its per-domain builders become the implementation
  unit *inside* the capability/feature registry rather than standing alone.
- Codex 2 — *Accept:* the pure `src/timeline/` kernel, source-capability
  adapters, the explicit demand stage, runtime broker reservations, structured-
  clone + `CanvasClip` coverage tests. *Reject:* the invented
  `policyId: 'interactive-preview'` (ghost policy; use shipped `interactive`);
  the `TimelineFrame` name ("frame" collides with video frames). *Modify:*
  capabilities are composed *with* Codex 3's feature registry, not used alone.
- Codex 3 — *Accept:* the kernel location, the feature registry (static,
  internal), feature-sliced cross-cutting visuals, **domain-level paint packets**
  over generic command lists, diagnostics-as-invariants, structural version keys,
  "file splitting is a consequence" phase ordering, `TimelineProjection` naming.
  *Reject:* nothing material. *Modify:* the feature registry is paired with Codex
  2's source-capability axis (entity-component), not used as the only axis.
- Current repo plan — *Accept:* adopt-don't-rebuild runtime coordinator, pinned
  shipped policy names, deleted-DOM-renderer invariants, focused-test budget.
  *Override:* contract location (kernel, not `renderModel/`) and the
  `timelineCommandBus.ts` (descriptors + executor, no bus).

**What Agent 2 should challenge next (in priority order):**

1. OD2 — the capabilities x features registry. Pressure-test it for
   over-abstraction. Propose the *minimum viable* registry shape (interfaces +
   dispatch site) that still kills `switch` sprawl, or argue for Codex 1's
   plain builders if the registry earns its weight only at >N source kinds.
2. OD1 — settle the `TimelineProjection` vs shipped `TimelineRenderModel` rename.
   Quantify the test/usage surface that would churn and make the call.
3. OD4 — define how the new demand stage subsumes or wraps the shipped
   `cacheSchedulerContracts`/`timelineVisualDemand.ts` without a second concept.
4. OD3 — decide whether edit-operation reducers migrate into the kernel or stay
   store-side; this sets the kernel's boundary with the store.
5. OD5/OD6 — make the geometry invalidation and paint-packet diff/transfer models
   concrete enough to defend the large-composition performance claim, since perf
   is an explicit consensus goal.

Also worth a fresh eye: whether the runtime lane (B11) belongs partly in the
kernel as pure *demand/reservation request* types (kernel) vs. coordinator
*implementation* (services) — i.e., draw the kernel/service line for runtime the
same way we drew it for resources.

### Turn 2 — Opus Agent 2 — 2026-06-07

**Did:** Verified Agent 1's draft against HEAD by reading the actual contracts
rather than reasoning from the plans — `renderModel/index.ts`,
`cacheSchedulerContracts.ts`, `timelineVisualDemand.ts`, `runtimeCoordinatorContracts.ts`,
`editOperations/{index,types}.ts`, the `timelineClipCanvasWorkerContract.ts` wire
format, and the `CanvasClip` interface. Added six verified grounding facts
(A7–A12) that move four open disagreements from "needs opinion" to "decided."
Updated the consensus in place (not appended): refined B1's import rule, added the
four-layer/contracts-tier model, closed B3, bounded B4's registry, rewrote B6,
grounded B8, corrected B11, sharpened B5, and resolved the edit-op home in B10.

**Accepted (from Agent 1's draft, unchanged):** the pure kernel (AD1, refined not
reversed), the 6-stage pipeline (AD2), `TimelineProjection` naming (AD3, now
*closed*), the two-axis registry concept (AD4, now *bounded*), one geometry source
(AD5), the resolver contract (AD7), domain paint packets (AD8, now *confirmed*),
thin hosts (AD9), descriptors-not-bus (AD10), adopt-don't-rebuild runtime (AD11,
now *corrected*), merged safeguards (AD12), kernel-first phasing (AD13), the
first slice (AD14). The Codex verdicts in Turn 1 stand.

**Modified / corrected (explicit deltas from Agent 1):**

1. **Import rule: "imports no *implementations*," not "imports nothing."** Agent
   1's literal "kernel never imports `src/stores/**` or services" is unworkable —
   the kernel must *name* the values it emits (edit operations, demand items,
   reservation requests). Introduced the **`src/timeline/contracts/` tier** and a
   four-layer model (kernel / store / services / hosts). (AD15)
2. **Demand renamed `TimelineResourceDemand` and stripped of priority logic.**
   Agent 1 had the demand stage "classify interactive/background/worker-transferable"
   — that duplicates the shipped scheduler's per-lane `priority`. Demand now emits
   lane-agnostic items; the scheduler stays the authority. (B6, AD6)
3. **Runtime providers bind to shipped `RenderResourceKind`.** Agent 1 took Codex
   1's provider list as greenfield; it partly reinvents the shipped vocabulary.
   Reservations are RAII over `retainResource`/`releaseResource`, not a new
   registry. (B11, AD11)

**Rejected:** nothing new from Agent 1's draft was rejected outright — the
corrections are refinements. (Turn 1's rejections of Codex 2's `interactive-preview`
ghost policy and the `renderModel/`-under-components placement stand and are now
backed by facts A10 and A7.)

**What Agent 3 should resolve (priority order):**

1. **OD7 (the crux): pick Option A vs B for the contracts-tier relocation.** This
   determines how literal the kernel boundary is and whether the store's data
   schema relocates. Everything else (OD3, OD4, runtime line) hangs off this.
   Agent 2 recommends Option A.
2. **OD2: ratify the registry bound, or defer registry population to Phase 9.**
   Decide whether Phase 1 builds the live capability/feature registry or just the
   interfaces + AV features, with non-AV capabilities stubbed until the future
   lane. Pressure the "manifest = data only" rule: where do source-specific
   *runtime/shell/menu* contributions attach without smuggling behavior into the
   manifest?
3. **OD5: validate version keys against many-clip edits** (ripple, transitions,
   linked groups) — confirm they don't silently degrade to global rebuilds.
4. **OD6 tail: confirm the per-clip packet identity/version** scheme and define
   the worker/main parity test (same packets in, pixel-equivalent out).
5. **Fresh eye for Agent 3:** does the four-layer model imply the `src/stores/timeline`
   slices should be re-described as "kernel-schema state managers" in the success
   criteria? And is `src/timeline/contracts/` at risk of itself becoming a
   god-folder — what is its explicit "does not own" line, and should schema vs.
   vocabulary be two sub-tiers (`contracts/schema/` vs `contracts/vocab/`)?

### Turn 3 — Opus Agent 3 — 2026-06-07

**Did:** Read all three Codex plans, the protocol, and the Agent 1/2 consensus.
Rather than reason about OD7 abstractly, verified the actual import graph behind
the kernel boundary against HEAD: `src/timeline/` is still absent; the canonical
`TimelineClip`/`TimelineTrack` schema lives in `src/types/index.ts` (709/830) in a
barrel that imports only within `src/types/`; `runtimeCoordinatorTypes.ts` has
zero imports; the edit-op union imports only `src/types` + its sibling
`transactionTypes`; `cacheSchedulerTypes.ts` imports only `src/types/audio`;
`stores/timeline/types.ts` imports `src/services/audio/*`; and `TimelineClip.source`
still carries `videoElement`/`audioElement`/`imageElement`/`file`. Added facts
A13–A15, then closed the four remaining open disagreements (OD2, OD5, OD6-tail,
OD7) and made the top read as final.

**Closed OD7 (the crux) — and improved on Agent 2's own recommendation.** Agent 2
recommended "Option A: relocate the type files" with a fuzzy edge ("the store's
data `types.ts`"). The dependency graph shows the binary A/B framing was slightly
mis-posed:

- The schema is not in the store's `types.ts`; it is in the app-wide `src/types/`
  barrel, which is *already* pure (fact A13). So "relocate the schema into the
  kernel" is the wrong move — it would make the timeline kernel own `Composition`,
  color, motion, and node-graph types, and force app-wide churn for non-timeline
  consumers. The kernel should **import** `src/types/`, not absorb it.
- The clean relocation targets are only the genuinely-timeline-owned, import-light
  vocabularies (edit-op union, `runtimeCoordinatorTypes`, `cacheSchedulerTypes`).
- `stores/timeline/types.ts` must **stay** (it is service-coupled state glue, not
  schema).

Net rule — "`src/timeline/**` imports only `src/timeline/**` and `src/types/**`" —
is *strictly tighter* than Agent 2's Option B (no service module is ever a kernel
import; there is no type-only allowlist to police), while costing less churn than a
naive Option A (we do not move the 800-line app-wide barrel). I also decoupled the
runtime-field entanglement Agent 2 flagged: the kernel type-imports the schema
today (ambient DOM types on a type are not module imports), `contracts/schema/`
holds the runtime-free *descriptor* view used by kernel code, and Phase 8 strips
the runtime fields from the persisted shape — three independent steps, not one
blocking ordering constraint.

**Closed OD2/OD5/OD6 and answered both fresh-eye questions:**

- OD2: ratified the minimum-viable registry bound; fixed sequencing (mechanism +
  AV population in Phase 1, non-AV kinds in Phase 9, rejecting "stub now/populate
  later"); and answered "where does source-specific runtime/shell/menu behavior
  go" — by id from the data manifest into per-axis static behavioral registries,
  never as functions in the manifest.
- OD5: validated the version keys against ripple/transition/linked-group edits
  (bounded to changed tracks; zoom is the only accepted global rebuild); added
  transition records to the per-track key; noted an optional translate fast-path.
- OD6 tail: pinned per-clip packet identity/version, the worker transferable cache
  with retain/release, and two parity tests (structural always-on + raster
  after-paint-changes).
- Fresh-eye Q1 (store slices): added AD21 — store slices are kernel-schema state
  managers (write/history/selection over the kernel vocabulary), not the read-side
  presentation API.
- Fresh-eye Q2 (`contracts/` god-folder): sub-tiered `contracts/` into
  `schema`/`editOps`/`cache`/`runtime`/`demand`/`commands` as a DAG over `schema/`,
  with an explicit no-behavior "does not own" line and an intra-`contracts` import
  test. (Chose family-named sub-tiers over Agent 2's `schema/` vs `vocab/` split
  because "everything that isn't schema is vocab" is too coarse to budget or test.)

**Accepted from Agents 1–2, unchanged:** the pure kernel + four-layer model (AD1,
AD15), the 6-stage pipeline (AD2), `TimelineProjection` naming (AD3), the two-axis
registry (AD4), one geometry source (AD5), the demand/scheduler split (AD6), the
resolver contract (AD7), domain paint packets (AD8), thin hosts (AD9),
descriptors-not-bus (AD10), adopt-don't-rebuild runtime with shipped-vocabulary
providers (AD11), merged safeguards (AD12), kernel-first phasing (AD13), the first
slice (AD14), the edit-op split (AD16). All Codex verdicts from Turns 1–2 stand.

**Rejected/overturned this turn:** nothing from Agents 1–2 was reversed. The only
correction is to Agent 2's *recommendation* on OD7 (relocate the schema), which the
import graph shows should be "import `src/types/`, relocate only the timeline-owned
vocabularies" — a refinement in the same direction, not a reversal.

**Remaining dissent:** none blocking (see Open Disagreements). Three items are
recorded as accepted-tradeoff / deferred-optimization / out-of-scope, not open
architecture.

**Hand-off to cross-team synthesis:** the Opus Team file is final. The most
load-bearing, defensible decisions for the synthesis to weigh against the Codex
Team file are: (1) the pure `src/timeline/` kernel with the two-pure-root import
rule and tiered `contracts/` (AD1/AD15/AD17); (2) the two-axis capability×feature
registry bounded to projection/demand/paint (AD4/AD18); (3) domain paint packets =
kernel promotion of the shipped worker contract, with the incremental transfer
cache (AD8/AD20); (4) adopt-don't-rebuild runtime bound to the shipped
`RenderResourceKind`/policy vocabulary (AD11). One caveat the synthesis should
re-verify if the Codex Team disagrees: the entire kernel-boundary argument rests on
`src/types/` being and staying import-pure — if a future change makes `src/types/`
import a service implementation, the "two pure roots" rule must be re-defended.
