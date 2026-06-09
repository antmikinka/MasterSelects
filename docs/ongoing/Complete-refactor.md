# Complete Refactor Execution Plan

Status: execution plan
Created: 2026-06-09
Updated: 2026-06-09

## Objective

Guide the full-codebase refactor execution for MasterSelects.

The target is the long-term architecture, not a cleanup MVP. The timeline
refactor is the method template: lanes, ownership, gates, ledgers, focused
checks, retired-path classification, and execution reporting. The whole-codebase
plan must reuse that discipline without copying timeline-specific code.

Agents working on the Complete Refactor should use this document as the active
execution plan. Do not restart meta-planning by default. Work in bounded
packets with a lane, write set, forbidden files, expected gates/checks, and a
short report.

If a required contract, gate, or write set is missing, add the smallest needed
preflight entry here and in the checklist, then continue with the bounded
packet when the risk is controlled.

## Success Definition

The final architecture should be easy to change, easy to reason about, and fast
in the places where performance matters.

Success means:

- no source god objects remain as normal architecture
- no product source file should exceed 700 LOC without an explicit temporary
  gate exception
- files are grouped by responsibility, dependency direction, and lifecycle
  owner, not split blindly by line count
- duplicate logic is consolidated behind stable contracts instead of copied
  into smaller files
- runtime ownership is explicit and durable state stays serializable
- hot paths have performance baselines and guardrails before and after changes
- legacy paths are deleted or isolated behind import/migration boundaries
- tests protect user-visible behavior and architecture boundaries, not obsolete
  implementation details

The 700 LOC limit is a guardrail, not the definition of success. A 300 LOC file
can still be bad architecture if it is a prop funnel, dependency dump,
compatibility wrapper, or hidden runtime owner.

## 700 LOC And Cohesion Rule

Target state: no normal product source file over 700 LOC.

700 LOC is the ceiling, not the target. Most files should be much smaller,
depending on their role.

Suggested target budgets:

| File role | Target |
|---|---:|
| Composition root / complex shell | <= 700 LOC |
| React host component | <= 400 LOC |
| Focused React view component | <= 250 LOC |
| Leaf UI component | <= 150 LOC |
| Store root / public store facade | <= 400 LOC |
| Store slice | <= 300 LOC |
| Store selector / action planner | <= 250 LOC |
| Pure planner / builder / selector | <= 250 LOC |
| Runtime service facade | <= 700 LOC |
| Runtime lifecycle owner | <= 400 LOC |
| IO adapter | <= 300 LOC |
| Registry / contributor module | <= 300 LOC |
| Renderer / painter facet | <= 200 LOC |
| Bridge route / dev-tool handler | <= 250 LOC |
| Architecture gate / coherence test | <= 250 LOC |
| Coherence envelope / orchestration function | <= 80 LOC |
| Component CSS module/file | <= 250 LOC |
| Domain CSS file | <= 700 LOC |

Allowed exceptions:

- generated files
- vendored code
- test fixtures where splitting would hide intent
- temporary gate exceptions with owner, reason, replacement plan, and delete or
  split gate

A split is valid only when it improves at least one real architectural property:

- narrows a public contract
- removes a cross-domain import
- separates durable state from runtime allocation
- isolates IO from planning or pure selection
- isolates dev-only diagnostics from product behavior
- moves legacy compatibility to an importer/migration boundary
- removes duplicated logic by creating a single domain owner
- separates high-frequency rendering from low-frequency React UI
- gives tests a smaller and more meaningful behavior surface

Invalid splits:

- moving random functions into `helpers.ts` or `utils.ts`
- creating wrapper modules that only rename old logic
- creating a broad `types.ts` dump beside the old god object
- splitting by visual position in the file instead of responsibility
- passing the same broad prop/store bag through more layers
- keeping old fallback branches after the new contract owns the behavior

Preferred module shapes:

- public contract / types
- pure selectors or planners
- runtime owner / lease manager
- IO adapter
- React shell
- focused view components
- renderer or painter facet
- test and smoke gate

## Master Orchestrator Execution Model

The eventual refactor should be executed by one master orchestrator agent.

The master orchestrator owns:

- canonical plan and lane ordering
- contract freeze decisions
- dependency map and shared hub ownership
- write-set assignment and forbidden-file enforcement
- worker-agent prompts
- gate closure decisions
- diff review and integration order
- execution report updates
- skeptical review incorporation

The master orchestrator should not let worker agents invent the target
architecture independently. Workers implement or verify bounded packets from
the accepted plan.

The orchestrator may use up to 6 parallel worker agents when the work is truly
independent. Parallelism is allowed for read-only discovery, baseline scans,
test classification, legacy classification, and implementation packets with
disjoint write sets. If two packets touch the same shared hub, project schema,
store boundary, renderer, bridge, or source file, they must be sequenced.

The orchestrator should prefer waves:

1. Baseline/discovery wave: read-only agents collect metrics and risks.
2. Contract wave: foundation agents define target contracts and gates.
3. Skeptical review wave: reviewers attack the plan before implementation.
4. Implementation wave: up to 6 disjoint worker packets.
5. Verification wave: independent verifier agents run gates and inspect diffs.
6. Synthesis wave: orchestrator updates ledgers, checklist, and next packet
   list.

## Worker Agent Packet Format

Every worker-agent task should be issued as a packet with this shape:

```text
Lane:
Packet:
Mode: read-only | implementation | verification
Goal:
Read first:
Allowed write set:
Forbidden files:
Current contract:
Target contract:
Retired paths in scope:
Runtime invariants:
Expected gates:
Expected checks:
Expected report:
Stop conditions:
```

Worker agents must report:

- files read
- files changed, if any
- coupling actually reduced
- gates passed, failed, or still active
- checks run and result
- checks skipped and why
- retired paths classified or deleted
- tests ported, replaced, split, kept, or deleted
- remaining risks and next packet recommendation

For implementation packets, the worker should not broaden scope when it finds
extra debt. It should report the debt and let the orchestrator assign the next
packet.

## Progress, Commit, And Check Cadence

The refactor should preserve progress frequently, but checks must stay scoped
to the risk of the packet.

During normal implementation:

- keep changes in small, coherent packets
- update this plan/checklist whenever requirements, gates, write sets,
  blockers, or decisions change
- run focused gates, targeted unit tests, static scans, or smokes that match
  the packet risk
- do not run full `npm run build`, `npm run lint`, and `npm run test` after
  every small edit
- run the full chain only when AGENTS.md requires it: normal commit, push,
  release, merge, or explicit final readiness
- if the user explicitly requests a `fast commit`/`fast push` workflow, follow
  the fast-command rules in AGENTS.md instead of running checks

Commit cadence:

- commit after coherent, reviewable packets rather than after every file edit
- do not commit unresolved broad churn that lacks an accepted gate/write set
- do not push unless the active branch/workflow and user instruction allow it
- for long multi-agent execution, prefer frequent checkpoint commits only when
  the command mode permits them and the diff is understandable

## Gate And Checklist Contract

The checklist is not only a task list. It is the user-visible contract for what
is allowed, forbidden, blocked, and finished.

Every phase and every implementation packet must expose:

- goal
- allowed write set
- forbidden files or directories
- high-conflict hubs
- do-not rules
- gate ids
- gate subchecks
- focused checks or smoke commands
- exit criteria

Gate ids are not complete until their subchecks say what proves them. A gate
that only names a desired state is still a planning item, not an executable
guard.

Each gate should have this shape:

```text
Gate:
Subchecks:
- static or runtime condition
- fixture/smoke condition
- import/LOC/runtime-boundary condition
Checks:
- exact test, script, bridge command, or scan command when known
Do not:
- files, domains, or shortcuts that must not be touched to close this gate
Exit:
- observable state that lets the orchestrator mark the gate closed
```

When a worker discovers that a gate lacks subchecks, the worker must stop
source edits for that packet and report the smallest missing preflight entry.

