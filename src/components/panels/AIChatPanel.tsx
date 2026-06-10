import { useState, useCallback, useRef } from 'react';
import { useSettingsStore, type AIProvider } from '../../stores/settingsStore';
import { useAccountStore } from '../../stores/accountStore';
import {
  AI_TOOLS,
  createGuidedReplayBudgetController,
  executeAIToolCalls,
  getToolPolicy,
} from '../../services/aiTools';
import { cloudAiService } from '../../services/cloudAiService';
import { isProjectPromptStorageAvailable } from '../../services/aiPromptLibrary';
import {
  createLemonadeChatCompletionStream,
  DEFAULT_LEMONADE_MODEL,
} from '../../services/lemonadeProvider';
import {
  formatToolResultForApi,
  MAX_TOOL_RESULT_MESSAGE_CHARS,
  type ModelToolResult,
} from './aiChatSerialization';
import { AIChatAccessOverlay } from './aiChat/AIChatAccessOverlay';
import { AIChatComposer } from './aiChat/AIChatComposer';
import { AIChatHeader } from './aiChat/AIChatHeader';
import { AIChatMessages } from './aiChat/AIChatMessages';
import { AIChatPromptDialog } from './aiChat/AIChatPromptDialog';
import {
  EDITOR_SYSTEM_PROMPT,
  getLemonadeModelOptions,
  LEMONADE_CHAT_TIMEOUT_MS,
  LEMONADE_EDITOR_SYSTEM_PROMPT,
  LEMONADE_EDITOR_TOOLS,
  LEMONADE_MAX_COMPLETION_TOKENS,
  LEMONADE_MAX_TOOL_RESULT_MESSAGE_CHARS,
  LEMONADE_STREAM_IDLE_TIMEOUT_MS,
  LEMONADE_TOOL_FOLLOWUP_TIMEOUT_MS,
  OPENAI_MODELS,
} from './aiChat/chatConfig';
import {
  buildAIChatApiMessages,
  createHostedPromptIdempotencyKey,
  formatToolFollowupFallback,
  getErrorMessage,
  parseChatCompletionPayload,
  sanitizeConversationHistory,
  shouldRequireConfirmation,
} from './aiChat/chatMessageUtils';
import type { APIMessage, ExecutedToolResult, Message, PendingApproval, SelectorMenu, ToolCall } from './aiChat/types';
import { useAIChatPromptLibrary } from './aiChat/useAIChatPromptLibrary';
import { useAIChatLoadingFocusGuard, useAIChatScroll } from './aiChat/useAIChatScroll';
import { useAIChatSelectorMenu } from './aiChat/useAIChatSelectorMenu';
import { useLemonadeHealth } from './aiChat/useLemonadeHealth';
import './AIChatPanel.css';

