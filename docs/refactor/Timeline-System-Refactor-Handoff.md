# Timeline System Refactor Handoff

Progress: Planning 100% | Gate: canonical-plan-reconciliation | Status: done

Canonical references:

- Plan: `docs/refactor/Timeline-System-Refactor-Plan.md`
- Final synthesis:
  `docs/refactor/timeline-system-agent-plans/cross-team-final-synthesis.md`
- Agent protocol: `AGENTS.md` / `CLAUDE.md` section 6A

## Current State

- Branch: `staging`.
- Implementation lanes have not started.
- Current worktree has unrelated active work. Do not revert it:
  - `src/engine/render/LayerCollector.ts`
  - `src/services/layerBuilder/AudioTrackSyncManager.ts`
  - `src/services/layerBuilder/VideoSyncManager.ts`
  - `src/stores/timeline/helpers/blobUrlManager.ts`
  - `src/stores/timeline/trackSlice.ts`
  - `tests/stores/timeline/trackSlice.test.ts`
  - `tests/unit/blobUrlManager.test.ts`

## Current Baseline

| File | Lines | Pressure |
|---|---:|---|
| `src/components/timeline/Timeline.tsx` | 4122 | Root orchestration, section layout, menus, overlays, pointer behavior. |
| `src/components/timeline/TimelineClipCanvas.tsx` | 3544 | Canvas drawing, cache demand, worker prep/lifecycle, diagnostics. |
| `src/services/layerBuilder/VideoSyncManager.ts` | 3487 | Runtime video sync and source-field handling. |
| `src/stores/timeline/keyframeSlice.ts` | 2452 | Keyframe actions and compatibility logic. |
| `src/services/layerBuilder/AudioTrackSyncManager.ts` | 2218 | Runtime audio sync and source-field handling. |
| `src/stores/timeline/clipSlice.ts` | 2212 | Clip mutations and compatibility actions. |
| `src/components/timeline/hooks/useExternalDrop.ts` | 2171 | Drop/import/new-track placement. |
| `src/components/timeline/TimelineTrack.tsx` | 1819 | Track row, hit testing, shell mounting, canvas shaping. |
| `src/stores/timeline/editOperations/applyTimelineEditOperation.ts` | 1550 | Edit operation execution. |
| `src/stores/timeline/serializationUtils.ts` | 1369 | Load/save restore helpers. |
| `src/stores/timeline/types.ts` | 1330 | Store state/action contracts. |

## Decisions Already Made

- Target is pure `src/timeline/**` kernel, not permanent
  `src/components/timeline/renderModel/**` ownership.
- First implementation packet is architecture registry first:
  - `gateRegistry`
  - `laneWriteManifest`
  - `adapterDebtLedger`
  - `exitCriteriaCoverage`
  - `testMigrationLedger`
  - `retiredPathLedger`
  - `P1_ARCHITECTURE_REGISTRY_COHERENT`
- P1 must also enforce import boundaries, LOC budgets, runtime-free schema,
  high-conflict ownership, visual-demand name isolation, and
  test/retired-path classifications.
- Do not start by splitting `Timeline.tsx`.
- Do not keep compatibility modes inside the new pipeline.
- Optional old-project support belongs to a separate one-way importer.
- No long-lived `CanvasClip` bridge.
- No new god objects or broad helper files.
- Old unused paths must be deleted, moved to the importer lane, or tracked as
  explicit debt/keep entries with a delete gate or reason.
- Tests follow behavior: port user-visible coverage, replace implementation
  checks with architecture gates, and delete tests that only assert removed
  legacy behavior.

## Existing Useful Code To Migrate

- `src/components/timeline/renderModel/types.ts`
- `src/components/timeline/renderModel/geometry.ts`
- `tests/unit/timelineRenderModel.test.ts`
- `src/components/timeline/interactionShell/**`
- `src/components/timeline/utils/timelineClipCanvasWorkerContract.ts`
- `src/components/timeline/utils/timelineClipCanvasWorkerModel.ts`
- `tests/unit/timelineClipCanvasWorkerModel.test.ts`
- `tests/unit/TimelineClipCanvasWorkerRuntime.test.tsx`
- `src/services/timeline/timelineRuntimeCoordinator.ts`
- `src/services/timeline/runtimeCoordinatorTypes.ts`
- `src/services/timeline/cacheSchedulerContracts.ts`
- `src/services/timeline/timelineCanvasDiagnostics.ts`

Use these as source material. Do not recreate them blindly.

## Initial Test Classifications

| Test | Classification | Note |
|---|---|---|
| `tests/unit/timelineRenderModel.test.ts` | `port` | Move to kernel projection/geometry gates. |
| `tests/unit/timelineClipCanvasWorkerModel.test.ts` | `replace` | Replace worker message/eligibility structure with contributor/paint-packet gates. |
| `tests/unit/TimelineClipCanvasWorkerRuntime.test.tsx` | `split` | Port host/runtime behavior; delete `CanvasClip` shape and fallback-split assertions after Phase 3. |
| `tests/stores/timeline/trackSlice.test.ts` | `keep` | Store behavior coverage outside kernel. |
| `tests/unit/blobUrlManager.test.ts` | `keep` | Runtime/resource coverage outside kernel. |

