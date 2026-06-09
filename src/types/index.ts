// Core types for WebVJ Mixer

import type {
  VectorAnimationClipSettings,
} from './vectorAnimation';
import type { ColorCorrectionState, RuntimeColorGrade } from './colorCorrection';
import type { MotionLayerDefinition } from './motionDesign';
import type { ClipNodeGraph } from './nodeGraph';
import type {
  ClipAudioAnalysisJobState,
  ClipAudioState,
  MasterAudioState,
  TrackAudioState,
} from './audio';
import type { BlendMode } from './blendMode';
import type {
  AnalysisStatus,
  ClipAnalysis,
  ClipSegment,
  ClipVideoState,
  SceneDescriptionStatus,
  SceneSegment,
  TranscriptStatus,
  TranscriptWord,
  VideoBakeRegion,
} from './clipMetadata';
import type { Effect } from './effects';
import type { Keyframe } from './keyframes';
import type { MathSceneDefinition } from './mathScene';
import type { ClipMask } from './masks';
import type { Text3DProperties, TextClipProperties } from './text';
import type { TimelineSourceType } from './timelineSource';
import type { ClipTransform, TimelineTransition } from './timelineCore';

export * from './audio';
export * from './colorCorrection';
export * from './motionDesign';
export * from './nodeGraph';
export type {
  AnimatableProperty,
  BezierHandle,
  CameraProperty,
  CameraPropertyName,
  ColorProperty,
  EasingType,
  EffectProperty,
  MaskNumericProperty,
  MaskNumericPropertyName,
  MaskPathProperty,
  MaskProperty,
  NodeGraphParamProperty,
  RotationInterpolationMode,
  TextBoundsNumericProperty,
  TextBoundsNumericPropertyName,
  TextBoundsPathProperty,
  TextBoundsProperty,
  TransformProperty,
} from './animationProperties';
export {
  createEffectProperty,
  createMaskNumericProperty,
  createMaskPathProperty,
  createNodeGraphParamProperty,
  createTextBoundsNumericProperty,
  createTextBoundsPathProperty,
  isCameraProperty,
  isColorProperty,
  isEffectProperty,
  isMaskNumericProperty,
  isMaskPathProperty,
  isNodeGraphParamProperty,
  isTextBoundsNumericProperty,
  isTextBoundsPathProperty,
  parseCameraProperty,
  parseEffectProperty,
  parseMaskProperty,
  parseNodeGraphParamProperty,
  parseTextBoundsProperty,
} from './animationProperties';
export type { BlendMode } from './blendMode';
export type {
  AnalysisStatus,
  ClipAnalysis,
  ClipSegment,
  ClipVideoState,
  FrameAnalysisData,
  SceneDescriptionStatus,
  SceneSegment,
  TranscriptStatus,
  TranscriptWord,
  VideoBakeRegion,
  VideoBakeRegionScope,
  VideoBakeRegionStatus,
} from './clipMetadata';
export type { Effect, EffectType } from './effects';
export { isAudioEffect } from './effects';
export type { EngineStats } from './engineStats';
export type { Keyframe } from './keyframes';
export type {
  MathBaseObject,
  MathFunctionObject,
  MathLabelObject,
  MathObject,
  MathObjectAnimation,
  MathParameter,
  MathParameterAnimation,
  MathPointObject,
  MathSceneDefinition,
  MathSceneStyle,
  MathSceneViewport,
  MathTangentObject,
} from './mathScene';
export type {
  ClipMask,
  MaskMode,
  MaskPathKeyframeValue,
  MaskVertex,
  MaskVertexHandleMode,
  TextBoundsPath,
} from './masks';
export type {
  RenderDestinationType,
  RenderSource,
  RenderSourceActiveComp,
  RenderSourceComposition,
  RenderSourceLayer,
  RenderSourceProgram,
  RenderSourceSlot,
  RenderSourceType,
  RenderTarget,
} from './renderTarget';
export type { Text3DProperties, TextClipProperties } from './text';
export type { TimelineSourceType } from './timelineSource';
export type { ClipTransform, TimelineTransition } from './timelineCore';
export type {
  VectorAnimationClipSettings,
  VectorAnimationInputProperty,
  VectorAnimationMetadata,
  VectorAnimationProvider,
} from './vectorAnimation';

