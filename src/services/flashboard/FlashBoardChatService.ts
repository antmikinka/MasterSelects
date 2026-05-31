import {
  createLemonadeChatCompletionStream,
  DEFAULT_LEMONADE_MODEL,
} from '../lemonadeProvider';
import { cloudAiService } from '../cloudAiService';
import {
  AI_TOOLS,
  createGuidedReplayBudgetController,
  executeAIToolCalls,
  getQuickTimelineSummary,
  getToolPolicy,
  type ToolDefinition,
  type ToolPolicyEntry,
  type ToolResult,
} from '../aiTools';
import { useSettingsStore } from '../../stores/settingsStore';

export type FlashBoardChatProvider = 'openai' | 'anthropic' | 'lemonade';
export type FlashBoardOpenAiReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

export interface FlashBoardChatProviderOption {
  id: FlashBoardChatProvider;
  label: string;
}

export interface FlashBoardChatModelOption {
  id: string;
  label: string;
  provider: FlashBoardChatProvider;
  supportsTemperature: boolean;
  supportsReasoningEffort?: boolean;
  reasoningEfforts?: FlashBoardOpenAiReasoningEffort[];
  maxTokensParameter?: 'max_tokens' | 'max_completion_tokens';
}

export interface FlashBoardChatRequest {
  anthropicApiKey?: string;
  hostedAvailable?: boolean;
  lemonadeEndpoint?: string;
  model: string;
  openAiApiKey?: string;
  openAiReasoningEffort?: FlashBoardOpenAiReasoningEffort;
  prompt: string;
  provider: FlashBoardChatProvider;
  signal?: AbortSignal;
  temperature: number;
}

export const FLASHBOARD_CHAT_PROVIDERS: FlashBoardChatProviderOption[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'lemonade', label: 'Lemon' },
];

const OPENAI_REASONING_EFFORTS_FULL: FlashBoardOpenAiReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh'];
const OPENAI_REASONING_EFFORTS_FAST: FlashBoardOpenAiReasoningEffort[] = ['none', 'low', 'medium', 'high'];

export const FLASHBOARD_CHAT_MODEL_OPTIONS: Record<FlashBoardChatProvider, FlashBoardChatModelOption[]> = {
  openai: [
    {
      id: 'gpt-5.5',
      label: '5.5',
      provider: 'openai',
      supportsTemperature: false,
      supportsReasoningEffort: true,
      reasoningEfforts: OPENAI_REASONING_EFFORTS_FULL,
    },
    {
      id: 'gpt-5.4',
      label: '5.4',
      provider: 'openai',
      supportsTemperature: false,
      supportsReasoningEffort: true,
      reasoningEfforts: OPENAI_REASONING_EFFORTS_FULL,
    },
    {
      id: 'gpt-5.4-mini',
      label: '5.4 Fast',
      provider: 'openai',
      supportsTemperature: false,
      supportsReasoningEffort: true,
      reasoningEfforts: OPENAI_REASONING_EFFORTS_FAST,
    },
    {
      id: 'gpt-5.4-nano',
      label: '5.4 Instant',
      provider: 'openai',
      supportsTemperature: false,
      supportsReasoningEffort: true,
      reasoningEfforts: OPENAI_REASONING_EFFORTS_FAST,
    },
  ],
  anthropic: [
    { id: 'claude-opus-4-1-20250805', label: 'Opus 4.1', provider: 'anthropic', supportsTemperature: true },
    { id: 'claude-sonnet-4-20250514', label: 'Sonnet 4', provider: 'anthropic', supportsTemperature: true },
    { id: 'claude-3-5-haiku-20241022', label: 'Haiku 3.5', provider: 'anthropic', supportsTemperature: true },
  ],
  lemonade: [
    { id: DEFAULT_LEMONADE_MODEL, label: 'Lemonade', provider: 'lemonade', supportsTemperature: true },
  ],
};