## Source Of Truth

Use the current code tree as the primary source of truth.

Current feature docs in `docs/Features/**` are useful context. Historical docs
under `docs/completed/**` are reference material only; they may describe old
plans or surfaces that no longer exist.

Keep the refactor execution artifacts small.

Required during execution:

- `docs/ongoing/Complete-refactor.md`: actual refactor plan
- `docs/ongoing/Complete-refactor-checklist.md`: user-visible progress

Optional when the plan becomes canonical:

- `docs/refactor/whole-codebase/Whole-Codebase-Refactor-Plan.md`
- `docs/refactor/whole-codebase/Whole-Codebase-Refactor-Baseline.md`

Do not create separate manifest/ledger files up front unless a gate needs to be
executable. Keep lane ownership, contract freeze notes, adapter debt, retired
paths, test migration, and dependency maps as sections inside the plan until
they become too large or the implementation phase needs separate files.

The completed timeline refactor already has an executable architecture-registry
pattern under `src/timeline/architecture/**` and
`tests/unit/timelineArchitectureRegistry.test.ts`. The whole-codebase refactor
should generalize that discipline only when the Phase 0 architecture-registry
gate is accepted, so this plan does not drift into a second unverified source
of truth.

While the refactor runs from `docs/ongoing/`, use this file as the actual plan
and `docs/ongoing/Complete-refactor-checklist.md` as the user-visible progress
checklist.

Handoff files are execution templates. Use them when a master orchestrator or
worker-agent run starts and needs resume state.

Checklist rule: whenever a new requirement, lane, gate, baseline item, or
blocker is discovered, update `Complete-refactor-checklist.md` in the same
session so the user can quickly see what is done and what remains.

## Timeline Reuse Position

The timeline refactor is not work to restart.

Reuse from `src/timeline/architecture/**`:

- gate registry shape
- lane write manifest shape
- high-conflict ownership tracking
- retired-path ledger shape
- adapter-debt ledger shape
- test-migration ledger shape
- exit-criteria coverage shape
- architecture-registry test style from
  `tests/unit/timelineArchitectureRegistry.test.ts`

Do not copy timeline-specific gate ids or implementation details into the
whole-codebase plan. Generalize the method and keep the timeline as a protected
lane that other phases integrate with through contracts.

Timeline source edits are allowed only for explicit integration packets, such
as project hydration adapters, runtime lease migration, signal materialization,
or render/export snapshot integration. A worker must not reopen broad timeline
architecture work just because a whole-codebase gate mentions the timeline.

## Foundation-First Order

The plan should not start with Media Panel, FlashBoard, Preview, or render code
movement. Those lanes depend on shared foundations.

Required order:

1. Type tier, broad barrels, and dependency map.
2. Durable state versus runtime lease boundaries.
3. Universal Signal and import route foundation for "no unsupported files".
4. Project load/save, importers, history, autosave, and artifact schema.
5. Dev bridge and smoke verifier quarantine.
6. Domain lanes: Media Panel, FlashBoard, Preview, Export, Audio, Render,
   Proxy/Cache/Runtime, Common UI, Dock, CSS, tools, and tests.

Shared hubs need explicit ownership before implementation:

- `src/types/index.ts`
- `src/stores/timeline/index.ts`
- `src/stores/mediaStore/index.ts`
- history, dock, settings, and render-target stores
- project load/save and importers
- `RenderDispatcher`
- `WebGPUEngine`
- `Preview`
- `MediaPanel`
- `aiTools/bridge`
- dev smoke/torture handlers such as `timelineCanvasSmoke`

## Runtime Invariants

Runtime handles must not leak into durable state, project files, pure shared
types, or cross-domain schema tiers.

Explicitly exclude these from durable/project state:

- `File`
- `Blob`
- object URLs
- DOM elements
- `HTMLMediaElement`
- `AudioContext`
- `VideoFrame`
- `ImageBitmap`
- `GPU*` objects
- decoder/player instances
- workers
- service singletons

The plan must separate durable state, selectors, commands, IO, runtime leases,
and importer compatibility.

## Baseline Checklist

Before finalizing this plan, capture a reproducible baseline with command
outputs summarized in this plan unless the data becomes too large.

Minimum baseline:

- domain LOC totals
- files over 700, 1000, 1500, 2000, and 3000 LOC
- fan-in/fan-out hubs
- broad `index.ts` barrels and global type dumps
- cross-domain imports that violate intended ownership
- `getState()` usage outside stores, counted by file
- runtime-handle usage in durable state or pure contracts
- React components with mixed update cadence or excessive hooks
- services that mix planning, allocation, IO, diagnostics, and UI policy
- CSS files over 700, 1000, and 2000 LOC
- unused or legacy CSS class candidates
- deprecated panels and migration-only UI paths
- project save/load and importer touch points
- AI bridge and dev-smoke handlers that currently act as verifier surfaces
- render, playback, audio, export, preview, and Media Panel performance smokes
- tests coupled to legacy internals instead of user-visible behavior

Known baseline signals from the first scan:

- `src/components` is the largest area at roughly 162k LOC.
- `src/services` is roughly 134k LOC and must be split by lifecycle owner, not
  treated as one lane.
- `src/engine` is roughly 52k LOC.
- `src/stores` is roughly 50k LOC.
- `src/types/index.ts` has roughly 450 fan-in and is a foundation lane.
- Large god objects include `MediaPanel.tsx`, `FlashBoardComposer.tsx`,
  `ExportPanel.tsx`, `proxyFrameCache.ts`, `timelineCanvasSmoke.ts`,
  `aiTools/bridge.ts`, `Preview.tsx`, `RenderDispatcher.ts`, and
  `WebCodecsPlayer.ts`.

## Actual Codebase Refactor Plan

This is the codebase-specific refactor plan. It is not only a plan for how to
plan.

The work should be executed in phases because several large files are symptoms
of shared foundation problems. Media Panel, FlashBoard, Preview, Export, Render,
Audio, Project, and AI tools all touch shared types, stores, project hydration,
runtime handles, and dev smokes. Starting with a single UI god object would
only move the coupling.

## Review Corrections From Codebase Agents

Four read-only review agents compared this plan against the codebase. The plan
should incorporate these corrections before implementation starts:

- Baseline numbers in this document are planning signals only. Before gates or
  budgets are enforced, refresh LOC, fan-in/fan-out, `getState()`, runtime
  handles, CSS, and smoke baselines with reproducible commands.
- Add a required `Phase 1A` for clip/media-source data versus runtime split.
  Runtime handles already live in shared foundation models such as
  `src/types/index.ts` and media store types; treating this only as a later
  store/runtime cleanup would leave the root defect in place.
- Treat Phase 2 and Phase 3 contract design as one freeze wave. Stores,
  project load/save, project schema, history, FlashBoard persistence, media
  runtime, and importers currently form a cycle.
- Use `services/mediaRuntime` as the canonical runtime lease domain instead of
  inventing a second lease manager. Existing sources such as
  `blobUrlManager`, `sourceRuntimeSanitizer`, `webCodecsHelpers`, proxy/cache,
  and project hydration should migrate into or behind that owner.
- Project schema must be plain persisted DTOs with no imports from stores,
  engine, components, or live runtime services. Store/domain code may map to
  schema DTOs; schema must not depend on store internals.
- Add a versioned project migration registry. The current load path mostly uses
  ad-hoc `normalize*` functions; the importer boundary must be built, not just
  split out.
- Static runtime-handle scans are not enough. Add a persisted-state runtime
  roundtrip guard using `structuredClone` and JSON roundtrip checks so live
  handles cannot leak through field names such as `url`, `handle`, or `file`.
- Split `getState()` findings by usage class:
  - sanctioned fresh reads in async callbacks
  - adapter/bridge reads
  - module-scope/render-path reads
  Only the last category is a hard reduction target.
