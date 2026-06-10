import type { ModelToolResult } from '../aiChatSerialization';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: Date;
  modelContent?: string;
  toolCalls?: ToolCall[];
  toolName?: string;
  isToolResult?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface APIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface PendingApproval {
  toolName: string;
  args: Record<string, unknown>;
  resolve: (approved: boolean) => void;
}

export interface ExecutedToolResult {
  result: ModelToolResult;
  toolName: string;
}

export type SelectorMenu = 'provider' | 'model' | null;
export type AiApprovalMode = 'auto' | 'confirm-destructive' | 'confirm-all-mutating';
