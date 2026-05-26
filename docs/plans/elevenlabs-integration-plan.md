# ElevenLabs In AI Generative Board Plan

GitHub issue: https://github.com/Sportinger/MasterSelects/issues/160
Branch: `issue-160-implement-elevenlabs`
Working folder: `C:\Users\admin\Documents\masterselects-elevenlabs`

## Goal

Turn the existing AI Video panel into an AI Generative panel and make ElevenLabs a first-class audio generation option inside the FlashBoard board view.

The user should be able to choose between video, image, and audio generation from the same board composer. Audio generations should use ElevenLabs voices and voice settings, then become normal durable media assets that can be previewed, dragged, saved, reloaded, and inserted onto audio tracks.

## Current Code Shape

The right integration point is FlashBoard, not a separate one-off panel.

Relevant files:

- `src/components/panels/AIVideoPanel.tsx`
- `src/components/panels/AIVideoPanel.css`
- `src/components/panels/flashboard/FlashBoardWorkspace.tsx`
- `src/components/panels/flashboard/FlashBoardCanvas.tsx`
- `src/components/panels/flashboard/FlashBoardToolbar.tsx`
- `src/components/panels/flashboard/FlashBoardComposer.tsx`
- `src/components/panels/flashboard/FlashBoardNode.tsx`
- `src/components/panels/flashboard/FlashBoardContextMenu.tsx`
- `src/components/panels/flashboard/FlashBoardInspector.tsx`
- `src/components/panels/flashboard/FlashBoard.css`
- `src/services/flashboard/FlashBoardJobService.ts`
- `src/services/flashboard/FlashBoardMediaBridge.ts`
- `src/services/flashboard/FlashBoardModelCatalog.ts`
- `src/services/flashboard/FlashBoardPricing.ts`
- `src/services/flashboard/types.ts`
- `src/stores/flashboardStore/types.ts`
- `src/stores/flashboardStore/slices/nodeSlice.ts`
- `src/stores/flashboardStore/slices/uiSlice.ts`
- `src/services/project/projectSave.ts`
- `src/services/project/projectLoad.ts`
- `src/hooks/useGlobalHistory.ts`
- `src/services/project/projectLifecycle.ts`
- `src/types/dock.ts`
- `src/stores/dockStore.ts`
- `src/components/panels/media/board/MediaBoardView.tsx`

Current useful behavior:

- FlashBoard already persists board nodes in projects.
- FlashBoard already queues generation jobs.
- FlashBoard already imports generated video/image into `AI Gen`.
- FlashBoard already has direct timeline insertion.
- `mediaStore.importFile()` already supports audio files.
- `timeline.addClip()` already routes audio files to audio clips and waveform generation.

Current gaps:

- FlashBoard generation/result types only allow `video | image`.
- The composer model popover only exposes Kie.ai/cloud in board mode.
- `AIVideoPanel` gates access around Kie.ai/cloud only.
- FlashBoard nodes only render image/video previews.
- FlashBoard job completion assumes a remote asset URL, while ElevenLabs text-to-speech returns audio directly.
- `FlashBoardWorkspace` currently rejects completed jobs that do not provide `assetUrl`, so direct `File` completion must be handled there.
- FlashBoard pricing falls through non-cloud/non-PiAPI services into Kie pricing, so ElevenLabs needs an explicit no-estimate branch.
- FlashBoard undo/history compares a manual composer snapshot and will not capture new audio settings unless updated.
- `FlashBoardCanvas` and `createReferenceNode()` currently treat every non-image result as video, so audio drops/reference actions need explicit behavior.
- Persisted dock layouts store panel titles. Changing `PANEL_CONFIGS` and the default layout is not enough because unchanged `ai-video` panels keep their old saved title.
- Classic provider controls, the balance bar, and the classic Generate button currently render outside the Board/Classic split. ElevenLabs-only board access must not expose stale Kie/cloud-only controls.
- The dock, media board shortcut, FlashBoard docs, and AI docs still name the surface "AI Video".

## Product Scope

### User-Facing Behavior

- The dock tab and panel heading should read `AI Generative`.
- Board mode remains the primary experience.
- The compact board composer gets an output/model selection that can target:
  - Video models
  - Image models
  - ElevenLabs audio models
- Audio mode changes the prompt textarea into a text-to-speech input.
- Audio mode exposes a custom audio settings button, matching the requested control direction:
  - Model picker
  - Voice picker
  - Speed slider
  - Stability slider
  - Similarity slider
  - Style Exaggeration slider
  - Language Override toggle and optional language field
  - Output Format picker
  - Speaker Boost toggle
  - Reset values action
