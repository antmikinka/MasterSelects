# Complete Refactor Checklist

Status: execution plan
Updated: 2026-06-09

This checklist tracks the actual codebase refactor plan in
`docs/ongoing/Complete-refactor.md`.

Handoff files are prepared as execution templates. Use them when the master
orchestrator or worker-agent execution run starts.

## Progress Snapshot

- Complete Refactor execution plan: active
- Baseline: partially captured from read-only scans
- Working docs: keep to plan + checklist unless data becomes too large
- Handoff templates: prepared for execution only
- Source implementation: pending bounded packets with explicit write sets,
  forbidden files, and gates

## How To Read Gates

Each phase gate is reviewable only when it has:

- [ ] gate id
- [ ] subchecks
- [ ] allowed write set
- [ ] forbidden files
- [ ] do-not rules
- [ ] focused checks or smoke commands
- [ ] exit criteria

A checked phase definition means the plan names the target. It does not mean
source implementation is complete. A gate is implementation-ready only when all
items above are explicit.

## Timeline Reuse Decision

- [x] Treat the completed timeline refactor as the method template.
- [x] Reuse the shapes for gate registry, lane write manifest, high-conflict
      ownership, retired-path ledger, adapter-debt ledger, test-migration
      ledger, exit-criteria coverage, and architecture-registry tests.
- [x] Protect timeline source from broad re-refactor work.
- [ ] Define the future whole-codebase registry from the timeline method without
      copying timeline-specific ids.
- [ ] Define explicit integration packets before touching timeline source for
      project hydration, runtime leases, signals, or render/export snapshots.

## Plan Document

- [x] Define success criteria for maintainability, performance, and no god
      objects.
- [x] Define role-based LOC budgets with 700 LOC as product-source ceiling.
- [x] Define valid versus invalid splits.
- [x] Define master orchestrator execution model.
- [x] Define worker-agent packet format.
- [x] Define parallel-agent use for planning, implementation, verification, and
      cleanup waves.
- [x] Add actual codebase refactor phases based on current source scans.
- [x] Keep planning artifacts minimal: plan + checklist only for now.
- [x] Prepare current handoff and handoff-history templates for execution.
- [x] Run 2 Codex and 2 Claude read-only plan-vs-codebase reviews.
- [x] Add agent review corrections to the actual plan.
- [x] Tighten phase gates into reviewable gate/subcheck blocks.
- [x] Add phase-level allowed write sets, forbidden files, and do-not rules.
- [x] Add max-6 parallel execution wave plan with sequenced shared hubs.
- [x] Add progress/commit/check cadence: coherent checkpoint commits, focused
      packet checks, full build/lint/test only when AGENTS.md requires it.
- [ ] Convert gate/subcheck blocks into exact test/static-check names.
- [ ] Add packet-level high-conflict write sets.
- [ ] Add first implementation packets after skeptical review.

## Progress And Check Cadence

- [x] Preserve progress in coherent packets, not random file-edit commits.
- [x] Prefer focused gates, targeted tests, static scans, and smokes during
      implementation.
- [x] Do not run full `npm run build`, `npm run lint`, and `npm run test` after
      every small edit.
- [x] Run the full chain for normal commit, push, release, merge, or explicit
      final readiness as required by `AGENTS.md`.
- [x] Use `fast commit`/`fast push` rules only when the user explicitly requests
      that command mode.
- [ ] Add packet-level checkpoint policy to the first implementation packet.

## Reviewable Gate Matrix

This matrix is the user-visible "what not to do yet" control surface. Source
implementation must not start for a phase until its relevant gate block is
complete enough for the packet.

### P0 - Baseline And Guard Rails

Allowed write set:

- `docs/ongoing/**`
- future architecture-registry preflight only after approval
- read-only scan outputs if the orchestrator creates them

Forbidden files:

- `src/components/**`
- `src/stores/**`
- `src/engine/**`
- `src/services/**` except read-only scans
- `src/timeline/architecture/**` unless explicitly reviewing the method

Gates and subchecks:

- [ ] `P0_BASELINE_CAPTURED`
  - [ ] LOC/domain/file-size commands recorded
  - [ ] fan-in/fan-out commands recorded
  - [ ] `getState()` scan recorded
  - [ ] runtime-handle scan recorded
  - [ ] CSS/global selector scan recorded
  - [ ] smoke inventory recorded