- Phase 5 and Phase 6 are coupled. Preview and Export mutate render targets,
  engine export mode, resolution, readback paths, and render-time overrides.
  They must wait for render lifecycle contracts such as `RenderFrameSnapshot`,
  `RenderTargetSnapshot`, `RenderOutputRouter`, and `ExportRenderSession`.
- Proxy/cache needs its own explicit lifecycle work: VideoFrame close/borrow
  contracts, object URL revoke accounting, decoder coalescing, bounded cache
  pressure, and scrub `AudioContext` disposal.
- Audio needs an ownership map before refactor: live playback routing, scrub
  audition, recording/worklet, export/offline rendering, diagnostics, and
  compatibility.
- Existing AI bridge smokes are valuable and should become Phase 0 gates with
  thresholds, not remain Phase 7 cleanup.
- CSS risk is broader than LOC. Add gates for global selectors, z-index tiers,
  fixed overlays, pointer-event traps, and retired class usage.
- New runtime owners must be HMR-safe according to the repo singleton pattern.
- The whole-codebase gates should reuse the timeline architecture-registry
  method instead of remaining Markdown-only. Add a Phase 0 preflight gate for a
  codebase-wide registry plan before source implementation begins.
- Add a Universal Signal lane. `src/signals/**`,
  `src/importers/UniversalImportOrchestrator.ts`, CSV import, binary fallback,
  WASM/worker runtime, and renderer adapters are already part of the "no
  unsupported files" target and must not be treated as incidental project
  persistence details.

### Phase 0 - Baseline And Guard Rails

Goal: make the current architecture measurable before source movement starts.

Current codebase signals:

- domain LOC:
  - `src/components`: 161,715 LOC
  - `src/services`: 133,407 LOC
  - `src/engine`: 51,359 LOC
  - `src/stores`: 49,465 LOC
- largest domains inside those:
  - `components/panels`: 58,539 LOC
  - `components/timeline`: 54,081 LOC
  - `services/audio`: 23,857 LOC
  - `services/aiTools`: 18,008 LOC
  - `stores/timeline`: 32,157 LOC
  - `stores/mediaStore`: 8,202 LOC
  - `engine/audio`: 11,191 LOC
  - `engine/render`: 6,094 LOC
- top product files over 2,000 LOC:
  - `src/components/panels/MediaPanel.tsx`: 6,095
  - `src/components/panels/flashboard/FlashBoardComposer.tsx`: 3,901
  - `src/components/panels/flashboard/FlashBoard.css`: 3,502
  - `src/components/export/ExportPanel.tsx`: 3,326
  - `src/services/proxyFrameCache.ts`: 3,266
  - `src/services/aiTools/handlers/timelineCanvasSmoke.ts`: 3,110
  - `src/services/aiTools/bridge.ts`: 2,995
  - `src/components/preview/Preview.tsx`: 2,827
  - `src/engine/render/RenderDispatcher.ts`: 2,543
  - `src/engine/WebCodecsPlayer.ts`: 2,539
  - `src/components/panels/MediaPanel.css`: 2,282
  - `src/services/audio/ClipAudioRenderService.ts`: 2,121
  - `src/components/panels/properties/VolumeBlendshapeTabs.css`: 2,072
  - `src/services/audio/AudioRecordingService.ts`: 2,058
  - `src/components/preview/SceneObjectOverlay.tsx`: 2,053
  - `src/stores/dockStore.ts`: 2,051
  - `src/engine/audio/AudioEffectRenderer.ts`: 2,011
  - `src/services/project/projectLoad.ts`: 2,003

Guard rails to create before implementation:

- LOC budget gate for product source, with role-specific budgets from this doc.
- Import/fan-in report gate for shared hubs.
- Runtime-handle leak scan for durable/project/shared-type boundaries.
- `getState()` usage report outside stores.
- CSS size and legacy-class report.
- Smoke inventory for render, playback, export, preview, Media Panel,
  FlashBoard generation, project load/save, and AI bridge.

Gate:

- `P0_BASELINE_CAPTURED`: baseline files exist and contain reproducible command
  summaries for LOC, fan-in/out, barrels, `getState()`, runtime handles, CSS,
  legacy panels, project persistence, and existing smokes.
- `P0_BASELINE_REFRESHED`: all counts used by gates are refreshed from the
  current working tree, not copied from older planning scans.
- `P0_RENDER_PLAYBACK_BASELINE`: playback and scrub at 1, 4, and 16 visible
  clips; record FPS, max frame delta, render timing, and cache evictions.
- `P0_EXPORT_BASELINE`: `debugExport` fast and precise, 640x360 and 1080p,
  audio on/off; assert blob size, monotonic progress, no device loss, and
  stable engine state before/after.
- `P0_PROXY_CACHE_PRESSURE`: scrub proxy video under cache pressure; assert
  bounded `VideoFrame` count, decoder count, object URL revokes, and runtime
  releases.
- `P0_AUDIO_CONTEXT_BASELINE`: play, scrub, record, and export; assert only
  approved live `AudioContext` owners remain.
- `P0_PREVIEW_TARGET_LIFECYCLE`: mount/unmount Preview, source monitor, and
  output targets; assert no stale target canvases or render contexts.
- `P0_CSS_GLOBAL_SELECTOR_GATE`: report large CSS, global selectors, z-index
  tiers, fixed overlays, pointer-event traps, and retired class usage.
- `P0_COMPLETE_ARCHITECTURE_REGISTRY`: define a whole-codebase architecture
  registry plan based on the timeline registry method. Subchecks must cover
  lane ids, gate ids, write sets, forbidden sets, exit criteria, retired-path
  classification, test migration classification, and the command that will
  make the registry executable when implementation starts.

Parallel worker packets:

- Worker 1: LOC/domain/file-size baseline.
- Worker 2: import fan-in/fan-out and barrel baseline.
- Worker 3: store `getState()` and runtime-handle baseline.
- Worker 4: CSS/legacy/deprecated panel baseline.
- Worker 5: project persistence and migration payload baseline.
- Worker 6: render/audio/export/preview/AI-bridge smoke baseline.

Do not:

- Do not start source implementation before the relevant phase gate has
  subchecks, allowed write set, forbidden files, and exit criteria.
- Do not enforce stale LOC numbers as gates without `P0_BASELINE_REFRESHED`.
- Do not edit timeline architecture registry files while defining the
  whole-codebase registry pattern.

### Phase 1 - Foundation Contracts

Goal: remove global coupling pressure before touching domain god objects.

Why first:

- `src/types/index.ts` has about 453 fan-in and 1,194 LOC.
- `src/stores/timeline/index.ts` has about 181 fan-in and 401 LOC.
- `src/stores/mediaStore/index.ts` has about 167 fan-in and 501 LOC.
- `src/services/logger.ts` has about 242 fan-in and should remain a stable
  utility, not become an architecture dependency sink.
- high fan-out files such as `RenderDispatcher`, `Preview`, `MediaPanel`,
  `projectLoad`, `timeline/index`, and `fileManageSlice` depend on these hubs.

Target shape:

- Replace the global type dump with domain type entry points:
  - media contracts
  - timeline contracts
  - project schema contracts
  - render/audio contracts
  - dock/UI contracts
  - AI-tool contracts
  - effect/vector contracts
- Keep `src/types/index.ts` as a thin compatibility facade only during the
  migration, then retire broad imports at gates.
- Split store contracts into:
  - durable state type
  - action API
  - selectors
  - command/planner API
  - runtime lease API
- Project schema must not import live store types directly. Example current
  risk: `project.types.ts` imports `ProjectFlashBoardState` from the
  FlashBoard store type module.

Concrete targets:

- `src/types/index.ts`: split below 150 LOC or retire as a narrow barrel.
- `src/stores/timeline/index.ts`: public facade only, below 250 LOC.
- `src/stores/mediaStore/index.ts`: public facade only, below 250 LOC.
- `src/types/dock.ts`: keep deprecated panel type migration explicit but do not
  let active UI depend on deprecated panels.