- Generated audio appears as a FlashBoard node with audio preview controls.
- Generated audio imports into `AI Gen / Audio`.
- Generated audio can be dragged to the timeline or added directly from context menu/inspector.
- Generated audio should behave like normal imported audio after generation.

### Non-Goals

- Do not add a separate AI Audio dock panel for this issue.
- Do not create remote-only timeline clips.
- Do not add custom timeline clip types for ElevenLabs output.
- Do not hardcode ElevenLabs account pricing unless a reliable API/source is added.
- Do not make community voice library browsing the only voice-picking path, because API/tier access can vary.

## Architecture Plan

### 1. Rename The Surface To AI Generative

Keep internal panel type `ai-video` to avoid breaking saved dock layouts.

Change display labels:

- `src/types/dock.ts`
- `src/stores/dockStore.ts`
- `src/components/dock/DockTabPane.tsx` if a render-time fallback is cleaner than title migration
- `src/components/panels/AIVideoPanel.tsx`
- `src/components/panels/media/board/MediaBoardView.tsx`
- `docs/Features/AI-Integration.md`
- `docs/Features/UI-Panels.md` if it references the old label

Use `AI Generative` for visible panel/tab copy.

Saved-layout title migration:

- Keep internal panel type `ai-video`.
- Update `PANEL_CONFIGS['ai-video'].title` and the default dock layout title.
- Normalize existing saved `ai-video` dock panels whose title is still `AI Video` to `AI Generative` in `dockStore` load/normalization.
- Check floating panels and persisted project dock state, not just the built-in default layout.

Do not rename files/classes in the first pass unless it stays small and mechanical. Renaming `AIVideoPanel` and CSS selectors can be a later cleanup because it has a wider churn footprint.

### 2. Add ElevenLabs API Key Support

Files:

- `src/services/apiKeyManager.ts`
- `src/stores/settingsStore.ts`
- `src/components/common/settings/ApiKeysSettings.tsx`

Changes:

- Add `elevenlabs` to `ApiKeyType`.
- Add `elevenlabs: 'elevenlabs-api-key'` to `KEY_IDS`.
- Add `elevenlabs: string` to `APIKeys`.
- Initialize `apiKeys.elevenlabs` to `''`.
- Include it in `apiKeyManager.getAllKeys()`.
- Add a settings group such as `AI Audio Generation`.
- Add an ElevenLabs API key row with local encrypted storage through the existing `setApiKey()` path.
- Add `elevenlabs` to the hardcoded `showKeys` object in `ApiKeysSettings`.
- Add the ElevenLabs row to the hardcoded API key settings UI, not only to store/manager types.
- Keep the key out of localStorage. The existing Zustand `partialize` already omits `apiKeys`; keep that behavior.
- Note that the existing `setApiKey()` path stores keys in encrypted IndexedDB and may update the project `.keys.enc` file when a project is open. The ElevenLabs key should follow that same behavior.

### 3. Create ElevenLabs Service Layer

New file:

- `src/services/elevenLabsService.ts`

Responsibilities:

- `setApiKey(apiKey: string): void`
- `hasApiKey(): boolean`
- `listModels(signal?: AbortSignal): Promise<ElevenLabsModel[]>`
- `listVoices(params, signal?: AbortSignal): Promise<ElevenLabsVoiceSearchResult>`
- `createSpeech(params, signal?: AbortSignal): Promise<ElevenLabsSpeechResult>`
- Normalize fetch/network/provider errors into clean UI messages.
- Log technical details through `Logger.create('ElevenLabs')`.
- Never log raw API keys or text payloads that may be sensitive.

Implementation notes from current official docs, recheck during coding:

- Models endpoint: `GET https://api.elevenlabs.io/v1/models`.
- Model objects include `model_id`, `name`, `can_do_text_to_speech`, `can_use_style`, `can_use_speaker_boost`, and length/rate metadata.
- Voice search/list endpoint: `GET https://api.elevenlabs.io/v2/voices`.
- Shared voice library endpoint: `GET https://api.elevenlabs.io/v1/shared-voices`, but tier restrictions mean it should not be the only picker source.
- Speech endpoint: `POST https://api.elevenlabs.io/v1/text-to-speech/:voice_id`.
- Speech request uses text plus options such as `model_id`, `voice_settings`, optional `language_code`, and query `output_format`.
- Authentication uses the `xi-api-key` header.

Default audio output format for the first implementation:

- `mp3_44100_128`

Offer MP3 output formats in the first implementation:

- `mp3_44100_128`
- `mp3_44100_192`
- `mp3_22050_32`

The file extension/mime should be derived from the selected format:

- MP3: `.mp3`, `audio/mpeg`

