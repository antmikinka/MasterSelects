# MasterSelects Agent Instructions

Repository instructions for Codex, Claude, and other coding agents working on MasterSelects.

`AGENTS.md` and `CLAUDE.md` are intentionally identical. When workflow, branch rules, debug recipes, or project conventions change, update both files to the same content.

---

## -1. Working Principle / Top Memory

Never assume that you are the only person or agent working in the current branch. Treat all unrelated changes as someone else's active work: never revert, overwrite, clean up, reformat, or otherwise undo changes you did not make unless the user explicitly asks for that exact operation.

MasterSelects is not optimized for short-term fixes. Because this project can move very quickly with AI-powered development and currently has no external users blocked by changes, large and correct architectural decisions are explicitly allowed and preferred.

Default behavior: think long term, build the real target architecture, do not build MVPs, mocks, throwaway prototypes, or small temporary solutions when the robust solution is directly reachable. Use short-term hacks only when the user explicitly requests them or when a hard technical blocker leaves no better implementation path.

---

## 0. Project Goal

By June 2026, MasterSelects should support all media files, not only video, audio, and images, but genuinely everything:

- 3D: OBJ, FBX, glTF
- Documents: PDF, SVG
- CAD / technical data: DXF, STEP
- Data formats: JSON, CSV, binary formats, point clouds, and more

The inspiration is the TouchDesigner principle: every file becomes a visual signal. There are no "unsupported" files. Everything becomes texture, geometry, or data, can be placed on the timeline, composited, and exported.

---

## 1. Command Modes

### Fast Commands

Fast commands are explicit exceptions to the normal check, push, merge, documentation, and versioning rules. When the user says one of these exact commands, follow this section even if other sections would normally require checks.

#### `fast commit`

Use when the user says `fast commit`.

1. Stage everything in the current worktree, including untracked files: `git add -A`.
2. Commit without running build, lint, tests, or targeted checks.
3. Do not require documentation updates.
4. Do not bump versions or update changelog.
5. Use the user's supplied commit message if present; otherwise derive a concise message from the diff.

#### `fast push`

Use when the user says `fast push`.

1. If the worktree is dirty, perform `fast commit` first.
2. Push the current branch.
3. If the branch has no upstream, push with upstream: `git push -u origin <branch>`.
4. Do not run build, lint, tests, or targeted checks.
5. Do not require documentation, version, or changelog updates.

#### `fast merge`

Use when the user says `fast merge`.

1. Remember the current source branch.
2. If the worktree is dirty, perform `fast commit` first.
3. Push the current source branch, setting upstream if needed.
4. Fetch `origin`.
5. Switch to local `master`.
6. Bring local `master` to `origin/master`.
7. Merge the source branch directly into `master`.
8. Push `master` directly to `origin/master`.
9. Do not create a PR.
10. Do not go through `staging` unless `staging` is the source branch.
11. Do not wait for GitHub checks.
12. Do not run build, lint, tests, or targeted checks.
13. Do not bump versions or update changelog.
14. If a merge conflict occurs, stop and report the conflict. Do not auto-resolve by guessing.

### Normal Commands

Any commit, push, merge, release, or readiness request that does not explicitly use a `fast ...` command follows the normal rules:

- Run `npm run build`, `npm run lint`, and `npm run test` before commit, release, merge, or final commit readiness.
- Do not commit if build, lint, or tests fail.
- Update relevant docs in `docs/Features/` for feature, UI, workflow, architecture, or user-visible behavior changes.
- Update version and changelog for normal merges to `master`.
- Do not repeat the full check chain if it already passed on the exact same HEAD after the latest changes. Reuse the latest successful check result and state that it was reused.

---

## 2. Branch, Commit, Push, And Merge Rules

### Branch Rules

| Branch | Purpose |
|---|---|
| `staging` | Development, default target for ongoing work |
| `master` | Production |

Normal rule: never commit directly to `master`, never merge to `master` independently, and never push independently unless the user explicitly asks for it.

Exceptions:

- `fast push`
- `fast merge`
- issue branches created through the Issue Handling Workflow
- direct user instructions that explicitly ask for commit, push, or merge

### Issue Handling Workflow

When taking over a GitHub issue, always use this flow:

1. Comment `I am on it` on the issue.
2. Assign the issue to `sportinger`.
3. Create a new Git branch for the issue and link it to the issue on GitHub.
4. Clone that branch into a new separate folder, then work from that folder so other agents can stay in their own working directories.
5. Implement the issue in that branch folder.
5.5 test and repeat till it works
6. Commit and push to the issue branch at the agent's discretion when the work is coherent and locally checked.
7. When the user says that everything works, merge the issue branch to `master` without waiting for GitHub checks.
8. After the merge, comment on the issue with the result.

This issue workflow is an explicit exception to the general "do not push independently" rule, but only for the created issue branch. Merging to `master` still requires the user's confirmation that everything works.

### Normal Test, Commit, And Push Rules

During ongoing work, test deliberately: choose relevant unit/smoke tests, build, or lint according to risk and change scope. The full suite is not required after every small intermediate change and should not be run routinely because of time/token cost.

Before every normal push, all checks are mandatory:

```bash
npm run build
npm run lint
npm run test
```

Rules:

- Prefer small, coherent changes.
- Do not commit if build, lint, or tests fail.
- Do not push unless the user explicitly asks, except for issue branches and fast commands.
- For feature changes, update relevant docs in `docs/Features/`.

### Normal Merge To Master

Only when the user explicitly requests a normal merge to `master`:

1. Make sure required checks have passed for the exact HEAD being merged.
2. If checks already passed on the same HEAD after the latest changes, do not rerun them.
3. Bump the release version in all required version locations.
4. Update changelog/release notes.
5. Commit and push.
6. Create and merge a PR from the source branch to `master`, unless the user explicitly asks for a direct merge.
7. Bring `staging` back to the current `master` state when the normal workflow uses `staging`.

---

## 3. Version And Changelog Locations

When intentionally bumping the release version, check all of these:

- `src/version.ts`
  - `APP_VERSION`
  - `FEATURED_VIDEO.banner.title` if it contains the version
  - `FEATURED_VIDEO.banner.message` if it names the release
  - `BUILD_NOTICE.title` if it contains the version
  - `BUILD_NOTICE.message` if it names the release
- `src/changelog-data.json`
  - add release notes / changelog entries at the beginning when a normal release or normal merge requires them
- `package.json`
  - top-level `"version"`
- `package-lock.json`
  - top-level `"version"`
  - `packages[""].version`

Before a normal release, verify version consistency with a targeted search:

```bash
rg -n "APP_VERSION|MasterSelects [0-9]+\\.[0-9]+\\.[0-9]+|\"version\": \"[0-9]+\\.[0-9]+\\.[0-9]+\"" src package.json package-lock.json
```

Fast commands do not bump versions and do not update changelog unless the user explicitly adds that request.

---

## 4. Codex Skill Mapping

The old Claude commands under `C:\Users\admin\.claude\commands\` should be represented in Codex through skills. If the following skills are available, prefer them:

| Claude Command | Codex Skill | Purpose |
|---|---|---|
| `/masterselects` | `masterselects` | Timeline, clip, preview, and analysis actions through the local AI bridge |
| `/cloudflare` | `cloudflare-api` | Cloudflare REST / Wrangler |
| `/stripe` | `stripe-api` | Stripe REST API |
| `/vazer` | `vazer-app-api` | Local VAZer app / XML / analysis |
| `/react-doctor` | `react-doctor` | React codebase analysis |
| `/nano-banana` | `nano-banana` | Image generation via Gemini |
| `/kie` | `kie-ai-api-route` | Kie.ai image and video generation |
| `/kling` | `kling` | Kling video prompting / API |
| `/tasks` | `tasks` | Task list |
| `/email` | `email` | Strato / OX mail |
| `/gmail` | `gmail` | Gmail via IMAP/SMTP |
| `/dienstplan` | `dienstplan` | Duty roster PDF -> calendar |

If a skill is not available, work directly through local scripts, MCP tools, the HTTP bridge, or APIs. Do not get stuck on Claude command files.

---

## 5. MasterSelects Debug Bridge

For app debugging, local AI tools exist behind `POST http://localhost:5173/api/ai-tools`. Prerequisite: the dev server is running and the app is open in a browser.

