# Timeline Rendering Architecture — Full-Scope Plan

**Status:** In progress — P0/P1/P2/P4 implemented behind flags; P3 gated on validation.
**Goal:** Display arbitrarily large compositions (100s–1000s of clips) at near-60fps, fully zoomed out, while still showing thumbnails and waveforms — and keep all editing interactions.
**Author:** debugging session 2026-05-31 (super-cut comp, 100 clips, ~9fps)

---

## Implementation status (issue #228 branch)

| Phase | What | State | Commit |
|---|---|---|---|
| P0a/b/c | Selection-culling fix · TimelineTrack memo · shared id-index | ✅ done | 9ebeae46 |
| P1 | `TimelineClipCanvas` clip bodies + LOD (flag `timelineCanvasClips`, default OFF) | ✅ done | 77c45121 |
| P1 | Canvas thumbnails (filmstrip, ImageBitmap cache) | ✅ done | 86f95755 |
| P2 | Canvas interaction via active-clip DOM overlay + hover hit-test | ✅ done | 9f2e338c |
| P4 | OffscreenCanvas Web Worker path (flag `timelineCanvasWorker`, default OFF) | ✅ done | d01c3cd9 |
| P1 | Waveforms on canvas (audio clips) | ⏳ follow-up | |
| P3 | Make canvas the **default** · remove DOM clip path · finish god-object dissolution | ⛔ **validation-gated** | |

**Why P3 is gated, by design:** the plan's own exit criteria (§3) require P1 to hit
the 1000-clip/≥55fps target and P2 to pass QA sign-off *before* P3 flips the
default and deletes the DOM path. P3 changes behaviour for every user, so it must
not land until the flag has been validated live on a real large comp. Everything
that precedes that gate (P0/P1/P2 and the optional P4) is implemented and shippable
behind off-by-default flags. To validate: run the branch dev server, set
`window.__ENGINE_FLAGS__.timelineCanvasClips = true`, open a 100+ clip comp, check
alignment/interaction, and compare `getStats` `rafGap` before/after.

---

## 0. TL;DR — Is this even possible with React?

**Yes — but the clips must leave the React DOM.**

Every professional NLE (Premiere, DaVinci Resolve, Final Cut) and every fast web editor (Descript, Clipchamp, Veed) renders the timeline clip area to a **canvas**, not to DOM nodes. React/DOM stays responsible only for:

- the chrome (track headers, controls, ruler, playhead, scrollbars),
- dialogs / context menus,
- the **interaction overlay** for the 1–2 clips you are currently touching (selection handles, trim/fade handles, hover affordance).

The clip bodies — rectangles, colors, **thumbnails**, **waveforms**, labels — get drawn onto a single `<canvas>` per timeline. This makes per-frame cost **O(visible clips)** instead of **O(all DOM nodes)**, and "fully zoomed out, everything at once" becomes trivial because you simply draw colored bars (Level-of-Detail) instead of mounting thousands of components.

React itself is not the bottleneck. **DOM-per-clip is.** React stays — it just stops owning the clip bodies.

---

## 1. Measured evidence (why we are at 9fps)

From the live dev bridge (`getStats` / `getPlaybackTrace`) on the 100-clip "super cut" comp, **idle/paused**:

| Metric | Value | Meaning |
|---|---|---|
| `fps` | **9** (target 60) | starved |
| `timing.total` (GPU render) | **1.01 ms** | the WebGPU engine is NOT the problem |
| `rafGap` | **115.9 ms** | ~114 ms/frame spent on main thread *outside* render |
| `drops.reason` | `slow_raf` | main thread can't service requestAnimationFrame |
| `layerCount` | 1 | only one visual layer at the playhead — rendering is cheap |

The GPU draws a frame in ~1 ms. The other ~114 ms is React reconciliation + browser style/layout/paint/composite of a huge timeline DOM. Loading the comp takes ~30 s = mounting 100 heavy components.

### Root causes in current code

