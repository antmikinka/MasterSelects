import type { VectorAnimationProvider } from './vectorAnimation';

export type TimelineSourceType =
  | 'video'
  | 'audio'
  | 'image'
  | 'text'
  | 'solid'
  | 'model'
  | 'camera'
  | 'gaussian-avatar'
  | 'gaussian-splat'
  | 'splat-effector'
  | 'math-scene'
  | 'motion-shape'
  | 'motion-null'
  | 'motion-adjustment'
  | 'midi'
  | VectorAnimationProvider;