| Tool | Parameters | Purpose |
|---|---|---|
| `getStats` | none | Engine snapshot: FPS, timing, decoder, drops, audio, GPU |
| `getStatsHistory` | `samples?`, `intervalMs?` | Multiple snapshots with min/max/avg |
| `getLogs` | `limit?`, `level?`, `module?`, `search?` | Retrieve filtered browser logs |
| `getPlaybackTrace` | `windowMs?`, `limit?` | WebCodecs and VF pipeline events plus health state |
| `debugExport` | `startTime?`, `endTime?`, `durationSeconds?`, `width?`, `height?`, `fps?`, `includeAudio?`, `exportMode?`, `download?`, `maxRuntimeMs?` | Dev-bridge-only export probe in the real browser. Calls `FrameExporter` and returns blob size, progress, engine state, and export/GPU logs. |

The `masterselects` skill is the preferred entry point. If the skill cannot be used, call the HTTP bridge directly with `curl` or PowerShell.

### Export Debug Through Bridge

When export hangs or fails in the UI, first reproduce it in the real browser through the bridge. The local dev-bridge POST needs the bearer token from `.ai-bridge-token`:

```powershell
$token = Get-Content -Path .ai-bridge-token -Raw
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }

$body = @{ tool = 'getStats'; args = @{} } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri 'http://localhost:5173/api/ai-tools' -Method Post -Headers $headers -Body $body
```

Smoke test without download:

```powershell
$body = @{
  tool = 'debugExport'
  args = @{
    startTime = 0
    durationSeconds = 1.0
    width = 640
    height = 360
    fps = 15
    includeAudio = $false
    exportMode = 'fast'
    download = $false
    maxRuntimeMs = 25000
  }
} | ConvertTo-Json -Depth 6
Invoke-RestMethod -Uri 'http://localhost:5173/api/ai-tools' -Method Post -Headers $headers -Body $body
```

Full timeline test with current export defaults:

```powershell
$body = @{ tool = 'debugExport'; args = @{ includeAudio = $true; exportMode = 'fast'; download = $false } } | ConvertTo-Json -Depth 6
Invoke-RestMethod -Uri 'http://localhost:5173/api/ai-tools' -Method Post -Headers $headers -Body $body
```

Interpretation:

- `debugExport` is intentionally not a chat/public tool. It is a self-registered dev-bridge handler with policy access for `devBridge`, `console`, and `internal`.
- `maxRuntimeMs` cleanly aborts browser export before the dev-bridge request hangs. Raise it deliberately for long exports.
- If `debugExport` returns a blob with `size > 0`, the browser export path basically works. Then investigate UI issues in `ExportPanel`, download handling, preset state, or progress state.
- If logs show `WebGPU device lost during export` and `getStats` afterwards reports `renderLoop.isRunning=false`, `renderDispatcher=null`, or `targetCanvasCount=0`, the browser engine is in a stale device state. First run `reloadApp`/hard reload through the bridge or reload the browser, then test again.
- Windows warnings about `requestAdapter(powerPreference)` and NativeHelper WebSocket errors are not automatically export blockers. NativeHelper matters only when the tested path actually needs it.
- For timelines with video-only clips, `FrameExporter` must skip audio. A long start at "Rendering audio" points to broken audio range detection.

---

## 6. Check Budget And Repo Memory

`AGENTS.md` and `CLAUDE.md` are the durable project memory for coding agents. Do not assume an agent has hidden persistent memory for this repo; important workflow rules belong here.

During normal implementation, check sparingly: run targeted unit/smoke tests, individual builds, or lint only when risk and change scope justify it. Do not run full `npm run build`, `npm run lint`, and `npm run test` after every small edit. That full check chain is mandatory before normal commit, release, merge, or when the user explicitly asks for final commit readiness.

Large command outputs are token- and time-expensive. For intermediate status, report short summaries and relevant error lines instead of repeating complete logs.

For longer Codex/agent work, run the local usage watcher when practical:

```bash
npm run codex:usage:watch
npm run codex:usage
npm run codex:usage:stop
```

The watcher writes local reports to `.codex-usage/`, which stays local and is gitignored.

---

## 6A. Timeline Refactor Agent Execution Protocol

This section applies when working on the timeline system refactor described in:

- `docs/refactor/timeline-system-agent-plans/cross-team-final-synthesis.md`
- `docs/refactor/Timeline-System-Refactor-Plan.md`
- `docs/refactor/Timeline-System-Refactor-Handoff.md`

The refactor goal is the clean long-term architecture, not compatibility
preservation and not a minimum-risk patch. Risk and churn are acceptable when
they move toward the agreed architecture.

### Required Read Before Editing

Before editing timeline refactor code, every main agent and spawned agent must
read:

1. `docs/refactor/timeline-system-agent-plans/cross-team-final-synthesis.md`
2. `docs/refactor/Timeline-System-Refactor-Handoff.md`
3. The current lane/gate/debt files if they already exist:
   - `src/timeline/architecture/gateRegistry*`
   - `src/timeline/architecture/laneWriteManifest*`
   - `src/timeline/architecture/adapterDebtLedger*`
   - `src/timeline/architecture/exitCriteriaCoverage*`
   - `src/timeline/architecture/testMigrationLedger*`
   - `src/timeline/architecture/retiredPathLedger*`

If those architecture registry files do not exist yet, the first implementation
packet is to create them and the `P1_ARCHITECTURE_REGISTRY_COHERENT` test before
large code movement.

The first packet is not complete with registry shape alone. Before broad
timeline implementation starts, the P1 suite must also include and pass:

- `P1_KERNEL_IMPORT_BOUNDARY`
- `P1_LOC_BUDGET_ENFORCED`
- `P1_SCHEMA_RUNTIME_FREE_BOUNDARY`
- `P1_VISUAL_DEMAND_NAME_ISOLATED`
- `P1_HIGH_CONFLICT_OWNERSHIP_COMPLETE`
- `P1_TEST_AND_RETIRED_PATH_CLASSIFICATION`

### Parallel Agent Rules

Parallel agents are encouraged only when write sets are disjoint.

- One owner per high-conflict file at a time:
  - `src/components/timeline/Timeline.tsx`
  - `src/components/timeline/TimelineTrack.tsx`
  - `src/components/timeline/TimelineClipCanvas.tsx`
  - `src/components/timeline/types.ts`
  - `src/components/timeline/hooks/useExternalDrop.ts`
  - `src/stores/timeline/clipSlice.ts`
  - `src/stores/timeline/keyframeSlice.ts`
  - `src/stores/timeline/editOperations/**`
  - `src/stores/timeline/trackSlice.ts`
  - `src/stores/timeline/helpers/blobUrlManager.ts`
  - `src/services/layerBuilder/VideoSyncManager.ts`
  - `src/services/layerBuilder/AudioTrackSyncManager.ts`
- A spawned agent must state its lane, intended write set, forbidden files, and
  expected gate/test output in its initial response or handoff note.
- A verifier lane may touch tests, docs, and diagnostics only unless explicitly
  assigned implementation files.
- If two lanes need the same high-conflict file, sequence them. Do not resolve by
  racing edits.
- Ownership transfers happen through the lane manifest once it exists; before
  that, record them in `Timeline-System-Refactor-Handoff.md`.

### No-God-Object Rule

Do not create a new large central object while removing the old ones.

Timeline refactor files should follow these targets unless a gate explicitly
allows an exception:

- React host components: target <= 400 LOC; root shell <= 700 LOC.
- Pure builders/planners: target <= 250 LOC per file.
- Paint modules: target <= 200 LOC per facet/painter file.
- Contributor/registry modules: target <= 300 LOC per source/capability module.
- Coherence envelopes such as `buildTimelineFrame`: composition-only, target
  <= 80 LOC, no per-clip feature logic.
- No broad `helpers.ts`, `utils.ts`, `viewModel`, or stateful
  `timelineCommandBus` dumping grounds.
- No source-kind switches outside registered contributors/capabilities.

When a file must exceed a target temporarily, record it in the adapter/debt
ledger or handoff with owner, delete/split gate, and focused checks.

### Retired/Unused Code Rule

During the timeline refactor, old unused code is a removal target. Do not leave
legacy render, runtime, restore, callback, geometry, or compatibility paths as
quiet fallback code after the new path owns the behavior.

Classify every retired path touched by the refactor as one of:

- `delete now`: remove it in the current slice.
- `delete at gate`: keep temporarily with owner, write set, introduced phase,
  delete gate, and replacement coverage.
- `move to importer`: old-project compatibility only, isolated at the load
  boundary.
- `keep`: still part of the target architecture, with a named reason.

This applies to `CanvasClip` adapters, passive render helpers, duplicated
worker/main painter logic, scattered manual geometry mapping, direct callback
plumbing superseded by command planners, runtime-bearing restore/source
compatibility in editor paths, stale refactor docs, and orphan tests that only
assert deleted compatibility behavior.

### Timeline Test Migration Rule

Tests move with behavior, not retired filenames. For each affected old test,
classify it as:

- `port`: same user-visible behavior rewritten against new contracts/hosts.
- `replace`: old implementation assertion replaced by a gate, parity, or
  integration test for the new architecture.
- `split`: test contains both target behavior and rejected legacy internals;
  port/replace target behavior and delete legacy assertions at the owning gate.
- `delete`: test only protects removed compatibility, fallback, adapter, or
  legacy internals.
- `keep`: still valid target behavior and not coupled to retired internals.

Do not preserve tests that force the new architecture to keep rejected legacy
paths. Do not delete user-visible behavior coverage until it is ported or
replaced by a focused gate/parity test.

### Check Budget For Timeline Refactor

During timeline refactor implementation, do not run broad checks just to be
safe. Run the narrowest checks that prove the gate or changed code.

Use this order:

1. Gate-specific tests named in the current phase.
2. Unit tests for touched builders, contracts, hosts, stores, or services.
3. Touched-file ESLint only when moving or changing lint-sensitive React/TS.
4. `npx tsc -p tsconfig.app.json --noEmit --pretty false` only when changing
   public TS contracts, module boundaries, imports, or cross-lane types.
5. Browser/AI-bridge smokes only when changing rendering, worker handoff,
   hit-testing, playback, export, or project-load behavior.
6. Full `npm run build`, `npm run lint`, and `npm run test` only before normal
   commit, push, merge, release, final commit readiness, or when the user
   explicitly asks for them.

Do not repeat a broad check chain when it already passed on the exact same HEAD
after the latest changes. Reuse the result and say so.

If a higher-priority instruction requires broader checks, follow it, but record
why the broader check was run. Otherwise this section is the repo-specific rule
that prevents repetitive build/test cycles during the refactor.

### Handoff Requirements

At the end of any timeline refactor slice, update
`docs/refactor/Timeline-System-Refactor-Handoff.md` with:

- one-line progress marker in the form
  `Progress: <lane> <percent>% | Gate: <gate> | Status: <blocked/active/done>`
- lane name and owner
- files changed
- gates satisfied, still active, or retired
- exact checks run and their result
- checks deliberately skipped and why
- adapter debt added or removed
- retired paths deleted, moved, kept, or left as debt
- tests ported, replaced, deleted, kept, or split
- high-conflict file ownership changes
- next recommended slice

For spawned agents, the final response must include the same information in
short form, starting with the progress marker. If the agent only did research,
it must say which files it read and which decision it supports or challenges.

Keep handoff entries concise. Prefer compact bullets over explanation. Do not
paste full logs; cite the command and summarize the result. During longer
timeline-refactor runs, report the current progress marker to the user
regularly so the user can tell which lane/gate is moving without reading the
handoff file.

### Clean Rebuild Rule

Do not preserve legacy runtime/render paths inside the new timeline pipeline.
Old project support, if kept, belongs to a separate one-way importer at the load
boundary and must not leak into `src/timeline/**`, canvas hosts, worker draw
code, runtime allocation, or editor interaction.

Canvas cleanup is not the end of the timeline refactor. Runtime and store
cleanup must be tracked through later gates such as
`P4_RUNTIME_PROVIDER_DEMAND_ADOPTED`,
`P4_TIMELINE_STATE_RUNTIME_HANDLES_REMOVED`, and
`P4_IMPORTER_LEGACY_QUARANTINE`.

---

## 7. Quick Reference

```bash
npm install && npm run dev
npm run dev:changelog
npm run build
npm run build:deploy
npm run lint
npm run test
npm run test:watch
npm run test:unit
npm run test:ui
npm run test:coverage
npm run preview
```

### Dev Server Rules

- Default is `npm run dev`.
- Use `npm run dev:changelog` only when the changelog dialog is needed.
- Production builds show the changelog automatically.

### Native Helper

```bash
cd tools/native-helper
cargo run --release
```

Windows MSI builds bundle `yt-dlp.exe`; source builds and non-Windows archives use `yt-dlp` next to the helper binary or from `PATH`.

Ports:

- WebSocket: `9876`
- HTTP: `9877`

---

## 8. Architecture

Important areas:

- `src/components/`: React UI, Timeline, Panels, Preview, Docking, Export, Mobile
- `src/stores/`: Zustand stores for Timeline, Media, History, Settings, Dock, Slice, Render Targets, SAM2, Multicam, YouTube
- `src/engine/`: WebGPU rendering, Render Dispatcher, texture/audio/export/analysis pipeline
- `src/effects/`: GPU effects and shared shaders
- `src/transitions/`: GPU transitions
- `src/services/`: business logic such as Layer Builder, Media Runtime, Monitoring, Project Storage, AI Tools, Export
- `src/hooks/`, `src/utils/`, `src/types/`, `src/workers/`, `src/shaders/`