1. **Viewport culling is defeated by selection.**
   `src/components/timeline/TimelineTrack.tsx:282` — selected clips are *always* rendered regardless of viewport:
   ```ts
   if (selectedClipIds.has(clip.id) || draggedClipIds.has(clip.id) || clipTrim?.clipId === clip.id) {
     return true;
   }
   ```
   Select-all on 100 clips → all 100 in the DOM, culling contributes nothing (exactly the screenshot case).

2. **`TimelineClip` is a 4,328-line mega-component with 51 store subscriptions per clip.**
   `src/components/timeline/TimelineClip.tsx` — 51 × `useTimelineStore(...)` + 3 × `useMediaStore(...)`, including **30 `.find()` scans** over `files` / `compositions` / `clips` (O(n)). At 100 clips that is ~5,000 selector evaluations and thousands of array scans on *every* store update. Most are audio-only features (spectral, stems, audio-regions) that a video clip subscribes to but never needs.

3. **`TimelineTrack` memoization is effectively disabled.**
   `src/components/timeline/TimelineTrack.tsx:430` `areTimelineTrackPropsEqual` only returns `true` during an active clip drag; otherwise every track re-renders on every parent render.

4. **Heavy DOM → expensive paint/composite each frame.**
   100 clips × thumbnails + gradients + `backdrop-filter` form large composited layers the browser must re-composite whenever the preview canvas updates → RAF starved to 115 ms.

### What is already good (keep it)

- Thumbnails are already viewport-windowed (`THUMBNAIL_RENDER_OVERSCAN_PX`, `thumbnailRenderWindow`).
- `TimelineClip` only subscribes to `playheadPosition` when the blade tool is active (`TimelineClip.tsx:807`) → normal playback does not re-render every clip per frame.
- Thumbnails come from a central source cache: `thumbnailCacheService` (`src/hooks/useThumbnailCache.ts`).
- **Waveforms are already rendered on a canvas** with an LOD pyramid: `ClipWaveform.tsx` + `src/components/timeline/utils/waveformLod.ts`. The canvas+LOD pattern is already proven in this codebase.

---

## 2. Target architecture — Hybrid Canvas Timeline

Three layers, stacked, sharing one coordinate transform (`timeToPixel` / `scrollX` / `zoom`):

```
┌─────────────────────────────────────────────────────────┐
│ React chrome (DOM)                                        │  ← unchanged React
│  track headers · controls · ruler · playhead · scrollbars │
├─────────────────────────────────────────────────────────┤
│ Interaction overlay (DOM, React)                          │  ← only ACTIVE clips
│  trim/fade handles · selection outline · hover · ctx menu │     (1–2 at a time)
├─────────────────────────────────────────────────────────┤
│ Clip layer (Canvas 2D / OffscreenCanvas)                  │  ← ALL clips, drawn
│  clip rects · thumbnails · waveforms · labels (LOD)       │     not mounted
└─────────────────────────────────────────────────────────┘
```

### 2.1 The Clip Canvas (`TimelineClipCanvas`)

A single `<canvas>` covering the track-lanes area. One draw call cycle paints every visible clip across all tracks.

Draw loop (per visible clip, culled to viewport + small overscan):

```
for each track (visible vertical range):
  for each clip overlapping [scrollLeftTime, scrollRightTime]:
    x = timeToPixel(clip.startTime) - scrollX
    w = timeToPixel(clip.duration)
    drawClipBackground(ctx, x, y, w, h, color, selected, muted, ...)
    if lod >= THUMB:   drawThumbnails(ctx, clip, x, w)      // from ImageBitmap atlas
    if lod >= WAVE:    drawWaveform(ctx, clip, x, w)        // reuse waveformLod pyramid
    if lod >= LABEL:   drawLabel(ctx, clip.name, x, w)
    drawClipBorder(ctx, ...)                                 // selection / link group
```

Cost is proportional to **clips intersecting the viewport**, never the total. Drawing rectangles + cached bitmaps is GPU-accelerated by the browser's 2D canvas backend.

### 2.2 Level of Detail (this is what makes "fully zoomed out" smooth)

The clip's pixel width decides how much to draw:

| Clip pixel width | What we draw |
|---|---|
| `< 4 px` | merge into a density bar (see 2.6); no per-clip work |
| `4–24 px` | solid color bar + selection state only |
| `24–96 px` | color + **one poster thumbnail** + truncated label |
| `> 96 px` | full filmstrip thumbnails + waveform + label + (handles via overlay) |

Fully zoomed out, 1000 clips might each be 2 px wide → we draw a handful of aggregated density bars, not 1000 anything. This is impossible to do cheaply with DOM (you'd still mount 1000 nodes) but trivial on canvas.

### 2.3 Thumbnail atlas (reuse `thumbnailCacheService`)

- Keep `thumbnailCacheService` as the source of truth (already source-based, dedup across clips sharing a media file).
- Add an **ImageBitmap layer**: decode each cached thumbnail blob once into an `ImageBitmap` (GPU-uploadable, drawable with `ctx.drawImage` with zero per-frame decode). Optionally pack into a sprite atlas per media file to reduce `drawImage` calls.
- Canvas asks: "thumbnails for media X, source range [in,out], N slots" → same API shape as `useThumbnailCache.getThumbnailsForRange`, but returns `ImageBitmap`s.
- Eviction by LRU on total bitmap memory budget (mirror existing cache budget logic).

### 2.4 Waveform on canvas (reuse `waveformLod`)

`ClipWaveform.tsx` already builds an LOD pyramid and draws to a 2D context. Lift the *draw* function out of the React component into a pure `drawWaveform(ctx, pyramid, window, style)` used by both the old DOM path (during migration) and the new clip canvas. No new DSP needed.

### 2.5 Hit-testing & interaction (no DOM per clip)

- Maintain a **spatial index** of clip rects keyed by `(trackId, startTime, endTime)` — an interval tree or a simple per-track sorted array with binary search (clips per track are modest; binary search is plenty).
- Pointer events land on the canvas (or a transparent DOM hit layer). Convert `clientX/Y → (trackId, time)` → look up the clip → dispatch the **existing** selection/drag/trim handlers (they already operate on `clip.id`, see `Timeline.tsx` `handleTimelineClipMouseDown` etc.).
- While hovering or selecting a clip, mount a **single DOM overlay** for that clip only: trim handles, fade handles, region-edit UI, context-menu anchor. This keeps the rich interactive affordances exactly as today, but for 1–2 clips instead of 100.
- Drag/trim previews: redraw the canvas (cheap) instead of re-rendering React. The active clip's geometry comes from the same `clipDrag`/`clipTrim` state already in the store.

### 2.6 Density bars (zoomed-out aggregation)

When many clips fall under a few pixels, bucket them per X-pixel-column and draw an aggregate bar (average label color, "selected" if any selected). Gives a meaningful, smooth overview when fully zoomed out instead of a smear of sub-pixel rectangles.

### 2.7 Invalidation model (don't redraw when nothing changed)

The clip canvas redraws only when something it depends on changes:

- `clips` / `tracks` geometry, `selectedClipIds`, label colors, thumbnail/waveform cache version, `scrollX`, `zoom`, track heights, drag/trim preview.
- It does **not** redraw on `playheadPosition` (the playhead is a separate cheap DOM/canvas line).
- Use a dirty flag + single `requestAnimationFrame` coalesce; skip frames where nothing is dirty. This alone keeps idle at true idle (no 115 ms paint loop).

### 2.8 Phase 2 option — OffscreenCanvas in a worker

Once the clip canvas is stable, move its drawing to an `OffscreenCanvas` controlled by a Web Worker. Thumbnails (`ImageBitmap`) and waveform pyramids (transferable `Float32Array`) are worker-friendly. Result: the entire timeline clip render happens **off the main thread**, so even React reconciliation of the chrome can't stutter it. This is the path to rock-solid 60fps with very large comps. Optional, not required for the first big win.

### 2.9 God-object decomposition (`TimelineClip.tsx` is 4,328 lines)

**This is a first-class workstream, not a side effect of the canvas migration.** The canvas removes only the *rendering* responsibility from `TimelineClip`. The component also carries a large amount of *interaction/business logic* (audio-region editing, spectral selection, stem separation, video bake, trim/fade/slip gestures, keyframe drag, context menus). That logic does not disappear — it moves to the active-clip overlay. If we move 4,328 lines wholesale into the overlay, we still have a god object, just rendered for one clip.

So `TimelineClip` is decomposed by responsibility, independent of (and partly ahead of) the canvas work:

| Responsibility (today all inside `TimelineClip`) | Target home |
|---|---|
| Geometry / trim math (`displayStartTime`, slip window, clamps) | pure `utils` + small hooks |
| Audio-region editing (selection, gain, fades, fx presets) | own component, **mounted only for audio clips** |
| Spectral selection / spectrogram region edits | own module |
| Stem-separation UI (jobs, choices, prewarm) | own module |
| Video-bake regions | own module |
| Thumbnails / filmstrip | → canvas (Phase 1) |
| Waveform | already `ClipWaveform` (reuse) |
| Pointer / tool dispatch | already partly `timelineToolPointerDispatcher` (finish extracting) |
| Label-color resolution | indexed-map lookup (see 0c) |
| 51 store subscriptions | **split by feature** — a video clip must not instantiate the ~30 audio-only subscriptions |

Two payoffs that do **not** depend on the canvas:
1. **Immediate performance:** splitting subscriptions by clip kind removes ~30 audio-feature subscriptions + their `.find()` scans from every video clip. This helps even the zoomed-out-to-fit case where all clips are genuinely in view.
2. **De-risks the canvas migration:** the interaction logic ends up in cohesive, testable modules feeding the single active-clip overlay, instead of a monolith that must be moved atomically.

Decomposition rule: the only thing that needs to render for *every* clip is the visual body (→ canvas). Everything else only needs to exist for the **1–2 clips being interacted with** → mount those modules in the active-clip overlay, lazily, by clip kind.

---

## 3. Migration plan (incremental, app stays working)

Each phase is shippable and behind a feature flag where it changes rendering.

### Phase 0 — Stop the bleeding (hours, low risk) ✅ do first
- **0a.** Fix culling bypass: in `TimelineTrack.tsx:282`, only force-render a selected/dragged clip if it is also within `[visibleStartTime, visibleEndTime]` (+overscan). Selected clips off-screen don't need DOM — selection is restored when scrolled into view. Keep dragged/trimmed clips always rendered.
- **0b.** Repair `areTimelineTrackPropsEqual` (`TimelineTrack.tsx:430`) to do a real shallow compare in the non-drag case too, so tracks stop re-rendering on every parent render.
- **0c.** Replace the O(n) `.find()` selectors in `TimelineClip` `mediaLabelHex` and friends with lookups into indexed maps (`filesById`, `compositionsById`) provided by the stores.
- **0d.** Begin the god-object split (§2.9): gate the ~30 audio-only store subscriptions behind `isAudioClip` so video clips stop instantiating them. First, safe slice of the decomposition; biggest per-clip subscription win and helps the zoomed-out case.
- **Expected:** select-all on 100 clips drops from 100 → ~15 DOM clips; idle paint loop stops; video clips shed ~30 subscriptions each. Measure `rafGap` via bridge before/after.

### Phase 1 — Read-only clip canvas behind a flag (the real fix)
- Add `featureFlags.timelineCanvasClips`.
- Build `TimelineClipCanvas` rendering clip backgrounds + LOD + labels for all tracks. Thumbnails/waveforms first via existing data, drawn as bitmaps.
- When the flag is on, the DOM clip path renders **nothing** (or only the active overlay); the canvas owns the clip bodies. Selection/scroll/zoom drive canvas redraws.
- Keep DOM path as fallback for parity testing.
- **Exit criteria:** 1000-clip synthetic comp scrolls and zooms at ≥55fps; `rafGap` ≤ 18 ms idle.

### Phase 2 — Interaction parity
- Spatial index + pointer routing → existing `clip.id` handlers.
- Single-clip DOM interaction overlay (trim/fade/region edit/context menu) for hovered/selected clip.
- Drag/trim/slip previews via canvas redraw.
- **Exit criteria:** every interaction available in the DOM path works on the canvas path; QA sign-off.

### Phase 3 — Make canvas the default, finish god-object decomposition, remove DOM clip path
- Flip the flag on by default; delete the per-clip DOM rendering once parity is confirmed.
- Complete the §2.9 decomposition: `TimelineClip.tsx` is dissolved into the active-clip overlay + focused per-feature modules (audio-region, spectral, stem, video-bake) mounted lazily by clip kind. The 4,328-line monolith no longer exists; nothing renders for non-active clips except the canvas body.

### Phase 4 (optional) — OffscreenCanvas worker
- Move clip drawing off the main thread for very large comps.

---

## 4. Performance targets & how we measure

Use the existing dev bridge (`getStats`, `getStatsHistory`, `getPlaybackTrace`):

| Scenario | Target |
|---|---|
| 100 clips, idle | `rafGap` ≤ 17 ms, `fps` ≥ 58 |
| 100 clips, select-all, idle | unchanged from above (no penalty) |
| 1000 clips, fully zoomed out, scrolling | `fps` ≥ 55 |
| Comp load (100 clips) | ≤ ~2 s to interactive (no 100-component mount) |
| Playback, 100 clips | no per-frame clip re-render; `drops.lastSecond` ≈ 0 |

Benchmark harness: a script that programmatically creates N clips (via the AI bridge / store) and samples `getStatsHistory` while scrolling/zooming.

---

## 5. Alternatives considered (and why they're insufficient alone)

- **Virtualize the DOM clip list only.** Helps the common case but breaks down exactly when the user wants "everything at once, zoomed out" (then *all* clips are in view → no windowing benefit) and still mounts heavy components. Necessary as Phase 0, not sufficient.
- **Just optimize React (memo, split subscriptions).** Cuts the 51-subscription tax and helps a lot (Phase 0c), but DOM node count, layout, and paint still scale with clip count. Ceiling is maybe low-hundreds of clips, not thousands.
- **Render timeline with the existing WebGPU engine.** Possible but couples timeline to the preview render target and competes for the device; a dedicated 2D/Offscreen canvas is simpler, isolated, and already half-built (waveforms).

## 6. Risks & mitigations

- **Interaction parity is the hard part** (trim/fade/region/spectral edits, context menus). Mitigation: keep these as DOM overlays for the active clip; reuse existing handlers; phase behind a flag with the DOM path as fallback until QA passes.
- **Text/label crispness & accessibility on canvas.** Mitigation: draw labels at devicePixelRatio; keep a11y affordances on the active-clip DOM overlay; canvas is decorative/visual like the preview already is.
- **Theme/CSS styling moves into draw code.** Mitigation: read CSS custom properties (`--track-color`, etc.) once per redraw into a style object; centralize clip visual style constants.
- **Large refactor on a shared branch.** Mitigation: feature-flagged, additive; the DOM path stays until Phase 3. No deletion until parity is proven.

## 7. First concrete steps

1. Land Phase 0a/0b/0c and re-measure `rafGap` on the super-cut comp (fast, high ROI).
2. Spike `TimelineClipCanvas` (backgrounds + LOD + labels only) behind `featureFlags.timelineCanvasClips` to validate the 1000-clip target.
3. Lift `drawWaveform` out of `ClipWaveform.tsx` and add the `ImageBitmap` thumbnail layer on `thumbnailCacheService`.
4. Build the spatial index + pointer routing; add the single active-clip overlay.

---

### Appendix — key files

- `src/components/timeline/Timeline.tsx` — composition root, `renderClip` (`:2739`), playhead subscription (`:480`).
- `src/components/timeline/TimelineTrack.tsx` — viewport culling (`:270`), selection bypass (`:282`), memo (`:430`).
- `src/components/timeline/TimelineClip.tsx` — 4,328-line clip component, 51 subscriptions (target of split).
- `src/components/timeline/components/ClipWaveform.tsx` + `utils/waveformLod.ts` — existing canvas waveform + LOD (reuse).
- `src/hooks/useThumbnailCache.ts` + `src/services/thumbnailCacheService.ts` — thumbnail source cache (reuse).
- `src/engine/render/RenderLoop.ts` — engine RAF/idle (confirms render is cheap; timeline DOM is the cost).
</content>
</invoke>
