import { endBatch, startBatch } from '../../historyStore';
import { getKeyframeAtTime } from '../../../utils/keyframeInterpolation';
import type { TimelineEditOperationApplyContext } from './editOperationContext';
import { isClipTrackLocked, resultFromWarnings } from './editOperationResults';
import {
  applyKeyframeSelection,
  changedKeyframeClipIds,
  clonePathKeyframeValue,
  createPathValueKeyframeId,
  findKeyframeOwner,
  keyframeSnapshot,
} from './keyframeTransactionHelpers';
import type { KeyframeTransactionOperation } from './transactionTypes';
import type { TimelineEditOperation, TimelineEditResult, TimelineEditWarning } from './types';

export function isKeyframeTransactionOperation(operation: TimelineEditOperation): operation is KeyframeTransactionOperation {
  return (
    operation.type === 'keyframe-transaction-begin' ||
    operation.type === 'keyframe-transaction-update' ||
    operation.type === 'keyframe-transaction-commit' ||
    operation.type === 'keyframe-transaction-cancel'
  );
}

export function applyKeyframeTransactionOperation(
  operation: KeyframeTransactionOperation,
  context: TimelineEditOperationApplyContext,
): TimelineEditResult {
  const { get, options, set } = context;
  const operationId = operation.id;
  const clip = get().clips.find(candidate => candidate.id === operation.clipId);
  if (!clip) {
    return resultFromWarnings(operationId, [{
      code: 'clip-not-found',
      message: `Keyframe transaction clip not found: ${operation.clipId}`,
      clipId: operation.clipId,
    }]);
  }
  if (isClipTrackLocked(get().clips, get().tracks, operation.clipId)) {
    return resultFromWarnings(operationId, [{
      code: 'track-locked',
      message: `Keyframe transaction clip is on a locked track: ${operation.clipId}`,
      clipId: operation.clipId,
      trackId: clip.trackId,
    }]);
  }

  if (operation.type === 'keyframe-transaction-begin') {
    return {
      success: true,
      operationId,
      changedClipIds: [],
      warnings: [],
    };
  }

  const beforeKeyframes = keyframeSnapshot(get().clipKeyframes);
  const beforeSelection = new Set(get().selectedKeyframeIds);
  const warnings: TimelineEditWarning[] = [];
  const deferHistoryCommit = operation.type === 'keyframe-transaction-update' && options.deferHistoryCommit === true;

  startBatch(options.historyLabel ?? 'Edit keyframes');
  try {
    const operations = operation.type === 'keyframe-transaction-cancel'
      ? operation.discardKeyframeIds.map(keyframeId => ({
          type: 'keyframe-remove' as const,
          keyframeId,
          clipId: operation.clipId,
          property: operation.property ?? 'opacity',
        }))
      : operation.operations;

    for (const keyframeOperation of operations) {
      if (keyframeOperation.type === 'keyframe-create') {
        const targetClip = get().clips.find(candidate => candidate.id === keyframeOperation.clipId);
        if (!targetClip) {
          warnings.push({
            code: 'clip-not-found',
            message: `Keyframe create clip not found: ${keyframeOperation.clipId}`,
            clipId: keyframeOperation.clipId,
          });
          continue;
        }
        if (isClipTrackLocked(get().clips, get().tracks, keyframeOperation.clipId)) {
          warnings.push({
            code: 'track-locked',
            message: `Keyframe create clip is on a locked track: ${keyframeOperation.clipId}`,
            clipId: keyframeOperation.clipId,
            trackId: targetClip.trackId,
          });
          continue;
        }
        if (typeof keyframeOperation.value.value === 'number') {
          get().addKeyframe(
            keyframeOperation.clipId,
            keyframeOperation.property,
            keyframeOperation.value.value,
            keyframeOperation.time,
            keyframeOperation.easing,
          );
          continue;
        }
        if (keyframeOperation.value.pathValue) {
          const clampedTime = Math.max(0, Math.min(keyframeOperation.time, targetClip.duration));
          const existingKeyframes = get().clipKeyframes.get(keyframeOperation.clipId) ?? [];
          const existingAtTime = getKeyframeAtTime(
            existingKeyframes,
            keyframeOperation.property,
            clampedTime,
          );
          const pathValue = clonePathKeyframeValue(keyframeOperation.value.pathValue);
          const nextKeyframes = existingAtTime
            ? existingKeyframes.map((keyframe) => (
                keyframe.id === existingAtTime.id
                  ? {
                      ...keyframe,
                      value: 0,
                      pathValue,
                      easing: keyframeOperation.easing,
                    }
                  : keyframe
              ))
            : [
                ...existingKeyframes,
                {
                  id: createPathValueKeyframeId(),
                  clipId: keyframeOperation.clipId,
                  time: clampedTime,
                  property: keyframeOperation.property,
                  value: 0,
                  pathValue,
                  easing: keyframeOperation.easing,
                },
              ].sort((left, right) => left.time - right.time);
          const nextMap = new Map(get().clipKeyframes);
          nextMap.set(keyframeOperation.clipId, nextKeyframes);
          set({ clipKeyframes: nextMap });
          get().invalidateCache();
          continue;
        }
        warnings.push({
          code: 'unsupported',
          message: 'Keyframe create operation did not include a supported value payload.',
          clipId: keyframeOperation.clipId,
        });
        continue;
      }

      if (keyframeOperation.type === 'keyframe-select') {
        set({
          selectedKeyframeIds: applyKeyframeSelection(
            get().selectedKeyframeIds,
            keyframeOperation.selectedKeyframeIds,
            keyframeOperation.mode,
          ),
        });
        continue;
      }

      const owner = findKeyframeOwner(get().clipKeyframes, keyframeOperation.keyframeId);
      if (!owner) {
        warnings.push({
          code: 'keyframe-not-found',
          message: `Keyframe not found: ${keyframeOperation.keyframeId}`,
        });
        continue;
      }
      if (isClipTrackLocked(get().clips, get().tracks, owner.clipId)) {
        const ownerClip = get().clips.find(candidate => candidate.id === owner.clipId);
        warnings.push({
          code: 'track-locked',
          message: `Keyframe ${keyframeOperation.keyframeId} clip is on a locked track: ${owner.clipId}`,
          clipId: owner.clipId,
          trackId: ownerClip?.trackId,
        });
        continue;
      }

      if (keyframeOperation.type === 'keyframe-move') {
        get().moveKeyframe(keyframeOperation.keyframeId, keyframeOperation.resolvedTime);
      } else if (keyframeOperation.type === 'keyframe-update-value') {
        if (typeof keyframeOperation.value.value === 'number') {
          get().updateKeyframe(keyframeOperation.keyframeId, { value: keyframeOperation.value.value });
        } else if (keyframeOperation.value.pathValue) {
          get().updateKeyframe(keyframeOperation.keyframeId, { pathValue: keyframeOperation.value.pathValue });
        } else {
          warnings.push({
            code: 'unsupported',
            message: `Keyframe ${keyframeOperation.keyframeId} update-value operation did not include a supported value payload.`,
            clipId: owner.clipId,
          });
        }
      } else if (keyframeOperation.type === 'keyframe-remove') {
        get().removeKeyframe(keyframeOperation.keyframeId);
      } else if (keyframeOperation.type === 'keyframe-update-easing') {
        get().updateKeyframe(keyframeOperation.keyframeId, { easing: keyframeOperation.easing });
      } else if (keyframeOperation.type === 'keyframe-update-bezier-handle') {
        get().updateBezierHandle(keyframeOperation.keyframeId, keyframeOperation.handle, keyframeOperation.position);
      } else if (keyframeOperation.type === 'keyframe-update-rotation-interpolation') {
        get().updateKeyframe(keyframeOperation.keyframeId, {
          rotationInterpolation: keyframeOperation.rotationInterpolation,
        });
      }
    }
  } finally {
    if (!deferHistoryCommit) endBatch();
  }

  const changedClipIds = changedKeyframeClipIds(beforeKeyframes, get().clipKeyframes);
  const selectionChanged = JSON.stringify([...beforeSelection].sort()) !== JSON.stringify([...get().selectedKeyframeIds].sort());
  if (changedClipIds.length === 0 && !selectionChanged) {
    return resultFromWarnings(operationId, warnings.length > 0 ? warnings : [{
      code: 'no-op',
      message: 'No keyframes changed.',
    }]);
  }

  return {
    success: true,
    operationId,
    changedClipIds,
    warnings,
  };
}