export const DEFAULT_FLASHBOARD_CHAT_PROVIDER: FlashBoardChatProvider = 'openai';
export const DEFAULT_FLASHBOARD_CHAT_MODEL = 'gpt-5.4-nano';
export const DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT: FlashBoardOpenAiReasoningEffort = 'none';
const FLASHBOARD_CHAT_MODEL_CREDIT_COSTS: Record<string, number> = {
  'gpt-5.5': 5,
  'gpt-5.4': 5,
  'gpt-5.4-mini': 1,
  'gpt-5.4-nano': 1,
};
export const FLASHBOARD_OPENAI_REASONING_EFFORT_OPTIONS: Array<{
  id: FlashBoardOpenAiReasoningEffort;
  label: string;
}> = [
  { id: 'none', label: 'None' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'XHigh' },
];
export const DEFAULT_FLASHBOARD_CHAT_TEMPERATURE = 0.7;
const FLASHBOARD_CHAT_MAX_TOOL_ITERATIONS = 12;
const FLASHBOARD_CHAT_MAX_TOOL_RESULT_CHARS = 8000;
const FLASHBOARD_LEMONADE_MAX_TOOL_RESULT_CHARS = 2000;
const FLASHBOARD_LEMONADE_TOOL_NAMES = new Set([
  'getTimelineState',
  'getClipDetails',
  'getClipsInTimeRange',
  'selectClips',
  'clearSelection',
  'setPlayhead',
  'setInOutPoints',
  'splitClip',
  'deleteClip',
  'moveClip',
  'trimClip',
  'cutRangesFromClip',
  'getMediaItems',
  'setTransform',
  'listEffects',
  'addEffect',
  'updateEffect',
  'undo',
  'redo',
  'play',
  'pause',
]);
const FLASHBOARD_LEMONADE_TOOLS = AI_TOOLS.filter((tool) => FLASHBOARD_LEMONADE_TOOL_NAMES.has(tool.function.name));

