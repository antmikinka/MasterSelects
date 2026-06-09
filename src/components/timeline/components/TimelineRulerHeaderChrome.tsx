import type { ComponentProps, PointerEvent } from 'react';
import { TimelineControls } from '../TimelineControls';
import { TimelineRuler } from '../TimelineRuler';
import type { TimelineControlsProps } from '../types';

type TimelineRulerProps = ComponentProps<typeof TimelineRuler>;

interface TimelineRulerHeaderChromeProps {
  cacheRanges: TimelineRulerProps['cacheRanges'];
  clipAnimationPhase: string;
  displayMode: TimelineRulerProps['displayMode'];
  duration: number;
  formatTime: TimelineRulerProps['formatTime'];
  frameRate: TimelineRulerProps['frameRate'];
  isTrackHeaderWidthResizing: boolean;
  onRulerMouseDown: TimelineRulerProps['onRulerMouseDown'];
  onTrackHeaderWidthResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
  scrollX: number;
  timelineControlsProps: Omit<TimelineControlsProps, 'variant'>;
  videoBakeRegionSelection: TimelineRulerProps['videoBakeRegionSelection'];
  videoBakeRegions: TimelineRulerProps['videoBakeRegions'];
  zoom: number;
}

export function TimelineRulerHeaderChrome({
  cacheRanges,
  clipAnimationPhase,
  displayMode,
  duration,
  formatTime,
  frameRate,
  isTrackHeaderWidthResizing,
  onRulerMouseDown,
  onTrackHeaderWidthResizeStart,
  scrollX,
  timelineControlsProps,
  videoBakeRegionSelection,
  videoBakeRegions,
  zoom,
}: TimelineRulerHeaderChromeProps) {
  return (
    <>
      <div className="timeline-header-row">
        <div className="ruler-header">
          <div className="timeline-ruler-control-strip">
            <TimelineControls variant="main" {...timelineControlsProps} />
          </div>
        </div>
        <div className={`time-ruler-wrapper ${clipAnimationPhase !== 'idle' ? 'comp-switching' : ''}`}>
          <TimelineRuler
            duration={duration}
            zoom={zoom}
            frameRate={frameRate}
            displayMode={displayMode}
            scrollX={scrollX}
            onRulerMouseDown={onRulerMouseDown}
            formatTime={formatTime}
            cacheRanges={cacheRanges}
            videoBakeRegions={videoBakeRegions}
            videoBakeRegionSelection={videoBakeRegionSelection}
          />
        </div>
      </div>

      <div
        className={`timeline-layer-divider-resize-handle ${isTrackHeaderWidthResizing ? 'active' : ''}`}
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize layer column"
        onPointerDown={onTrackHeaderWidthResizeStart}
      />
    </>
  );
}
