import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { AIProvider } from '../../../stores/settingsStore';
import type { SelectorMenu } from './types';

interface ModelMenuOption {
  disabled: boolean;
  id: string;
  label: string;
  meta: string;
}

interface AIChatHeaderProps {
  accessLabel: string;
  accessMode: 'hosted' | 'byo' | 'lemonade' | 'none';
  activeModelId: string;
  activeModelName: string;
  activeProviderFullName: string;
  activeProviderName: string;
  aiProvider: AIProvider;
  editorMode: boolean;
  isLoading: boolean;
  lemonadeModelOptionsCount: number;
  messagesCount: number;
  modelMenuDisabled: boolean;
  modelMenuOptions: ModelMenuOption[];
  onClearChat: () => void;
  onOpenPromptDialog: () => void;
  onSelectModel: (modelId: string) => void;
  onSelectProvider: (provider: AIProvider) => void;
  onSetEditorMode: (enabled: boolean) => void;
  openSelectorMenu: SelectorMenu;
  promptHasOverride: boolean;
  selectorMenuRef: RefObject<HTMLDivElement | null>;
  setOpenSelectorMenu: Dispatch<SetStateAction<SelectorMenu>>;
}

export function AIChatHeader({
  accessLabel,
  accessMode,
  activeModelId,
  activeModelName,
  activeProviderFullName,
  activeProviderName,
  aiProvider,
  editorMode,
  isLoading,
  lemonadeModelOptionsCount,
  messagesCount,
  modelMenuDisabled,
  modelMenuOptions,
  onClearChat,
  onOpenPromptDialog,
  onSelectModel,
  onSelectProvider,
  onSetEditorMode,
  openSelectorMenu,
  promptHasOverride,
  selectorMenuRef,
  setOpenSelectorMenu,
}: AIChatHeaderProps) {
  return (
    <div className="ai-chat-header">
      <div className="ai-chat-title-group">
        <h2>AI Editor</h2>
        <span className={`ai-access-chip ${accessMode}`}>
          {accessLabel}
        </span>
      </div>
      <div className="ai-chat-controls">
        <div className="ai-selector-group" ref={selectorMenuRef}>
          <div className="ai-selector">
            <button
              className={`ai-selector-trigger ${openSelectorMenu === 'provider' ? 'active' : ''}`}
              onClick={() => setOpenSelectorMenu((current) => current === 'provider' ? null : 'provider')}
              disabled={isLoading}
              title={activeProviderFullName}
              aria-haspopup="menu"
              aria-expanded={openSelectorMenu === 'provider'}
            >
              <span className="ai-selector-value">{activeProviderName}</span>
              <span className="ai-selector-caret" aria-hidden="true" />
            </button>
            {openSelectorMenu === 'provider' && (
              <div className="ai-selector-menu provider-menu" role="menu">
                <button
                  className={`ai-selector-option ${aiProvider === 'openai' ? 'selected' : ''}`}
                  onClick={() => onSelectProvider('openai')}
                  role="menuitemradio"
                  aria-checked={aiProvider === 'openai'}
                >
                  <span className="ai-selector-option-title">OpenAI / Cloud</span>
                  <span className="ai-selector-option-meta">hosted or key</span>
                </button>
                <button
                  className={`ai-selector-option ${aiProvider === 'lemonade' ? 'selected' : ''}`}
                  onClick={() => onSelectProvider('lemonade')}
                  role="menuitemradio"
                  aria-checked={aiProvider === 'lemonade'}
                >
                  <span className="ai-selector-option-title">Lemonade Local</span>
                  <span className="ai-selector-option-meta">local model</span>
                </button>
              </div>
            )}
          </div>
          <div className="ai-selector">
            <button
              className={`ai-selector-trigger model-trigger ${openSelectorMenu === 'model' ? 'active' : ''}`}
              onClick={() => setOpenSelectorMenu((current) => current === 'model' ? null : 'model')}
              disabled={modelMenuDisabled}
              title={aiProvider === 'lemonade' && lemonadeModelOptionsCount === 0 ? 'No Lemonade models found' : activeModelName}
              aria-haspopup="menu"
              aria-expanded={openSelectorMenu === 'model'}
            >
              <span className="ai-selector-value">{activeModelName}</span>
              <span className="ai-selector-caret" aria-hidden="true" />
            </button>
            {openSelectorMenu === 'model' && (
              <div className="ai-selector-menu model-menu" role="menu">
                {modelMenuOptions.length === 0 ? (
                  <div className="ai-selector-empty">No Lemonade models found</div>
                ) : (
                  modelMenuOptions.map((option) => (
                    <button
                      key={option.id}
                      className={`ai-selector-option ${option.id === activeModelId ? 'selected' : ''}`}
                      onClick={() => onSelectModel(option.id)}
                      disabled={option.disabled}
                      role="menuitemradio"
                      aria-checked={option.id === activeModelId}
                      title={option.label}
                    >
                      <span className="ai-selector-option-title">{option.label}</span>
                      <span className="ai-selector-option-meta">{option.meta}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
        <label className="editor-mode-toggle" title="Enable timeline editing tools">
          <input
            type="checkbox"
            checked={editorMode}
            onChange={(event) => onSetEditorMode(event.target.checked)}
            disabled={isLoading}
          />
          <span className="toggle-label">Tools</span>
        </label>
        <button
          className={`btn-prompt ${promptHasOverride ? 'active' : ''}`}
          onClick={onOpenPromptDialog}
          disabled={isLoading}
          title="Edit system prompt"
        >
          Prompt
        </button>
        <button
          className="btn-clear"
          onClick={onClearChat}
          disabled={isLoading || messagesCount === 0}
          title="Clear chat"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