export type ModelSequencePlaybackMode = 'clamp' | 'loop';

export interface ModelSequenceFrame {
  name: string;
  projectPath?: string;
  sourcePath?: string;
  absolutePath?: string;
  file?: File;
  modelUrl?: string;
}

export interface ModelSequenceData {
  fps: number;
  frameCount: number;
  playbackMode?: ModelSequencePlaybackMode;
  sequenceName?: string;
  frames: ModelSequenceFrame[];
}

export interface GaussianSplatSequenceFrame {
  name: string;
  projectPath?: string;
  sourcePath?: string;
  absolutePath?: string;
  file?: File;
  splatUrl?: string;
  splatCount?: number;
  fileSize?: number;
  container?: string;
  codec?: string;
}

export interface GaussianSplatBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface GaussianSplatSequenceData {
  fps: number;
  frameCount: number;
  playbackMode?: ModelSequencePlaybackMode;
  sequenceName?: string;
  sharedBounds?: GaussianSplatBounds;
  totalSplatCount?: number;
  minSplatCount?: number;
  maxSplatCount?: number;
  totalFileSize?: number;
  container?: string;
  codec?: string;
  frames: GaussianSplatSequenceFrame[];
}

export interface Layer {
  id: string;
  name: string;
  sourceClipId?: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  source: LayerSource | null;
  effects: Effect[];
  colorCorrection?: RuntimeColorGrade;
  position: { x: number; y: number; z: number };
  scale: { x: number; y: number; z?: number };
  rotation: number | { x: number; y: number; z: number };  // Single value (z only) or full 3D rotation
  is3D?: boolean;  // When true, layer participates in the shared 3D scene
  wireframe?: boolean;  // Debug: show as wireframe
  // Mask properties (passed from timeline clip masks for GPU processing)
  maskFeather?: number;  // Blur radius in pixels (0-50), handled in GPU shader
  maskFeatherQuality?: number;  // Blur quality: 0=low (9 samples), 1=medium (17), 2=high (25)
  maskInvert?: boolean;  // Whether to invert the mask, handled in GPU shader
  maskClipId?: string;  // Clip ID for looking up mask texture (consistent across systems)
}

export interface LayerSource {
  type: 'video' | 'image' | 'camera' | 'color' | 'text' | 'solid' | 'model' | 'gaussian-avatar' | 'gaussian-splat' | 'motion';
  modelUrl?: string;  // Blob URL to 3D model file (OBJ/glTF/GLB)
  modelFileName?: string;
  modelSequence?: ModelSequenceData;
  gaussianSplatSequence?: GaussianSplatSequenceData;
  threeDEffectorsEnabled?: boolean;  // Whether shared-scene 3D effectors can affect this layer
  meshType?: import('../stores/mediaStore/types').MeshPrimitiveType;  // Primitive mesh type (cube, sphere, etc.)
  file?: File;
  videoElement?: HTMLVideoElement;
  mediaTime?: number;
  targetMediaTime?: number;
  previewPath?: string;
  proxyFrameIndex?: number;
  mediaFileId?: string;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
  imageElement?: HTMLImageElement;
  color?: string;
  texture?: GPUTexture;
  // WebCodecs support for hardware-accelerated video decode
  webCodecsPlayer?:
    | import('../engine/WebCodecsPlayer').WebCodecsPlayer
    | import('../services/mediaRuntime/types').RuntimeFrameProvider;
  videoFrame?: VideoFrame;
  // Native Helper decoder for ProRes/DNxHD (turbo mode)
  nativeDecoder?: import('../services/nativeHelper').NativeDecoder;
  // Path to original file (for native helper to access directly)
  filePath?: string;
  // Shared media runtime binding
  runtimeSourceId?: string;
  runtimeSessionKey?: string;
  // Gaussian avatar support
  gaussianAvatarUrl?: string;
  gaussianBlendshapes?: Record<string, number>;
  // Gaussian splat clip support
  gaussianSplatUrl?: string;
  gaussianSplatFileName?: string;
  gaussianSplatFileHash?: string;
  gaussianSplatRuntimeKey?: string;
  gaussianSplatSettings?: import('../engine/gaussian/types').GaussianSplatSettings;
  cameraSettings?: import('../stores/mediaStore/types').SceneCameraSettings;
  // Nested composition support - pre-rendered layers from nested comp
  nestedComposition?: NestedCompositionData;
  // Text clip support
  textCanvas?: HTMLCanvasElement;
  textProperties?: TextClipProperties;
  text3DProperties?: Text3DProperties;
  // Motion design support
  motion?: MotionLayerDefinition;
}

