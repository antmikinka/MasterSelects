import type { AIProvider } from '../../../stores/settingsStore';
import { DEFAULT_LEMONADE_ENDPOINT } from '../../../services/lemonadeProvider';

interface AIChatAccessOverlayProps {
  accountAuthenticated: boolean;
  aiProvider: AIProvider;
  lemonadeEndpoint: string;
  lemonadeStatus: 'online' | 'offline' | 'checking';
  onOpenAccountDialog: () => void;
  onOpenAuthDialog: () => void;
  onOpenPricingDialog: () => void;
  onOpenSettings: () => void;
  onSetProvider: (provider: AIProvider) => void;
}

export function AIChatAccessOverlay({
  accountAuthenticated,
  aiProvider,
  lemonadeEndpoint,
  lemonadeStatus,
  onOpenAccountDialog,
  onOpenAuthDialog,
  onOpenPricingDialog,
  onOpenSettings,
  onSetProvider,
}: AIChatAccessOverlayProps) {
  return (
    <div className="ai-panel-overlay">
      <div className="ai-panel-overlay-content">
        <span className="no-key-icon">🔑</span>
        <p>
          {aiProvider === 'lemonade'
            ? (lemonadeStatus === 'checking' ? 'Checking Lemonade' : 'Lemonade is not ready')
            : 'Choose an AI provider'}
        </p>
        <span className="ai-panel-overlay-subtext">
          {aiProvider === 'lemonade'
            ? `Load a local model in Lemonade, then retry ${lemonadeEndpoint || DEFAULT_LEMONADE_ENDPOINT}.`
            : 'Use a local Lemonade model, sign in for Cloud, or add your own OpenAI key.'}
        </span>
        <div className="ai-panel-overlay-actions">
          {aiProvider === 'lemonade' ? (
            <>
              <button className="btn-settings primary" onClick={onOpenSettings}>
                Settings
              </button>
              <button className="btn-settings secondary" onClick={() => onSetProvider('openai')}>
                Use OpenAI
              </button>
            </>
          ) : (
            <>
              <button className="btn-settings primary" onClick={() => onSetProvider('lemonade')}>
                Use Lemonade
              </button>
              {!accountAuthenticated ? (
                <>
                  <button className="btn-settings secondary" onClick={onOpenPricingDialog}>
                    Prices
                  </button>
                  <button className="btn-settings secondary" onClick={onOpenAuthDialog}>
                    Sign in
                  </button>
                </>
              ) : (
                <button className="btn-settings secondary" onClick={onOpenPricingDialog}>
                  View plans
                </button>
              )}
              {accountAuthenticated && (
                <button className="btn-settings ghost" onClick={onOpenAccountDialog}>
                  Account
                </button>
              )}
              <button className="btn-settings ghost" onClick={onOpenSettings}>
                API Keys
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