Defer PCM and Opus until browser preview, media import, timeline duration probing, and waveform tests prove those formats are reliable in the current import pipeline.

### 4. Generalize FlashBoard Types To Audio

Files:

- `src/stores/flashboardStore/types.ts`
- `src/services/flashboard/types.ts`
- `src/services/project/projectSave.ts`
- `src/services/project/projectLoad.ts`
- `src/hooks/useGlobalHistory.ts`
- `src/stores/historyStore.ts`
- `src/services/project/projectLifecycle.ts`

Add shared type aliases:

```ts
export type FlashBoardService = 'piapi' | 'kieai' | 'cloud' | 'elevenlabs';
export type FlashBoardOutputType = 'video' | 'image' | 'audio';
export type FlashBoardMediaType = 'video' | 'image' | 'audio';
```

Update:

- `FlashBoardComposerState.service`
- `FlashBoardComposerState.outputType`
- `FlashBoardGenerationRequest.service`
- `FlashBoardGenerationRequest.outputType`
- `FlashBoardResult.mediaType`
- `ProjectFlashBoardNode.result`
- `FlashBoardGenerationMetadata`
- `ImportGeneratedMediaInput.mediaType`
- `CatalogEntry.service`
- `CatalogEntry.outputType`

Add audio-specific request metadata:

```ts
voiceId?: string;
voiceName?: string;
languageCode?: string;
outputFormat?: string;
voiceSettings?: {
  speed?: number;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
};
```

Use the existing `version` field as the canonical selected ElevenLabs model id unless the whole FlashBoard request contract is renamed in a broader refactor. Do not introduce a second `modelId` field that can drift from `version`.

Store normalized values in project JSON so regenerated/duplicated nodes preserve settings.

Undo/history coverage:

- Add new composer fields to the manual FlashBoard composer snapshot in `useGlobalHistory.ts`.
- Include voice, model/version, language, output format, and voice settings in history comparison.
- Add the same default composer fields wherever FlashBoard state is reset or synthesized:
  - `src/stores/historyStore.ts`
  - `src/services/project/projectLoad.ts`
  - `src/services/project/projectLifecycle.ts`

### 5. Extend FlashBoard Model Catalog

Files:

- `src/services/flashboard/FlashBoardModelCatalog.ts`
- `src/services/flashboard/types.ts`

Add an ElevenLabs catalog entry, probably one generic provider with dynamic models:

```ts
{
  service: 'elevenlabs',
  providerId: 'elevenlabs-tts',
  name: 'ElevenLabs',
  description: 'Text-to-speech voice generation',
  versions: ['eleven_multilingual_v2'],
  modes: [],
  durations: [],
  aspectRatios: [],
  supportsTextToVideo: false,
  supportsImageToVideo: false,
  supportsTextToImage: false,
  supportsTextToAudio: true,
  outputType: 'audio',
}
```

Then allow the composer to load real ElevenLabs model options from `elevenLabsService.listModels()`.

Reasoning:

- FlashBoard catalog is currently static.
- ElevenLabs model availability and capabilities can change.
- A static default keeps the composer usable, while dynamic metadata makes the picker accurate.

### 6. Update AI Generative Access Gate

File:

- `src/components/panels/AIVideoPanel.tsx`

Current board access depends on Kie.ai key or hosted cloud auth. That would block ElevenLabs-only usage.

Change `hasGenerationAccess` to:

```ts
Boolean(apiKeys.kieai || apiKeys.elevenlabs || hasHostedCloudAccess)
```

Change overlay copy so it does not imply only video/cloud access.

Board service scoping currently passes only `serviceScope={boardService}`. This hides everything outside Kie.ai/cloud. Removing that prop alone is not enough because the composer model popover also hardcodes Kie.ai/cloud groups.

Preferred first pass:

- Replace `serviceScope` with `allowedServices`.
- Let the model popover derive groups from `visibleCatalog` instead of the current hardcoded `['kieai', 'cloud']` list.
- Include `elevenlabs` in the allowed services for board mode.
- Define ElevenLabs-only startup behavior: if the user has an ElevenLabs key but no Kie/cloud access, initialize the composer on the ElevenLabs audio catalog entry.
- Keep Classic mode scoped to current Kie/cloud video behavior.

Classic/board control split:

- The provider dropdown, account balance bar, and top classic Generate button in `AIVideoPanel` are not board-aware today.
- Hide or restate those controls while `workspaceMode === 'board'`, or replace them with a board-aware AI Generative header that can represent Kie.ai, Cloud, and ElevenLabs.
- For ElevenLabs-only access, do not call Kie/cloud account balance or show classic video generation controls as if they were usable.

### 7. Composer UI Design

File:

- `src/components/panels/flashboard/FlashBoardComposer.tsx`
- `src/components/panels/flashboard/FlashBoard.css`

Current composer controls:

- Model button
- Aspect ratio
- Duration
- Image size
- Mode
- Sound
- Multi-shot
- Generate button

Add:

- Output/model distinction in the model popover:
  - Video group
  - Image group
  - Audio group
- Audio settings pill/button.
- Voice picker pill/button.

Audio mode behavior:

- Hide aspect ratio.
- Hide duration.
- Hide video/image mode.
- Hide sound toggle.
- Hide multi-shot.
- Hide image reference badges and reference hints unless we later support audio-driven references.
- Prompt placeholder: `Text to speak...`
- Generate disabled when:
  - text is empty
  - no ElevenLabs key
  - no voice selected
  - no model selected
  - request exceeds selected model character limit if known

Voice picker:

- Search input.
- Recently used voices first if available in local settings.
- Show name, category/labels, preview button when `preview_url` exists.
- Refresh button.
- Empty state with "Configure ElevenLabs key" or "No voices found".

Audio settings popover:

- Should be wider than the normal pill popovers, closer to the screenshot.
- Use compact sliders with labels and endpoints.
- Defaults:
  - Speed: `1`
  - Stability: `0.5`
  - Similarity: `0.75`
  - Style Exaggeration: `0`
  - Speaker Boost: `true`
  - Output Format: `mp3_44100_128`
- Reset restores those defaults.

Suggested component split to keep `FlashBoardComposer.tsx` manageable:

- `src/components/panels/flashboard/ElevenLabsVoicePicker.tsx`
- `src/components/panels/flashboard/ElevenLabsAudioSettingsPopover.tsx`
- `src/components/panels/flashboard/elevenLabsComposerDefaults.ts`

Layout requirement:

- Do not put the voice picker/settings UI inside the existing narrow 300px popover.
- Use a wider anchored panel or side panel with constrained max height and internal scrolling.
- Define narrow dock behavior so sliders, voice search, preview buttons, and output format controls cannot overflow the composer bubble.

### 8. Job Service Changes

File:

- `src/services/flashboard/FlashBoardJobService.ts`

Add ElevenLabs branch near the start of `startJob()`:

```ts
if (request.outputType === 'audio' || request.service === 'elevenlabs') {
  // validate key, voiceId, version/model, prompt
  // create speech through elevenLabsService
  // return a File through the update callback
}
```

Update job callback type:

```ts
type JobUpdateCallback = (nodeId: string, update: {
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';
  remoteTaskId?: string;
  progress?: number;
  error?: string;
  assetUrl?: string;
  assetFile?: File;
  mediaType?: 'video' | 'image' | 'audio';
}) => void;
```

ElevenLabs does not need remote polling for basic text-to-speech. Treat it as:

- `queued`
- `processing`
- direct `completed` with `assetFile`

Cancellation:

- Pass `AbortSignal` to fetch.
- If aborted, set canceled or return silently according to current cancel behavior.

Concurrency:

- Add `maxConcurrentElevenLabs = 2` or `1`.
- Update `canStartJob()` so Kie.ai and ElevenLabs can have separate limits.

Workspace handoff:

- Update `FlashBoardWorkspace` so completed jobs can provide either `assetUrl` or `assetFile`.
- For `{ assetFile, mediaType: 'audio' }`, call `flashBoardMediaBridge.importGeneratedFile(...)`.
- Keep the existing failure path only when neither `assetUrl` nor `assetFile` is present.

### 9. Media Bridge Changes

File:

- `src/services/flashboard/FlashBoardMediaBridge.ts`

Add:

- `getOrCreateAudioSubfolder(): string`
- `importGeneratedFile(nodeId, file, mediaType)`
- Or extend `importGeneratedMedia()` to accept URL or `File`.

Current URL import path downloads remote media. ElevenLabs should skip download and import the generated `File` directly:

```ts
await useMediaStore.getState().importFile(file, folderId, {
  forceCopyToProject: true,
});
```

Folder routing:

- Video -> `AI Gen / Video`
- Image -> `AI Gen / Images`
- Audio -> `AI Gen / Audio`

Filename pattern:

- `ai_voice_${voiceSlug}_${promptSlug}_${timestamp}.mp3`

Metadata:

- Store provider, version/model, prompt, voice id/name, voice settings, output format.

Timeline insertion:

- The existing `addToTimeline()` already detects audio by MIME/extension and chooses an audio track.
- Keep that path and add tests.

Drag-to-timeline:

- `FlashBoardNode` currently sets basic dataTransfer directly.
- Require `FlashBoardNode` to call `flashBoardMediaBridge.startDragToTimeline()` and `endDrag()` for all completed/reference media nodes.
- This is mandatory for generated audio because the bridge sets `application/x-media-is-audio` and the external drag payload used by timeline drop handling.

