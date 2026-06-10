import type { RefObject } from 'react';
import type { AIProvider } from '../../../stores/settingsStore';
import type { Message, PendingApproval } from './types';

interface AIChatMessagesProps {
  activeModelName: string;
  aiProvider: AIProvider;
  currentToolAction: string | null;
  editorMode: boolean;
  error: string | null;
  hasAccess: boolean;
  hasSeenAIChatOnboarding: boolean;
  isLoading: boolean;
  messages: Message[];
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onboardingClosing: boolean;
  onDismissOnboarding: () => void;
  pendingApproval: PendingApproval | null;
  streamingMessageId: string | null;
}

function MessageLines({ content }: { content: string }) {
  return (
    <>
      {content.split('\n').map((line, index) => (
        <p key={index}>{line || '\u00A0'}</p>
      ))}
    </>
  );
}

function TypingIndicator() {
  return (
    <span className="typing-indicator">
      <span></span><span></span><span></span>
    </span>
  );
}

function MessageHeader({ role, timestamp }: { role: 'user' | 'assistant'; timestamp: Date }) {
  return (
    <div className="message-header">
      <span className="message-role">{role === 'user' ? 'You' : 'AI'}</span>
      <span className="message-time">
        {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  );
}

function ToolResultMessage({ message }: { message: Message }) {
  return (
    <div className="ai-chat-message tool-result">
      <div className="tool-result-header">
        <span className="tool-icon">🔧</span>
        <span className="tool-name">{message.toolName}</span>
      </div>
      <pre className="tool-result-content">
        {message.content.length > 500
          ? `${message.content.substring(0, 500)}...`
          : message.content}
      </pre>
    </div>
  );
}

function ToolCallMessage({ message }: { message: Message }) {
  return (
    <div className="ai-chat-message assistant">
      <MessageHeader role="assistant" timestamp={message.timestamp} />
      {message.content && (
        <div className="message-content">
          <MessageLines content={message.content} />
        </div>
      )}
      <div className="tool-calls">
        {message.toolCalls?.map((toolCall) => (
          <div key={toolCall.id} className="tool-call">
            <span className="tool-call-name">{toolCall.name}</span>
            <span className="tool-call-args">
              {toolCall.arguments.length > 100
                ? `${toolCall.arguments.substring(0, 100)}...`
                : toolCall.arguments}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChatMessage({ message, streamingMessageId }: { message: Message; streamingMessageId: string | null }) {
  if (message.isToolResult) {
    return <ToolResultMessage message={message} />;
  }

  if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
    return <ToolCallMessage message={message} />;
  }

  return (
    <div className={`ai-chat-message ${message.role}`}>
      <MessageHeader role={message.role === 'user' ? 'user' : 'assistant'} timestamp={message.timestamp} />
      <div className="message-content">
        {message.id === streamingMessageId && message.content.length === 0 ? (
          <TypingIndicator />
        ) : (
          <MessageLines content={message.content} />
        )}
      </div>
    </div>
  );
}

function EmptyChatState({
  activeModelName,
  aiProvider,
  editorMode,
  hasAccess,
  hasSeenAIChatOnboarding,
  onboardingClosing,
  onDismissOnboarding,
}: Pick<AIChatMessagesProps,
  'activeModelName' | 'aiProvider' | 'editorMode' | 'hasAccess' | 'hasSeenAIChatOnboarding'
  | 'onboardingClosing' | 'onDismissOnboarding'>) {
  return (
    <>
      {hasAccess && !hasSeenAIChatOnboarding && (
        <div className={`ai-chat-onboarding ${onboardingClosing ? 'closing' : ''}`}>
          <div className="ai-chat-onboarding-card">
            <div className="ai-chat-onboarding-header">
              <span className="ai-chat-onboarding-icon">AI</span>
              <h3>Welcome to the AI Editor</h3>
            </div>
            <div className="ai-chat-onboarding-body">
              <p className="ai-chat-onboarding-intro">
                This AI assistant can directly edit your timeline. Just describe what you want in plain language.
              </p>
              <ul className="ai-chat-onboarding-tips">
                <li><strong>Cut &amp; trim:</strong> "Remove the first 3 seconds" or "Split at 10s"</li>
                <li><strong>Remove silence:</strong> "Find and remove all silent parts"</li>
                <li><strong>Analyze:</strong> "What clips are on the timeline?" or "Transcribe this clip"</li>
                <li><strong>Batch edits:</strong> "Delete all clips shorter than 1 second"</li>
                <li><strong>Downloads:</strong> "Search YouTube for nature footage and download it"</li>
              </ul>
              <p className="ai-chat-onboarding-note">
                The <strong>Tools</strong> toggle enables timeline editing. Turn it off for a normal chat.
                Use the approval mode in Settings to control which actions need your confirmation.
              </p>
            </div>
            <button className="ai-chat-onboarding-dismiss" onClick={onDismissOnboarding}>
              Got it
            </button>
          </div>
        </div>
      )}
      <div className="ai-chat-welcome">
        <p>{editorMode ? 'AI Editor Ready' : 'Start a conversation'}</p>
        <span className="welcome-hint">
          {editorMode
            ? (aiProvider === 'lemonade'
              ? `Using local ${activeModelName} with timeline tools`
              : 'Ask me to edit your timeline - cut clips, remove silence, etc.')
            : `Using ${activeModelName}`}
        </span>
      </div>
    </>
  );
}

export function AIChatMessages(props: AIChatMessagesProps) {
  const {
    currentToolAction,
    error,
    isLoading,
    messages,
    messagesEndRef,
    pendingApproval,
    streamingMessageId,
  } = props;

  return (
    <div className="ai-chat-messages">
      {messages.length === 0 ? (
        <EmptyChatState {...props} />
      ) : (
        messages.map((message) => (
          <ChatMessage key={message.id} message={message} streamingMessageId={streamingMessageId} />
        ))
      )}
      {pendingApproval && (
        <div className="ai-chat-message tool-approval">
          <div className="tool-approval-banner">
            <span className="tool-approval-label">Confirm action:</span>
            <span className="tool-approval-name">{pendingApproval.toolName}</span>
            <pre className="tool-approval-args">
              {JSON.stringify(pendingApproval.args, null, 2).substring(0, 200)}
            </pre>
            <div className="tool-approval-buttons">
              <button className="btn-approve" onClick={() => pendingApproval.resolve(true)}>
                Allow
              </button>
              <button className="btn-deny" onClick={() => pendingApproval.resolve(false)}>
                Deny
              </button>
            </div>
          </div>
        </div>
      )}
      {isLoading && (currentToolAction || !streamingMessageId) && (
        <div className="ai-chat-message assistant loading">
          <div className="message-header">
            <span className="message-role">AI</span>
          </div>
          <div className="message-content">
            {currentToolAction ? (
              <span className="tool-action">{currentToolAction}</span>
            ) : (
              <TypingIndicator />
            )}
          </div>
        </div>
      )}
      {error && (
        <div className="ai-chat-error">
          <span className="error-icon">⚠️</span>
          {error}
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}
