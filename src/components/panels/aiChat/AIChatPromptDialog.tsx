import type { RefObject } from 'react';
import type { AIProvider } from '../../../stores/settingsStore';
import { getDefaultProjectPromptName, type SavedAiSystemPrompt } from '../../../services/aiPromptLibrary';

interface AIChatPromptDialogProps {
  aiProvider: AIProvider;
  exportPromptDraft: () => void;
  isPromptLibraryLoading: boolean;
  loadPromptFile: (event: React.ChangeEvent<HTMLInputElement>) => void;
  loadSelectedProjectPrompt: () => void;
  projectPromptStorageReady: boolean;
  promptDialogError: string | null;
  promptDialogStatus: string | null;
  promptDraft: string;
  promptFileInputRef: RefObject<HTMLInputElement | null>;
  promptHasOverride: boolean;
  promptNameDraft: string;
  refreshSavedPromptFiles: () => void;
  resetPromptDraft: () => void;
  savePromptDialog: () => void;
  savedPromptFiles: SavedAiSystemPrompt[];
  selectedPromptFile: string;
  setIsPromptDialogOpen: (open: boolean) => void;
  setPromptDraft: (draft: string) => void;
  setPromptNameDraft: (name: string) => void;
  setSelectedPromptFile: (fileName: string) => void;
}

export function AIChatPromptDialog({
  aiProvider,
  exportPromptDraft,
  isPromptLibraryLoading,
  loadPromptFile,
  loadSelectedProjectPrompt,
  projectPromptStorageReady,
  promptDialogError,
  promptDialogStatus,
  promptDraft,
  promptFileInputRef,
  promptHasOverride,
  promptNameDraft,
  refreshSavedPromptFiles,
  resetPromptDraft,
  savePromptDialog,
  savedPromptFiles,
  selectedPromptFile,
  setIsPromptDialogOpen,
  setPromptDraft,
  setPromptNameDraft,
  setSelectedPromptFile,
}: AIChatPromptDialogProps) {
  return (
    <div className="ai-prompt-dialog-backdrop" onClick={() => setIsPromptDialogOpen(false)}>
      <div className="ai-prompt-dialog" onClick={(event) => event.stopPropagation()}>
        <input
          ref={promptFileInputRef}
          type="file"
          accept=".txt,.md,.prompt,text/plain,text/markdown"
          className="ai-prompt-file-input"
          onChange={loadPromptFile}
        />
        <div className="ai-prompt-dialog-header">
          <div>
            <h3>System Prompt</h3>
            <span>{aiProvider === 'lemonade' ? 'Lemonade Local' : 'OpenAI / Cloud'}</span>
          </div>
          <button
            className="ai-prompt-dialog-close"
            onClick={() => setIsPromptDialogOpen(false)}
            title="Close"
          >
            x
          </button>
        </div>
        <div className="ai-prompt-library">
          <label className="ai-prompt-name-field">
            <span>Name</span>
            <input
              value={promptNameDraft}
              onChange={(event) => setPromptNameDraft(event.target.value)}
              placeholder={getDefaultProjectPromptName(aiProvider)}
              disabled={isPromptLibraryLoading}
            />
          </label>
          <div className="ai-prompt-load-row">
            <select
              className="ai-prompt-select"
              value={selectedPromptFile}
              onChange={(event) => setSelectedPromptFile(event.target.value)}
              disabled={!projectPromptStorageReady || isPromptLibraryLoading || savedPromptFiles.length === 0}
            >
              {savedPromptFiles.length === 0 ? (
                <option value="">No saved prompts</option>
              ) : (
                savedPromptFiles.map((prompt) => (
                  <option key={prompt.fileName} value={prompt.fileName}>
                    {prompt.name}
                  </option>
                ))
              )}
            </select>
            <button
              onClick={loadSelectedProjectPrompt}
              disabled={!selectedPromptFile || isPromptLibraryLoading}
            >
              Load
            </button>
            <button onClick={refreshSavedPromptFiles} disabled={isPromptLibraryLoading}>
              Refresh
            </button>
          </div>
          {(promptDialogError || promptDialogStatus || !projectPromptStorageReady) && (
            <div className={`ai-prompt-feedback ${promptDialogError ? 'error' : ''}`}>
              {promptDialogError || promptDialogStatus || 'Open a project to use saved prompts.'}
            </div>
          )}
        </div>
        <textarea
          className="ai-prompt-textarea"
          value={promptDraft}
          onChange={(event) => setPromptDraft(event.target.value)}
          spellCheck={false}
        />
        <div className="ai-prompt-dialog-footer">
          <span className="ai-prompt-status">
            {promptHasOverride ? 'Custom' : 'Default'} - {promptDraft.length} chars
          </span>
          <div className="ai-prompt-actions">
            <button onClick={() => promptFileInputRef.current?.click()} disabled={isPromptLibraryLoading}>
              Import
            </button>
            <button onClick={exportPromptDraft} disabled={!promptDraft.trim()}>
              Export
            </button>
            <button onClick={resetPromptDraft} disabled={isPromptLibraryLoading}>
              Reset
            </button>
            <button onClick={() => setIsPromptDialogOpen(false)}>
              Cancel
            </button>
            <button
              className="primary"
              onClick={savePromptDialog}
              disabled={!promptDraft.trim() || !projectPromptStorageReady || isPromptLibraryLoading}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