// Data for pre-rendering nested compositions
export interface NestedCompositionData {
  compositionId: string;
  layers: Layer[];  // Layers from the nested composition to be pre-rendered
  width: number;
  height: number;
  currentTime?: number;  // Current time for frame caching
  sceneClips?: TimelineClip[];
  sceneTracks?: TimelineTrack[];
}

export interface Project {
  id: string;
  name: string;
  layers: Layer[];
  outputResolution: { width: number; height: number };
  fps: number;
}

export interface MIDIMapping {
  channel: number;
  control: number;
  target: string;
  min: number;
  max: number;
}

// Timeline types

export interface TimelineClipDataSource {
  type: TimelineSourceType;
  modelUrl?: string;
  modelFileName?: string;
  modelSequence?: ModelSequenceData;
  gaussianSplatSequence?: GaussianSplatSequenceData;
  threeDEffectorsEnabled?: boolean;
  meshType?: import('../stores/mediaStore/types').MeshPrimitiveType;
  text3DProperties?: Text3DProperties;
  cameraSettings?: import('../stores/mediaStore/types').SceneCameraSettings;
  splatEffectorSettings?: import('./splatEffector').SplatEffectorSettings;
  gaussianAvatarUrl?: string;
  gaussianBlendshapes?: Record<string, number>;
  gaussianSplatUrl?: string;
  gaussianSplatFileName?: string;
  gaussianSplatFileHash?: string;
  gaussianSplatRuntimeKey?: string;
  gaussianSplatSettings?: import('../engine/gaussian/types').GaussianSplatSettings;
  imageUrl?: string;
  naturalDuration?: number;
  mediaFileId?: string;
  vectorAnimationSettings?: VectorAnimationClipSettings;
  filePath?: string;
}

export interface TimelineClipSourceRuntimeHandles {
  videoElement?: HTMLVideoElement;
  audioElement?: HTMLAudioElement;
  imageElement?: HTMLImageElement;
  webCodecsPlayer?: import('../engine/WebCodecsPlayer').WebCodecsPlayer;
  nativeDecoder?: import('../services/nativeHelper/NativeDecoder').NativeDecoder;
  file?: File;
  textCanvas?: HTMLCanvasElement;
  runtimeSourceId?: string;
  runtimeSessionKey?: string;
}

export type TimelineClipSource = TimelineClipDataSource & TimelineClipSourceRuntimeHandles;