- `src/services/project/types/project.types.ts`: own project-persistence schema
  instead of importing live runtime/store types.

Gates:

- `P1_TYPE_TIER_DEFINED`
- `P1_GLOBAL_TYPES_BARREL_THIN`
- `P1_TYPE_TIER_NO_RUNTIME_IMPORTS`
- `P1_PROJECT_SCHEMA_NO_STORE_IMPORTS`
- `P1_STORE_PUBLIC_FACADES_DEFINED`
- `P1_PROJECT_SCHEMA_OWNS_PERSISTED_TYPES`
- `P1_RUNTIME_HANDLES_FORBIDDEN_IN_SHARED_SCHEMA`

Checks:

- import-boundary test for domain type entry points
- static scan for `File`, `Blob`, object URLs, `HTMLMediaElement`,
  `VideoFrame`, `ImageBitmap`, `GPU*`, workers, and service singletons in
  project schema/shared pure contracts
- fan-in/fan-out report must show fewer direct imports from `src/types/index.ts`
  after each implementation packet

Do not:

- Do not move domain UI, render, export, or project load/save behavior while the
  type tiers are still being frozen.
- Do not create broad replacement barrels such as `helpers.ts`, `utils.ts`, or
  another global type dump.
- Do not let project schema import live store, engine, component, or runtime
  service types.

### Phase 1A - Clip And Media Source Runtime Split

Goal: split durable clip/media-source data from runtime handles before store,
project, render, or media-domain implementation lanes begin.

Why this is required:

- Shared foundation models already carry runtime handles such as `File`,
  `HTMLVideoElement`, `HTMLAudioElement`, `WebCodecsPlayer`, `NativeDecoder`,
  `VideoFrame`, `GPUTexture`, object URLs, and canvas-related types.
- `TimelineClipSource`, media source data, and `MediaFile` are used across
  stores, project load/save, render, preview, export, and media runtime.
- If these models stay mixed, later phases can only wrap the old coupling.

Target shape:

- Durable state stores ids, paths, hashes, media metadata, project references,
  and runtime keys only.
- Runtime handles live behind `services/mediaRuntime` as the canonical runtime
  lease domain.
- Existing runtime sources such as `blobUrlManager`, `sourceRuntimeSanitizer`,
  `webCodecsHelpers`, proxy/cache runtime handles, project hydration handles,
  and media object URL managers migrate into or behind this domain.
- Introduce explicit concepts such as:
  - `MediaAssetRef`
  - `TimelineSourceRef`
  - `MediaRuntimeLease`
  - `RuntimeSourceId`
  - `RenderFrameSource`
- Avoid a second competing lease framework. Reuse and harden the existing
  `mediaRuntime` direction.

Gates:

- `P1A_CLIP_SOURCE_DURABLE_RUNTIME_SPLIT`
- `P1A_MEDIA_FILE_RUNTIME_SIDETABLE`
- `P1A_SINGLE_RUNTIME_LEASE_DOMAIN`
- `P1A_RUNTIME_HANDLE_ROUNDTRIP_GUARD`
- `P1A_HMR_SAFE_RUNTIME_OWNER`

Checks:

- static import/type scan for runtime handles in shared durable types
- persisted-state `structuredClone` and JSON roundtrip guard
- runtime lease owner map includes `File`, `FileSystemFileHandle`, object URLs,
  `HTMLMediaElement`, `VideoFrame`, `ImageBitmap`, `GPU*`, `AudioContext`,
  workers, decoder/player instances, and service singletons
- HMR singleton survival check for any new runtime owner

Do not:

- Do not build a second lease framework beside `services/mediaRuntime`.
- Do not remove `MediaFile.file` or clip runtime fields before a side-table or
  lease migration path exists.
- Do not edit `MediaPanel`, `projectLoad`, `projectSave`, `RenderDispatcher`,
  or `ExportPanel` to close this phase unless a later packet explicitly owns
  that write set.

### Phase 1B - Universal Signal Foundation

Goal: make the "every file becomes a visual signal" target explicit before
project, media, and renderer lanes lock their contracts.

Current codebase signals:

- `src/signals/**` already defines `SignalAsset`, `SignalRef`,
  `SignalArtifact`, `SignalGraph`, and operator descriptors.
- `src/importers/UniversalImportOrchestrator.ts` already routes files through
  signal providers or legacy media import.
- CSV import and binary fallback already exist, but CAD/PDF/SVG/3D/data
  renderer expectations need explicit ownership.
- Project files already persist `ProjectSignalState`.

Target shape:

- Universal import produces persisted signal DTOs plus runtime materialization
  leases, not ad-hoc unsupported-file branches.
- Signal project DTOs stay serializable and runtime-free.
- Format support is tracked with a matrix for OBJ, FBX, glTF/GLB, PDF, SVG,
  DXF, STEP, JSON, CSV, binary, point clouds, and unknown files.
- Timeline placement, preview materialization, export fallback, and project
  roundtrip are defined for each format family.

Concrete targets:

- `src/signals/types.ts`: pure signal DTOs only.
- `src/importers/**`: import planning, file identity, provider registry, and
  fallback routing stay isolated from UI and render runtime.
- renderer/materialization adapters own preview/export conversion from signal
  refs to textures, geometry, tables, or diagnostic surfaces.
- project schema may import pure signal DTOs only if those DTOs remain
  runtime-free; otherwise mirror them into project schema.

Gates:

- `P1B_SIGNAL_DTO_RUNTIME_FREE`
- `P1B_UNIVERSAL_IMPORT_ROUTE_MATRIX`
- `P1B_NO_UNSUPPORTED_FILE_FALLBACK`
- `P1B_SIGNAL_PROJECT_ROUNDTRIP`
- `P1B_SIGNAL_TIMELINE_MATERIALIZATION_CONTRACT`
- `P1B_SIGNAL_PREVIEW_EXPORT_FALLBACK`

Checks:

- static runtime-handle scan for `src/signals/**` and signal project DTOs
- CSV import fixture
- binary fallback fixture
- at least one unknown-file project roundtrip fixture
- format matrix entry for each June-2026 target family

Do not:

- Do not solve universal import by adding one-off UI branches in Media Panel.
- Do not put `File`, `Blob`, DOM, GPU, worker, decoder, or renderer instances
  in signal DTOs.
- Do not treat binary fallback as the final CAD/PDF/SVG/3D renderer strategy.

### Phase 2 - Store And Runtime Ownership

Goal: make stores durable and predictable, while runtime handles move to
service-owned leases.

Current codebase signals:

- `getState()` usage outside stores is widespread:
  - `timelineCanvasSmoke`: 56
  - `MatAnyoneService`: 48
  - `torture`: 46
  - `aiTools/bridge`: 33
  - `SAM2Panel`: 32
  - `AudioMixerPanel`: 30
  - `Preview`: 27
  - `useEngine`: 25
  - `projectLoad`: 19
  - `RenderDispatcher`: 16
- runtime-handle-heavy files include GPU/render files, proxy/cache, thumbnails,
  audio recording/routing, WebCodecs, Native3D, and project file services.
- `historyStore.ts` and `dockStore.ts` are both over 1,700 LOC and mix durable
  state, migration, normalization, and app coordination.

Target shape:

- Stores own durable state and action application.
- Selectors live in focused selector modules.
- Command/planner logic lives outside stores.
- Runtime handles are owned by `services/mediaRuntime` or another explicitly
  approved runtime owner from the Phase 1A lease map.
- Project save/load works through schema/importer adapters, not live store
  implementation types.
- `getState()` outside stores is classified, not blindly counted:
  - sanctioned fresh reads in async callbacks may remain
  - controlled adapter/bridge reads are allowlisted
  - module-scope and render-path reads are reduction targets
  - render hot paths must use typed snapshots instead of live store reads

