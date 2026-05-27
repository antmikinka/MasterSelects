import type { CampaignCategory } from '../tutorialCampaigns';
import type { GuidedScenario, GuidedScenarioStep } from '../../../services/guidedActions';

export type InteractiveCampaignStep = GuidedScenarioStep;

export interface InteractiveCampaign extends GuidedScenario {
  category: CampaignCategory;
  description: string;
  icon: string;
  steps: InteractiveCampaignStep[];
}

export const INTERACTIVE_CAMPAIGNS: InteractiveCampaign[] = [
  {
    id: 'guided-select-clip',
    title: 'Guided Clip Selection',
    description: 'Practice the guided tutorial flow by selecting any clip on the timeline.',
    icon: 'G',
    category: 'basics',
    defaultMode: 'guided',
    animationBudgetMs: 3000,
    steps: [
      {
        id: 'select-any-clip',
        title: 'Select a timeline clip',
        body: 'Select any clip in the timeline. The tutorial advances when the Timeline store reports a selected clip.',
        mode: 'guided',
        target: { kind: 'panel', panel: 'timeline' },
        waitFor: { kind: 'clipSelected' },
        timeoutMs: 30000,
      },
    ],
  },
];