## Initial Debt Seeds

Seed these in `adapterDebtLedger` / `retiredPathLedger` during P1:

- `CanvasClip` data shape and field-coverage matrix.
- `CanvasClip` runtime-bearing fields such as `File` and source handles.
- `CanvasClip` worker message, fallback lifecycle, warmups, and diagnostics.
- `timelineClipCanvasWorkerModel.ts` source-kind switches and LOC overage.
- `interactionShell/**` callback bags and app/store-shaped refs.
- `useExternalDrop.ts` direct clip/track creation and source-specific branches.
- `serializationUtils.ts` runtime restore compatibility.
- `VideoSyncManager.ts` and `AudioTrackSyncManager.ts` direct source handles.

## Known Pre-Implementation Risks

- `src/types/index.ts` still exposes runtime-bearing fields such as
  `videoElement`, `audioElement`, `imageElement`, `File`, blob URLs, and runtime
  ids. The kernel needs a clean schema view before relying on that barrel.
- `src/services/timeline/timelineVisualDemand.ts` already exists with a
  render-loop-gating meaning. The new resource-demand concept needs a distinct
  name or isolation.
- `CanvasClip` field coverage does not exist yet. Add it before deleting or
  narrowing `CanvasClip`.
- Runtime/project-load restore paths still create runtime-bearing source shapes.
  Treat them as a separate importer/runtime-cleanup lane.

## First Pickup

Progress: Architecture 0% | Gate: P1_ARCHITECTURE_REGISTRY_COHERENT | Status: active

Create the architecture registry packet:

```text
src/timeline/architecture/gateRegistry*
src/timeline/architecture/laneWriteManifest*
src/timeline/architecture/adapterDebtLedger*
src/timeline/architecture/exitCriteriaCoverage*
src/timeline/architecture/testMigrationLedger*
src/timeline/architecture/retiredPathLedger*
tests/unit/timelineArchitectureRegistry.test.ts
```

Minimum first gate suite:

- `P1_ARCHITECTURE_REGISTRY_COHERENT`
- `P1_KERNEL_IMPORT_BOUNDARY`
- `P1_LOC_BUDGET_ENFORCED`
- `P1_SCHEMA_RUNTIME_FREE_BOUNDARY`
- `P1_VISUAL_DEMAND_NAME_ISOLATED`
- `P1_HIGH_CONFLICT_OWNERSHIP_COMPLETE`
- `P1_TEST_AND_RETIRED_PATH_CLASSIFICATION`

`P1_ARCHITECTURE_REGISTRY_COHERENT` should prove:

- every gate id is registered exactly once
- every gate is `active`, `satisfied`, or `retired`
- retired gates have `retiredByGate`
- every lane has write set and exit gates
- every high-conflict file has exactly one active owner
- every adapter debt entry has owner, write set, introduced phase, and delete
  gate
- every `activeUntilGate`, `acceptanceTests`, and `deleteBy` tag resolves
- every retired old path has a delete gate, importer owner, or explicit keep
  reason
- every affected old test has `port`, `replace`, `split`, `delete`, or `keep`
  classification

The rest of the P1 suite should prove:

- `src/timeline/**` cannot import React, components, stores, services, workers,
  DOM/runtime allocation code, or broad helper bags.
- file budgets and forbidden names/patterns are machine-checked.
- kernel schema inputs are runtime-free.
- the kernel visual-resource-demand name is isolated from existing
  render-loop-gating `timelineVisualDemand`.
- high-conflict ownership covers current dirty overlapping files before agents
  parallelize.

Suggested focused check for the first packet:

```bash
npm run test -- tests/unit/timelineArchitectureRegistry.test.ts
```

Run `npx tsc -p tsconfig.app.json --noEmit --pretty false` only if the first
packet introduces public TS contracts/imports that need type verification.

## Later Phase Gate Reminders

Do not let Phase 3 be mistaken for the whole refactor. Canvas cleanup is followed
by a runtime/store/importer phase:

- `P4_RUNTIME_PROVIDER_DEMAND_ADOPTED`
- `P4_VIDEO_SYNC_SOURCE_HANDLES_REMOVED`
- `P4_AUDIO_SYNC_SOURCE_HANDLES_REMOVED`
- `P4_TIMELINE_STATE_RUNTIME_HANDLES_REMOVED`
- `P4_STORE_SLICE_GOD_FILES_SPLIT`
- `P4_EDIT_OPERATION_APPLIER_NARROW`
- `P4_IMPORTER_LEGACY_QUARANTINE`
- `P4_SERIALIZATION_RUNTIME_FREE_EDITOR_PATH`
- `P4_DROP_IMPORT_COMMANDS_ROUTED`
- `P4_RUNTIME_RESOURCE_TESTS_KEPT_OUT_OF_KERNEL`

