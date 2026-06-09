import type { TimelineClip } from '../../../types';
import { Logger } from '../../../services/logger';

const log = Logger.create('VideoCachedAnalysisLoader');

export function loadCachedProjectAnalysisForVideo(
  clipId: string,
  fileName: string,
  mediaFileId: string | undefined,
  setClips: (updater: (clips: TimelineClip[]) => TimelineClip[]) => void,
): void {
  if (!mediaFileId) return;

  import('../../../services/project/ProjectFileService').then(async ({ projectFileService }) => {
    if (!projectFileService.isProjectOpen()) return;
    try {
      const merged = await projectFileService.getAllAnalysisMerged(mediaFileId);
      if (merged && merged.frames.length > 0) {
        setClips(clips => clips.map(c => {
          if (c.id !== clipId || c.analysisStatus === 'ready') return c;
          return {
            ...c,
            analysis: { frames: merged.frames as import('../../../types').FrameAnalysisData[], sampleInterval: merged.sampleInterval },
            analysisStatus: 'ready' as const,
          };
        }));
        log.debug('Loaded cached analysis for new clip', { file: fileName, frames: merged.frames.length });
      }
    } catch {
      // No cached project analysis.
    }
  });
}