export function AIChatPanel() {
  const {
    apiKeys,
    apiKeyDefaults,
    apiKeysUnlocked,
    openSettings,
    aiApprovalMode,
    setAiApprovalMode,
    aiProvider,
    aiSystemPromptOverrides,
    lemonadeEndpoint,
    lemonadeModel,
    setAiProvider,
    setAiSystemPromptOverride,
    setLemonadeModel,
  } = useSettingsStore();
  const hasSeenAIChatOnboarding = useSettingsStore((s) => s.hasSeenAIChatOnboarding);
  const setHasSeenAIChatOnboarding = useSettingsStore((s) => s.setHasSeenAIChatOnboarding);
  const hostedAIEnabled = useAccountStore((s) => s.hostedAIEnabled);
  const accountSession = useAccountStore((s) => s.session);
  const loadAccountState = useAccountStore((s) => s.loadAccountState);
  const openAuthDialog = useAccountStore((s) => s.openAuthDialog);
  const openPricingDialog = useAccountStore((s) => s.openPricingDialog);
  const openAccountDialog = useAccountStore((s) => s.openAccountDialog);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [model, setModel] = useState('gpt-5.1');
  const [error, setError] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState(true); // Enable tools by default
  const [currentToolAction, setCurrentToolAction] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [onboardingClosing, setOnboardingClosing] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [openSelectorMenu, setOpenSelectorMenu] = useState<SelectorMenu>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shouldRefocusInputAfterLoadingRef = useRef(false);
  const messagesEndRef = useAIChatScroll(messages, currentToolAction);
  const selectorMenuRef = useAIChatSelectorMenu(openSelectorMenu, setOpenSelectorMenu);
  useAIChatLoadingFocusGuard(isLoading, panelRef, shouldRefocusInputAfterLoadingRef);
  const { lemonadeModels, lemonadeStatus } = useLemonadeHealth(aiProvider, lemonadeEndpoint);

  const hasHostedAccess = Boolean(accountSession?.authenticated && hostedAIEnabled);
  const useOpenAiKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.openai && apiKeys.openai.trim());
  const useHostedProductionProviders = import.meta.env.PROD;
  const openAiAccessMode: 'hosted' | 'byo' | 'none' = !useHostedProductionProviders && useOpenAiKeyByDefault
    ? 'byo'
    : hasHostedAccess ? 'hosted' : 'none';
  const accessMode: 'hosted' | 'byo' | 'lemonade' | 'none' =
    aiProvider === 'lemonade'
      ? (lemonadeStatus === 'online' ? 'lemonade' : 'none')
      : openAiAccessMode;
  const hasAccess = accessMode !== 'none';
  const lemonadeModelOptions = getLemonadeModelOptions(lemonadeModels, lemonadeModel);
  const configuredLemonadeModel = lemonadeModel.trim() || DEFAULT_LEMONADE_MODEL;
  const activeLemonadeModel = lemonadeModelOptions.some((option) => option.id === configuredLemonadeModel)
    ? configuredLemonadeModel
    : lemonadeModelOptions[0]?.id || configuredLemonadeModel;
  const accessLabel = accessMode === 'hosted'
    ? 'Cloud'
    : accessMode === 'byo'
      ? 'OpenAI key'
      : accessMode === 'lemonade'
        ? 'Local'
        : 'Locked';
  const activeModelName = aiProvider === 'lemonade'
    ? lemonadeModelOptions.find((option) => option.id === activeLemonadeModel)?.name || activeLemonadeModel
    : OPENAI_MODELS.find((option) => option.id === model)?.name || model;
  const activeProviderName = aiProvider === 'lemonade' ? 'Lemonade' : 'OpenAI';
  const activeProviderFullName = aiProvider === 'lemonade' ? 'Lemonade Local' : 'OpenAI / Cloud';
  const activeModelId = aiProvider === 'lemonade' ? activeLemonadeModel : model;
  const modelMenuOptions = aiProvider === 'lemonade'
    ? lemonadeModelOptions.map((option) => ({
      id: option.id,
      label: option.available ? option.name : `${option.name} (preset)`,
      meta: option.available ? 'loaded' : 'preset',
      disabled: false,
    }))
    : OPENAI_MODELS.map((option) => ({
      id: option.id,
      label: option.name,
      meta: accessMode === 'byo'
        ? 'OpenAI API'
        : option.credits === 1 ? '1 credit' : `${option.credits} credits`,
      disabled: false,
    }));
  const modelMenuDisabled = isLoading || (aiProvider === 'lemonade' && lemonadeModelOptions.length === 0);
  const defaultSystemPrompt = aiProvider === 'lemonade'
    ? LEMONADE_EDITOR_SYSTEM_PROMPT
    : EDITOR_SYSTEM_PROMPT;
  const activeSystemPrompt = aiSystemPromptOverrides[aiProvider]?.trim()
    ? aiSystemPromptOverrides[aiProvider]!
    : defaultSystemPrompt;
  const promptHasOverride = Boolean(aiSystemPromptOverrides[aiProvider]?.trim());
  const projectPromptStorageReady = isProjectPromptStorageAvailable();
  const {
    exportPromptDraft,
    isPromptDialogOpen,
    isPromptLibraryLoading,
    loadPromptFile,
    loadSelectedProjectPrompt,
    openPromptDialog,
    promptDialogError,
    promptDialogStatus,
    promptDraft,
    promptFileInputRef,
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
  } = useAIChatPromptLibrary({
    activeSystemPrompt,
    aiProvider,
    defaultSystemPrompt,
    setAiSystemPromptOverride,
  });

  const buildAPIMessages = useCallback((userContent: string): APIMessage[] => (
    buildAIChatApiMessages({
      activeSystemPrompt,
      aiProvider,
      editorMode,
      messages,
      userContent,
    })
  ), [activeSystemPrompt, aiProvider, editorMode, messages]);

  const callOpenAI = useCallback(async (
    apiMessages: APIMessage[],
    idempotencyKey?: string,
  ): Promise<{
    content: string | null;
    toolCalls: ToolCall[];
  }> => {
    const isNewerModel = model.startsWith('gpt-5') || model.startsWith('o3') || model.startsWith('o4');

    const requestBody: Record<string, unknown> = {
      model,
      messages: apiMessages,
      ...(isNewerModel
        ? { max_completion_tokens: 4096 }
        : { max_tokens: 4096 }),
    };

    if (editorMode) {
      requestBody.tools = AI_TOOLS;
      requestBody.tool_choice = 'auto';
    }

    if (accessMode === 'hosted') {
      if (idempotencyKey) {
        requestBody.idempotencyKey = idempotencyKey;
      }

      return parseChatCompletionPayload(await cloudAiService.createChatCompletion(requestBody));
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKeys.openai}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API error: ${response.status}`);
    }

    return parseChatCompletionPayload(await response.json());
  }, [accessMode, model, editorMode, apiKeys.openai]);

  const callLemonade = useCallback(async (
    apiMessages: APIMessage[],
    onContentDelta?: (delta: string) => void,
    options?: {
      allowTools?: boolean;
      streamIdleTimeoutMs?: number;
      timeoutMs?: number;
    },
  ): Promise<{
    content: string | null;
    toolCalls: ToolCall[];
  }> => createLemonadeChatCompletionStream({
    endpoint: lemonadeEndpoint,
    model: activeLemonadeModel,
    messages: apiMessages,
    tools: editorMode && options?.allowTools !== false ? LEMONADE_EDITOR_TOOLS : undefined,
    maxTokens: LEMONADE_MAX_COMPLETION_TOKENS,
    onContentDelta,
    streamIdleTimeoutMs: options?.streamIdleTimeoutMs ?? LEMONADE_STREAM_IDLE_TIMEOUT_MS,
    timeoutMs: options?.timeoutMs ?? LEMONADE_CHAT_TIMEOUT_MS,
  }), [activeLemonadeModel, editorMode, lemonadeEndpoint]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || !hasAccess || isLoading) return;

    const userContent = input.trim();
    const transientMessageIds = new Set<string>();
    const executedToolResults: ExecutedToolResult[] = [];
    const guidedReplayBudgetController = createGuidedReplayBudgetController();
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: userContent,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setError(null);
    setIsLoading(true);
    shouldRefocusInputAfterLoadingRef.current = true;

    try {
      const apiMessages = buildAPIMessages(userContent);
      const hostedPromptIdempotencyKey = accessMode === 'hosted'
        ? createHostedPromptIdempotencyKey()
        : undefined;
      let iterationCount = 0;
      const maxIterations = 50; // Safety limit for tool iterations

      while (iterationCount < maxIterations) {
        iterationCount++;

        let content: string | null;
        let toolCalls: ToolCall[];
        let streamedAssistantMessageId: string | null = null;

        if (aiProvider === 'lemonade') {
          const assistantMessageId = `assistant-${Date.now()}-${iterationCount}`;
          streamedAssistantMessageId = assistantMessageId;
          transientMessageIds.add(assistantMessageId);
          let streamedContent = '';
          const hasToolContext = executedToolResults.length > 0;

          setMessages(prev => [...prev, {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            timestamp: new Date(),
          }]);
          setStreamingMessageId(assistantMessageId);

          let result: { content: string | null; toolCalls: ToolCall[] };

          try {
            result = await callLemonade(apiMessages, (delta) => {
              streamedContent += delta;
              setMessages(prev => prev.map((message) => (
                message.id === assistantMessageId
                  ? { ...message, content: streamedContent }
                  : message
              )));
            }, {
              allowTools: !hasToolContext,
              streamIdleTimeoutMs: LEMONADE_STREAM_IDLE_TIMEOUT_MS,
              timeoutMs: hasToolContext ? LEMONADE_TOOL_FOLLOWUP_TIMEOUT_MS : LEMONADE_CHAT_TIMEOUT_MS,
            });
          } catch (lemonadeError) {
            if (!hasToolContext && editorMode && streamedContent.length === 0) {
              result = await callLemonade(apiMessages, (delta) => {
                streamedContent += delta;
                setMessages(prev => prev.map((message) => (
                  message.id === assistantMessageId
                    ? { ...message, content: streamedContent }
                    : message
                )));
              }, {
                allowTools: false,
                streamIdleTimeoutMs: LEMONADE_STREAM_IDLE_TIMEOUT_MS,
                timeoutMs: LEMONADE_CHAT_TIMEOUT_MS,
              });
            } else if (!hasToolContext) {
              throw lemonadeError;
            } else {
              result = {
                content: formatToolFollowupFallback(executedToolResults),
                toolCalls: [],
              };
            }
          }

          setStreamingMessageId(null);
          content = result.content || (hasToolContext ? formatToolFollowupFallback(executedToolResults) : null);
          toolCalls = result.toolCalls;

          if (content !== streamedContent) {
            setMessages(prev => prev.map((message) => (
              message.id === assistantMessageId
                ? { ...message, content: content || '' }
                : message
            )));
          }
        } else {
          const result = await callOpenAI(
            apiMessages,
            hostedPromptIdempotencyKey ? `${hostedPromptIdempotencyKey}:round:${iterationCount}` : undefined,
          );
          content = result.content;
          toolCalls = result.toolCalls;
        }

        if (toolCalls.length === 0) {
          const finalContent = content || (executedToolResults.length > 0
            ? formatToolFollowupFallback(executedToolResults)
            : null);

          if (streamedAssistantMessageId) {
            if (finalContent) {
              if (finalContent !== content) {
                setMessages(prev => prev.map((message) => (
                  message.id === streamedAssistantMessageId
                    ? { ...message, content: finalContent }
                    : message
                )));
              }
              transientMessageIds.delete(streamedAssistantMessageId);
            } else {
              setMessages(prev => prev.filter((message) => message.id !== streamedAssistantMessageId));
            }
          } else if (finalContent) {
            const assistantMessage: Message = {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: finalContent,
              timestamp: new Date(),
            };
            setMessages(prev => [...prev, assistantMessage]);
          }
          break;
        }

        const assistantMessage: Message = {
          id: streamedAssistantMessageId || `assistant-${Date.now()}-${iterationCount}`,
          role: 'assistant',
          content: content || '',
          timestamp: new Date(),
          toolCalls,
        };
        if (streamedAssistantMessageId) {
          setMessages(prev => prev.map((message) => (
            message.id === streamedAssistantMessageId ? assistantMessage : message
          )));
        } else {
          transientMessageIds.add(assistantMessage.id);
          setMessages(prev => [...prev, assistantMessage]);
        }

        apiMessages.push({
          role: 'assistant',
          content: content || null,
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });

        const preparedToolCalls: Array<{
          args: Record<string, unknown>;
          result?: ModelToolResult;
          toolCall: ToolCall;
        }> = [];

        for (let toolCallIndex = 0; toolCallIndex < toolCalls.length; toolCallIndex++) {
          const toolCall = toolCalls[toolCallIndex];
          if (!toolCall) {
            continue;
          }
          setCurrentToolAction(`Preparing: ${toolCall.name}`);

          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(toolCall.arguments);
          } catch {
            args = {};
          }

          const policy = getToolPolicy(toolCall.name);
          const needsConfirmation = shouldRequireConfirmation(policy, aiApprovalMode);

          let result: ModelToolResult;

          if (needsConfirmation) {
            const approved = await new Promise<boolean>((resolve) => {
              setPendingApproval({ toolName: toolCall.name, args, resolve });
            });
            setPendingApproval(null);

            if (!approved) {
              result = { success: false, error: 'User denied tool execution' };
              preparedToolCalls.push({ toolCall, args, result });
            } else {
              preparedToolCalls.push({ toolCall, args });
            }
          } else {
            preparedToolCalls.push({ toolCall, args });
          }
        }

        const executableToolCalls = preparedToolCalls.filter((entry) => !entry.result);
        const executedResultsByToolCallId = new Map<string, ModelToolResult>();
        if (executableToolCalls.length > 0) {
          setCurrentToolAction(executableToolCalls.length === 1
            ? `Executing: ${executableToolCalls[0]?.toolCall.name ?? 'tool'}`
            : `Executing ${executableToolCalls.length} tools`);

          try {
            const groupedResults = await executeAIToolCalls(
              executableToolCalls.map((entry) => ({
                id: entry.toolCall.id,
                tool: entry.toolCall.name,
                args: entry.args,
              })),
              'chat',
              { guidedReplayBudgetController },
            );
            for (const groupedResult of groupedResults) {
              if (groupedResult.id) {
                executedResultsByToolCallId.set(groupedResult.id, groupedResult.result);
              }
            }
          } catch (toolErr) {
            const errorResult = {
              success: false,
              error: toolErr instanceof Error ? toolErr.message : String(toolErr),
            };
            for (const entry of executableToolCalls) {
              executedResultsByToolCallId.set(entry.toolCall.id, errorResult);
            }
          }
        }

        for (const preparedToolCall of preparedToolCalls) {
          const { toolCall } = preparedToolCall;
          const result = preparedToolCall.result
            ?? executedResultsByToolCallId.get(toolCall.id)
            ?? { success: false, error: 'Tool execution did not return a result' };
          const modelToolResultContent = formatToolResultForApi(
            result,
            aiProvider === 'lemonade'
              ? LEMONADE_MAX_TOOL_RESULT_MESSAGE_CHARS
              : MAX_TOOL_RESULT_MESSAGE_CHARS,
          );
          const toolResultMessage: Message = {
            id: toolCall.id,
            role: 'tool',
            content: JSON.stringify(result, null, 2),
            modelContent: modelToolResultContent,
            timestamp: new Date(),
            toolName: toolCall.name,
            isToolResult: true,
          };
          transientMessageIds.add(toolResultMessage.id);
          executedToolResults.push({ toolName: toolCall.name, result });
          setMessages(prev => [...prev, toolResultMessage]);

          apiMessages.push({
            role: 'tool',
            content: modelToolResultContent,
            tool_call_id: toolCall.id,
          });
        }

        setCurrentToolAction(null);
      }

      if (iterationCount >= maxIterations) {
        setError('Too many tool iterations - stopping to prevent infinite loop');
      }
    } catch (err) {
      setStreamingMessageId(null);
      setMessages((prev) => sanitizeConversationHistory(
        prev.filter((message) => !transientMessageIds.has(message.id)),
      ));
      setError(getErrorMessage(err));
    } finally {
      if (accessMode === 'hosted') {
        void loadAccountState();
      }
      setIsLoading(false);
      setCurrentToolAction(null);
      setStreamingMessageId(null);
      window.setTimeout(() => {
        if (shouldRefocusInputAfterLoadingRef.current) {
          inputRef.current?.focus();
        }
        shouldRefocusInputAfterLoadingRef.current = false;
      }, 0);
    }
  }, [input, hasAccess, isLoading, buildAPIMessages, accessMode, aiProvider, callLemonade, callOpenAI, aiApprovalMode, editorMode, loadAccountState]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isLoading) {
        return;
      }

      e.preventDefault();
      sendMessage();
    }
  }, [isLoading, sendMessage]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const dismissOnboarding = useCallback(() => {
    setOnboardingClosing(true);
    setTimeout(() => {
      setHasSeenAIChatOnboarding(true);
    }, 300);
  }, [setHasSeenAIChatOnboarding]);

  const selectProvider = useCallback((provider: AIProvider) => {
    setAiProvider(provider);
    setOpenSelectorMenu(null);
  }, [setAiProvider]);

  const selectModel = useCallback((modelId: string) => {
    if (aiProvider === 'lemonade') {
      setLemonadeModel(modelId);
    } else {
      setModel(modelId);
    }
    setOpenSelectorMenu(null);
  }, [aiProvider, setLemonadeModel]);

  return (
    <div ref={panelRef} className={`ai-chat-panel ${!hasAccess ? 'no-api-key' : ''}`}>
      {!hasAccess && (
        <AIChatAccessOverlay
          accountAuthenticated={Boolean(accountSession?.authenticated)}
          aiProvider={aiProvider}
          lemonadeEndpoint={lemonadeEndpoint}
          lemonadeStatus={lemonadeStatus}
          onOpenAccountDialog={openAccountDialog}
          onOpenAuthDialog={openAuthDialog}
          onOpenPricingDialog={openPricingDialog}
          onOpenSettings={openSettings}
          onSetProvider={setAiProvider}
        />
      )}

      <AIChatHeader
        accessLabel={accessLabel}
        accessMode={accessMode}
        activeModelId={activeModelId}
        activeModelName={activeModelName}
        activeProviderFullName={activeProviderFullName}
        activeProviderName={activeProviderName}
        aiProvider={aiProvider}
        editorMode={editorMode}
        isLoading={isLoading}
        lemonadeModelOptionsCount={lemonadeModelOptions.length}
        messagesCount={messages.length}
        modelMenuDisabled={modelMenuDisabled}
        modelMenuOptions={modelMenuOptions}
        onClearChat={clearChat}
        onOpenPromptDialog={openPromptDialog}
        onSelectModel={selectModel}
        onSelectProvider={selectProvider}
        onSetEditorMode={setEditorMode}
        openSelectorMenu={openSelectorMenu}
        promptHasOverride={promptHasOverride}
        selectorMenuRef={selectorMenuRef}
        setOpenSelectorMenu={setOpenSelectorMenu}
      />

      {isPromptDialogOpen && (
        <AIChatPromptDialog
          aiProvider={aiProvider}
          exportPromptDraft={exportPromptDraft}
          isPromptLibraryLoading={isPromptLibraryLoading}
          loadPromptFile={loadPromptFile}
          loadSelectedProjectPrompt={loadSelectedProjectPrompt}
          projectPromptStorageReady={projectPromptStorageReady}
          promptDialogError={promptDialogError}
          promptDialogStatus={promptDialogStatus}
          promptDraft={promptDraft}
          promptFileInputRef={promptFileInputRef}
          promptHasOverride={promptHasOverride}
          promptNameDraft={promptNameDraft}
          refreshSavedPromptFiles={refreshSavedPromptFiles}
          resetPromptDraft={resetPromptDraft}
          savePromptDialog={savePromptDialog}
          savedPromptFiles={savedPromptFiles}
          selectedPromptFile={selectedPromptFile}
          setIsPromptDialogOpen={setIsPromptDialogOpen}
          setPromptDraft={setPromptDraft}
          setPromptNameDraft={setPromptNameDraft}
          setSelectedPromptFile={setSelectedPromptFile}
        />
      )}

      <AIChatMessages
        activeModelName={activeModelName}
        aiProvider={aiProvider}
        currentToolAction={currentToolAction}
        editorMode={editorMode}
        error={error}
        hasAccess={hasAccess}
        hasSeenAIChatOnboarding={hasSeenAIChatOnboarding}
        isLoading={isLoading}
        messages={messages}
        messagesEndRef={messagesEndRef}
        onboardingClosing={onboardingClosing}
        onDismissOnboarding={dismissOnboarding}
        pendingApproval={pendingApproval}
        streamingMessageId={streamingMessageId}
      />

      <AIChatComposer
        aiApprovalMode={aiApprovalMode}
        editorMode={editorMode}
        hasAccess={hasAccess}
        input={input}
        inputRef={inputRef}
        isLoading={isLoading}
        onInputChange={setInput}
        onKeyDown={handleKeyDown}
        onSend={sendMessage}
        onToggleApprovalMode={() => setAiApprovalMode(aiApprovalMode === 'auto' ? 'confirm-destructive' : 'auto')}
      />
    </div>
  );
}