const FLASHBOARD_CHAT_SYSTEM_PROMPT = `You are an AI video editor working INSIDE MasterSelects, embedded in the Media panel chat. You drive the real app through the provided tools — you are not just giving advice, you perform the edits.

You are capable of complex, multi-step edits. Never refuse or silently downscope a task that the tools can express (e.g. "I could only do 5 of the 30 cuts"). If something seems hard, work out the tool sequence and do it. Only report a real limitation after you have actually tried the tools.

== CORE BEHAVIOUR ==
- All times are in seconds. split / move / addClipSegment use TIMELINE time; trim uses SOURCE-media time.
- Default to the selected clip / current media context when the user names no target.
- Inspect before answering about state: getTimelineState, getMediaItems, getClipDetails, getClipAnalysis, getClipTranscript.
- After an edit, say briefly what actually changed. If a tool result says confirmation is required or execution was denied, say so — never claim an edit happened when it did not.
- Keep prose short. Spend effort on correct tool calls, not long explanations.

== TOOL-STEP BUDGET (critical) ==
You get at most ~12 tool calls per turn. Never spend one call per item. For any N-item operation use a bulk tool:
- executeBatch({actions:[{tool,args}, ...]}) runs many tools in ONE call and ONE undo point. This is your main tool for N-item work.
- splitClipEvenly(parts) / splitClipAtTimes(times[]) split in one call.
- cutRangesFromClip(ranges[]) removes many ranges in one call (handles clip-id shifts itself).
- reorderClips(clipIds[]) repositions many clips in one call; deleteClips(clipIds[]) deletes many in one.
- addClipSegment(mediaFileId, trackId, startTime, inPoint, outPoint) imports ONLY a time-slice of a source onto the timeline — the right way to build montages from many short cuts (do NOT import whole clips and split them up).
- Output is capped (~2048 tokens/response), so ONE executeBatch can hold only ~20-25 actions before it truncates and runs as an empty "0 steps" batch. For larger N, split into several executeBatch calls of <=25 actions each (still well within the ~12 iterations). Never emit one giant batch for 50-100 cuts.

== WHAT YOU CAN DO (tool families) ==
Cutting: split* , trimClip, cutRangesFromClip, deleteClip(s), moveClip, reorderClips, addClipSegment.
Transform: setTransform (x/y, scale, rotation, opacity, blendMode) for PiP, split-screen, repositioning.
Effects: listEffects -> addEffect -> updateEffect / removeEffect (e.g. brightnessContrast, gaussianBlur, chromaKey).
Keyframes: addKeyframe(property, value, time, easing) to animate position, scale.all, rotation.z, opacity, speed.
Speed: setClipSpeed (slow-mo, 2x, reverse).
Masks: addRectangleMask / addEllipseMask / addMask(vertices) -> updateMask(feather/opacity/inverted).
Transitions: addTransition(crossDissolve/dip/wipe/slide, duration) between adjacent clips.
Tracks: createTrack, deleteTrack, setTrackVisibility, setTrackMuted.
Analysis: getClipAnalysis, getClipTranscript, findSilentSections, findLowQualitySections (start* to (re)run).
Media: getMediaItems, listLocalFiles, importLocalFiles, createComposition, openComposition, folders.
Download: searchVideos -> listVideoFormats -> downloadAndImportVideo (needs Native Helper).
Preview/QA: captureFrame, getFramesAtTimes, getCutPreviewQuad, getStats, simulatePlayback, getPlaybackTrace, getLogs.

== RECIPES (intent -> tool chain) ==
Random-cut / N-cut montage:
  Meaning: N short segments that actually VARY — not the same footage with N cut points. Choose by intent:
  - Assemble from sources (best variety): addClipSegment for N random source ranges (steps below).
  - Split + shuffle existing footage: splitClipAtTimes at the cut points, THEN reorderClips to randomise order — splitting alone leaves the same video playing, so you MUST shuffle (or drop pieces) or it looks unchanged.
  1) Find sources: getMediaItems (per folder, NOT recursive — if a folder holds subfolders, call getMediaItems(folderId) on each subfolder to reach the actual video files before concluding there are none), or listLocalFiles(dir) + importLocalFiles(paths) if not in the pool yet.
  2) Ensure a composition + target video track (getTimelineState for the trackId).
  3) Use ONLY video sources (type "video") — never images or audio. Read each source's duration from getMediaItems and clamp the slice so inPoint + sliceLen <= duration (leave a small margin); if a clip is shorter than the slice, shrink the slice or skip that clip. Emit the cuts as ONE executeBatch of N addClipSegment actions placed sequentially (startTime = running offset). Result: N valid cuts in one undo step.
  4) Each video cut also spawns a linked audio clip. If the montage should run under separate music, remove the source audio afterwards: getTimelineState -> deleteClips(the linked audio clip IDs, withLinked:false). Otherwise tell the user the source audio is kept.
Remove silence / dead air:
  findSilentSections(clipId) (or getClipTranscript) -> cutRangesFromClip(clipId, ranges) in one call.
Remove bad takes (blurry / dark / shaky):
  findLowQualitySections(clipId, metric) -> cutRangesFromClip with the returned timelineStart/timelineEnd.
Even / rhythmic cut:
  splitClipEvenly(clipId, parts) (or splitClipAtTimes for beats) -> optionally executeBatch of addTransition between neighbours.
Crossfade everything:
  for each adjacent pair, addTransition(clipAId, clipBId, "crossDissolve", dur) — batched.
Ken-Burns / push-in:
  addKeyframe(scale.all or position) at clip start and end with ease-in-out.
Picture-in-picture / split-screen:
  createTrack(video) -> setTransform(scale, position[, blendMode]) per layer.
Chroma key:
  listEffects -> addEffect(chromaKey) -> updateEffect(key colour / threshold).
Highlight reel (content-aware):
  getClipAnalysis + getClipTranscript -> pick high-motion / face / keyword ranges -> executeBatch[addClipSegment ...].

== SELF-VERIFY (use your eyes) ==
After a cut or a visual edit, verify instead of assuming:
- getCutPreviewQuad(cutTime) shows 4 frames before + 4 after a cut — check the cut sits where intended.
- captureFrame(time) / getFramesAtTimes(times[]) to confirm framing, effect, or transform looks right; adjust if not.

== DISCIPLINE ==
- Plan-first for >=3 steps: state a one-line plan, then execute it as a batch.
- Deliver the full requested amount in one pass: asked for N cuts -> produce N. Never hand back a partial result (e.g. 12 of 60) and ask "should I continue?" — finish the whole job, then report. Only ask up front when the GOAL is genuinely ambiguous (e.g. assemble vs split+shuffle), not to get permission to keep working.
- Be autonomous: choose sensible defaults and proceed instead of asking about parameters. Reusing the same few sources across many cuts is NORMAL for a montage — never ask permission for it. Pick a default slice length (~1-2s) and a seed, derive timeline length from count x average slice, and just build it. With only a handful of sources, vary in-points and order so repeats are not obvious. Ask the user only about the GOAL, never about parameters you can reasonably default.
- Randomness: pick and mention a seed so the result is reproducible.
- Multi-step edit = one executeBatch = one undo point.
- Linked clips: video imports create linked video+audio; withLinked defaults true. Set false only to edit one side.
- Media is foldered: getMediaItems returns ONE folder's items and is NOT recursive. Before reporting "no videos here", recurse into every subfolder (getMediaItems(folderId)). Tool names are bare (e.g. addClipSegment) — never prefix them.
- executeBatch reports failed if ANY single action fails, but the other actions still applied. Read data.results[].error, fix only the failed actions (most often an out-of-range slice: outPoint > source duration), and re-run just those — do not redo the whole batch or report total failure.
- Audio awareness: most video clips carry audio, so addClipSegment / split create a LINKED audio clip automatically — and you cannot set that audio's track or position. So always check whether your sources have audio (getClipDetails -> linkedClipId, or getTimelineState for audio tracks) and decide intentionally: keep the source audio, or for a music-backed visual montage remove it with deleteClips(linkedAudioIds, withLinked:false). Never leave scattered or overlapping audio clips unaddressed — tidy or remove them and tell the user what you did.`;