Concrete targets:

- `src/stores/dockStore.ts`: split migration/normalization, layout commands,
  selectors, and store facade.
- `src/stores/historyStore.ts`: split snapshot builders, FlashBoard history
  adapter, project/media/timeline snapshots, and undo/redo store facade.
- `src/stores/mediaStore/slices/fileManageSlice.ts`: split import planner,
  file runtime handling, folder operations, and durable slice actions.
- `src/stores/timeline/**`: keep the new timeline architecture direction, but
  finish runtime-handle removal and store facade narrowing after foundation.

Gates:

- `P2_DURABLE_STORE_BOUNDARY`
- `P2_RUNTIME_LEASE_OWNERS_DEFINED`
- `P2_GETSTATE_USAGE_CLASSIFIED`
- `P2_GETSTATE_MODULE_SCOPE_FORBIDDEN`
- `P2_HISTORY_AND_DOCK_SPLIT`
- `P2_PROJECT_HYDRATION_NOT_STORE_INTERNALS`
- `P2_STORE_PROJECT_CONTRACT_FREEZE`

Checks:

- `getState()` report by file and usage class
- allowlist for adapter/bridge `getState()` reads
- unit tests for dock normalization/migration
- history snapshot/restore tests ported away from internal god-object shape
- project save/load smoke

Do not:

- Do not reduce `getState()` by count alone; classify each usage first.
- Do not persist runtime leases, object URLs, DOM handles, GPU handles, or
  decoder/player instances in stores.
- Do not edit project schema or load/save internals from a store packet except
  through an approved hydration adapter packet.

### Phase 3 - Project Persistence And Migration Boundary

Goal: isolate old saved-project compatibility and make current project state
serializable, schema-owned, and independent from runtime/store implementation.

Current codebase signals:

- `src/services/project/projectLoad.ts`: 2,003 LOC, 28 fan-out, 19 `getState()`
  usages.
- `src/services/project/projectSave.ts`: 22 fan-out, serializes live stores,
  including FlashBoard.
- `src/services/project/ProjectFileService.ts`: 1,264 LOC and mixes browser
  FSA/native helper/raw/download/project file operations.
- `src/services/project/types/project.types.ts` includes `youtube` and
  `flashboard` persisted payloads.
- `src/services/project/types/project.types.ts` and related composition schema
  files currently import live store/engine/runtime-shaped types; this is a
  foundation violation, not just a project-service cleanup.
- old `youtube`, `download`, and `ai-video` panel types are saved-layout or
  migration targets, while active surfaces live in Media Panel.
- dock/layout data has both project-file persistence and local persisted UI
  state; the target owner must reconcile both.

Target shape:

- Project schema module owns persisted DTO shapes and imports no stores,
  components, engine modules, or live runtime services.
- Versioned importer/migration registry translates old payloads once at load
  boundary. This registry must be created; it is not already present as a clean
  subsystem.
- Store hydration adapters convert schema data to current durable store state.
- Runtime restore services own leases/object URLs/media handles after hydration.
- Download/YouTube legacy payloads are normalized into current Media Panel and
  timeline pending-download contracts.
- FlashBoard saved board/node data is split into active generation metadata and
  retired board-canvas compatibility.
- Project UI preferences, dock layout, Media Panel board layout, and direct
  localStorage project UI writes go through an explicit adapter.

Concrete targets:

- `projectLoad.ts`: split into schema validation, migration, media hydration,
  timeline hydration, FlashBoard hydration, dock/layout hydration, runtime
  restore.
- `projectSave.ts`: split into project schema builders by domain.
- `ProjectFileService.ts`: split FSA/native/raw/download operations by IO
  owner.
- `ProjectFlashBoardState`: move out of store types into project schema types
  with explicit importer mapping.
- `project.types.ts` and `composition.types.ts`: no imports from
  `src/stores/**`, `src/engine/**`, or `src/components/**`.
- direct project load/save localStorage sync: move behind
  `projectUiPreferences` or an equivalent project UI adapter.

Gates:

- `P3_PROJECT_SCHEMA_BOUNDARY`
- `P3_PROJECT_SCHEMA_NO_STORE_IMPORTS`
- `P3_PROJECT_VERSION_MIGRATION_REGISTRY`
- `P3_IMPORTER_LEGACY_QUARANTINE`
- `P3_FLASHBOARD_PERSISTENCE_SPLIT`
- `P3_DOWNLOAD_YOUTUBE_MIGRATION_ONLY`
- `P3_PROJECT_LOAD_SAVE_NO_DIRECT_LOCALSTORAGE`
- `P3_DOCK_LAYOUT_SINGLE_PERSISTENCE_OWNER`
- `P3_RUNTIME_HANDLE_ROUNDTRIP_GUARD`
- `P3_PROJECT_LOAD_SAVE_SMOKE`

Checks:

- project media persistence tests
- persisted project `structuredClone` and JSON roundtrip tests
- nested restore tests
- autosave recovery tests
- FlashBoard generation metadata save/load tests
- download pending clip migration tests
- old project fixture tests through the versioned migration registry

Do not:

- Do not import from `src/stores/**`, `src/components/**`, or `src/engine/**`
  inside project schema types.
- Do not normalize old saved data in multiple domain loaders; use the versioned
  migration registry.
- Do not delete deprecated `youtube`, `download`, or `ai-video` payload support
  before fixtures prove migration into current Media Panel/timeline contracts.

### Phase 4 - Media Panel And FlashBoard

Goal: turn the largest UI/service knot into a maintainable Media workspace and
active AI-generation contract.

Current codebase signals:

- `MediaPanel.tsx`: 6,095 LOC, 30 fan-out, 10 `getState()` usages.
- `MediaPanel.css`: 2,282 LOC.
- `FlashBoardComposer.tsx`: 3,901 LOC, 18 fan-out.
- `FlashBoard.css`: 3,502 LOC.
- `MediaAIGenerativeTray.css`: 931 LOC.
- active docs say FlashBoard is the Media Panel generation runtime, not a
  standalone AI-video tab.
- old dock panel types `ai-video`, `youtube`, and `download` are deprecated
  saved-layout targets.
- Media Panel board and FlashBoard board are not the same thing. The Media
  Panel board is an active media workspace surface; the old FlashBoard
  board/canvas/node workspace may be retired or migration-only.

Target shape:

- Media Panel shell:
  - panel chrome and top-level layout only
  - selected view/mode composition
  - no direct persistence/runtime allocation
- Media workspace modules:
  - folder tree
  - media grid/list
  - board overview or spatial media surface
  - board visual renderer for dense spatial media, connections, thumbnails,
    minimap, selection/marquee, and zoom/pan feedback
  - drag/drop and context menu
  - downloads tray
  - generation tray
  - import status/progress
- FlashBoard active contract:
  - generation request model
  - queue/job state
  - provider task adapter
  - media import metadata
  - pricing/catalog/prompt/chat services
- Retired FlashBoard board-canvas contract:
  - old node workspace CSS
  - viewport/selection/move/resize/duplicate state
  - reference-node canvas behavior
  - dock-level `ai-video` behavior

Concrete targets:

- `MediaPanel.tsx`: root shell below 700 LOC, most child files below 250 LOC.
- Media Panel board renderer: use a hybrid strategy. Keep controls, forms,
  context menus, accessibility, and low-frequency UI in DOM/React. Move dense
  board visuals to a canvas-backed renderer, and use `OffscreenCanvas`/worker
  rendering only when the Phase 0 board performance baseline proves that main
  thread DOM/canvas work is the bottleneck.
- `FlashBoardComposer.tsx`: split into provider/model picker, prompt editor,
  reference media strip, output settings, audio/music settings, queue submit,
  chat/refine controls, and runtime adapter.
- `FlashBoard.css`: split active tray/composer CSS from retired board/node CSS;
  delete retired CSS only after class usage scan and ledger entries.
