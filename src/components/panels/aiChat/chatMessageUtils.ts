import type { ToolPolicyEntry } from '../../../services/aiTools';
import type { AIProvider } from '../../../stores/settingsStore';
import { formatStoredToolMessageForApi } from '../aiChatSerialization';
import { buildSystemPromptForApi } from './chatConfig';
import type { AiApprovalMode, APIMessage, ExecutedToolResult, Message, ToolCall } from './types';

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  if (error && typeof error === 'object') {
    const candidate = error as { error?: unknown; message?: unknown };

    if (typeof candidate.message === 'string' && candidate.message.trim().length > 0) {
      return candidate.message;
    }

    if (typeof candidate.error === 'string' && candidate.error.trim().length > 0) {
      return candidate.error;
    }
  }

  return 'Failed to send message';
}

function getNumericValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatSecondsForChat(value: unknown): string | null {
  const seconds = getNumericValue(value);
  if (seconds === null) {
    return null;
  }

  return `${seconds.toFixed(seconds % 1 === 0 ? 0 : 2)}s`;
}

function summarizeTimelineToolResult(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const timeline = data as {
    duration?: unknown;
    playheadPosition?: unknown;
    selectedClipIds?: unknown;
    totalClips?: unknown;
  };
  const parts: string[] = [];
  const clipCount = getNumericValue(timeline.totalClips);
  const duration = formatSecondsForChat(timeline.duration);
  const playhead = formatSecondsForChat(timeline.playheadPosition);
  const selectedCount = Array.isArray(timeline.selectedClipIds) ? timeline.selectedClipIds.length : null;

  if (clipCount !== null) parts.push(`${clipCount} clip${clipCount === 1 ? '' : 's'}`);
  if (duration) parts.push(`${duration} duration`);
  if (playhead) parts.push(`playhead at ${playhead}`);
  if (selectedCount !== null) parts.push(`${selectedCount} selected`);

  return parts.length > 0 ? `I checked the timeline: ${parts.join(', ')}.` : null;
}

function summarizeMediaToolResult(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const media = data as { items?: unknown; files?: unknown; folders?: unknown };
  const itemCount = Array.isArray(media.items)
    ? media.items.length
    : Array.isArray(media.files)
      ? media.files.length
      : null;
  const folderCount = Array.isArray(media.folders) ? media.folders.length : null;

  if (itemCount === null && folderCount === null) {
    return null;
  }

  const parts: string[] = [];
  if (itemCount !== null) parts.push(`${itemCount} item${itemCount === 1 ? '' : 's'}`);
  if (folderCount !== null) parts.push(`${folderCount} folder${folderCount === 1 ? '' : 's'}`);

  return `I checked the media panel: ${parts.join(', ')}.`;
}

export function formatToolFollowupFallback(executedToolResults: ExecutedToolResult[]): string {
  const lastToolResult = executedToolResults[executedToolResults.length - 1];

  if (!lastToolResult) {
    return 'The local model did not return a response.';
  }

  if (!lastToolResult.result.success) {
    return `The ${lastToolResult.toolName} tool failed: ${lastToolResult.result.error || 'Unknown error'}.`;
  }

  if (lastToolResult.toolName === 'getTimelineState') {
    return summarizeTimelineToolResult(lastToolResult.result.data)
      || 'I checked the timeline. The local model did not return a follow-up answer.';
  }

  if (lastToolResult.toolName === 'getMediaItems') {
    return summarizeMediaToolResult(lastToolResult.result.data)
      || 'I checked the media panel. The local model did not return a follow-up answer.';
  }

  const toolNames = Array.from(new Set(executedToolResults.map((entry) => entry.toolName)));
  return `Done. I ran ${toolNames.join(', ')}.`;
}

export function createHostedPromptIdempotencyKey(): string {
  return `hosted-chat:${Date.now()}:${crypto.randomUUID()}`;
}

export function sanitizeConversationHistory(messages: Message[]): Message[] {
  if (messages.length === 0) {
    return messages;
  }

  const lastMessage = messages[messages.length - 1];
  if (lastMessage.role === 'assistant' && lastMessage.toolCalls && lastMessage.toolCalls.length > 0) {
    return messages.slice(0, -1);
  }

  let cursor = messages.length - 1;

  while (cursor >= 0 && messages[cursor].role === 'tool') {
    cursor -= 1;
  }

  if (cursor >= 0) {
    const candidate = messages[cursor];
    if (candidate.role === 'assistant' && candidate.toolCalls && candidate.toolCalls.length > 0) {
      return messages.slice(0, cursor);
    }
  }

  return messages;
}

export function shouldRequireConfirmation(
  policy: ToolPolicyEntry | undefined,
  approvalMode: AiApprovalMode,
): boolean {
  if (!policy) return true;
  if (approvalMode === 'auto') return false;
  if (approvalMode === 'confirm-destructive') {
    return policy.requiresConfirmation || policy.riskLevel === 'high' ||
      policy.localFileAccess || policy.sensitiveDataAccess;
  }
  return !policy.readOnly;
}

export function parseChatCompletionPayload(data: unknown): {
  content: string | null;
  toolCalls: ToolCall[];
} {
  const payload = data as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id: string;
          function: { name: string; arguments: string };
        }>;
      };
    }>;
  };
  const choice = payload.choices?.[0];

  return {
    content: choice?.message?.content || null,
    toolCalls: (choice?.message?.tool_calls || []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    })),
  };
}

export function buildAIChatApiMessages({
  activeSystemPrompt,
  aiProvider,
  editorMode,
  messages,
  userContent,
}: {
  activeSystemPrompt: string;
  aiProvider: AIProvider;
  editorMode: boolean;
  messages: Message[];
  userContent: string;
}): APIMessage[] {
  const apiMessages: APIMessage[] = [];
  const safeMessages = sanitizeConversationHistory(messages);
  const includeHistory = aiProvider !== 'lemonade' || !editorMode;

  if (editorMode) {
    apiMessages.push({
      role: 'system',
      content: buildSystemPromptForApi(activeSystemPrompt),
    });
  }

  if (includeHistory) {
    for (const msg of safeMessages) {
      if (msg.role === 'user') {
        apiMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        if (aiProvider === 'lemonade' && msg.toolCalls && msg.toolCalls.length > 0) {
          continue;
        }

        if (msg.toolCalls && msg.toolCalls.length > 0) {
          apiMessages.push({
            role: 'assistant',
            content: msg.content || null,
            tool_calls: msg.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: tc.arguments },
            })),
          });
        } else {
          apiMessages.push({ role: 'assistant', content: msg.content });
        }
      } else if (msg.role === 'tool' && msg.toolName) {
        if (aiProvider === 'lemonade') {
          continue;
        }

        apiMessages.push({
          role: 'tool',
          content: formatStoredToolMessageForApi(msg.modelContent ?? msg.content),
          tool_call_id: msg.id,
        });
      }
    }
  }

  apiMessages.push({ role: 'user', content: userContent });

  return apiMessages;
}