type FlashBoardApprovalMode = 'auto' | 'confirm-destructive' | 'confirm-all-mutating';

interface FlashBoardToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface FlashBoardExecutedToolCall {
  modelContent: string;
  result: ToolResult;
  toolCall: FlashBoardToolCall;
}

interface FlashBoardChatCompletionMessage {
  content: string | null;
  role: 'system' | 'user' | 'assistant' | 'tool';
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      arguments: string;
      name: string;
    };
  }>;
}

interface OpenAiResponsesToolDefinition {
  description: string;
  name: string;
  parameters: ToolDefinition['function']['parameters'];
  strict: false;
  type: 'function';
}

interface OpenAiResponsesFunctionCall {
  arguments: string;
  call_id: string;
  id?: string;
  name: string;
  status?: string;
  type: 'function_call';
}

interface AnthropicToolDefinition {
  description: string;
  input_schema: ToolDefinition['function']['parameters'];
  name: string;
}

interface AnthropicTextBlock {
  text: string;
  type: 'text';
}

interface AnthropicToolUseBlock {
  id: string;
  input?: unknown;
  name: string;
  type: 'tool_use';
}

interface AnthropicToolResultBlock {
  content: string;
  is_error?: boolean;
  tool_use_id: string;
  type: 'tool_result';
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

interface AnthropicMessage {
  content: string | AnthropicContentBlock[];
  role: 'user' | 'assistant';
}

const OPENAI_RESPONSES_TOOLS: OpenAiResponsesToolDefinition[] = AI_TOOLS.map((tool) => ({
  type: 'function',
  name: tool.function.name,
  description: tool.function.description,
  parameters: tool.function.parameters,
  strict: false,
}));

const ANTHROPIC_TOOLS: AnthropicToolDefinition[] = AI_TOOLS.map((tool) => ({
  name: tool.function.name,
  description: tool.function.description,
  input_schema: tool.function.parameters,
}));

export function buildFlashBoardChatSystemPrompt(): string {
  let timelineSummary = 'Timeline context unavailable.';
  try {
    timelineSummary = getQuickTimelineSummary();
  } catch {
    // The compact chat can also be rendered in isolated tests without a live timeline store.
  }

  return [
    FLASHBOARD_CHAT_SYSTEM_PROMPT,
    '',
    `Current MasterSelects context: ${timelineSummary}`,
  ].join('\n');
}

export function getFlashBoardChatCreditCost(model: string): number {
  return FLASHBOARD_CHAT_MODEL_CREDIT_COSTS[model] ?? 5;
}

export function getFlashBoardChatCreditLabel(model: string): string {
  const cost = getFlashBoardChatCreditCost(model);
  return `${cost} cr`;
}

function createHostedChatRoundIdempotencyKey(): string {
  return `flashboard-chat:${Date.now()}:${crypto.randomUUID()}`;
}

function clampTemperature(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_FLASHBOARD_CHAT_TEMPERATURE;
  }

  return Math.max(0, Math.min(2, Math.round(value * 10) / 10));
}

function isTemperatureSupported(provider: FlashBoardChatProvider, model: string): boolean {
  const option = FLASHBOARD_CHAT_MODEL_OPTIONS[provider].find((candidate) => candidate.id === model);
  return option?.supportsTemperature ?? provider !== 'openai';
}