Especially central files:

- `src/engine/WebGPUEngine.ts`
- `src/engine/render/RenderDispatcher.ts`
- `src/stores/timeline/index.ts`
- `src/stores/mediaStore/index.ts`
- `src/stores/historyStore.ts`
- `src/services/layerBuilder/LayerBuilderService.ts`
- `src/services/logger.ts`
- `src/engine/featureFlags.ts`

More context is in `README.md` and `docs/Features/README.md`.

---

## 9. Critical Patterns

### HMR Singletons

Singletons such as Engine, FFmpegBridge, or SAM2 must survive HMR.

```ts
let instance: MyService | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.myService) {
    instance = import.meta.hot.data.myService;
  }
  import.meta.hot.dispose((data) => {
    data.myService = instance;
  });
}
```

### Avoid Stale Closures

In async callbacks, always read fresh state through `get()` or functional updates.

```ts
video.onload = () => {
  const current = get().layers;
  set({ layers: current.map(...) });
};
```

### Other Patterns

- Wait for `canplaythrough`, not only `loadeddata`.
- Prefer functional `setState` updates.
- Use lazy state initialization for expensive initialization.
- Use `toSorted()` instead of `sort()` to avoid mutation.
- All stores use `subscribeWithSelector`.
- `settingsStore` and `dockStore` also use `persist`.
- `mediaStore` uses a slice-creator signature that differs from Timeline.

---

## 10. Debugging And Logging

### Logger

```ts
import { Logger } from '@/services/logger';
const log = Logger.create('ModuleName');

log.debug('Verbose', { data });
log.info('Event');
log.warn('Warning', data);
log.error('Error', error);
```

### Browser Console Shortcuts

```js
Logger.enable('WebGPU,FFmpeg')
Logger.enable('*')
Logger.disable()
Logger.setLevel('DEBUG')
Logger.setLevel('WARN')
Logger.search('device')
Logger.errors()
Logger.dump(50)
Logger.summary()
```



### Playback Debugging

Available in the browser:

- `window.__WC_PIPELINE__`
- `window.__VF_PIPELINE__`

Useful log modules:

```js
Logger.enable('WebCodecsPlayer,PlaybackHealth,LayerCollector')
Logger.enable('VideoSyncManager,ParallelDecode,RenderLoop')
Logger.setLevel('DEBUG')
```

Important monitoring services in `src/services/monitoring/`:

- `playbackHealthMonitor`
- `playbackDebugStats`
- `framePhaseMonitor`
- `wcPipelineMonitor`
- `vfPipelineMonitor`
- `scrubSettleState`

When the dev server is running, prefer the AI bridge for repros:

- `simulateScrub`
- `simulatePlayback`
- `simulatePlaybackPath`
- `getPlaybackTrace`
- `getClipDetails`
- `reloadApp`

More details: `docs/Features/Debugging.md` and `docs/Features/Playback-Debugging.md`.

---

## 11. Render And Data Flow

Rough render path:

```text
useEngine
  -> WebGPUEngine.initialize()
    -> RenderLoop.start()
      -> RenderDispatcher.render(layers)
        -> LayerCollector
        -> Compositor / Effects
        -> NestedCompRenderer
        -> OutputPipeline
        -> SlicePipeline
```

Texture types:

| Source | GPU Type |
|---|---|
| HTMLVideoElement | `texture_external` via `importExternalTexture` |
| Firefox HTMLVideo fallback | `texture_2d<f32>` |
| VideoFrame | `texture_external` |
| HTMLImageElement | `texture_2d<f32>` |
| Canvas / Text | `texture_2d<f32>` |
| Native decoder frames | dynamic `texture_2d<f32>` |

---

## 12. Practical Agent Rules For This Repo

- Read context before editing.
- For timeline, playback, render, or export bugs, inspect logs/traces/monitoring first.
- For larger feature changes, always check impact on `docs/Features/`, version/changelog locations, and tests.
- For editor automation, prefer the `masterselects` skill instead of manual browser speculation.
- Keep `AGENTS.md` and `CLAUDE.md` byte-identical.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