- [ ] `P0_BASELINE_REFRESHED`
  - [ ] all gate numbers regenerated from current HEAD/worktree
  - [ ] stale planning numbers are not enforced
- [ ] `P0_COMPLETE_ARCHITECTURE_REGISTRY`
  - [ ] lane ids listed
  - [ ] gate ids listed
  - [ ] write sets listed
  - [ ] forbidden sets listed
  - [ ] exit criteria listed
  - [ ] retired-path and test-migration ledgers planned
  - [ ] executable check command planned
- [ ] `P0_RENDER_PLAYBACK_BASELINE`
  - [ ] 1, 4, and 16 visible clip scenarios defined
  - [ ] FPS/frame-delta/render-timing thresholds defined
- [ ] `P0_EXPORT_BASELINE`
  - [ ] `debugExport` fast/precise scenarios defined
  - [ ] audio on/off and 640x360/1080p thresholds defined
- [ ] `P0_PROXY_CACHE_PRESSURE`
  - [ ] VideoFrame, decoder, object URL, and runtime-release thresholds defined
- [ ] `P0_AUDIO_CONTEXT_BASELINE`
  - [ ] live playback, scrub, record, and export owners listed
- [ ] `P0_PREVIEW_TARGET_LIFECYCLE`
  - [ ] Preview/source/output mount-unmount checks defined
- [ ] `P0_CSS_GLOBAL_SELECTOR_GATE`
  - [ ] global selector, z-index, fixed overlay, pointer-event, retired-class
        scans defined

Do not:

- [ ] Do not start source implementation before relevant gates have subchecks.
- [ ] Do not enforce stale LOC numbers.
- [ ] Do not edit the existing timeline architecture registry while defining
      the whole-codebase registry pattern.

### P1 - Foundation Contracts

Allowed write set:

- `src/types/**`
- domain contract entry points created for type tiers
- focused import-boundary tests

Forbidden files:

- `src/components/**`
- `src/engine/**`
- `src/services/project/projectLoad.ts`
- `src/services/project/projectSave.ts`
- domain UI and render implementation files

Gates and subchecks:

- [ ] `P1_TYPE_TIER_DEFINED`
  - [ ] pure schema tier defined
  - [ ] durable store tier defined
  - [ ] runtime store/lease tier defined
  - [ ] render/runtime tier defined
- [ ] `P1_GLOBAL_TYPES_BARREL_THIN`
  - [ ] `src/types/index.ts` compatibility plan defined
  - [ ] retirement order defined
- [ ] `P1_TYPE_TIER_NO_RUNTIME_IMPORTS`
  - [ ] scan forbids DOM/GPU/File/Blob/VideoFrame/runtime services in pure tiers
- [ ] `P1_PROJECT_SCHEMA_NO_STORE_IMPORTS`
  - [ ] project type imports from stores/components/engine fail the gate
- [ ] `P1_STORE_PUBLIC_FACADES_DEFINED`
  - [ ] durable state, actions, selectors, command/planner API separated
- [ ] `P1_PROJECT_SCHEMA_OWNS_PERSISTED_TYPES`
  - [ ] schema DTOs do not reuse live store internals
- [ ] `P1_RUNTIME_HANDLES_FORBIDDEN_IN_SHARED_SCHEMA`
  - [ ] runtime-handle scan covers shared schema and broad type barrels

Do not:

- [ ] Do not move UI/render/export/project behavior in this phase.
- [ ] Do not create another broad type dump.
- [ ] Do not let schema import live store, engine, component, or service types.

### P1A - Clip And Media Source Runtime Split

Allowed write set:

- `src/types/**`
- `src/services/mediaRuntime/**`
- targeted runtime-boundary tests

Forbidden files:

- `src/components/panels/MediaPanel.tsx`
- `src/services/project/projectLoad.ts`
- `src/services/project/projectSave.ts`
- `src/engine/render/RenderDispatcher.ts`
- `src/components/export/ExportPanel.tsx`

Gates and subchecks:

- [ ] `P1A_CLIP_SOURCE_DURABLE_RUNTIME_SPLIT`
  - [ ] durable clip/source refs contain ids/metadata only
  - [ ] runtime lookup uses `RuntimeSourceId`
- [ ] `P1A_MEDIA_FILE_RUNTIME_SIDETABLE`
  - [ ] `File`, object URL, DOM, frame, decoder, and GPU handles have owners
