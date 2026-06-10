// Domain types for the AI Multicam Editor store
// (cameras, analysis samples, transcript entries, edit decisions)

export interface MultiCamSource {
  id: string;
  mediaFileId: string;
  name: string;
  role: 'wide' | 'closeup' | 'detail' | 'custom';
  customRole?: string;
  // Sync offset in milliseconds (relative to master camera)
  syncOffset: number;
  // Duration in milliseconds
  duration: number;
  // Thumbnail URL
  thumbnailUrl?: string;
}

export interface CameraAnalysis {
  cameraId: string;
  // Per-frame analysis data (sampled at intervals)
  frames: FrameAnalysis[];
}

export interface FrameAnalysis {
  timestamp: number; // ms
  motion: number; // 0-1
  sharpness: number; // 0-1
  faces: DetectedFace[];
  audioLevel: number; // 0-1
}

export interface DetectedFace {
  id: string;
  bbox: { x: number; y: number; width: number; height: number };
  confidence: number;
  position: 'left' | 'center' | 'right';
  size: number; // Relative size in frame (0-1)
}

export interface MultiCamAnalysis {
  projectDuration: number; // ms
  sampleInterval: number; // ms between samples
  cameras: CameraAnalysis[];
  audioLevels: { timestamp: number; level: number }[];
}

export interface TranscriptEntry {
  id: string;
  start: number; // ms
  end: number; // ms
  speaker: string;
  text: string;
}

export interface EditDecision {
  id: string;
  start: number; // ms
  end: number; // ms
  cameraId: string;
  reason?: string;
  confidence?: number; // 0-1, how confident the AI is in this decision
}

export type EditStyle = 'podcast' | 'interview' | 'music' | 'documentary' | 'custom';

export type AnalysisStatus = 'idle' | 'analyzing' | 'complete' | 'error';
export type TranscriptStatus = 'idle' | 'loading-model' | 'generating' | 'complete' | 'error';
export type EDLStatus = 'idle' | 'generating' | 'complete' | 'error';