export interface TimelineClip {
  id: string;
  trackId: string;
  name: string;
  file: File;
  startTime: number;      // Start position on timeline (seconds)
  duration: number;       // Clip duration (seconds)
  inPoint: number;        // Trim in point within source (seconds)
  outPoint: number;       // Trim out point within source (seconds)
  source: TimelineClipSource | null;
  mathScene?: MathSceneDefinition;
  motion?: MotionLayerDefinition;
  thumbnails?: string[];  // Array of data URLs for filmstrip preview
  mediaFileId?: string;   // Reference to MediaFile for audio/proxy lookup (top-level for YouTube downloads)
  signalAssetId?: string; // Source SignalAsset for renderer-adapter materialized clips
  signalRefId?: string;   // Source SignalRef selected by the renderer adapter
  signalRenderAdapterId?: string; // Renderer adapter that produced the clip materialization
  linkedClipId?: string;  // ID of linked clip (e.g., audio linked to video)
  linkedGroupId?: string; // ID of multicam group (clips synced together)
  parentClipId?: string;  // ID of parent clip for transform inheritance (like AE parenting)
  videoState?: ClipVideoState; // Video bake/cache regions and future clip-side video derivations
  audioState?: ClipAudioState; // Advanced audio workstation state (optional, legacy-safe)
  audioAnalysisJob?: ClipAudioAnalysisJobState; // Transient current audio-analysis job state
  waveform?: number[];    // Array of normalized aggregate amplitude values (0-1) for audio waveform
  waveformChannels?: number[][]; // Optional per-channel waveform previews for stereo/multichannel audio
  waveformGenerating?: boolean;  // True while waveform is being generated
  waveformProgress?: number;     // 0-100 progress of waveform generation
  transform: ClipTransform;  // Visual transform properties
  effects: Effect[];      // Effects applied to this clip
  colorCorrection?: ColorCorrectionState;  // Professional node/list color correction state
  nodeGraph?: ClipNodeGraph; // Field-backed node graph UI state for this clip
  isLoading?: boolean;    // True while media is being loaded
  needsReload?: boolean;  // True if file handle needs re-authorization after page refresh
  reversed?: boolean;     // True if clip plays in reverse
  speed?: number;         // Playback speed (default 1.0, 0.5 = half speed, -1.0 = reverse)
  preservesPitch?: boolean;  // Keep pitch when speed changes (default true)
  // Nested composition support
  isComposition?: boolean;  // True if this clip is a nested composition
  compositionId?: string;   // ID of the nested composition
  nestedClips?: TimelineClip[];  // Loaded clips from the nested composition
  nestedTracks?: TimelineTrack[];  // Tracks from the nested composition
  nestedContentHash?: string;  // Hash to detect changes in nested composition (for thumbnail updates)
  nestedClipBoundaries?: number[];  // Normalized (0-1) positions where nested clips start/end (for visual markers)
  clipSegments?: ClipSegment[];  // Segment-based thumbnails for nested compositions
  // Nested composition audio mixdown
  mixdownAudio?: HTMLAudioElement;  // Audio element for playing nested comp audio
  mixdownWaveform?: number[];  // Waveform of the nested comp audio mixdown
  mixdownBuffer?: AudioBuffer;  // Raw audio buffer for export
  mixdownGenerating?: boolean;  // True while mixdown is being generated
  hasMixdownAudio?: boolean;  // True if nested comp has audio
  // Mask support
  masks?: ClipMask[];     // Array of masks applied to this clip
  // Transcript support
  transcript?: TranscriptWord[];  // Speech-to-text transcript
  transcriptStatus?: TranscriptStatus;  // Transcription status
  transcriptProgress?: number;  // 0-100 progress
  transcriptMessage?: string;  // Status message during transcription
  // Analysis support (focus/motion/face)
  analysis?: ClipAnalysis;
  analysisStatus?: AnalysisStatus;
  analysisProgress?: number;  // 0-100 progress
  // AI scene description support
  sceneDescriptions?: SceneSegment[];
  sceneDescriptionStatus?: SceneDescriptionStatus;
  sceneDescriptionProgress?: number;  // 0-100 progress
  sceneDescriptionMessage?: string;   // Status message during description
  // Text clip support
  textProperties?: TextClipProperties;
  text3DProperties?: Text3DProperties;
  // Solid clip support
  solidColor?: string;
  // MIDI clip support (issue #182): note data; instrument lives on the track
  midiData?: import('./midiClip').MidiClipData;
  // YouTube download support
  isPendingDownload?: boolean;  // True if clip is being downloaded
  downloadProgress?: number;    // 0-100 download progress
  downloadSpeed?: string;       // e.g. "5.23MiB/s"
  downloadError?: string;       // Error message if download failed
  youtubeVideoId?: string;      // YouTube video ID for pending downloads
  youtubeThumbnail?: string;    // Thumbnail URL for pending display
  // Transition support
  transitionIn?: TimelineTransition;   // Transition from previous clip
  transitionOut?: TimelineTransition;  // Transition to next clip
  // 3D layer support (AE-style per-layer toggle)
  is3D?: boolean;
  wireframe?: boolean;  // Debug: show 3D model as wireframe
  meshType?: import('../stores/mediaStore/types').MeshPrimitiveType;  // Primitive mesh geometry type
}

export interface TimelineTrack {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'midi';
  height: number;
  labelColor?: import('../stores/mediaStore/types').LabelColor;
  muted: boolean;
  visible: boolean;
  solo: boolean;
  locked?: boolean;
  parentTrackId?: string;  // ID of parent track for layer parenting (like AE parenting)
  audioState?: TrackAudioState;
  // MIDI track support: instrument that renders this track's MIDI clips (issue #182)
  midiInstrument?: import('./midiClip').MidiInstrument;
}