## High-Conflict Files

Single owner at a time:

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
- runtime/project-load restore modules once their lane starts

## Handoff Entry Template

Append one concise entry before ending a work session.

```markdown
### YYYY-MM-DD HH:mm - Lane - Agent

Progress: <lane> <percent>% | Gate: <gate> | Status: <blocked/active/done>
Base: <branch>@<sha>
Files: <created/modified/deleted, concise>
Gates: +<satisfied> / active <active> / retired <retired>
Debt: +<added> / -<removed> / transfer <ownership changes>
Retired paths: <deleted/moved/kept/debt, concise>
Tests: <ported/replaced/split/deleted/kept, concise>
Checks: <command=result>; skipped <check=reason>
Next: <one next action and first file/command>
```

Percentage markers are practical lane/gate completion markers:

- `0%`: not started
- `25%`: scaffolding
- `50%`: main implementation
- `75%`: checks/fixes
- `90%`: handoff/docs
- `100%`: complete

## Lane Updates

### 2026-06-08 01:36 - Docs - Codex

Progress: Docs 100% | Gate: four-agent-review-reconciliation | Status: done
Base: `staging@5889e9db`
Files: modified plan/handoff/synthesis and synced `AGENTS.md`/`CLAUDE.md`
Gates: +four-agent-review-reconciliation / active P1 gate suite / retired none
Debt: +initial CanvasClip/worker/shell/drop/serialization/runtime debt seeds / -loose P1 prose / transfer none
Retired paths: none deleted; P1 now requires retired-path ledger classification
Tests: classified known tests as port/replace/split/keep; none deleted
Checks: normal commit/push chain required after this handoff entry; final command results reported by committing agent
Next: run `npm run build`, `npm run lint`, and `npm run test`; then commit scoped docs/instruction changes

### 2026-06-08 01:23 - Docs - Codex

Progress: Docs 100% | Gate: test-migration-policy-reconciliation | Status: done
Base: `staging@5889e9db`
Files: modified plan/handoff/synthesis and synced `AGENTS.md`/`CLAUDE.md`
Gates: +test-migration-policy-reconciliation / active `P1_ARCHITECTURE_REGISTRY_COHERENT` / retired none
Debt: +affected-test classification rule / -implicit old-test retention / transfer none
Retired paths: none deleted
Tests: none changed; future slices must classify as port/replace/delete/keep
Checks: `git diff --check`=pass with LF/CRLF warnings only; `AGENTS.md`/`CLAUDE.md` hash=identical; skipped build/lint/test=docs-only
Next: encode affected-test classification assertions in `tests/unit/timelineArchitectureRegistry.test.ts`

### 2026-06-08 01:19 - Docs - Codex

Progress: Docs 100% | Gate: deletion-policy-reconciliation | Status: done
Base: `staging@5889e9db`
Files: modified plan/handoff/synthesis and synced `AGENTS.md`/`CLAUDE.md`
Gates: +deletion-policy-reconciliation / active `P1_ARCHITECTURE_REGISTRY_COHERENT` / retired none
Debt: +retired-path classification rule / -implicit deletion assumptions / transfer none
Retired paths: none deleted yet; future slices must classify as delete/move/keep/debt
Tests: none changed; future slices must classify affected tests as port/replace/delete/keep
Checks: `git diff --check`=pass with LF/CRLF warnings only; `AGENTS.md`/`CLAUDE.md` hash=identical; skipped build/lint/test=docs-only
Next: create architecture registry packet and encode retired-path assertions in `tests/unit/timelineArchitectureRegistry.test.ts`

### 2026-06-08 - Docs - Codex

Progress: Docs 100% | Gate: canonical-plan-reconciliation | Status: done
Base: `staging@5889e9db`
Files: modified plan/handoff/synthesis and synced `AGENTS.md`/`CLAUDE.md`
Gates: +canonical-plan-reconciliation / active `P1_ARCHITECTURE_REGISTRY_COHERENT` / retired none
Debt: +none / -old `renderModel/**` first-slice wording / transfer none
Checks: `git diff --check`=pass; skipped build/lint/test=docs-only
Next: create architecture registry packet and run `npm run test -- tests/unit/timelineArchitectureRegistry.test.ts`

## Do Not Do

- Do not restore `TimelineClip.tsx`.
- Do not recreate passive DOM clip bodies.
- Do not start in `Timeline.tsx`.
- Do not create broad `viewModel`, `timelineCommandBus`, or `helpers` files.
- Do not leave `CanvasClip` as permanent architecture.
- Do not leave old unused paths as flag-disabled fallback code.
- Do not keep tests that only assert deleted legacy fallback behavior.
- Do not run full build/lint/test after every slice.
- Do not preserve old-project restore behavior inside the new pipeline.