Generated media metadata:

- Add `service`, `outputType`, `mediaType`, voice id/name, language, output format, and voice settings to metadata produced by both URL import and direct file import paths.

### 10. Node Rendering

Files:

- `src/components/panels/flashboard/FlashBoardNode.tsx`
- `src/components/panels/flashboard/nodeSizing.ts`
- `src/components/panels/flashboard/FlashBoard.css`

Add audio-specific rendering:

- Audio node class, for example `has-audio-preview`.
- Voice/model title and compact prompt snippet.
- Native `<audio controls>` or custom play/seek row matching existing video controls.
- Duration label when metadata is known.
- Detail pills:
  - `Audio`
  - voice name
  - model name/id
  - output format
  - character count maybe

Sizing:

- Audio nodes should not default to 16:9.
- Use a default audio aspect such as `2.8 / 1` or fixed compact height.
- `resolveFlashBoardNodeAspectRatio()` can return audio-specific default when `node.result?.mediaType === 'audio'` or `node.request?.outputType === 'audio'`.

Reference/drop behavior:

- Audio media dropped onto the board should create an audio reference/media node, not a video node.
- `createReferenceNode()` must resolve `mediaFile.type === 'audio'` as `mediaType: 'audio'`.
- `FlashBoardCanvas.tsx` is the board drop entry point; update it alongside `src/stores/flashboardStore/slices/nodeSlice.ts`.
- Audio reference nodes are draggable/addable to timeline, but cannot be assigned as image/video reference frames in this issue.

### 11. Context Menu And Inspector

Files:

- `src/components/panels/flashboard/FlashBoardContextMenu.tsx`
- `src/components/panels/flashboard/FlashBoardInspector.tsx`

Context menu:

- Audio nodes should show `Add to Timeline`.
- Audio nodes should not show image/video reference assignment actions.
- Resolve the underlying `MediaFile.type` before showing `Set As Start Frame`, `Set As End Frame`, or `Add As Reference Frame`.
- Failed audio generation should support `Retry`.
- Draft audio generation should support `Edit`.

Inspector:

- Show audio request details:
  - Provider
  - Voice
  - Model
  - Output format
  - Voice settings
  - Prompt/text
- Wire the existing `Add to Timeline` button. It currently renders but has no click handler.

### 12. Project Save And Load

Files:

- `src/services/project/projectSave.ts`
- `src/services/project/projectLoad.ts`
- `src/stores/historyStore.ts`

Persist audio fields in:

- `FlashBoardGenerationRequest`
- `FlashBoardResult`
- `FlashBoardGenerationMetadata`

Manual metadata serialization paths:

- `projectSave.ts` manually rebuilds `generationMetadataByMediaId`; add all audio fields there.
- `FlashBoardMediaBridge` manually creates metadata after import; add all audio fields there too.
- Do not rely only on widening TypeScript interfaces, because metadata is not copied wholesale everywhere.

Load behavior:

- Interrupted audio jobs should load as failed with "Job interrupted by reload", same as existing queued/processing jobs.
- Completed audio nodes should resolve their media file through normal media project persistence.

Compatibility:

- Old projects with `video | image` continue to load because `audio` is only additive.
- Add a loader/UI fallback normalizer for unknown output/media types so old or future project data cannot crash FlashBoard rendering.

### 13. Pricing

Files:

- `src/services/flashboard/FlashBoardPricing.ts`
- `src/components/panels/flashboard/FlashBoardComposer.tsx`
- `src/components/panels/flashboard/FlashBoardNode.tsx`
- `src/components/panels/flashboard/FlashBoardInspector.tsx`

Current risk:

- `getFlashBoardPriceEstimate()` handles `cloud`, then `piapi`, then falls through to Kie pricing for everything else.
- Adding `service: 'elevenlabs'` without a pricing branch would show incorrect Kie credits.

Plan:

- Add an explicit branch for `input.service === 'elevenlabs'` or `input.outputType === 'audio'`.
- Return `null` until real ElevenLabs pricing/account metadata is implemented.
- Ensure composer/node/inspector tolerate `null` price estimates without layout shifts.

### 14. Tests

Add focused tests instead of relying only on full-suite smoke.

Suggested test files:

- `tests/unit/elevenLabsService.test.ts`
- `tests/unit/flashboardAudioCatalog.test.ts`
- `tests/unit/flashboardAudioJobService.test.ts`
- `tests/unit/flashboardMediaBridgeAudio.test.ts`
- `tests/unit/flashboardWorkspaceAudioCompletion.test.tsx`
- `tests/unit/flashboardSelectors.test.ts` extensions if reference selectors need audio exclusions
- `tests/unit/apiKeyManager.test.ts` or a focused settings/key wiring test if existing harness allows IndexedDB mocks