- [ ] `P1A_SINGLE_RUNTIME_LEASE_DOMAIN`
  - [ ] existing `services/mediaRuntime` registry is canonical
  - [ ] no second lease manager introduced
- [ ] `P1A_RUNTIME_HANDLE_ROUNDTRIP_GUARD`
  - [ ] `structuredClone` guard defined
  - [ ] JSON roundtrip guard defined
  - [ ] `file`, `url`, `handle`, and runtime object leak cases covered
- [ ] `P1A_HMR_SAFE_RUNTIME_OWNER`
  - [ ] singleton/HMR survival pattern defined for new runtime owners

Do not:

- [ ] Do not remove `MediaFile.file` before side-table migration exists.
- [ ] Do not add lease logic outside `services/mediaRuntime`.
- [ ] Do not touch MediaPanel/project/render/export to close this phase.

### P1B - Universal Signal Foundation

Allowed write set:

- `src/signals/**`
- `src/importers/**`
- signal/project DTO tests
- format-matrix docs

Forbidden files:

- `src/components/panels/MediaPanel.tsx`
- `src/services/project/projectLoad.ts`
- `src/engine/render/RenderDispatcher.ts`
- `src/components/export/ExportPanel.tsx`

Gates and subchecks:

- [ ] `P1B_SIGNAL_DTO_RUNTIME_FREE`
  - [ ] `src/signals/**` has no File/Blob/DOM/GPU/decoder/runtime handles
  - [ ] project signal DTOs remain JSON-safe
- [ ] `P1B_UNIVERSAL_IMPORT_ROUTE_MATRIX`
  - [ ] OBJ/FBX/glTF/GLB route listed
  - [ ] PDF/SVG route listed
  - [ ] DXF/STEP route listed
  - [ ] JSON/CSV route listed
  - [ ] binary/unknown route listed
  - [ ] point-cloud route listed
- [ ] `P1B_NO_UNSUPPORTED_FILE_FALLBACK`
  - [ ] unknown files become `SignalAsset` fallback
  - [ ] fallback is not treated as final renderer support
- [ ] `P1B_SIGNAL_PROJECT_ROUNDTRIP`
  - [ ] CSV fixture roundtrips
  - [ ] binary/unknown fixture roundtrips
- [ ] `P1B_SIGNAL_TIMELINE_MATERIALIZATION_CONTRACT`
  - [ ] timeline placement behavior defined for signal refs
- [ ] `P1B_SIGNAL_PREVIEW_EXPORT_FALLBACK`
  - [ ] preview/export fallback surface defined per format family

Do not:

- [ ] Do not solve signals with one-off Media Panel UI branches.
- [ ] Do not put runtime handles in signal DTOs.
- [ ] Do not claim CAD/PDF/SVG/3D support complete with binary summary only.

### P2 - Store And Runtime Ownership

Allowed write set:

- `src/stores/**`
- store selectors/action planners
- store boundary tests
- approved hydration adapters only after P2/P3 contract freeze

Forbidden files:

- `src/services/project/types/**` except approved adapter contract work
- `src/services/project/projectLoad.ts`
- `src/services/project/projectSave.ts`
- `src/components/**`
- `src/engine/**`

Gates and subchecks:

- [ ] `P2_DURABLE_STORE_BOUNDARY`
  - [ ] durable state is serializable
  - [ ] runtime leases are referenced by ids only
- [ ] `P2_RUNTIME_LEASE_OWNERS_DEFINED`
  - [ ] lease owner map covers media, audio, render, decoder, worker, GPU
- [ ] `P2_GETSTATE_USAGE_CLASSIFIED`
  - [ ] async fresh reads classified
  - [ ] bridge/adapter reads allowlisted
  - [ ] module-scope/render-path reads flagged
- [ ] `P2_GETSTATE_MODULE_SCOPE_FORBIDDEN`
  - [ ] hard gate forbids new module-scope live reads
- [ ] `P2_HISTORY_AND_DOCK_SPLIT`
  - [ ] history serializers separated
  - [ ] dock migration/layout ownership separated
- [ ] `P2_PROJECT_HYDRATION_NOT_STORE_INTERNALS`
  - [ ] project hydration uses adapters, not store internals
- [ ] `P2_STORE_PROJECT_CONTRACT_FREEZE`
  - [ ] P2 and P3 DTO/hydration contracts accepted together

Do not:

- [ ] Do not reduce `getState()` by count alone.
- [ ] Do not persist runtime leases or live handles in stores.
- [ ] Do not edit project load/save internals from a store packet unless the
      adapter write set is approved.

### P3 - Project Persistence And Migration Boundary

Allowed write set:

- `src/services/project/types/**`
- `src/services/project/migrations/**`
- project schema builders/importers/hydration adapters
- old-project fixtures and project persistence tests

Forbidden files:

- `src/stores/**` except approved hydration adapter call sites
- `src/components/**`
- `src/engine/**`
- `src/services/mediaRuntime/**` except approved runtime-restore adapter

Gates and subchecks:

- [ ] `P3_PROJECT_SCHEMA_BOUNDARY`
  - [ ] schema owns persisted DTOs
  - [ ] schema is serializable and runtime-free
- [ ] `P3_PROJECT_SCHEMA_NO_STORE_IMPORTS`
  - [ ] no imports from stores/components/engine in schema types
- [ ] `P3_PROJECT_VERSION_MIGRATION_REGISTRY`
  - [ ] versioned migration registry exists
  - [ ] old fixtures run through the registry
- [ ] `P3_IMPORTER_LEGACY_QUARANTINE`
  - [ ] legacy import compatibility isolated at load boundary
- [ ] `P3_FLASHBOARD_PERSISTENCE_SPLIT`
  - [ ] active generation metadata separated from retired board/canvas data
- [ ] `P3_DOWNLOAD_YOUTUBE_MIGRATION_ONLY`
  - [ ] deprecated payloads migrate into current Media Panel/timeline contracts
- [ ] `P3_PROJECT_LOAD_SAVE_NO_DIRECT_LOCALSTORAGE`
  - [ ] UI preferences go through explicit adapter
- [ ] `P3_DOCK_LAYOUT_SINGLE_PERSISTENCE_OWNER`
  - [ ] project and local layout ownership resolved
- [ ] `P3_RUNTIME_HANDLE_ROUNDTRIP_GUARD`
  - [ ] structured clone and JSON roundtrip fail on live handles
- [ ] `P3_PROJECT_LOAD_SAVE_SMOKE`
  - [ ] save/load/autosave/nested restore scenarios defined

Do not:

- [ ] Do not reuse live store internals as schema DTOs.
- [ ] Do not scatter old-version normalization across domain loaders.
- [ ] Do not delete deprecated payload support before migration fixtures pass.

### P4 - Media Panel And FlashBoard

Allowed write set:

- `src/components/panels/MediaPanel*`
- `src/components/panels/flashboard/**`
- `src/stores/flashboardStore/**`
- `src/services/flashboard/**`
- Media/FlashBoard smoke tests

Forbidden files:

- `src/services/project/types/**` except approved DTO adapter work
- `src/services/project/projectLoad.ts`
- `src/services/project/projectSave.ts`
- `src/engine/**`
- `src/services/mediaRuntime/**`

Gates and subchecks:

- [ ] `P4_MEDIA_PANEL_SHELL_SPLIT`
  - [ ] shell below budget
  - [ ] folders/grid/board/downloads/generation/import status split
- [ ] `P4_MEDIA_STORE_SELECTOR_CONTRACT`
  - [ ] Media Panel reads through selectors/adapters
- [ ] `P4_FLASHBOARD_ACTIVE_CONTRACT`
  - [ ] request -> queue/job -> provider task -> media import contract defined
- [ ] `P4_FLASHBOARD_PROVIDER_TASK_CONTRACT`
  - [ ] provider runner isolated from UI and direct store internals
- [ ] `P4_FLASHBOARD_RETIRED_BOARD_LEDGER`
  - [ ] old board/canvas/node paths classified
- [ ] `P4_MEDIA_BOARD_VS_FLASHBOARD_BOARD_CLASSIFIED`
  - [ ] active Media Board and retired FlashBoard Board separated
- [ ] `P4_MEDIA_BOARD_RENDER_STRATEGY`
  - [ ] DOM/React owns controls, forms, menus, accessibility, and low-frequency UI
  - [ ] canvas renderer owns dense board visuals, minimap, selection/marquee,
        thumbnails, connections, and zoom/pan feedback
  - [ ] `OffscreenCanvas`/worker path is used only if board performance
        baseline proves main-thread rendering is the bottleneck
  - [ ] main-thread canvas or DOM fallback remains defined