export function isOpenAiReasoningEffortSupported(model: string): boolean {
  const option = FLASHBOARD_CHAT_MODEL_OPTIONS.openai.find((candidate) => candidate.id === model);
  if (option) {
    return option.supportsReasoningEffort === true && (option.reasoningEfforts?.length ?? 0) > 0;
  }

  return model.startsWith('gpt-5') || model.startsWith('o3') || model.startsWith('o4');
}

export function getOpenAiReasoningEffortOptions(model: string): Array<{
  id: FlashBoardOpenAiReasoningEffort;
  label: string;
}> {
  const option = FLASHBOARD_CHAT_MODEL_OPTIONS.openai.find((candidate) => candidate.id === model);
  const supportedEfforts = option?.reasoningEfforts ?? (
    isOpenAiReasoningEffortSupported(model) ? OPENAI_REASONING_EFFORTS_FULL : []
  );

  return FLASHBOARD_OPENAI_REASONING_EFFORT_OPTIONS.filter((effort) => supportedEfforts.includes(effort.id));
}

function normalizeOpenAiReasoningEffort(
  model: string,
  effort: FlashBoardOpenAiReasoningEffort | undefined,
): FlashBoardOpenAiReasoningEffort {
  const supportedEfforts = getOpenAiReasoningEffortOptions(model).map((option) => option.id);
  return effort && supportedEfforts.includes(effort)
    ? effort
    : DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT;
}

function readErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const payload = data as { error?: unknown; message?: unknown };
  if (typeof payload.message === 'string') {
    return payload.message;
  }
  if (payload.error && typeof payload.error === 'object') {
    const error = payload.error as { message?: unknown };
    return typeof error.message === 'string' ? error.message : null;
  }
  if (typeof payload.error === 'string') {
    return payload.error;
  }

  return null;
}

function readOpenAiResponseText(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return '';
  }

  const response = data as {
    output_text?: unknown;
    output?: Array<{
      content?: Array<{
        text?: unknown;
        type?: string;
      }>;
      type?: string;
    }>;
  };

  if (typeof response.output_text === 'string') {
    return response.output_text.trim();
  }

  return response.output
    ?.flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n')
    .trim() ?? '';
}

function readOpenAiChatCompletionText(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return '';
  }

  const response = data as {
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  };
  const content = response.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}

function parseOpenAiChatCompletion(data: unknown): {
  content: string | null;
  toolCalls: FlashBoardToolCall[];
} {
  const payload = data as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id?: string;
          function?: {
            arguments?: string;
            name?: string;
          };
        }>;
      };
    }>;
  };
  const message = payload.choices?.[0]?.message;
  return {
    content: typeof message?.content === 'string' ? message.content.trim() : null,
    toolCalls: (message?.tool_calls ?? [])
      .map((toolCall, index): FlashBoardToolCall => ({
        id: toolCall.id || `flashboard-tool-${index}`,
        name: toolCall.function?.name || '',
        arguments: toolCall.function?.arguments || '{}',
      }))
      .filter((toolCall) => toolCall.name.length > 0),
  };
}

function getOpenAiResponsesOutput(data: unknown): unknown[] {
  if (!data || typeof data !== 'object') {
    return [];
  }

  const response = data as { output?: unknown };
  return Array.isArray(response.output) ? response.output : [];
}

function parseOpenAiResponsesToolCalls(data: unknown): FlashBoardToolCall[] {
  return getOpenAiResponsesOutput(data)
    .map((item): FlashBoardToolCall | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const candidate = item as Partial<OpenAiResponsesFunctionCall>;
      if (candidate.type !== 'function_call' || !candidate.name || !candidate.call_id) {
        return null;
      }

      return {
        id: candidate.call_id,
        name: candidate.name,
        arguments: typeof candidate.arguments === 'string' ? candidate.arguments : '{}',
      };
    })
    .filter((toolCall): toolCall is FlashBoardToolCall => toolCall !== null);
}

