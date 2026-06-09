# Documentation / Codebase Audit Summary

Date: 2026-05-30

## Scope

Six parallel agents compared `README.md` and `docs/Features/` against the current MasterSelects codebase. Each agent wrote a separate findings report in this directory. This summary consolidates the highest-impact documentation updates and the order in which they should be handled.

## Implementation Status

Follow-up implementation on 2026-05-30 addressed the public/documentation items from this audit:

- README now uses 86 exported model tools, current audio/stem/send caveats, opt-in Native Helper decode wording, Signal IR, and the refreshed project structure.
- `index.html` now advertises the current 86-tool model catalog, 33 GPU effects, audio/3D/Signal capabilities, and no longer exposes the stale 41-tool catalog.
- `searchVideos` now dispatches through the same YouTube handler as `searchYouTube`.
- AI docs and `docs/Features/README.md` now reflect 2.0.6, 86 tools, 16 groups, and the current dispatcher state.
- Security docs, hosted-AI setup docs, and the legal privacy dialog now disclose hosted AI chat logging into D1.
- Hosted-AI setup docs now clarify that `kling_generation` is currently entitlement metadata, while `/api/ai/video` is gated by sign-in and credit balance.
- The obsolete standalone `AIVideoPanel` source/CSS were removed; FlashBoard is now documented and implemented as the Media Panel generation tray, with only legacy dock type migration left.
- Export, Preview, Download, Proxy, Audio, FlashBoard, and Project Persistence docs were updated for the current behavior described below.

The individual agent reports are left as the original audit evidence; use this summary section to distinguish implemented follow-up from the initial findings.

## Reports

- `01-readme-top-level.md` - README metrics, package/build metadata, project structure, public metadata.
- `02-media-import-storage-native.md` - media import, storage, Native Helper, downloads, proxies.
- `03-timeline-render-export.md` - timeline, preview, render, export, effects, scopes.
- `04-audio-workstation-stems.md` - audio workstation, audio FX, recording, stems, export audio.
- `05-3d-vector-signal-flashboard.md` - 3D, gaussian splats, vector animation, Signal IR, FlashBoard.
- `06-ai-security-cloud-billing.md` - AI tools, cloud generation, auth/billing/credits, security/privacy.

## Cross-Cutting Findings

### Tool Counts Need Reconciliation

There are three competing tool-count stories:

- `src/services/aiTools/definitions/` contains 92 `name:` entries across all definition files.
- `AI_TOOLS` currently imports 86 of them; `definitions/gaussian.ts` is present but not imported into `AI_TOOLS`.
- `index.html` still advertises an older 41-tool catalog.

Documentation should avoid a hard "90+" claim unless it clearly distinguishes "definition files" from "exported model tools." The safest public wording is "the shared AI tool catalog" or "80+ exported tools" until the Gaussian definitions are either exported or documented as bridge/debug-only.

### README Metrics Are Mostly Correct After The Recent Update

The new README metrics are supported by local evidence:

- version `2.0.6`
- 19 direct runtime dependencies
- 33 GPU effects
- 37 blend modes
- 23 registry-backed Audio FX
- about 2 MB compressed editor startup path
- about 330k TS/TSX app lines under `src`
- about 4.1k WGSL shader-file lines

Remaining README risk is not the metrics, but over-specific capability wording around AI tool count, Native Helper decode fallback, stems, track sends/buses, and single-submit rendering.

### Public Metadata Is Stale

`index.html` and built `dist/index.html` still contain crawler/AI-readable metadata for an older app state:

- 41 AI tools
- older tool catalog
- 30+ GPU effects
- `searchVideos` shown as callable despite a dispatcher mismatch

This should be updated or generated from source so it does not drift again.

### Feature Docs Drift Is Concentrated

The biggest stale areas are:

- `docs/Features/AI-Integration.md`
- `docs/Features/FlashBoard.md`
- `docs/Features/Download-Panel.md`
- `docs/Features/Proxy-System.md`
- `docs/Features/Export.md`
- `docs/Features/Preview.md`
- `docs/Features/Audio.md`
- `docs/Features/README.md`

Several docs are currently reliable enough and need little or no immediate work: `3D-Layers.md`, `Vector-Animation.md`, `Text-Clips.md`, `Signal-IR.md`, `Node-Workspace.md`, and most of `Audio-Workstation.md`.

## Priority Fixes

### Priority 0 - Publicly Misleading Or Security-Relevant

1. Update `index.html` AI-readable catalog.
   - Replace 41-tool claims.
   - Remove or fix stale `searchVideos` callability.
   - Update 30+ GPU effects to 33.
   - Prefer generated/static summarized catalog over a long stale embedded list.

2. Update AI tool-count wording in README and AI docs.
   - Use 86 exported model tools today, or avoid hard counts.
   - Explain Gaussian definitions are present but not imported into `AI_TOOLS` if kept that way.
   - Update `docs/Features/AI-Integration.md` from 79/15 groups to current exported state.