export interface TimelineState {
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  playheadPosition: number;  // Current time in seconds
  duration: number;          // Total timeline duration
  zoom: number;              // Pixels per second
  scrollX: number;           // Horizontal scroll position
  isPlaying: boolean;
  selectedClipId: string | null;
}

// Serializable clip data for storage (without DOM elements)
export interface SerializableClip {
  id: string;
  trackId: string;
  name: string;
  mediaFileId: string;       // Reference to MediaFile in mediaStore
  signalAssetId?: string;    // Source SignalAsset for renderer-adapter materialized clips
  signalRefId?: string;      // Source SignalRef selected by the renderer adapter
  signalRenderAdapterId?: string; // Renderer adapter that produced the clip materialization
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  sourceType: TimelineSourceType;
  naturalDuration?: number;
  thumbnails?: string[];
  linkedClipId?: string;
  linkedGroupId?: string;  // Multicam group ID
  videoState?: ClipVideoState;
  audioState?: ClipAudioState;
  waveform?: number[];
  waveformChannels?: number[][];
  transform: ClipTransform;
  effects: Effect[];         // Effects applied to this clip
  colorCorrection?: ColorCorrectionState;
  nodeGraph?: ClipNodeGraph; // Field-backed node graph UI state
  keyframes?: Keyframe[];    // Animation keyframes for this clip
  // Nested composition support
  isComposition?: boolean;
  compositionId?: string;
  // Mask support
  masks?: ClipMask[];        // Masks applied to this clip
  // Transcript data
  transcript?: TranscriptWord[];
  transcriptStatus?: TranscriptStatus;
  // Analysis data
  analysis?: ClipAnalysis;
  analysisStatus?: AnalysisStatus;
  // AI scene description data
  sceneDescriptions?: SceneSegment[];
  sceneDescriptionStatus?: SceneDescriptionStatus;
  // Playback
  reversed?: boolean;
  speed?: number;         // Playback speed (default 1.0)
  preservesPitch?: boolean;  // Keep pitch when speed changes (default true)
  // Text clip support
  textProperties?: TextClipProperties;
  text3DProperties?: Text3DProperties;
  // Solid clip support
  solidColor?: string;
  // MIDI clip support (issue #182)
  midiData?: import('./midiClip').MidiClipData;
  vectorAnimationSettings?: VectorAnimationClipSettings;
  mathScene?: MathSceneDefinition;
  motion?: MotionLayerDefinition;
  // Transition support
  transitionIn?: TimelineTransition;
  transitionOut?: TimelineTransition;
  // 3D layer support
  is3D?: boolean;
  modelSequence?: ModelSequenceData;
  gaussianSplatSequence?: GaussianSplatSequenceData;
  threeDEffectorsEnabled?: boolean;
  meshType?: import('../stores/mediaStore/types').MeshPrimitiveType;
  cameraSettings?: import('../stores/mediaStore/types').SceneCameraSettings;
  splatEffectorSettings?: import('./splatEffector').SplatEffectorSettings;
  // Gaussian avatar blendshape state
  gaussianBlendshapes?: Record<string, number>;
  // Gaussian splat settings
  gaussianSplatSettings?: import('../engine/gaussian/types').GaussianSplatSettings;
}

// Serializable timeline marker (for project save/load)
export interface SerializableMarker {
  id: string;
  time: number;
  label: string;
  color: string;
  stopPlayback?: boolean;
  midiBindings?: import('./midi').MarkerMIDIBinding[];
}

// Serializable timeline data for composition storage
export interface CompositionTimelineData {
  tracks: TimelineTrack[];
  clips: SerializableClip[];
  playheadPosition: number;
  duration: number;
  durationLocked?: boolean;  // When true, duration won't auto-update based on clips
  zoom: number;
  scrollX: number;
  inPoint: number | null;
  outPoint: number | null;
  loopPlayback: boolean;
  markers?: SerializableMarker[];  // Timeline markers
  videoBakeRegions?: VideoBakeRegion[];
  masterAudioState?: MasterAudioState;
}