function parseAnthropicToolCalls(data: unknown): {
  contentBlocks: AnthropicContentBlock[];
  text: string | null;
  toolCalls: FlashBoardToolCall[];
} {
  const payload = data as { content?: unknown };
  const contentBlocks = Array.isArray(payload.content) ? payload.content as AnthropicContentBlock[] : [];
  const text = contentBlocks
    .filter((block): block is AnthropicTextBlock => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
  const toolCalls = contentBlocks
    .filter((block): block is AnthropicToolUseBlock => (
      block.type === 'tool_use'
      && typeof block.id === 'string'
      && typeof block.name === 'string'
    ))
    .map((block) => ({
      id: block.id,
      name: block.name,
      arguments: JSON.stringify(block.input ?? {}),
    }));

  return {
    contentBlocks,
    text: text || null,
    toolCalls,
  };
}

function parseToolArguments(rawArguments: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawArguments || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Invalid model-supplied JSON is converted into an empty argument object.
  }

  return {};
}

function shouldRequireConfirmation(
  policy: ToolPolicyEntry | undefined,
  approvalMode: FlashBoardApprovalMode,
): boolean {
  if (!policy) return true;
  if (approvalMode === 'auto') return false;
  if (approvalMode === 'confirm-destructive') {
    return policy.requiresConfirmation || policy.riskLevel === 'high' ||
      policy.localFileAccess || policy.sensitiveDataAccess;
  }

  return !policy.readOnly;
}

function sanitizeToolResultValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) {
      return '[image data omitted from compact chat context]';
    }
    return value.replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi, '[image data omitted]');
  }

  if (
    value === null
    || typeof value === 'number'
    || typeof value === 'boolean'
    || typeof value === 'undefined'
  ) {
    return value;
  }

  if (depth >= 4) {
    return '[truncated nested value]';
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, 30).map((item) => sanitizeToolResultValue(item, depth + 1));
    if (value.length > 30) {
      items.push(`[${value.length - 30} more items truncated]`);
    }
    return items;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const sanitized: Record<string, unknown> = {};
    for (const [key, nestedValue] of entries.slice(0, 50)) {
      sanitized[key] = sanitizeToolResultValue(nestedValue, depth + 1);
    }
    if (entries.length > 50) {
      sanitized.__truncatedKeys = entries.length - 50;
    }
    return sanitized;
  }

  return String(value);
}

function formatToolResultForModel(result: ToolResult, maxLength: number): string {
  const sanitized = JSON.stringify({
    success: result.success,
    data: sanitizeToolResultValue(result.data),
    error: result.error,
  });

  if (sanitized.length <= maxLength) {
    return sanitized;
  }

  return JSON.stringify({
    success: result.success,
    error: result.error,
    preview: `${sanitized.slice(0, Math.max(256, maxLength - 128))}... [truncated]`,
    truncated: true,
  });
}

function formatToolFollowupFallback(executedToolCalls: FlashBoardExecutedToolCall[]): string {
  if (executedToolCalls.length === 0) {
    return 'Done.';
  }

  return executedToolCalls
    .map(({ result, toolCall }) => (
      result.success
        ? `${toolCall.name}: done.`
        : `${toolCall.name}: ${result.error ?? 'failed.'}`
    ))
    .join('\n');
}

async function executeFlashBoardToolCalls(
  toolCalls: FlashBoardToolCall[],
  maxToolResultChars: number,
): Promise<FlashBoardExecutedToolCall[]> {
  const approvalMode = useSettingsStore.getState().aiApprovalMode;
  const guidedReplayBudgetController = createGuidedReplayBudgetController();
  const preparedToolCalls: Array<{
    args: Record<string, unknown>;
    result?: ToolResult;
    toolCall: FlashBoardToolCall;
  }> = [];

  for (const toolCall of toolCalls) {
    const args = parseToolArguments(toolCall.arguments);
    const policy = getToolPolicy(toolCall.name);

    if (shouldRequireConfirmation(policy, approvalMode)) {
      preparedToolCalls.push({
        args,
        toolCall,
        result: {
          success: false,
          error: `Tool "${toolCall.name}" requires confirmation in the current AI approval mode. Use the full AI Editor approval flow or switch approval mode to Auto before running it from compact chat.`,
        },
      });
      continue;
    }

    preparedToolCalls.push({ args, toolCall });
  }

  const executableToolCalls = preparedToolCalls.filter((entry) => !entry.result);
  const executedResultsById = new Map<string, ToolResult>();

  if (executableToolCalls.length > 0) {
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
          executedResultsById.set(groupedResult.id, groupedResult.result);
        }
      }
    } catch (error) {
      const result = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      for (const entry of executableToolCalls) {
        executedResultsById.set(entry.toolCall.id, result);
      }
    }
  }

  return preparedToolCalls.map(({ result, toolCall }) => {
    const resolvedResult = result
      ?? executedResultsById.get(toolCall.id)
      ?? { success: false, error: 'Tool execution did not return a result.' };
    return {
      toolCall,
      result: resolvedResult,
      modelContent: formatToolResultForModel(resolvedResult, maxToolResultChars),
    };
  });
}

