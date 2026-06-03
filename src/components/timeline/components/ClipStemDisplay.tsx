import {
  IconDisc,
  IconGuitarPick,
  IconMicrophone,
  IconMusic,
  IconWaveSine,
} from '@tabler/icons-react';
import type { ClipStemSeparationJobStemChoice } from '../../../stores/timeline/types';
import type { AudioStemKind } from '../../../types/audio';

export const EMPTY_STEM_CHOICES: ClipStemSeparationJobStemChoice[] = [];

export const ACTIVE_STEM_JOB_PHASES = new Set([
  'queued',
  'preparing',
  'downloading-model',
  'loading-model',
  'separating',
  'storing',
]);

export function formatStemJobPhase(phase: string): string {
  switch (phase) {
    case 'queued':
      return 'Queued';
    case 'preparing':
      return 'Preparing audio';
    case 'downloading-model':
      return 'Downloading stem model';
    case 'loading-model':
      return 'Loading stem model';
    case 'separating':
      return 'Separating stems';
    case 'storing':
      return 'Storing stems';
    default:
      return 'Stem separation';
  }
}

export function StemChoiceIcon({ kind }: { kind: AudioStemKind }) {
  switch (kind) {
    case 'vocals':
    case 'dialogue':
      return <IconMicrophone className="clip-stem-choice-icon" size={15} stroke={2.3} aria-hidden="true" />;
    case 'drums':
      return <IconDisc className="clip-stem-choice-icon" size={15} stroke={2.3} aria-hidden="true" />;
    case 'bass':
    case 'instrumental':
      return <IconGuitarPick className="clip-stem-choice-icon" size={15} stroke={2.3} aria-hidden="true" />;
    case 'music':
      return <IconMusic className="clip-stem-choice-icon" size={15} stroke={2.3} aria-hidden="true" />;
    case 'mix':
    case 'other':
    case 'sfx':
    default:
      return <IconWaveSine className="clip-stem-choice-icon" size={15} stroke={2.3} aria-hidden="true" />;
  }
}