- [ ] `P4_MEDIA_BOARD_PROJECT_ROUNDTRIP`
  - [ ] board layout/prefs roundtrip defined
- [ ] `P4_MEDIA_GENERATION_PROJECT_ROUNDTRIP`
  - [ ] generation metadata save/load test defined
- [ ] `P4_DOWNLOADS_ACTIVE_IN_MEDIA_PANEL`
  - [ ] deprecated download panel behavior mapped to Media Panel

Do not:

- [ ] Do not merge active Media Board with retired FlashBoard board/canvas.
- [ ] Do not move Composer/forms/provider settings/chat controls to canvas.
- [ ] Do not require `OffscreenCanvas` as the only board render path.
- [ ] Do not delete FlashBoard CSS/classes without usage scan and ledger.
- [ ] Do not let FlashBoard services reach directly into stores.
- [ ] Do not change project schema from this phase without the P3 adapter packet.

### P5 - Preview, Export, And Common UI

Allowed write set:

- `src/components/preview/**`
- `src/components/export/**`
- overlay modules and common UI/CSS split targets
- preview/export smoke and unit tests

Forbidden files:

- `src/engine/render/RenderDispatcher.ts` unless Phase 5/6 joint packet owns it
- `src/engine/WebGPUEngine.ts` unless Phase 5/6 joint packet owns it
- render-target store files unless Phase 5/6 joint packet owns them
- `src/services/project/**`

Gates and subchecks:

- [ ] `P5_PREVIEW_RUNTIME_BOUNDARY`
  - [ ] Preview shell separated from render target lifecycle owner
- [ ] `P5_RENDER_TARGET_SNAPSHOT_CONTRACT`
  - [ ] render target snapshot input defined before implementation
- [ ] `P5_PREVIEW_OVERLAY_REGISTRY`
  - [ ] overlays registered through focused contracts
- [ ] `P5_EXPORT_PANEL_RUNNER_BOUNDARY`
  - [ ] UI settings separated from runner adapters
- [ ] `P5_EXPORT_RENDER_SESSION_CONTRACT`
  - [ ] export session transaction and cancellation contract defined
- [ ] `P5_BOUNDED_MEMORY_EXPORT`
  - [ ] bounded or streaming frame delivery requirement covered
- [ ] `P5_EXPORT_SMOKE_PRESERVED`
  - [ ] debugExport scenarios remain available
- [ ] `P5_COMMON_CSS_BUDGET`
  - [ ] CSS split targets under role budgets
- [ ] `P5_CSS_GLOBAL_SELECTOR_AND_ZINDEX_GATE`
  - [ ] z-index/global/fixed/pointer-event scans defined

Do not:

- [ ] Do not touch engine export state/render-target store without P5/P6 joint
      ownership.
- [ ] Do not delete CSS without usage scan and retired-class entry.
- [ ] Do not split overlays by visual order only.

### P6 - Render, Audio, WebCodecs, Proxy, And Cache Hot Paths

Allowed write set:

- `src/engine/**`
- `src/services/proxyFrameCache.ts` and proxy/cache modules
- `src/services/audio/**`
- `src/services/mediaRuntime/**` only for approved lease integration
- hot-path tests and smokes

Forbidden files:

- `src/components/**` except approved smoke harnesses
- `src/services/project/**`
- `src/stores/**` except approved snapshot adapter files

Gates and subchecks:

- [ ] `P6_RENDER_FRAME_SNAPSHOT`
  - [ ] per-frame snapshot contract avoids live store reads
- [ ] `P6_RENDER_OUTPUT_ROUTER`
  - [ ] output target routing owner defined
- [ ] `P6_RENDER_DISPATCHER_OWNERSHIP_SPLIT`
  - [ ] collection/composition/output/diagnostics split plan defined
- [ ] `P6_WEBCODECS_LIFECYCLE_SPLIT`
  - [ ] source open/close/seek/decode scheduling owners defined
- [ ] `P6_VIDEOFRAME_LEASE_CONTRACT`
  - [ ] borrow/clone/close accounting defined
- [ ] `P6_PROXY_CACHE_OWNER_DEFINED`
  - [ ] cache key, storage, extraction, eviction owners defined
- [ ] `P6_PROXY_CACHE_CLOSE_REVOKE_ACCOUNTING`
  - [ ] VideoFrame close and object URL revoke counters defined
- [ ] `P6_PROXY_DECODER_COALESCING`
  - [ ] per-frame decoder churn reduction target defined