async function runChatCompletionToolLoop(
  messages: FlashBoardChatCompletionMessage[],
  complete: (currentMessages: FlashBoardChatCompletionMessage[]) => Promise<{
    content: string | null;
    toolCalls: FlashBoardToolCall[];
  }>,
  providerName: string,
  maxToolResultChars = FLASHBOARD_CHAT_MAX_TOOL_RESULT_CHARS,
): Promise<string> {
  const executedToolCalls: FlashBoardExecutedToolCall[] = [];

  for (let iteration = 0; iteration < FLASHBOARD_CHAT_MAX_TOOL_ITERATIONS; iteration += 1) {
    const result = await complete(messages);
    const content = result.content?.trim() || null;
    if (result.toolCalls.length === 0) {
      return content || (
        executedToolCalls.length > 0
          ? formatToolFollowupFallback(executedToolCalls)
          : `${providerName} returned an empty response.`
      );
    }

    messages.push({
      role: 'assistant',
      content,
      tool_calls: result.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.name,
          arguments: toolCall.arguments,
        },
      })),
    });

    const toolResults = await executeFlashBoardToolCalls(result.toolCalls, maxToolResultChars);
    executedToolCalls.push(...toolResults);
    for (const toolResult of toolResults) {
      messages.push({
        role: 'tool',
        content: toolResult.modelContent,
        tool_call_id: toolResult.toolCall.id,
      });
    }
  }

  return formatToolFollowupFallback(executedToolCalls) || 'Stopped after too many tool iterations.';
}

async function sendHostedOpenAiChat(request: FlashBoardChatRequest, systemPrompt: string): Promise<string> {
  const messages: FlashBoardChatCompletionMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: request.prompt },
  ];

  return runChatCompletionToolLoop(messages, async (currentMessages) => {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: currentMessages,
      tools: AI_TOOLS,
      tool_choice: 'auto',
      max_completion_tokens: 2048,
    };

    if (isTemperatureSupported('openai', request.model)) {
      body.temperature = clampTemperature(request.temperature);
    }

    body.idempotencyKey = createHostedChatRoundIdempotencyKey();

    const data = await cloudAiService.createChatCompletion(body);
    const parsed = parseOpenAiChatCompletion(data);
    return parsed.toolCalls.length > 0
      ? parsed
      : {
        content: parsed.content || readOpenAiChatCompletionText(data) || readOpenAiResponseText(data) || null,
        toolCalls: [],
      };
  }, 'OpenAI');
}

async function sendOpenAiResponsesChat(request: FlashBoardChatRequest, systemPrompt: string): Promise<string> {
  const apiKey = request.openAiApiKey?.trim();
  if (!apiKey) {
    throw new Error('Add an OpenAI API key in Settings to use compact chat.');
  }

  const input: unknown[] = [{ role: 'user', content: request.prompt }];
  const executedToolCalls: FlashBoardExecutedToolCall[] = [];

  for (let iteration = 0; iteration < FLASHBOARD_CHAT_MAX_TOOL_ITERATIONS; iteration += 1) {
    const body: Record<string, unknown> = {
      model: request.model,
      instructions: systemPrompt,
      input,
      tools: OPENAI_RESPONSES_TOOLS,
      tool_choice: 'auto',
      max_output_tokens: 2048,
      store: false,
      include: ['reasoning.encrypted_content'],
    };

    if (isTemperatureSupported('openai', request.model)) {
      body.temperature = clampTemperature(request.temperature);
    }

    if (isOpenAiReasoningEffortSupported(request.model)) {
      body.reasoning = {
        effort: normalizeOpenAiReasoningEffort(request.model, request.openAiReasoningEffort),
      };
    }

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(readErrorMessage(data) ?? `OpenAI request failed: ${response.status}`);
    }

    const toolCalls = parseOpenAiResponsesToolCalls(data);
    if (toolCalls.length === 0) {
      return readOpenAiResponseText(data) || (
        executedToolCalls.length > 0
          ? formatToolFollowupFallback(executedToolCalls)
          : 'OpenAI returned an empty response.'
      );
    }

    input.push(...getOpenAiResponsesOutput(data));
    const toolResults = await executeFlashBoardToolCalls(toolCalls, FLASHBOARD_CHAT_MAX_TOOL_RESULT_CHARS);
    executedToolCalls.push(...toolResults);
    for (const toolResult of toolResults) {
      input.push({
        type: 'function_call_output',
        call_id: toolResult.toolCall.id,
        output: toolResult.modelContent,
      });
    }
  }

  return formatToolFollowupFallback(executedToolCalls) || 'Stopped after too many tool iterations.';
}