Test cases:

- API key type includes `elevenlabs`.
- Settings UI calls `setApiKey('elevenlabs', value)`.
- ElevenLabs service builds model/voice requests with `xi-api-key`.
- ElevenLabs service filters text-to-speech capable models.
- Missing API key creates a clean error.
- Missing voice creates a clean error.
- Failed provider response normalizes message.
- Audio job returns a `File` with expected name/type.
- Workspace completion with `{ assetFile, mediaType: 'audio' }` imports the file and completes the node.
- Workspace completion without `assetUrl` or `assetFile` fails cleanly.
- Media bridge imports audio into `AI Gen / Audio`.
- Audio node result can be added to an audio track.
- Audio node drag uses the bridge drag payload and drops as audio.
- Audio nodes are not offered as image/video reference frames.
- Pricing returns `null` for ElevenLabs/audio until a real estimator exists.
- `useGlobalHistory` captures and restores audio composer setting changes.

Manual smoke:

- Add ElevenLabs key, reload, verify key presence without localStorage plaintext.
- Open AI Generative board.
- Pick Audio/ElevenLabs.
- Search/select voice.
- Adjust settings.
- Generate short speech.
- Preview audio in node.
- Add audio to timeline.
- Save/reload project.
- Confirm audio node and timeline clip still work.
- Export a short timeline with generated voice.

### 15. Documentation Updates

Update after implementation:

- `docs/Features/AI-Integration.md`
- `docs/Features/Audio.md` if audio workflow behavior changes
- `docs/Features/FlashBoard.md`
- `docs/Features/UI-Panels.md`
- `docs/Features/README.md` if the feature index names AI Generative

Document:

- AI Generative panel replaces AI Video naming.
- Video/image/audio generation live in FlashBoard board view.
- ElevenLabs key storage path.
- Voice generation output is imported as durable audio media.
- FlashBoard imports generated media under `AI Gen / Video`, `AI Gen / Images`, and `AI Gen / Audio`.

## Parallel Agent Execution Plan

Use parallel agents only after a short shared-contract pass lands. The biggest merge risk is not code volume; it is multiple agents independently widening FlashBoard request/result types, composer defaults, and dock naming. Keep those contracts centralized first, then fan out.

### Coordination Rules

- Use separate worktrees or short-lived branches per agent, all based on `issue-160-implement-elevenlabs`.
- One integration lead owns final merge order, conflict resolution, and the final full `npm run build`, `npm run lint`, `npm run test`.
- Each agent must read this plan, `AGENTS.md`, and the files in its ownership list before editing.
- Agents should not rename `AIVideoPanel` files/classes unless their assignment explicitly says so.
- Agents should not touch files outside their ownership list without reporting why in their handoff.
- Agents should run focused tests for their slice and report commands plus failures. Full-suite checks are the integration lead's job before commit.
- Any API-surface uncertainty for ElevenLabs must be verified against official ElevenLabs docs during implementation, then captured in the service tests.

### Wave 0: Contract Lead

Run this first and merge it before the parallel wave.

Ownership:

- `src/stores/flashboardStore/types.ts`
- `src/services/flashboard/types.ts`
- `src/services/flashboard/FlashBoardModelCatalog.ts`
- `src/services/flashboard/FlashBoardPricing.ts`
- FlashBoard default composer-state reset locations in `historyStore`, `projectLoad`, and `projectLifecycle`

Scope:

- Add shared `FlashBoardService`, `FlashBoardOutputType`, and `FlashBoardMediaType` aliases.
- Add ElevenLabs/audio fields to request/result/metadata types.
- Add the static ElevenLabs catalog entry.
- Add explicit `elevenlabs`/`audio` no-price branch.
- Add default audio composer fields everywhere FlashBoard state is synthesized or reset.
- Add focused catalog/pricing/type-adjacent tests.

Done when:

- TypeScript can represent an audio FlashBoard request/result without downstream casts.
- Non-audio behavior remains unchanged.
- Pricing returns `null` for ElevenLabs/audio.

### Wave 1: Parallel Implementation Agents

These agents can run after Wave 0 is merged.

#### Agent A: Surface Naming And Access Gate

Ownership:

- `src/types/dock.ts`
- `src/stores/dockStore.ts`
- `src/components/dock/DockTabPane.tsx` only if needed for render-time fallback
- `src/components/panels/AIVideoPanel.tsx`
- `src/components/panels/media/board/MediaBoardView.tsx`
- relevant dock/settings tests

