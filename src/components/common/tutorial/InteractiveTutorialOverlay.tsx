import { useEffect } from 'react';
import {
  createGuidedScenarioSessionRequest,
  getGuidedActionRuntime,
} from '../../../services/guidedActions';
import type { InteractiveCampaign } from './interactiveCampaigns';

interface InteractiveTutorialOverlayProps {
  campaign: InteractiveCampaign;
  onClose: () => void;
  onSkip: () => void;
}

export function InteractiveTutorialOverlay({
  campaign,
  onClose,
  onSkip,
}: InteractiveTutorialOverlayProps) {
  useEffect(() => {
    let disposed = false;
    const runtime = getGuidedActionRuntime();
    const request = createGuidedScenarioSessionRequest(campaign, {
      sessionId: `guided-tutorial-${campaign.id}-${Date.now()}`,
    });

    void runtime.startSession(request).then((result) => {
      if (disposed) {
        return;
      }

      if (result.status === 'completed') {
        onClose();
        return;
      }

      onSkip();
    });

    return () => {
      disposed = true;
      runtime.cancelSession(request.sessionId, 'Interactive tutorial closed');
    };
  }, [campaign, onClose, onSkip]);

  return null;
}
