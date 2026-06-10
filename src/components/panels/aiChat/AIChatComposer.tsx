import type { KeyboardEventHandler, RefObject } from 'react';
import type { AiApprovalMode } from './types';

interface AIChatComposerProps {
  aiApprovalMode: AiApprovalMode;
  editorMode: boolean;
  hasAccess: boolean;
  input: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  isLoading: boolean;
  onInputChange: (value: string) => void;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  onSend: () => void;
  onToggleApprovalMode: () => void;
}

export function AIChatComposer({
  aiApprovalMode,
  editorMode,
  hasAccess,
  input,
  inputRef,
  isLoading,
  onInputChange,
  onKeyDown,
  onSend,
  onToggleApprovalMode,
}: AIChatComposerProps) {
  return (
    <div className="ai-chat-input-area">
      <textarea
        ref={inputRef}
        className="ai-chat-input"
        value={input}
        onChange={(event) => onInputChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={editorMode
          ? "e.g., 'Remove all silent parts' or 'Split clip at 5 seconds'"
          : 'Type a message... (Enter to send)'}
        disabled={!hasAccess}
        rows={2}
      />
      <button
        type="button"
        className={`btn-approval-toggle ${aiApprovalMode === 'auto' ? 'auto-on' : ''}`}
        onClick={onToggleApprovalMode}
        disabled={!hasAccess}
        title={aiApprovalMode === 'auto'
          ? 'Auto-approval ON - the AI runs actions without asking. Click to require confirmation.'
          : 'Auto-approval OFF - destructive actions need your confirmation. Click to let the AI run them automatically.'}
        aria-pressed={aiApprovalMode === 'auto'}
      >
        {aiApprovalMode === 'auto' ? '⚡ Auto' : '🔒 Confirm'}
      </button>
      <button
        className="btn-send"
        onClick={onSend}
        disabled={!input.trim() || isLoading || !hasAccess}
      >
        {isLoading ? '...' : 'Send'}
      </button>
    </div>
  );
}
