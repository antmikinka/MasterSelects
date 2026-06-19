# Browser-Local Background Removal Plan

Status: planning
Updated: 2026-06-17

## Goal

Add a Photoroom-like background-removal workflow to MasterSelects that runs on
the user's own CPU/GPU in the browser/local environment, produces a transparent
image or matte artifact, and fits the existing local-first/serverless product
architecture.

This plan uses `briaai/RMBG-1.4` and the Xenova in-browser demo as the UX and
quality reference, but it must not ship BRIA weights by default until BRIA grants
written permission or commercial terms are accepted.

## Current External Status

- Reference demo: <https://huggingface.co/spaces/Xenova/remove-background-web>
- Reference model: <https://huggingface.co/briaai/RMBG-1.4>
- BRIA contact attempt:
  - Email sent 2026-06-17 to `legal@bria.ai`, CC `info@bria.ai`.
  - `legal@bria.ai` bounced as a Google group/address that may not exist or may
    reject outside mail.
  - `info@bria.ai` may still have received the CC unless a separate bounce
    appears.
  - Next contact path should be BRIA's official contact form:
    <https://bria.ai/contact-us>

## Confirmed Technical Facts

`RMBG-1.4`:

- Task: background removal / image segmentation.
- License state: source-available for non-commercial use; commercial use needs
  a BRIA agreement. Treat as blocked for product shipment until written
  permission exists.
- Architecture: IS-Net-derived model with BRIA training/data changes.
- Input preprocessing from public model materials:
  - Resize to `1024x1024`.
  - Rescale RGB by `1 / 255`.
  - Normalize with mean `[0.5, 0.5, 0.5]` and std `[1, 1, 1]`.
  - No padding in the published pipeline.
- Output behavior:
  - Model returns multiple side-output masks.
  - Public pipeline uses the first mask.
  - Mask is upscaled back to original image size.
  - Public pipeline min/max normalizes the mask and applies it as alpha.
- ONNX files available in the model repository:
  - `model.onnx`: about 176 MB.
  - `model_fp16.onnx`: about 88 MB.
  - `model_quantized.onnx`: about 44 MB.

Xenova demo:

- Static browser app.
- Uses an older `@xenova/transformers`/ONNX Runtime stack.
- Runs locally in the browser.
- Loads `briaai/RMBG-1.4`, preprocesses with Transformers.js, runs ONNX
  inference, resizes the mask to source dimensions, and writes mask values into
  a canvas alpha channel.

MasterSelects already has:

- `@huggingface/transformers` in `package.json`.
- `onnxruntime-web` in `package.json`.
- Browser-local SAM 2 using ONNX Runtime/WebGPU plus OPFS model caching.
- A Transformers.js worker pattern in local transcription.
- Media import paths for generated assets.
- A MatAnyone2 workflow that imports matte results into a dedicated media
  folder.

## Product Shape

First shippable scope:

- Still-image/current-frame background removal.
- Output a new transparent PNG asset in the media library.
- Keep source media unchanged.
- Surface in the existing AI segmentation/matting area, not as a standalone paid
  AI generation feature.
- Make model/source explicit in the UI when BRIA is enabled.

Explicitly out of first scope:

- Full in-browser video background removal.
- Temporal smoothing/flicker handling.
- Mutating original media.
- Shipping BRIA model weights without written license clearance.

## Architecture

Add a new browser-local background-removal module instead of extending SAM2
directly.

Proposed files:

- `src/services/backgroundRemoval/modelCatalog.ts`
- `src/services/backgroundRemoval/BackgroundRemovalModelManager.ts`
- `src/services/backgroundRemoval/BackgroundRemovalService.ts`
- `src/services/backgroundRemoval/backgroundRemovalWorker.ts`
- `src/services/backgroundRemoval/types.ts`
- `src/stores/backgroundRemovalStore.ts`
- `src/components/panels/sam2/BackgroundRemovalSection.tsx`

Use the existing SAM2/Stem patterns:

- OPFS cache for model files and metadata.
- HMR-safe singleton for service/model manager.
- Worker-side inference so the panel does not block.
- Zustand store contains only serializable job/status/progress/error/model
  state. Do not store `File`, `Blob`, canvas, ImageBitmap, ONNX sessions, or DOM
  handles in durable stores.
- Use `Logger.create('BackgroundRemoval')`.

Model abstraction:

```ts
type BackgroundRemovalModelId =
  | 'bria-rmbg-1.4'
  | 'birefnet-lite-onnx'
  | 'ben2-onnx'
  | 'ormbg-onnx';
```

BRIA model entry remains disabled/experimental until license clearance:

- Show in internal/dev builds only, or behind an explicit local feature flag.
- Include a clear model license state in the catalog.
- Do not include BRIA weights in bundled artifacts until approved.

## Runtime Flow

1. User selects an image/media item or captures the current preview frame.
2. UI asks `BackgroundRemovalService` to run a job.
3. Service resolves the source to bounded `ImageData` or a transferable bitmap.
4. Worker loads the selected model:
   - Preferred path: Transformers.js with existing package version.
   - Fallback path: direct ONNX Runtime adapter if the model requires custom
     pre/post-processing.
5. Worker preprocesses at model input resolution.
6. Worker runs inference.
7. Worker post-processes alpha:
   - Restore original aspect/dimensions.
   - Preserve soft alpha.
   - Guard `max == min` during normalization.
   - Avoid thresholding by default.
8. Service composites source RGB plus alpha into PNG.
9. Result imports through `useMediaStore.getState().importFile(...)` with
   `forceCopyToProject: true`.
10. Result is placed under a stable folder, likely `AI Gen / Matting`.

## UI Plan

Add a section to the AI Segment panel:

- Source selector:
  - Selected media image.
  - Current preview frame.
- Button: `Remove Background`.
- Model status:
  - Not downloaded.
  - Downloading with progress.
  - Ready.
  - Running.
  - Error.
- Output command:
  - `Import transparent PNG`.
  - Later: `Add to timeline`.
- Optional refinement bridge:
  - `Refine with SAM2` after result import.

Keep `SAM2Panel.tsx` below the 700 LOC ceiling by extracting any new UI into
child components.

## Model Candidate Strategy

Use BRIA only as reference until legal clearance exists.

Benchmark candidates:

- `briaai/RMBG-1.4`: best observed UX/reference, license-blocked.
- `briaai/RMBG-2.0`: newer, also non-commercial by default, license-blocked.
- `onnx-community/BiRefNet_lite-ONNX`: permissive candidate to test for quality.
- `onnx-community/BEN2-ONNX`: permissive candidate with background-removal
  examples.
- `onnx-community/ormbg-ONNX`: permissive candidate to test.
- `Xenova/modnet`: useful person/portrait baseline, not enough for general
  product/object cutouts.

Do not choose the final shipping model without a browser benchmark on real
MasterSelects images.

## Benchmark Plan

Create a local benchmark set with at least:

- Portrait/hair.
- Product on cluttered background.
- Dark foreground on dark background.
- Light foreground on light background.
- Glass/translucent object.
- Motion-blurred video frame.
- Low-resolution frame.
- High-resolution still.
- Object touching image edge.
- Multiple foreground objects.

Measure:

- First load time.
- Cached load time.
- Inference time on WebGPU.
- Inference time on WASM fallback.
- Peak memory where available.
- Output dimensions and alpha quality.
- Linux/Mesa behavior.
- Failure mode when WebGPU is missing or silently broken.

Quality review:

- Edge softness.
- Hair/fine detail.
- Holes.
- Foreground color contamination.
- Background leaks.
- Fringing after compositing over white, black, and checkerboard.

## Linux / Mesa Constraints

This feature touches canvas, workers, ONNX, and possibly WebGPU. It must follow
the repository's Linux/Mesa rules:

- Keep model inference size bounded.
- Clamp backing canvases below 8192 in either dimension.
- Use software 2D canvas fallback with `willReadFrequently: true` where needed.
- Treat WebGPU as an optimization, not the only path.
- Do not rely on worker `OffscreenCanvas` without a main-thread fallback.
- Verify actual visible/output pixels, not only completed draw calls.

