import { useEffect, useRef, useState } from 'react';
import type { TimelineClip, TimelineTrack } from '../../../types';
import { useTimelineStore } from '../../../stores/timeline';
import type { AIMovingClip } from '../../../stores/timeline/types';

export interface ClipAnimationState {
  aiMove: AIMovingClip | undefined;
  aiMovePhase: 'idle' | 'initial' | 'animating';
  animationClass: string;
  animationDelay: number;
}

export function useClipAnimationState(input: {
  clip: TimelineClip;
  clips: readonly TimelineClip[];
  tracks: readonly TimelineTrack[];
}): ClipAnimationState {
  const clipAnimationPhase = useTimelineStore(s => s.clipAnimationPhase);
  const compositionSwitchDirection = useTimelineStore(s => s.compositionSwitchDirection);
  const clipEntranceKey = useTimelineStore(s => s.clipEntranceAnimationKey);
  const aiMove = useTimelineStore(s => s.aiMovingClips.get(input.clip.id));
  const [mountEntranceKey] = useState(clipEntranceKey);

  const animationDelay = clipAnimationPhase === 'entering'
    ? Math.max(0, (() => {
        const sorted = [...input.clips].sort((a, b) => {
          const aTrack = input.tracks.findIndex(track => track.id === a.trackId);
          const bTrack = input.tracks.findIndex(track => track.id === b.trackId);
          if (aTrack !== bTrack) return aTrack - bTrack;
          return a.startTime - b.startTime;
        });
        return sorted.findIndex(candidate => candidate.id === input.clip.id);
      })()) * 0.02
    : 0;

  const isNewClip = mountEntranceKey === clipEntranceKey && clipEntranceKey > 0;
  const exitAnimationClass = compositionSwitchDirection === 'backward'
    ? 'exit-animate exit-animate-left'
    : 'exit-animate exit-animate-right';
  const entranceAnimationClass = compositionSwitchDirection === 'backward'
    ? 'entrance-animate entrance-animate-right'
    : 'entrance-animate entrance-animate-left';
  const animationClass = clipAnimationPhase === 'exiting'
    ? exitAnimationClass
    : (clipAnimationPhase === 'entering' && isNewClip)
      ? entranceAnimationClass
      : '';

  const [aiMovePhase, setAiMovePhase] = useState<ClipAnimationState['aiMovePhase']>('idle');
  const aiMoveRef = useRef<number | null>(null);
  const aiMoveStartedAt = aiMove?.startedAt;
  const aiMoveDuration = aiMove?.animationDuration ?? 200;

  useEffect(() => {
    if (aiMoveStartedAt !== undefined) {
      const raf1 = requestAnimationFrame(() => {
        setAiMovePhase('initial');
        const raf2 = requestAnimationFrame(() => {
          setAiMovePhase('animating');
        });
        aiMoveRef.current = raf2;
      });
      const timer = setTimeout(() => {
        setAiMovePhase('idle');
      }, aiMoveDuration + 50);
      return () => {
        cancelAnimationFrame(raf1);
        if (aiMoveRef.current) cancelAnimationFrame(aiMoveRef.current);
        clearTimeout(timer);
      };
    }

    const frame = requestAnimationFrame(() => setAiMovePhase('idle'));
    return () => cancelAnimationFrame(frame);
  }, [aiMoveDuration, aiMoveStartedAt]);

  return {
    aiMove,
    aiMovePhase,
    animationClass,
    animationDelay,
  };
}