- [ ] `P6_THUMBNAIL_PROXY_BOUNDARY`
  - [ ] thumbnail rendering separated from proxy cache ownership
- [ ] `P6_AUDIO_CONTEXT_OWNERSHIP_MAP`
  - [ ] playback, scrub, recording, export, diagnostics owners listed
- [ ] `P6_AUDIO_RECORDING_AND_ROUTE_BOUNDARY`
  - [ ] recording/worklet/routing boundaries defined
- [ ] `P6_SCRUB_AUDIOCONTEXT_DISPOSED`
  - [ ] scrub context disposal check defined
- [ ] `P6_EXPORT_AUDIO_SYNC_GUARD`
  - [ ] frame/audio sync smoke defined

Do not:

- [ ] Do not start hot-path splits before Phase 0 smokes have thresholds.
- [ ] Do not close/transfer frames, URLs, GPU, or audio resources without
      accounting.
- [ ] Do not keep live store reads in render work after snapshot contracts.

### P7 - AI Tools, Dev Bridge, Guided Actions, And Smokes

Allowed write set:

- `src/services/aiTools/**`
- smoke handler modules
- bridge policy/transport tests

Forbidden files:

- product UI/components except explicit smoke fixtures
- project schema/load/save except approved debug adapter
- engine/render hot paths except approved smoke read-only probes

Gates and subchecks:

- [ ] `P7_AI_TOOL_EXECUTION_FACADE`
  - [ ] execution facade separated from handler registry and policy
- [ ] `P7_DEV_BRIDGE_QUARANTINED`
  - [ ] dev bridge transport separated from product behavior
- [ ] `P7_SMOKE_HANDLERS_SPLIT`
  - [ ] fixture setup, user actions, canvas assertions, reporting split
- [ ] `P7_PHASE0_SMOKES_STABLE`
  - [ ] Phase 0 smoke commands survive bridge cleanup
- [ ] `P7_GUIDED_ACTION_BOUNDARY`
  - [ ] guided replay/compiler/runtime contracts separated
- [ ] `P7_POLICY_REGISTRY_STABLE`
  - [ ] caller policy/permissions tests defined

Do not:

- [ ] Do not delete verifier coverage before replacement gates exist.
- [ ] Do not let bridge transport define product contracts.
- [ ] Do not broaden product internals for a bridge handler.

### P8 - Test Suite Refactor And Architecture Gates

Allowed write set:

- `tests/**`
- architecture gate tests
- test fixtures
- package scripts for focused gates

Forbidden files:

- product source files unless a test packet has an approved paired fix
- generated/vendor files

Gates and subchecks:

- [ ] `P8_ARCHITECTURE_GATE_SUITE`
  - [ ] LOC budget gate executable
  - [ ] import boundary gate executable
  - [ ] runtime-free schema gate executable
  - [ ] retired-path gate executable
  - [ ] smoke coverage gate executable
- [ ] `P8_TEST_MIGRATION_LEDGER`
  - [ ] large tests classified as port/split/replace/keep/delete
- [ ] `P8_NO_OBSOLETE_GODOBJECT_TESTS`
  - [ ] tests assert public contracts, not old internal file shape
- [ ] `P8_FULL_CHAIN_READY_FOR_NORMAL_COMMIT`
  - [ ] build/lint/test required only for normal commit/merge/readiness

Do not:

- [ ] Do not delete tests only to satisfy LOC budgets.
- [ ] Do not mark gates closed without executable checks or accepted exception.
- [ ] Do not keep tests that force obsolete god-object internals.

## Baseline Captured

- [x] Capture top-level domain LOC totals.
- [x] Capture major subdomain LOC totals.
- [x] Capture largest product files over 2,000 LOC.
- [x] Capture import fan-in/fan-out hubs.
- [x] Capture broad `index.ts` barrel candidates.
- [x] Capture `getState()` hotspots.
- [x] Capture runtime-handle hotspots.
- [x] Capture largest CSS files.
- [x] Capture deprecated panel and migration-only signals.
- [x] Capture largest tests.
- [ ] Keep baseline data inside the plan unless it becomes too large.
- [ ] Add reproducible baseline commands to the plan.
- [ ] Define performance-smoke baseline matrix.
- [ ] Refresh all baseline counts before turning any number into a gate.

## Phase 0 - Baseline And Guard Rails

