import { useCallback, type SyntheticEvent } from 'react';
import {
  DEFAULT_FLASHBOARD_MODEL_VERSION,
  DEFAULT_FLASHBOARD_PROVIDER_ID,
  DEFAULT_FLASHBOARD_SERVICE,
} from '../../../stores/flashboardStore/defaults';
import { FlashBoardComposer } from '../flashboard/FlashBoardComposer';
import { useFlashBoardRuntime } from '../flashboard/useFlashBoardRuntime';
import { MediaAIGenerationQueue } from './MediaAIGenerationQueue';
import '../flashboard/FlashBoard.css';
import './MediaAIGenerativeTray.css';

const MEDIA_GENERATIVE_SERVICES: Array<'kieai' | 'evolink' | 'elevenlabs' | 'suno'> = [
  'kieai',
  'evolink',
  'elevenlabs',
  'suno',
];

interface MediaAIGenerativeTrayProps {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

export function MediaAIGenerativeTray({
  expanded,
  onExpandedChange,
}: MediaAIGenerativeTrayProps) {
  useFlashBoardRuntime({ enableKeyboardDelete: false });

  const stopEvent = useCallback((event: SyntheticEvent) => {
    event.stopPropagation();
  }, []);

  if (!expanded) {
    return (
      <div className="media-ai-tray media-ai-tray-collapsed" onMouseDown={stopEvent} onClick={stopEvent}>
        <button
          className="media-ai-tray-launch"
          type="button"
          onClick={() => onExpandedChange(true)}
          title="Expand AI prompt"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M8 1.5 9.2 5 13 6.2 9.2 7.4 8 11 6.8 7.4 3 6.2 6.8 5 8 1.5Z" />
            <path d="m12.4 10.4.5 1.4 1.5.5-1.5.5-.5 1.4-.5-1.4-1.5-.5 1.5-.5.5-1.4Z" />
          </svg>
          <span>Generate</span>
        </button>
      </div>
    );
  }

  return (
    <div className="media-ai-tray media-ai-tray-expanded" onMouseDown={stopEvent} onClick={stopEvent}>
      <MediaAIGenerationQueue />
      <button
        className="media-ai-tray-collapse"
        type="button"
        onClick={() => onExpandedChange(false)}
        title="Collapse AI prompt"
      >
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M4 6h8" />
        </svg>
      </button>
      <FlashBoardComposer
        initialProviderId={DEFAULT_FLASHBOARD_PROVIDER_ID}
        initialService={DEFAULT_FLASHBOARD_SERVICE}
        initialVersion={DEFAULT_FLASHBOARD_MODEL_VERSION}
        allowedServices={MEDIA_GENERATIVE_SERVICES}
      />
    </div>
  );
}