## Test Plan

Unit tests:

- Model catalog metadata and license-state guards.
- Cache manager:
  - empty cache.
  - valid cached file.
  - undersized/corrupt cached file.
  - clear cache.
- Alpha composition:
  - RGB preservation.
  - soft alpha preservation.
  - all-zero/all-one mask.
  - `max == min` normalization guard.
- PNG output file naming and MIME type.
- Media folder creation for `AI Gen / Matting`.

Integration/smoke tests:

- Worker client request/cancel/error lifecycle.
- Import generated PNG through media store.
- UI state transitions with mocked worker.

Manual checks:

- Chrome/Edge WebGPU.
- WASM fallback.
- Linux/Mesa machine or forced software path.
- Memory behavior after repeated runs and cache clear.

## Implementation Packets

### Packet 1: Planning And Legal Gate

Write set:

- `docs/ongoing/Browser-Local-Background-Removal-Plan.md`

Stop conditions:

- Plan documents license gate, architecture, packets, risks, and checks.
- No source implementation.

### Packet 2: Model-Agnostic Service Skeleton

Write set:

- `src/services/backgroundRemoval/*`
- `src/stores/backgroundRemovalStore.ts`
- Focused unit tests.

Goal:

- Add catalog, status store, cache manager, and worker-client shell.
- Include BRIA entry only as disabled/reference metadata.
- No UI yet.

Checks:

- `npx tsc -b`
- focused vitest for new service/cache/store tests

### Packet 3: Local Inference Prototype

Write set:

- `src/services/backgroundRemoval/backgroundRemovalWorker.ts`
- model adapter files
- focused tests for pure post-processing/composition

Goal:

- Run one permissive candidate locally through Transformers.js or direct ONNX.
- Produce a transparent PNG from an image input.
- Keep BRIA adapter behind a dev-only/license-disabled gate unless permission is
  received.

Checks:

- `npx tsc -b`
- focused unit tests
- manual browser smoke

### Packet 4: AI Segment Panel Integration

Write set:

- `src/components/panels/sam2/BackgroundRemovalSection.tsx`
- small edits to `src/components/panels/SAM2Panel.tsx`
- media folder/import helpers as needed
- docs update in `docs/Features/AI-Integration.md`

Goal:

- User can run background removal on selected image/current frame and import the
  transparent PNG.

Checks:

- `npx tsc -b`
- focused component/store tests
- manual UI smoke

### Packet 5: Benchmark And Model Selection

Write set:

- benchmark script or dev-only harness
- `docs/ongoing/Browser-Local-Background-Removal-Plan.md`
- optional `docs/Features/AI-Integration.md`

Goal:

- Compare BRIA reference, BiRefNet-lite, BEN2, ORMBG, and MODNet where license
  allows testing.
- Decide shipping default and fallback.

Checks:

- benchmark report with model sizes/load/inference/quality notes

### Packet 6: Production Hardening

Write set:

- service/worker/UI refinements
- docs
- tests

Goal:

- Cache controls, cancellation, memory cleanup, retry/error UX, attribution,
  and final docs.

Checks:

- `npm run build`
- `npm run lint`
- `npm run test`

## Open Questions

- Does BRIA grant written permission for free browser-local use in MasterSelects?
- If not, which permissive candidate is close enough to the RMBG quality bar?
- Should the output be only a new transparent image, or also a clip-level raster
  matte attachment later?
- Should current-frame capture use existing preview capture or a render-host
  readback path for full-resolution output?
- Should model files be loaded from Hugging Face at runtime, mirrored, or cached
  through a project-controlled model manifest?

## Decision Log

- 2026-06-17: Use the Xenova RMBG demo as quality/UX reference.
- 2026-06-17: Do not ship BRIA weights until written permission/commercial terms
  are resolved.
- 2026-06-17: First scope is still-image/current-frame transparent PNG output,
  not full video matting.
- 2026-06-17: Keep SAM2 for interactive refinement/rotoscoping; do not overload
  SAM2 as the default one-click background-removal path.