- [x] Define Phase 0 goal.
- [x] Define baseline categories.
- [x] Define `P0_BASELINE_CAPTURED` gate.
- [x] Add Phase 0 smoke gate names for render/playback/export/proxy/audio/
      preview/CSS.
- [x] Define 6 read-only worker packets for first baseline wave.
- [x] Add `P0_COMPLETE_ARCHITECTURE_REGISTRY` preflight gate.
- [ ] Complete baseline section inside `Complete-refactor.md`.
- [x] Create first architecture/static gate list.
- [ ] Define thresholds for `P0_RENDER_PLAYBACK_BASELINE`.
- [ ] Define thresholds for `P0_EXPORT_BASELINE`.
- [ ] Define thresholds for `P0_PROXY_CACHE_PRESSURE`.
- [ ] Define thresholds for `P0_AUDIO_CONTEXT_BASELINE`.
- [ ] Define thresholds for `P0_PREVIEW_TARGET_LIFECYCLE`.
- [ ] Define exact scan for `P0_CSS_GLOBAL_SELECTOR_GATE`.

## Phase 1 - Foundation Contracts

- [x] Identify `src/types/index.ts` as highest fan-in hub.
- [x] Identify timeline/media store public facades as shared hubs.
- [x] Identify project schema importing live store types as a boundary risk.
- [x] Define target type tiers.
- [x] Define foundation gates.
- [x] Add project schema no-store-imports gate.
- [x] Add type-tier no-runtime-imports gate.
- [ ] Define exact module targets for type-tier split.
- [ ] Define compatibility-retirement order for `src/types/index.ts`.
- [ ] Define import-boundary tests.
- [ ] Define pure schema, durable store, runtime store, and render runtime type
      tiers.

## Phase 1A - Clip And Media Source Runtime Split

- [x] Add Phase 1A to the plan.
- [x] Define `services/mediaRuntime` as canonical runtime lease domain.
- [x] Define runtime-handle roundtrip guard requirement.
- [x] Define HMR-safe runtime owner requirement.
- [ ] Define `MediaAssetRef`, `TimelineSourceRef`, `MediaRuntimeLease`, and
      `RuntimeSourceId` target contracts.
- [ ] Map migration sources: `blobUrlManager`, `sourceRuntimeSanitizer`,
      `webCodecsHelpers`, proxy/cache handles, project hydration handles, and
      media object URL managers.
- [ ] Define static runtime-handle scan for shared durable types.
- [ ] Define `structuredClone` and JSON roundtrip persisted-state test.

## Phase 1B - Universal Signal Foundation

- [x] Add Phase 1B to the plan.
- [x] Identify `src/signals/**` and `src/importers/**` as June-2026 foundation
      lanes.
- [x] Define Universal Signal gate names.
- [x] Add format matrix requirement for 3D, documents, CAD, data, binary, and
      point-cloud families.
- [ ] Define exact DTO/runtime-free scan for `src/signals/**`.
- [ ] Define format matrix owners and checks.
- [ ] Define timeline materialization contract for signal refs.
- [ ] Define preview/export fallback contract for signal refs.
- [ ] Define CSV, binary, unknown-file, and at least one non-media fixture.

## Phase 2 - Store And Runtime Ownership

- [x] Identify `getState()` hotspots.
- [x] Define durable store versus runtime lease target.
- [x] Define dock/history/mediaStore/timeline targets.
- [x] Define store/runtime gates.
- [x] Replace blind `getState()` reduction with usage classification.
- [x] Add combined store/project contract-freeze requirement.
- [ ] Define allowed `getState()` adapter list.
- [ ] Define runtime lease owner map.
- [ ] Define store selector/action planner file targets.
- [ ] Define history serializer guard for runtime-handle leaks.
- [ ] Define dock layout localStorage versus project persistence ownership.

## Phase 3 - Project Persistence And Migration Boundary

- [x] Identify `projectLoad`, `projectSave`, and `ProjectFileService` as
      persistence god objects.
- [x] Identify deprecated `youtube`, `download`, and `ai-video` migration
      surfaces.
- [x] Define project schema/importer/hydration target.
- [x] Define project persistence gates.
- [x] Add versioned migration registry as a required deliverable.
- [x] Add project UI preferences/localStorage adapter gate.
- [x] Add persisted-state runtime roundtrip guard.
- [ ] Define exact saved-project compatibility policy.
- [ ] Define FlashBoard project-schema split.
- [ ] Define download/youtube migration tests.
- [ ] Define `P3_PROJECT_SCHEMA_NO_STORE_IMPORTS` import-boundary check.
- [ ] Define old-project fixture tests for migration registry.