3. Add hosted AI chat logging disclosure.
   - `functions/lib/chatLog.ts` stores prompts/messages, responses, tool calls, token/cost/duration/status/error data in D1.
   - `docs/Features/Security.md` and the legal/privacy UI copy should clearly disclose this.

4. Correct Native Helper decode fallback claims.
   - README currently should not imply unsupported codecs automatically fall back to native decode.
   - Native decode is opt-in/disabled by default and requires helper connection plus a resolvable path.
   - `docs/Features/Native-Helper.md` is more accurate than README here.

### Priority 1 - User-Facing Feature Accuracy

5. Correct Export docs.
   - `docs/Features/Export.md` still claims fast export can auto-fallback/retry into HTMLVideo Precise.
   - Current code is strict: users must select HTMLVideo Precise explicitly.

6. Update Preview/Source Monitor docs.
   - Source Monitor supports audio playback, waveform display/scrubbing, In/Out, and placement commands.
   - Current docs understate this as video/image oriented.

7. Update Download and Proxy docs.
   - FSA projects and Native projects store completed downloads differently.
   - Current proxy frames are `.jpg`, audio proxies are `.wav`.
   - Native video proxy frame storage is not wired through the same path.

8. Update FlashBoard docs.
   - Current visible UI is the Media Panel generator tray/composer/queue, not the old standalone canvas/workspace.
   - FlashBoard supports audio generation through ElevenLabs/Suno, not only video/image.
   - Replace stale source map entries for removed files.

9. Update Audio docs.
   - `docs/Features/Audio.md` says spectral brush editing and full phase/image resynthesis are still in progress, but code/tests show they are implemented.
   - README should qualify stem WAV publishing: it publishes WAV media when the project/media write path succeeds; artifact-backed stems remain possible.
   - Wording should distinguish track sends rendered as master returns from full dedicated return-bus FX chains.

### Priority 2 - Architecture / Maintenance Accuracy

10. Refresh README project structure.
    - Add current directories: `src/artifacts`, `src/extensions`, `src/importers`, `src/runtime`, `src/signals`, `src/marketing`, `src/routing`, `src/styles`, `src/shims`.
    - Add current engine areas: `src/engine/scene`, `src/engine/native3d`, `src/engine/gaussian`.
    - Add `tools/visitor-tray`.

11. Surface Signal IR in README.
    - Unknown files can become binary SignalAssets.
    - CSV imports into table/metadata/binary signals.
    - Model/splat artifacts can materialize into real timeline media; other signals currently fall back to text-summary clips.

12. Update `docs/Features/README.md`.
    - It still names app version `1.7.2`.
    - It still says `openComposition` and `searchVideos` are both AI dispatch gaps; only `searchVideos` remains a current gap according to the audit.

13. Qualify single-submit render wording.
    - README's nested composition paragraph should describe the normal 2D/nested compositor path, not all 3D/gaussian auxiliary submits.

## Suggested Update Order

1. Public metadata and AI tool counts: `index.html`, `README.md`, `docs/Features/AI-Integration.md`, `docs/Features/README.md`.
2. Security/privacy: `docs/Features/Security.md`, legal/privacy UI copy for hosted AI chat logs.
3. Native/import/download/proxy: `README.md`, `Project-Persistence.md`, `Download-Panel.md`, `Proxy-System.md`, `UI-Panels.md`.
4. Export/preview/timeline: `Export.md`, `Preview.md`, `UI-Panels.md`, `Timeline.md`, small README render wording adjustment.
5. Audio: `Audio.md`, README stem/send wording, optional `Audio-Workstation.md` caveat.
6. FlashBoard/Signal/project structure: `FlashBoard.md`, README feature row and architecture tree, optional `Signal-IR.md` cross-links.

## Open Decisions

- Should Gaussian AI tool definitions be imported into `AI_TOOLS`, or kept as handler/debug-only definitions? This determines whether the public tool count should be 86 or 92.
- Should `searchVideos` be fixed to dispatch, or should docs/index metadata remove it until the handler key is corrected?
- Is `kling_generation` meant to be a real server-side entitlement? Current `/api/ai/video` checks sign-in and credits, while entitlement definitions suggest plan-specific generation gates.
- Should Native Helper video proxy frame storage be implemented, or should docs mark video proxy frame storage as FSA-only for now?
- Should README advertise universal Signal IR now, or keep it as a feature-doc-only architecture until the import UI exposes all file types uniformly?

## Verification Notes

- `git diff --check -- README.md` was clean before this summary was added.
- A local parser confirmed `AI_TOOLS` imports 86 tool definitions and leaves `definitions/gaussian.ts` unimported.
- The audit reports are read-only findings except for this summary and the existing README changes already present in the worktree.