- `flashboardStore`: split active generation state from retired board workspace
  compatibility; project importer owns old board state if kept.
- Media Panel board persistence: classify and keep as active project/UI
  preference behavior, separate from retired FlashBoard board-canvas state.
- FlashBoard services: split request planner, reference resolver, provider
  runner, queue/job state, and media import adapter so services do not reach
  directly into stores except through approved adapters.

Gates:

- `P4_MEDIA_PANEL_SHELL_SPLIT`
- `P4_MEDIA_STORE_SELECTOR_CONTRACT`
- `P4_FLASHBOARD_ACTIVE_CONTRACT`
- `P4_FLASHBOARD_PROVIDER_TASK_CONTRACT`
- `P4_FLASHBOARD_RETIRED_BOARD_LEDGER`
- `P4_MEDIA_BOARD_VS_FLASHBOARD_BOARD_CLASSIFIED`
- `P4_MEDIA_BOARD_RENDER_STRATEGY`
- `P4_MEDIA_BOARD_PROJECT_ROUNDTRIP`
- `P4_MEDIA_GENERATION_PROJECT_ROUNDTRIP`
- `P4_DOWNLOADS_ACTIVE_IN_MEDIA_PANEL`

Checks:

- Media Panel render smoke
- Media Panel board pan/zoom/selection smoke with FPS and input-latency
  thresholds
- board renderer fallback smoke for browsers without `OffscreenCanvas`
- import media smoke
- download tray smoke
- FlashBoard generate queue smoke with mocked provider
- generated-media import test
- project save/load roundtrip for generation metadata

Do not:

- Do not merge Media Panel board behavior with retired FlashBoard board/canvas
  behavior without a classification entry.
- Do not move Composer/forms/provider settings/chat controls to canvas. Canvas
  is for dense board visualization and interaction feedback, not normal UI.
- Do not require `OffscreenCanvas` as the only path; keep a main-thread canvas
  or DOM fallback unless browser support and smokes prove otherwise.
- Do not delete old FlashBoard CSS, node, viewport, selection, or z-order paths
  before class usage and migration ledger entries exist.
- Do not make FlashBoard services reach directly into stores except through
  approved adapters.
- Do not change project schema from this phase unless the Phase 3 adapter owns
  the write set.

### Phase 5 - Preview, Export, And Common UI

Goal: split mixed React/UI/runtime shells that currently coordinate too many
lifecycles.

Current codebase signals:

- `Preview.tsx`: 2,827 LOC, 31 fan-out, 27 `getState()` usages.
- Preview registers GPU/render targets and mutates render-target state from
  React setup/cleanup; treat it as render lifecycle code, not only UI.
- `SceneObjectOverlay.tsx`: 2,053 LOC.
- `MaskOverlay.tsx`: 1,267 LOC.
- `TextPreviewEditor.tsx`: 1,063 LOC.
- `ExportPanel.tsx`: 3,326 LOC.
- Export UI and `FrameExporter` both affect engine export mode, resolution,
  render-time overrides, readback, and zero-copy paths.
- `ExportPanel.css`: 1,151 LOC.
- large common CSS files: `authBillingDialogs.css` 1,878,
  `WhatsNewDialog.css` 1,360, `dock.css` 875, `SettingsDialog.css` 870.

Target shape:

- Preview:
  - canvas target registration
  - render target lifecycle
  - `RenderTargetSnapshot` input contract
  - source monitor
  - camera/input controller
  - overlay registry
  - focused overlay components
- Export:
  - preset/settings form
  - export job planner
  - `ExportRenderSession` transaction contract
  - progress/result view
  - WebCodecs/FFmpeg/GIF runner adapters
  - bounded or streaming frame delivery for memory-heavy export paths
  - debug/export smoke adapter
- Common UI/CSS:
  - component-scoped CSS files below budget
  - shared tokens/utilities only for real shared primitives
  - dialogs split by responsibility, not broad common sheets

Concrete targets:

- `Preview.tsx`: shell below 700 LOC with overlay registry and runtime adapter.
- `SceneObjectOverlay.tsx`, `MaskOverlay.tsx`, `TextPreviewEditor.tsx`: split
  geometry planning, interaction handlers, painters/views, and persistence
  adapters.
- `ExportPanel.tsx`: shell below 700 LOC; export runners outside component and
  behind an `AbortSignal`-friendly session/cancellation contract.
- Common CSS over 700 LOC split by component/domain.
- Preview/Export implementation waits for render snapshot and output-router
  contracts when touching engine export state, render-target store, Preview
  registration, or export runners.

Gates:

- `P5_PREVIEW_RUNTIME_BOUNDARY`
- `P5_RENDER_TARGET_SNAPSHOT_CONTRACT`
- `P5_PREVIEW_OVERLAY_REGISTRY`
- `P5_EXPORT_PANEL_RUNNER_BOUNDARY`
- `P5_EXPORT_RENDER_SESSION_CONTRACT`
- `P5_BOUNDED_MEMORY_EXPORT`
- `P5_EXPORT_SMOKE_PRESERVED`
- `P5_COMMON_CSS_BUDGET`
- `P5_CSS_GLOBAL_SELECTOR_AND_ZINDEX_GATE`

Checks:

- preview render smoke
- source monitor smoke
- overlay interaction tests
- debugExport smoke
- export unit tests
- visual/CSS usage scan for deleted classes
- global selector, z-index tier, fixed overlay, and pointer-event scan

Do not:

- Do not edit Preview registration, render-target store, engine export mode, or
  export runners before the Phase 5/6 render contracts are frozen.
- Do not delete CSS classes without a usage scan and retired-class entry.
- Do not split overlays by visual order only; split geometry planning,
  interaction, painting/view, and persistence adapters.

### Phase 6 - Render, Audio, WebCodecs, Proxy, And Cache Hot Paths

Goal: split hot paths by lifecycle and ownership without regressing playback,
scrubbing, export, GPU, audio, or cache behavior.

Current codebase signals:

- `RenderDispatcher.ts`: 2,543 LOC, 41 fan-out, 24 runtime-handle hits.
- Render paths still read live stores during frame work; target state should use
  per-frame snapshots instead of mid-render store reads.
- `WebCodecsPlayer.ts`: 2,539 LOC, 37 runtime-handle hits.
- `WebGPUEngine.ts`: 1,113 LOC, 27 fan-out, 31 runtime-handle hits.
- `LayerCollector.ts`: 1,553 LOC.
- `NestedCompRenderer.ts`: 1,269 LOC.
- `proxyFrameCache.ts`: 3,266 LOC, 53 runtime-handle hits.
- `proxyFrameCache` mixes JPEG/image data, raw `VideoFrame`s, audio elements,
  audio buffers, object URLs, decoder creation, and scrub `AudioContext`
  ownership.
- `proxyGenerator.ts`: 1,427 LOC.
- `thumbnailRenderer.ts`: 1,198 LOC.
- `ClipAudioRenderService.ts`: 2,121 LOC.
- `AudioRecordingService.ts`: 2,058 LOC.
- `audioRoutingManager.ts`: 1,921 LOC.
- `AudioEffectRenderer.ts`: 2,011 LOC.

Target shape:

- Render:
  - `RenderFrameSnapshot`
  - `RenderTargetSnapshot`
  - `RenderOutputRouter`
  - frame request planner
  - layer collection
  - render target routing
  - effect/compositor dispatch
  - nested comp handling
  - diagnostics/stats
- WebCodecs:
  - source open/close lifecycle
  - `VideoFrameLease` or explicit borrow/clone/close contract
  - frame cache with ownership rules
  - seek/playback state
  - decode scheduling
  - error recovery
- Proxy/cache/thumbnail:
  - cache key policy
  - storage owner
  - frame extraction
  - coalesced or batched decode provider instead of per-frame decoder churn
  - object URL revoke accounting
  - `VideoFrame` close accounting
  - thumbnail render
  - cleanup/eviction