## Phase 4 - Media Panel And FlashBoard

- [x] Identify `MediaPanel`, `MediaPanel.css`, `FlashBoardComposer`, and
      `FlashBoard.css` as major targets.
- [x] Define active FlashBoard contract.
- [x] Define retired board/canvas candidates.
- [x] Define Media Panel and FlashBoard gates.
- [x] Add Media Board versus FlashBoard Board classification requirement.
- [x] Add Media Board hybrid canvas/OffscreenCanvas render strategy gate.
- [x] Add FlashBoard provider task contract gate.
- [x] Add Media Board project roundtrip gate.
- [ ] Define Media Panel component/module tree.
- [ ] Define FlashBoard composer module tree.
- [ ] Define Media Board renderer packet and board performance thresholds.
- [ ] Define FlashBoard retired-path ledger entries.
- [ ] Define Media Panel and FlashBoard smoke tests.
- [ ] Define request planner/reference resolver/provider runner/media import
      adapter split for FlashBoard services.

## Phase 5 - Preview, Export, And Common UI

- [x] Identify Preview, overlays, ExportPanel, and large common CSS targets.
- [x] Define target split for Preview.
- [x] Define target split for Export.
- [x] Define target split for common CSS.
- [x] Add RenderTargetSnapshot dependency for Preview.
- [x] Add ExportRenderSession and bounded-memory export requirements.
- [x] Add CSS global selector/z-index/retired-class gate.
- [ ] Define overlay registry contract.
- [ ] Define export runner contract.
- [ ] Define CSS deletion/usage scan gate.
- [ ] Define `AbortSignal` cancellation contract for export runners.
- [ ] Define Phase 5/Phase 6 sequencing rules for render/export shared state.

## Phase 6 - Render, Audio, WebCodecs, Proxy, And Cache Hot Paths

- [x] Identify RenderDispatcher, WebCodecsPlayer, WebGPUEngine, proxy/cache,
      thumbnail, and audio god objects.
- [x] Define hot-path invariants.
- [x] Define render/audio/proxy gates.
- [x] Add RenderFrameSnapshot and RenderOutputRouter gates.
- [x] Add VideoFrame lease/borrow/close contract gate.
- [x] Add proxy close/revoke accounting and decoder coalescing gates.
- [x] Add audio context ownership map gate.
- [ ] Define playback/scrub/export performance baseline.
- [ ] Define GPU/resource lifetime checks.
- [ ] Define cache eviction/object URL lifetime checks.
- [ ] Define `audioRoutingManager` versus `audioManager` ownership decision.
- [ ] Define scrub `AudioContext` disposal check.

## Phase 7 - AI Tools, Dev Bridge, Guided Actions, And Smokes

- [x] Identify `aiTools/bridge`, `aiTools/index`, handlers, and
      `timelineCanvasSmoke` as targets.
- [x] Define product AI versus dev bridge boundary.
- [x] Define smoke handler split.
- [x] Define AI/dev bridge gates.
- [x] Promote existing AI bridge smokes to Phase 0 gate inputs.
- [ ] Define bridge transport split.
- [ ] Define tool execution facade target.
- [ ] Define smoke replacement order.
- [ ] Define thresholds for `getStats`, `getPlaybackTrace`, `debugExport`, and
      timeline canvas smokes.

## Phase 8 - Test Suite Refactor And Architecture Gates

- [x] Identify largest tests.
- [x] Define test migration rule.
- [x] Define architecture gate categories.
- [ ] Define exact test migration ledger.
- [ ] Define LOC budget gate.
- [ ] Define runtime-free schema gate.
- [ ] Define retired-path gate.
- [ ] Define smoke coverage gate.

## Review And Approval

- [x] Run initial skeptical/codebase review with 2 Codex and 2 Claude agents.
- [x] Incorporate first review findings into the plan.
- [ ] Run final skeptical review after exact gates/write sets are added.
- [ ] Incorporate or reject final skeptical review findings.
- [ ] Produce first orchestrator-ready source implementation packets inside
      `Complete-refactor.md`.
- [ ] Start first source implementation packet after its write set, forbidden
      files, and gate/check are explicit.
