export interface WebCodecsPlayerOptions {
  loop?: boolean;
  onFrame?: (frame: VideoFrame) => void;
  onReady?: (width: number, height: number) => void;
  onError?: (error: Error) => void;
  // Use simple VideoFrame extraction from HTMLVideoElement instead of MP4Box demuxing
  useSimpleMode?: boolean;
  // Use MediaStreamTrackProcessor for VideoFrame extraction (best performance)
  useStreamMode?: boolean;
}

export type SeekPreviewMode = 'strict' | 'interactive';

export type PendingSeekKind = 'seek' | 'advance';

export type PendingSeekEndReason =
  | 'resolved'
  | 'cancelled'
  | 'replaced'
  | 'cleared'
  | 'fallback';