Scope:

- Rename visible `AI Video` labels to `AI Generative` while keeping panel type `ai-video`.
- Migrate persisted `ai-video` panel titles from `AI Video` to `AI Generative`.
- Add ElevenLabs to the generation access gate.
- Make Board mode coherent by hiding or replacing Classic-only provider, balance, and Generate controls.
- Define ElevenLabs-only board startup behavior.

Conflict boundaries:

- Do not implement composer audio controls.
- Do not change FlashBoard job/media import logic.

#### Agent B: API Key And ElevenLabs Service

Ownership:

- `src/services/apiKeyManager.ts`
- `src/stores/settingsStore.ts`
- `src/components/common/settings/ApiKeysSettings.tsx`
- `src/services/elevenLabsService.ts`
- `tests/unit/elevenLabsService.test.ts`
- focused API key/settings tests

Scope:

- Add ElevenLabs API key wiring through existing encrypted key storage.
- Implement typed model, voice, and create-speech service calls.
- Normalize provider/network errors.
- Ensure raw API keys and text payloads are not logged.
- Limit first implementation to MP3 output formats.

Conflict boundaries:

- Do not wire FlashBoard composer UI beyond exported service APIs.
- Do not change job queue behavior.

#### Agent C: Composer Audio UX

Ownership:

- `src/components/panels/flashboard/FlashBoardComposer.tsx`
- `src/components/panels/flashboard/ElevenLabsVoicePicker.tsx`
- `src/components/panels/flashboard/ElevenLabsAudioSettingsPopover.tsx`
- `src/components/panels/flashboard/elevenLabsComposerDefaults.ts`
- `src/components/panels/flashboard/FlashBoard.css`
- composer-focused tests

Scope:

- Add audio mode/model selection in the board composer.
- Add voice picker and audio settings UI.
- Hide video/image-only controls in audio mode.
- Validate missing key, missing voice, missing model, empty text, and known character limits.
- Persist normalized voice/settings fields into the FlashBoard request.

Conflict boundaries:

- Do not implement ElevenLabs fetch logic beyond calling `elevenLabsService`.
- Do not implement job completion/import behavior.

#### Agent D: Job, Workspace Handoff, And Media Bridge

Ownership:

- `src/services/flashboard/FlashBoardJobService.ts`
- `src/components/panels/flashboard/FlashBoardWorkspace.tsx`
- `src/services/flashboard/FlashBoardMediaBridge.ts`
- job/workspace/media bridge tests

Scope:

- Add ElevenLabs audio job branch with cancellation and concurrency limits.
- Extend job completion to support `assetFile`.
- Route direct audio `File` completions through the media bridge.
- Add `AI Gen / Audio` folder creation and direct generated-file import.
- Store generated audio metadata.

Conflict boundaries:

- Do not build composer UI.
- Do not edit node rendering except if a test requires a narrow type fix.

#### Agent E: Audio Nodes, Drag, Context Menu, Inspector, Drops

Ownership:

- `src/components/panels/flashboard/FlashBoardNode.tsx`
- `src/components/panels/flashboard/nodeSizing.ts`
- `src/components/panels/flashboard/FlashBoardContextMenu.tsx`
- `src/components/panels/flashboard/FlashBoardInspector.tsx`
- `src/components/panels/flashboard/FlashBoardCanvas.tsx`
- `src/stores/flashboardStore/slices/nodeSlice.ts`
- `src/components/panels/flashboard/FlashBoard.css`
- node/context/drop tests

Scope:

- Render audio nodes with preview controls and audio-specific sizing.
- Use `flashBoardMediaBridge.startDragToTimeline()` / `endDrag()` for completed/reference media nodes.
- Make audio nodes addable to timeline but ineligible as image/video references.
- Fix inspector `Add to Timeline` click handler.
- Ensure board-dropped audio creates `mediaType: 'audio'`.

Conflict boundaries:

- Coordinate CSS edits with Agent C if both touch `FlashBoard.css`.
- Do not edit job service or composer service calls.

#### Agent F: Persistence, History, Documentation, And Smoke Checklist

Ownership:

- `src/services/project/projectSave.ts`
- `src/services/project/projectLoad.ts`
- `src/stores/historyStore.ts`
- `src/hooks/useGlobalHistory.ts`
- `docs/Features/AI-Integration.md`
- `docs/Features/Audio.md`
- `docs/Features/FlashBoard.md`
- `docs/Features/UI-Panels.md`
- `docs/Features/README.md`
- persistence/history/docs tests

Scope:

- Persist all audio request/result/metadata fields in manual serialization paths.
- Normalize unknown output/media types during load/UI fallback.
- Ensure history captures audio composer setting changes.
- Update feature docs after implementation details are stable.
- Maintain the manual smoke checklist.