async function sendOpenAiChat(request: FlashBoardChatRequest, systemPrompt: string): Promise<string> {
  return request.hostedAvailable
    ? sendHostedOpenAiChat(request, systemPrompt)
    : sendOpenAiResponsesChat(request, systemPrompt);
}

async function sendAnthropicChat(request: FlashBoardChatRequest, systemPrompt: string): Promise<string> {
  const apiKey = request.anthropicApiKey?.trim();
  if (!apiKey) {
    throw new Error('Add an Anthropic API key in Settings to use Claude chat.');
  }

  const messages: AnthropicMessage[] = [{ role: 'user', content: request.prompt }];
  const executedToolCalls: FlashBoardExecutedToolCall[] = [];

  for (let iteration = 0; iteration < FLASHBOARD_CHAT_MAX_TOOL_ITERATIONS; iteration += 1) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'anthropic-dangerous-direct-browser-access': 'true',
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: 2048,
        temperature: clampTemperature(request.temperature),
        system: systemPrompt,
        tools: ANTHROPIC_TOOLS,
        messages,
      }),
      signal: request.signal,
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(readErrorMessage(data) ?? `Anthropic request failed: ${response.status}`);
    }

    const parsed = parseAnthropicToolCalls(data);
    if (parsed.toolCalls.length === 0) {
      return parsed.text || (
        executedToolCalls.length > 0
          ? formatToolFollowupFallback(executedToolCalls)
          : 'Anthropic returned an empty response.'
      );
    }

    messages.push({ role: 'assistant', content: parsed.contentBlocks });
    const toolResults = await executeFlashBoardToolCalls(parsed.toolCalls, FLASHBOARD_CHAT_MAX_TOOL_RESULT_CHARS);
    executedToolCalls.push(...toolResults);
    messages.push({
      role: 'user',
      content: toolResults.map((toolResult): AnthropicToolResultBlock => ({
        type: 'tool_result',
        tool_use_id: toolResult.toolCall.id,
        content: toolResult.modelContent,
        is_error: !toolResult.result.success,
      })),
    });
  }

  return formatToolFollowupFallback(executedToolCalls) || 'Stopped after too many tool iterations.';
}

async function sendLemonadeChat(request: FlashBoardChatRequest, systemPrompt: string): Promise<string> {
  const messages: FlashBoardChatCompletionMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: request.prompt },
  ];

  return runChatCompletionToolLoop(messages, async (currentMessages) => (
    createLemonadeChatCompletionStream({
      endpoint: request.lemonadeEndpoint ?? '',
      model: request.model || DEFAULT_LEMONADE_MODEL,
      messages: currentMessages,
      tools: FLASHBOARD_LEMONADE_TOOLS,
      maxTokens: 1024,
      temperature: clampTemperature(request.temperature),
      signal: request.signal,
      timeoutMs: 45_000,
    })
  ), 'Lemonade', FLASHBOARD_LEMONADE_MAX_TOOL_RESULT_CHARS);
}

export async function sendFlashBoardChatMessage(request: FlashBoardChatRequest): Promise<string> {
  const prompt = request.prompt.trim();
  if (!prompt) {
    throw new Error('Write a prompt before starting chat.');
  }

  const systemPrompt = buildFlashBoardChatSystemPrompt();

  switch (request.provider) {
    case 'anthropic':
      return sendAnthropicChat({ ...request, prompt }, systemPrompt);
    case 'lemonade':
      return sendLemonadeChat({ ...request, prompt }, systemPrompt);
    case 'openai':
    default:
      return sendOpenAiChat({ ...request, prompt }, systemPrompt);
  }
}