- Audio:
  - audio context ownership map
  - live playback routing owner
  - scrub audition owner
  - recording lifecycle
  - clip render planning
  - route graph ownership
  - export/offline rendering owner
  - diagnostics/compat owner
  - effect renderer registry
  - export audio pipeline

Concrete targets:

- Do not begin these splits before Phase 0 smokes exist.
- Each hot-path split must name the invariant preserved:
  - frame identity
  - seek consistency
  - GPU resource lifetime
  - object URL lifetime
  - audio graph route consistency
  - audio context lifetime
  - export frame/audio sync
  - cache eviction correctness
  - `VideoFrame` close/borrow correctness
  - object URL revoke correctness
  - HMR-safe runtime owner behavior

Gates:

- `P6_RENDER_FRAME_SNAPSHOT`
- `P6_RENDER_OUTPUT_ROUTER`
- `P6_RENDER_DISPATCHER_OWNERSHIP_SPLIT`
- `P6_WEBCODECS_LIFECYCLE_SPLIT`
- `P6_VIDEOFRAME_LEASE_CONTRACT`
- `P6_PROXY_CACHE_OWNER_DEFINED`
- `P6_PROXY_CACHE_CLOSE_REVOKE_ACCOUNTING`
- `P6_PROXY_DECODER_COALESCING`
- `P6_THUMBNAIL_PROXY_BOUNDARY`
- `P6_AUDIO_CONTEXT_OWNERSHIP_MAP`
- `P6_AUDIO_RECORDING_AND_ROUTE_BOUNDARY`
- `P6_SCRUB_AUDIOCONTEXT_DISPOSED`
- `P6_EXPORT_AUDIO_SYNC_GUARD`

Checks:

- playback trace smoke
- scrub/seek smoke
- proxy cache pressure smoke
- audio context baseline smoke
- render dispatcher unit tests
- WebCodecs player tests
- proxy frame cache tests
- thumbnail tests
- audio render tests
- export frame/audio sync smoke

Do not:

- Do not start hot-path splits before Phase 0 playback/export/proxy/audio
  smokes have thresholds.
- Do not close or transfer `VideoFrame`, object URL, GPU, or audio resources
  without accounting checks.
- Do not let render paths read live stores during frame work once snapshot
  contracts exist.
- Do not combine live playback, scrub audition, recording, and export audio
  ownership in one manager without an ownership-map exception.

### Phase 7 - AI Tools, Dev Bridge, Guided Actions, And Smokes

Goal: keep AI/dev tooling powerful while preventing it from defining product
architecture.

Current codebase signals:

- `src/services/aiTools`: 18,008 LOC.
- `aiTools/index.ts`: 568 LOC.
- `aiTools/handlers/index.ts`: 575 LOC.
- `aiTools/bridge.ts`: 2,995 LOC.
- `timelineCanvasSmoke.ts`: 3,110 LOC.
- `torture.ts`: 46 `getState()` usages.
- AI bridge touches project service, HMR, execution, policy, debug export,
  project patching, and smoke plumbing.

Target shape:

- product AI tool execution
- caller policy/permissions
- guided replay orchestration
- handler registry
- dev bridge transport
- debug/smoke handlers
- browser/HMR bridge diagnostics
- smoke contracts reusable by refactor gates

Concrete targets:

- `aiTools/bridge.ts`: split transport, browser HMR client, request parsing,
  debug handlers, project debug helpers, and status/presence.
- `timelineCanvasSmoke.ts`: split into fixture setup, canvas assertions, user
  action simulation, and reporting.
- `aiTools/index.ts`: execute facade only; handler registry and policy stay
  separate.
- Dev-only code must not import product internals except through approved test
  and bridge contracts.
- Existing bridge handlers such as `getStats`, `getPlaybackTrace`,
  `debugExport`, and timeline canvas smokes become Phase 0 gate commands with
  thresholds before bridge source cleanup starts.

Gates:

- `P7_AI_TOOL_EXECUTION_FACADE`
- `P7_DEV_BRIDGE_QUARANTINED`
- `P7_SMOKE_HANDLERS_SPLIT`
- `P7_PHASE0_SMOKES_STABLE`
- `P7_GUIDED_ACTION_BOUNDARY`
- `P7_POLICY_REGISTRY_STABLE`

Checks:

- AI tool policy tests
- bridge status/list tests
- timeline canvas smoke tests
- guided action compiler/runtime tests
- debugExport bridge smoke

Do not:

- Do not delete bridge or smoke coverage before replacement gates exist.
- Do not let dev-only bridge transport define product architecture contracts.
- Do not broaden product internals to satisfy a bridge handler; add an approved
  test/bridge adapter instead.

### Phase 8 - Test Suite Refactor And Architecture Gates

Goal: make tests support the new architecture instead of preserving old god
objects.

Current codebase signals:

- large tests over 1,500 LOC include:
  - `projectMediaPersistence.test.ts`: 3,622
  - `timelineArchitectureRegistry.test.ts`: 3,074
  - `clipSlice.test.ts`: 2,554
  - `timelineEditOperations.test.ts`: 2,312
  - `fileManageSlice.test.ts`: 2,284
  - `serializationNestedRestore.test.ts`: 1,995
  - `layerBuilderService.test.ts`: 1,975
  - `addCompClipNestedRestore.test.ts`: 1,963
  - `layerCollector.test.ts`: 1,920
  - `keyframeSlice.test.ts`: 1,878

Target shape:

- tests move with behavior, not old filenames
- architecture gates cover import direction, runtime-free schemas, LOC budgets,
  retired path classification, and smoke availability
- large tests split by user behavior or contract
- tests that only assert retired implementation details are deleted after
  replacement coverage exists

Gates:

- `P8_TEST_MIGRATION_LEDGER_COMPLETE`
- `P8_LOC_BUDGET_GATE`
- `P8_IMPORT_BOUNDARY_GATE`
- `P8_RUNTIME_FREE_SCHEMA_GATE`
- `P8_RETIRED_PATH_GATE`
- `P8_SMOKE_COVERAGE_GATE`

Checks:

- targeted migrated tests per domain
- architecture gate suite
- full build/lint/test only at normal commit/merge/readiness points

Do not:

- Do not keep tests that assert obsolete god-object internals after a new
  public contract owns the behavior.
- Do not delete large tests only to satisfy LOC budgets; split, port, replace,
  or explicitly retire them with coverage notes.
- Do not mark an architecture gate closed until it is executable or has an
  accepted temporary exception with owner and expiry.

## Dependency Order

The master orchestrator should execute in this order:

1. Phase 0 baseline and gates.
2. Phase 1 foundation contracts.
3. Phase 1A clip/media-source data versus runtime split.
4. Phase 1B Universal Signal foundation and format matrix.
5. Combined Phase 2/3 contract freeze for stores, project schema, project
   persistence, importers, history, FlashBoard persistence, and runtime leases.
6. Phase 2 store/runtime ownership implementation packets.
7. Phase 3 project persistence/importer implementation packets.
8. Phase 4 Media Panel and FlashBoard.
9. Phase 5 Preview, Export, and Common UI.
10. Phase 6 Render, Audio, WebCodecs, Proxy, Cache.
11. Phase 7 AI tools/dev bridge/smokes.
12. Phase 8 test suite and architecture gates.

Phase 4 and Phase 5 can overlap only after Phase 1A and the combined P2/P3
contract freeze are accepted. Phase 5 and Phase 6 must be sequenced whenever
they touch engine export state, render target store, Preview registration,
render snapshots, output routing, or export runners. Phase 7 can start earlier
for read-only smoke inventory, but bridge source edits should wait until the
product contracts it calls are stable.

## First Orchestrator Execution Wave

The first real execution wave should still be read-only, but it is concrete
codebase work, not meta-planning.

Run up to 6 agents:

1. Foundation map agent
   - read `src/types`, `src/stores`, `src/services/project/types`,
     `src/services/mediaRuntime`, `src/signals`, and `src/importers`
   - output target type tiers, store facades, forbidden runtime handles, and
     Phase 1A clip/media runtime split plus Phase 1B signal DTO constraints
2. Store/runtime agent
   - read `src/stores`, `src/hooks/useEngine.ts`, high `getState()` hotspots
   - output runtime lease owners and `getState()` usage classification plan
3. Project/importer agent
   - read `src/services/project`, project feature docs, FlashBoard persistence
   - output project schema/importer split, versioned migration registry plan,
     localStorage/UI-preferences adapter, and migration ledger candidates
4. Media/FlashBoard agent
   - read `MediaPanel`, `mediaStore`, `FlashBoardComposer`, FlashBoard services
   - output active contract, shell split, Media Board versus FlashBoard Board
     classification, retired board/canvas paths
5. Preview/export/UI agent
   - read Preview, ExportPanel, overlays, dock/common CSS
   - output render-target snapshot dependency, export session contract, and CSS
     global/z-index/retired-class split plan
6. Hotpath/smoke agent
   - read RenderDispatcher, WebCodecsPlayer, proxy/cache, audio, aiTools smokes
   - output performance-smoke matrix, audio context ownership map, proxy/cache
     close/revoke gates, and hot-path split invariants

The orchestrator then synthesizes these findings into this plan, the checklist,
and the first implementation packets.

## Lane Records

The plan should track at least these lanes:

- Foundation contracts: type tier, barrels, dependency map, runtime-free shared
  contracts.
- Universal signals and importers: signal DTOs, universal import route matrix,
  artifact storage, timeline materialization, preview/export fallback, and
  renderer/runtime adapter boundary.
- Store architecture: timeline, media, history, dock, settings, render targets,
  selectors, commands, IO, runtime leases.
- Project persistence: load/save, importers, hydration, autosave, history,
  artifacts, migration-only project data.
- Media Panel and media store: panel shell, board/grid/tray composition,
  subscriptions, generated media, imports, persistence.
- FlashBoard and AI generation: active generation request, queue/job state,
  provider task, media import, prompt/pricing/catalog/chat services.
- Preview: target canvas registration, overlays, camera/input, source monitor,
  render-target lifecycle.
- Export: UI shell, runners, progress, audio/GIF/WebCodecs/FFmpeg boundaries.
- Audio: recording, analysis, routing, engine, mixer, proxies, lifecycle.
- Render/core/codecs: WebGPU/WebCodecs, dispatcher, players, cache ownership,
  hot-path invariants.
- Proxy/thumbnail/cache/media runtime services.
- AI tools/dev bridge/guided actions/smoke handlers.
- Common UI/dock/toolbar/dialogs/CSS architecture.
- Tests, scripts, tools, and diagnostics where they shape architecture.

Each lane must record:

- current contract
- target contract
- intended write set
- forbidden files
- high-conflict files
- exit gates
- focused checks
- performance or runtime invariants
- retired paths
- test migration classification

## FlashBoard Legacy Position

FlashBoard should be an early lane inside the whole-codebase plan, not a
separate unplanned cleanup before the plan.

The old dock-level `AI Generative` / `ai-video` tab appears to be
migration-only:

- `ai-video` remains in the dock panel type union as a deprecated saved-layout
  migration target.
- `DockPanelContent` no longer renders an `ai-video` panel.
- Toolbar and dock add/change menus filter deprecated panel types.

Likely retired or migration-only candidates:

- old `.flashboard-workspace`, `.flashboard-toolbar`, `.flashboard-canvas*`,
  `.flashboard-node*`, resize, drag, and context-menu CSS
- `selectedNodeIds`
- `viewMode: 'board'`
- board `viewport`
- node `position` and `size`
- `createReferenceNode`
- `moveNode`
- `resizeNode`
- `duplicateNode`
- old z-order actions

Still-active pieces that must not be deleted blindly:

- `MediaAIGenerativeTray` and `useFlashBoardRuntime`
- `FlashBoardComposer`
- `MediaAIGenerationQueue`
- `FlashBoardJobService`
- `FlashBoardMediaBridge`
- pricing, catalog, prompt refinement, and chat services
- project save/load/history persistence for generation state and metadata

Active contract:

```text
media generation request -> queue/job state -> provider task -> media import
```

Everything outside that active contract should be classified as retained target
architecture, migration-only compatibility, or retired legacy.

## Canvas And Performance Rule

Do not convert UI to canvas by default.

Reuse the timeline rendering method only where there is a real hot path or a
measured DOM update bottleneck, such as dense visual timelines, board/preview
drawing, or large interactive visual surfaces.

Composer, form, settings, toolbar, and command UI should remain normal
React/DOM unless the baseline proves otherwise.

Render/core/WebCodecs/audio/export work must start from performance baselines
and smoke gates. Splitting a hot-path file is not success unless lifecycle
ownership, cache ownership, and runtime invariants improve.

## AI Bridge And Smoke Quarantine

`aiTools/bridge.ts` and dev smoke/torture files are architecture debt, but they
also protect current behavior.

Plan rule:

- do not delete or shrink verifier surfaces before replacement smokes exist
- separate product architecture from dev-only bridge policy
- record which smoke or bridge handler proves each refactor gate
- classify bridge-only behavior as verifier, product behavior, or retired
  diagnostic path

## Execution Readiness Gate

Before a source implementation packet starts, the orchestrator must have:

- lane order and dependency graph
- current and target contracts for all shared foundations
- write sets and forbidden files for every lane
- high-conflict ownership for shared hubs
- executable gates and focused checks
- runtime invariants and lease ownership
- baseline metrics and performance guardrails
- retired-path ledger entries
- test-migration ledger entries
- stale-doc and migration-only-data decisions
- skeptical review findings and accepted/rejected changes
- orchestrator-ready worker packets for the first execution wave
- max-6 parallel scheduling plan with conflicts and sequencing notes

A plan that only lists god objects, LOC targets, or file splits is incomplete.
It must name the coupling reduced and the check that proves it.

## Parallel Agent Use

Parallel agents should be used in both planning and execution when the work can
be split cleanly. The master orchestrator decides the wave, assigns packets,
and integrates the results.

Allowed parallel waves:

- planning and baseline scans
- contract/design reviews
- implementation packets with disjoint write sets
- verification packets that run gates, smokes, tests, and diff review
- cleanup/classification packets for tests, retired paths, CSS, and docs

Use up to 6 parallel worker agents when useful. Parallelism is encouraged for
separate domains such as Foundation, Project, Media/FlashBoard, Preview/Export,
Render/Audio/Proxy, and AI Tools, but only after shared contracts and forbidden
files are clear.

Do not parallelize packets that touch the same shared hub or unresolved
contract. These must be sequenced:

- shared type tier and `src/types/index.ts`
- project schema/load/save/importers
- media runtime lease owner
- timeline/media/history/dock store facades
- render target lifecycle and engine export state
- `RenderDispatcher`, `WebGPUEngine`, `Preview`, `ExportPanel`
- `MediaPanel`, `mediaStore`, `FlashBoardComposer`, FlashBoard persistence
- AI bridge and smoke handler registries

Every worker packet must state:

- lane
- mode: read-only, implementation, or verification
- read set
- allowed write set
- forbidden files
- current contract
- target contract
- expected gates/checks
- expected report
- stop conditions

Implementation workers must not broaden scope when they discover extra debt.
They report it and let the orchestrator schedule a new packet.

## Immediate Next Step

Begin execution with bounded preflight packets:

1. Refresh baseline counts and add reproducible commands.
2. Add exact gate/static-check names and smoke thresholds.
3. Add high-conflict write sets and forbidden files per phase.
4. Add orchestrator-ready first implementation packets.
5. Run one final skeptical review after those details are added.
6. Start the first source implementation packet only after its write set,
   forbidden files, and gate/check are explicit.
