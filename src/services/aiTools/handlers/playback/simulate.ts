import { useTimelineStore } from '../../../../stores/timeline';
import { getPlayheadPosition } from '../../../layerBuilder/PlayheadState';
import { playbackHealthMonitor } from '../../../playbackHealthMonitor';
import { vfPipelineMonitor } from '../../../vfPipelineMonitor';
import { wcPipelineMonitor } from '../../../wcPipelineMonitor';
import { createScrubPlan, sampleScrubPlan } from '../../scrubSimulation';
import {
  clampPlaybackTime,
  collectPlaybackRunDiagnostics,
  readDurationMsArg,
  readFiniteNumber,
  waitForAnimationFrame,
  waitForTimeout,
  type PlaybackToolResult,
  type TimelineStore,
} from './runtime';
import {
  buildPlaybackPathPreset,
  findPlaybackPathAnchor,
  type PlaybackPathAnchor,
  type PlaybackPathPreset,
} from './pathPreset';
import {
  runPlaybackPathPlayStep,
  runPlaybackPathScrubStep,
} from './pathSteps';
import { runScrubMotion } from './scrubMotion';

export async function handleSimulateScrub(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<PlaybackToolResult> {
  const wasPlaying = timelineStore.isPlaying;
  const resetDiagnostics = args.resetDiagnostics !== false;
  if (wasPlaying) {
    timelineStore.pause();
  }

  const plan = createScrubPlan(args, timelineStore.playheadPosition, timelineStore.duration);
  if (resetDiagnostics) {
    wcPipelineMonitor.reset();
    vfPipelineMonitor.reset();
    playbackHealthMonitor.reset();
  }
  const startedAt = performance.now();
  const scrubResult = await runScrubMotion(
    timelineStore,
    plan.totalDurationMs,
    (elapsedMs) => sampleScrubPlan(plan, elapsedMs),
    false
  );
  const endedAt = performance.now();
  const runDiagnostics = collectPlaybackRunDiagnostics(startedAt, endedAt);

  return {
    success: true,
    data: {
      pattern: plan.pattern,
      speed: plan.speed,
      durationMs: scrubResult.actualDurationMs,
      requestedDurationMs: plan.totalDurationMs,
      segmentDurationMs: plan.segmentDurationMs,
      waypoints: plan.points.slice(0, 16),
      waypointCount: plan.points.length,
      initialPosition: scrubResult.initialPosition,
      finalPosition: scrubResult.finalPosition,
      minTime: plan.minTime,
      maxTime: plan.maxTime,
      minVisited: scrubResult.minVisited,
      maxVisited: scrubResult.maxVisited,
      framesApplied: scrubResult.framesApplied,
      wasPlaying,
      dragMode: scrubResult.dragMode,
      pausedAfterGrab: scrubResult.pausedAfterGrab,
      zoom: scrubResult.zoom,
      scrollX: scrubResult.scrollX,
      startClientX: scrubResult.startClientX,
      endClientX: scrubResult.endClientX,
      pixelDistance: scrubResult.pixelDistance,
      released: true,
      seed: plan.seed,
      resetDiagnostics,
      runDiagnostics,
    },
  };
}

export async function handleSimulatePlayback(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<PlaybackToolResult> {
  const requestedDurationMs = readDurationMsArg(args, 'durationMs', 10_000, 100, 60_000);
  const settleMs = readDurationMsArg(args, 'settleMs', 150, 0, 5_000);
  const requestedPlaybackSpeed = readFiniteNumber(args.playbackSpeed);
  const playbackSpeed =
    requestedPlaybackSpeed !== null && requestedPlaybackSpeed !== 0
      ? requestedPlaybackSpeed
      : 1;
  const resetDiagnostics = args.resetDiagnostics !== false;
  const restorePlaybackState = args.restorePlaybackState === true;

  const wasPlaying = timelineStore.isPlaying;
  const previousSpeed = timelineStore.playbackSpeed;
  let completed = false;
  let restoredPlaybackState = false;

  try {
    if (wasPlaying) {
      timelineStore.pause();
      await waitForAnimationFrame();
    }

    const startTime = readFiniteNumber(args.startTime);
    if (startTime !== null) {
      timelineStore.setPlayheadPosition(
        clampPlaybackTime(startTime, timelineStore.duration)
      );
    }

    timelineStore.setDraggingPlayhead(false);
    await waitForAnimationFrame();

    if (resetDiagnostics) {
      wcPipelineMonitor.reset();
      vfPipelineMonitor.reset();
      playbackHealthMonitor.reset();
    }

    await timelineStore.play();
    timelineStore.setPlaybackSpeed(playbackSpeed);

    const startedAt = performance.now();
    const deadlineAt = startedAt + requestedDurationMs;
    const initialState = useTimelineStore.getState();
    const initialPosition = getPlayheadPosition(initialState.playheadPosition);
    let previousPosition = initialPosition;
    let framesObserved = 0;
    let movingFrames = 0;
    let stalledFrames = 0;
    let currentStallFrames = 0;
    let currentStallStartedAt = startedAt;
    let longestStallFrames = 0;
    let longestStallMs = 0;
    let minVisited = initialPosition;
    let maxVisited = initialPosition;
    let maxStepSeconds = 0;

    while (true) {
      const remainingMs = Math.max(0, deadlineAt - performance.now());
      const now = await waitForAnimationFrame(Math.min(120, Math.max(16, remainingMs)));
      const state = useTimelineStore.getState();
      const position = getPlayheadPosition(state.playheadPosition);
      const stepSeconds = Math.abs(position - previousPosition);

      framesObserved++;
      minVisited = Math.min(minVisited, position);
      maxVisited = Math.max(maxVisited, position);
      maxStepSeconds = Math.max(maxStepSeconds, stepSeconds);

      if (stepSeconds > 0.0001) {
        movingFrames++;
        if (currentStallFrames > 0) {
          longestStallFrames = Math.max(longestStallFrames, currentStallFrames);
          longestStallMs = Math.max(longestStallMs, now - currentStallStartedAt);
          currentStallFrames = 0;
        }
      } else {
        stalledFrames++;
        if (currentStallFrames === 0) {
          currentStallStartedAt = now;
        }
        currentStallFrames++;
      }

      previousPosition = position;

      if (now >= deadlineAt || performance.now() >= deadlineAt) {
        break;
      }
    }

    if (currentStallFrames > 0) {
      longestStallFrames = Math.max(longestStallFrames, currentStallFrames);
      longestStallMs = Math.max(longestStallMs, performance.now() - currentStallStartedAt);
    }

    timelineStore.pause();
    if (settleMs > 0) {
      await waitForTimeout(settleMs);
    }
    await waitForAnimationFrame();

    timelineStore.setPlaybackSpeed(previousSpeed);
    if (restorePlaybackState && wasPlaying) {
      await timelineStore.play();
      timelineStore.setPlaybackSpeed(previousSpeed);
      restoredPlaybackState = true;
    }

    const finalState = useTimelineStore.getState();
    const finalPosition = getPlayheadPosition(finalState.playheadPosition);
    const endedAt = performance.now();
    const actualDurationMs = Math.round(endedAt - startedAt);
    const deltaSeconds = finalPosition - initialPosition;
    const expectedDeltaSeconds = (requestedDurationMs / 1000) * playbackSpeed;
    const runDiagnostics = collectPlaybackRunDiagnostics(startedAt, endedAt);

    completed = true;
    return {
      success: true,
      data: {
        requestedDurationMs,
        actualDurationMs,
        playbackSpeed,
        initialPosition,
        finalPosition,
        deltaSeconds,
        expectedDeltaSeconds,
        driftSeconds: deltaSeconds - expectedDeltaSeconds,
        framesObserved,
        movingFrames,
        stalledFrames,
        longestStallFrames,
        longestStallMs: Math.round(longestStallMs),
        minVisited,
        maxVisited,
        maxStepSeconds,
        wasPlaying,
        restoredPlaybackState,
        resetDiagnostics,
        settled: settleMs > 0,
        endedPlaying: finalState.isPlaying,
        runDiagnostics,
      },
    };
  } finally {
    if (!completed || !restoredPlaybackState) {
      timelineStore.pause();
      timelineStore.setPlaybackSpeed(previousSpeed);
    }
  }
}

export async function handleSimulatePlaybackPath(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<PlaybackToolResult> {
  const preset: PlaybackPathPreset =
    args.preset === 'play_scrub_stress_v1'
      ? 'play_scrub_stress_v1'
      : 'play_scrub_stress_v1';
  const resetDiagnostics = args.resetDiagnostics !== false;
  const playbackSpeed =
    typeof args.playbackSpeed === 'number' && Number.isFinite(args.playbackSpeed) && args.playbackSpeed > 0
      ? args.playbackSpeed
      : 1;
  const anchor = findPlaybackPathAnchor(timelineStore);
  const requestedStartTime =
    typeof args.startTime === 'number' && Number.isFinite(args.startTime)
      ? clampPlaybackTime(args.startTime, timelineStore.duration)
      : clampPlaybackTime(anchor.clipStartTime, timelineStore.duration);
  const latestPlayableStartTime = Math.max(0, anchor.playableEndTime - 0.5);
  const startTime = clampPlaybackTime(
    Math.min(requestedStartTime, latestPlayableStartTime),
    timelineStore.duration
  );
  const pathAnchor: PlaybackPathAnchor = {
    ...anchor,
    clipStartTime: startTime,
    playableEndTime: Math.max(startTime, anchor.playableEndTime),
  };
  const steps = buildPlaybackPathPreset(preset, pathAnchor);
  const previousSpeed = timelineStore.playbackSpeed;

  timelineStore.pause();
  timelineStore.setDraggingPlayhead(false);
  timelineStore.setPlaybackSpeed(playbackSpeed);
  timelineStore.setPlayheadPosition(startTime);
  await waitForAnimationFrame();

  if (resetDiagnostics) {
    wcPipelineMonitor.reset();
    vfPipelineMonitor.reset();
    playbackHealthMonitor.reset();
  }

  const startedAt = performance.now();
  const results: Record<string, unknown>[] = [];

  for (const step of steps) {
    if (step.kind === 'play') {
      results.push(await runPlaybackPathPlayStep(timelineStore, step));
    } else {
      results.push(await runPlaybackPathScrubStep(timelineStore, step));
    }
  }

  timelineStore.pause();
  timelineStore.setDraggingPlayhead(false);
  timelineStore.setPlaybackSpeed(previousSpeed);
  await waitForAnimationFrame();

  const finalState = useTimelineStore.getState();
  const endedAt = performance.now();
  const runDiagnostics = collectPlaybackRunDiagnostics(startedAt, endedAt);

  return {
    success: true,
    data: {
      preset,
      diagnosticMode: 'playback_scrub_stress',
      clipStartTime: startTime,
      requestedStartTime,
      playableEndTime: pathAnchor.playableEndTime,
      clipId: anchor.clipId,
      clipName: anchor.clipName,
      playbackSpeed,
      resetDiagnostics,
      totalDurationMs: Math.round(endedAt - startedAt),
      steps: results,
      finalPosition: finalState.playheadPosition,
      endedPlaying: finalState.isPlaying,
      runDiagnostics,
    },
  };
}
