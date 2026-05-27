import type { GuidedScheduledAction, GuidedSessionSnapshot } from '../../services/guidedActions';

interface GuidedStepHudProps {
  currentStep: GuidedScheduledAction | null;
  session: GuidedSessionSnapshot;
}

export function GuidedStepHud({ currentStep, session }: GuidedStepHudProps) {
  const total = session.plan.actions.length;
  const current = currentStep ? currentStep.index + 1 : total;
  const label = currentStep?.action.label ?? currentStep?.family ?? session.label ?? session.context.playbackMode;

  return (
    <div className="guided-step-hud" role="status">
      <span className="guided-step-hud-label">{label}</span>
      <span className="guided-step-hud-count">{Math.min(current, total)} / {total}</span>
    </div>
  );
}