Conflict boundaries:

- Do not change API/service implementation.
- Do not change composer UI beyond default-state/history field alignment.

### Integration Lead Merge Order

1. Merge Wave 0 contract changes.
2. Merge Agent B service/key changes.
3. Merge Agent D job/media bridge changes.
4. Merge Agent C composer UI changes.
5. Merge Agent E node/drag/drop changes.
6. Merge Agent A naming/access changes.
7. Merge Agent F persistence/history/docs changes.
8. Resolve any CSS overlap in `FlashBoard.css`.
9. Run targeted tests for affected slices.
10. Run final required checks: `npm run build`, `npm run lint`, `npm run test`.

### Agent Prompt Template

Use this template for each parallel agent:

```text
You are Agent <name> working in C:\Users\admin\Documents\masterselects-elevenlabs on branch issue-160-implement-elevenlabs.
Read AGENTS.md and docs/plans/elevenlabs-integration-plan.md first.
Implement only the <agent name> scope from the Parallel Agent Execution Plan.
Do not rename AIVideoPanel files/classes.
Do not touch files outside your ownership list unless necessary; if necessary, explain why.
Run focused tests for your slice and report commands/results.
Return a concise handoff: changed files, behavior implemented, tests run, known risks.
```

## Implementation Order

1. Rename visible AI Video labels to AI Generative while keeping internal panel id stable.
2. Add saved-layout title migration so old `ai-video` panels display as AI Generative.
3. Split or restate Classic-only provider/balance/generate controls so Board mode and ElevenLabs-only access are coherent.
4. Add ElevenLabs API key plumbing.
5. Add `elevenLabsService` with tests for models, voices, speech, and errors.
6. Generalize FlashBoard service/output/media types to include audio.
7. Add ElevenLabs catalog entry and replace `serviceScope` with derived service groups or `allowedServices`.
8. Add composer audio mode, voice picker, and audio settings popover.
9. Add audio job branch in `FlashBoardJobService`.
10. Update `FlashBoardWorkspace` to route `assetFile` completions to the media bridge.
11. Add audio import folder and direct `File` import in `FlashBoardMediaBridge`.
12. Add explicit ElevenLabs/audio no-price branch.
13. Add audio node rendering and sizing.
14. Fix context menu/inspector behavior for audio nodes.
15. Update board drop/reference behavior for audio media.
16. Update project save/load metadata coverage.
17. Update `useGlobalHistory` and FlashBoard default composer snapshots.
18. Add focused tests.
19. Update docs.
20. Run required pre-commit checks:
    - `npm run build`
    - `npm run lint`
    - `npm run test`

## Acceptance Criteria

- [ ] The visible dock/panel name is `AI Generative`.
- [ ] ElevenLabs API key is configurable through encrypted local key storage.
- [ ] Board composer can select an audio/ElevenLabs generation mode.
- [ ] User can choose a voice.
- [ ] User can choose an ElevenLabs text-to-speech model.
- [ ] User can adjust speed, stability, similarity, style exaggeration, language override, output format, and speaker boost.
- [ ] Generated speech becomes a normal imported audio media file under `AI Gen / Audio`.
- [ ] Audio FlashBoard nodes can preview playback.
- [ ] Audio FlashBoard nodes can be dragged or added to the timeline.
- [ ] Saved projects reload completed audio nodes and generated audio media.
- [ ] Missing key, missing voice, invalid request, network failure, quota/rate-limit, and cancellation states are handled cleanly.
- [ ] Focused tests cover service, key wiring, board job, media import, and timeline insertion behavior.
- [ ] Feature docs are updated.
- [ ] `npm run build`, `npm run lint`, and `npm run test` pass before merge.

## Open Questions

- Should generated audio auto-add to the timeline by default, or stay media-only unless explicitly added?
- Should the first version expose only the user's own voices, or also shared/community voices when the account tier allows it?
- Should voice/model/settings defaults be global preferences, project-level state, or only composer-local state?
- Should ElevenLabs generations be available in Classic mode, or should Classic remain video-only until a separate cleanup?

## External References

- ElevenLabs Create Speech API: https://elevenlabs.io/docs/api-reference/text-to-speech
- ElevenLabs List Models API: https://elevenlabs.io/docs/api-reference/get-models
- ElevenLabs Voice Search/List API: https://elevenlabs.io/docs/api-reference/voices/get-all
- ElevenLabs Shared Voices API: https://elevenlabs.io/docs/api-reference/voices
- ElevenLabs Text to Speech guide: https://elevenlabs.io/docs/capabilities/text-to-speech
