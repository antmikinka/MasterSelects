import {
  AI_TOOLS,
  getQuickTimelineSummary,
} from '../../../services/aiTools';
import {
  DEFAULT_LEMONADE_MODEL,
  LEMONADE_MODEL_PRESETS,
  type LemonadeModelInfo,
} from '../../../services/lemonadeProvider';

export const OPENAI_MODELS = [
  { id: 'gpt-5.2', name: 'GPT-5.2 (Thinking)', credits: 8 },
  { id: 'gpt-5.2-pro', name: 'GPT-5.2 Pro', credits: 10 },
  { id: 'gpt-5.1', name: 'GPT-5.1', credits: 5 },
  { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', credits: 5 },
  { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini', credits: 1 },
  { id: 'gpt-5', name: 'GPT-5', credits: 5 },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini', credits: 1 },
  { id: 'gpt-5-nano', name: 'GPT-5 Nano', credits: 1 },
  { id: 'o3', name: 'o3 (Reasoning)', credits: 5 },
  { id: 'o4-mini', name: 'o4-mini (Reasoning)', credits: 3 },
  { id: 'o3-pro', name: 'o3-pro (Deep Reasoning)', credits: 50 },
  { id: 'gpt-4.1', name: 'GPT-4.1', credits: 5 },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', credits: 1 },
  { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', credits: 1 },
  { id: 'gpt-4o', name: 'GPT-4o', credits: 5 },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', credits: 1 },
];

const LEMONADE_EDITOR_TOOL_NAMES = new Set([
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

export const LEMONADE_EDITOR_TOOLS = AI_TOOLS.filter((tool) => LEMONADE_EDITOR_TOOL_NAMES.has(tool.function.name));
export const LEMONADE_CHAT_TIMEOUT_MS = 45_000;
export const LEMONADE_TOOL_FOLLOWUP_TIMEOUT_MS = 12_000;
export const LEMONADE_STREAM_IDLE_TIMEOUT_MS = 12_000;
export const LEMONADE_MAX_COMPLETION_TOKENS = 512;
export const LEMONADE_MAX_TOOL_RESULT_MESSAGE_CHARS = 2_000;

export const EDITOR_SYSTEM_PROMPT = `You are an AI video editing assistant with direct access to the timeline AND media panel. You can:

TIMELINE:
- View and analyze the timeline state (tracks, clips, playhead position)
- Get detailed clip information including analysis data and transcripts
- Split, delete, move, and trim clips
- Create and manage video/audio tracks
- Start analysis and transcription for clips
- Capture frames and create preview grids to evaluate cuts
- Find silent sections in clips based on transcripts

MEDIA PANEL:
- View all media items (files, compositions, folders)
- Create and organize folders
- Rename and delete items
- Move items between folders
- Create new compositions

YOUTUBE / DOWNLOADS:
- Search YouTube for videos by keyword (requires YouTube API key)
- List available download formats/qualities for any video URL
- Download videos and import them directly into the timeline
- View downloaded videos in the Media panel
- Supported platforms: YouTube, TikTok, Instagram, Twitter/X, Vimeo, and more (via yt-dlp)
- Downloads require the Native Helper application to be running
- When the user asks for a video on a TOPIC (e.g. "download a jungle video"), ALWAYS use searchYouTube first to find real videos, then download from the results. NEVER make up or guess URLs.

CRITICAL RULES - FOLLOW EXACTLY:
1. ALWAYS assume the user means the CURRENTLY SELECTED CLIP. Never ask "which clip?" - just use the selected one.
2. ONLY work within the VISIBLE RANGE of the clip on the timeline (from clip.startTime to clip.startTime + clip.duration).
   - Analysis data covers the full source file, but the tools automatically FILTER to only the visible/trimmed portion.
3. DO NOT ask for clarification. Make reasonable assumptions and proceed with the action.
4. When removing MULTIPLE sections (like all low-focus parts), ALWAYS use cutRangesFromClip with the sections array from findLowQualitySections. NEVER use multiple individual splitClip calls - they will fail because clip IDs change after each split.
5. Be precise with time values - they are in seconds.
6. The cutRangesFromClip tool handles everything automatically: sorting end-to-start, finding clips by position, and deleting the unwanted sections.
7. When performing multiple editing operations (splits, deletes, moves, trims), ALWAYS use executeBatch to combine them into a single action. This is much faster than calling tools individually and creates a single undo point.
8. The timeline state is already included in this prompt - do NOT call getTimelineState unless you specifically need updated clip IDs after performing edits.
9. For splitting clips into equal parts, use splitClipEvenly. For splitting at specific times, use splitClipAtTimes. These are much faster than executeBatch with individual splitClip calls.
10. For reordering/shuffling clips, use reorderClips with the clip IDs in the desired order. This is much faster and more reliable than executeBatch with multiple moveClip calls.
11. After receiving tool results, always provide a concise human-readable follow-up. Do not stop after a tool call.

CUT EVALUATION WORKFLOW:
- Use getCutPreviewQuad(cutTime) to see 4 frames before and 4 frames after a potential cut point
- This helps evaluate if a cut will look smooth (similar frames = good) or jarring (big jump = maybe bad)
- Use getFramesAtTimes([...times]) to capture specific moments for comparison`;

export const LEMONADE_EDITOR_SYSTEM_PROMPT = `You are a local AI video editing assistant.
Use the provided tools to inspect and edit the timeline.
Prefer the selected clip. If clip IDs are unclear, inspect the timeline first.
Use seconds for all time values.
After every tool result, answer briefly with what you did or found.`;

export function getLemonadeModelOptions(
  availableModels: LemonadeModelInfo[],
  selectedModel: string,
): Array<{ id: string; name: string; description?: string; available: boolean }> {
  if (availableModels.length > 0) {
    return availableModels.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      available: true,
    }));
  }

  const options = new Map<string, { id: string; name: string; description?: string; available: boolean }>();

  for (const preset of LEMONADE_MODEL_PRESETS) {
    options.set(preset.id, {
      id: preset.id,
      name: preset.name,
      description: preset.description,
      available: false,
    });
  }

  if (selectedModel && !options.has(selectedModel)) {
    options.set(selectedModel, {
      id: selectedModel,
      name: selectedModel || DEFAULT_LEMONADE_MODEL,
      available: false,
    });
  }

  return Array.from(options.values());
}

export function buildSystemPromptForApi(prompt: string): string {
  return `${prompt.trim()}\n\nCurrent timeline summary: ${getQuickTimelineSummary()}`;
}
