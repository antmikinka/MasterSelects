import { useEffect } from 'react';
import { executeAITool } from '../../../services/aiTools';
import {
  createGuidedScenarioSessionRequest,
  getGuidedActionRuntime,
  SemanticExecutionAdapter,
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
    const adapter = new SemanticExecutionAdapter({
      defaultCallerContext: 'internal',
      defaultLegacyFeedback: 'off',
      executeTool: (tool, args, callerContext, options) => (
        executeAITool(tool, args, callerContext, {
          ...options,
          guidedReplay: false,
        })
      ),
    });
    const unregisterHandlers = runtime.setActionHandlers(adapter.createActionHandlers({
      callerContext: 'internal',
      legacyFeedback: 'off',
    }));

    void runtime.startSession(request)
      .then((result) => {
        if (disposed) {
          return;
        }

        if (result.status === 'completed') {
          onClose();
          return;
        }

        onSkip();
      })
      .finally(unregisterHandlers);

    return () => {
      disposed = true;
      unregisterHandlers();
      runtime.cancelSession(request.sessionId, 'Interactive tutorial closed');
    };
  }, [campaign, onClose, onSkip]);

  return null;
}
