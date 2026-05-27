import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { useMediaStore, type MediaFile } from '../../../stores/mediaStore';
import type { FlashBoardGenerationRequest, FlashBoardNode } from '../../../stores/flashboardStore/types';

const VISIBLE_QUEUE_STATUSES = new Set(['queued', 'processing', 'completed', 'failed', 'canceled']);
const MAX_VISIBLE_GENERATIONS = 6;
const MEDIA_QUEUE_FLY_MS = 620;

function formatElapsedDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${seconds}s`;
}

function formatElapsedRange(startedAt: number, endedAt: number): string {
  return formatElapsedDuration(endedAt - startedAt);
}

function getStatusLabel(status: NonNullable<FlashBoardNode['job']>['status'] | undefined): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'processing':
      return 'Generating';
    case 'completed':
      return 'Ready';
    case 'failed':
      return 'Failed';
    case 'canceled':
      return 'Canceled';
    default:
      return 'Pending';
  }
}

function getServiceLabel(request: FlashBoardGenerationRequest): string {
  switch (request.service) {
    case 'cloud':
      return 'Cloud';
    case 'elevenlabs':
      return 'ElevenLabs';
    case 'evolink':
      return 'EvoLink';
    case 'kieai':
      return 'Kie.ai';
    case 'piapi':
      return 'PiAPI';
    case 'suno':
      return 'Suno';
    default:
      return request.service;
  }
}

function getOutputLabel(request: FlashBoardGenerationRequest): string {
  if (request.outputType === 'image') {
    return 'Image';
  }
  if (request.outputType === 'audio' || request.service === 'elevenlabs' || request.service === 'suno') {
    return 'Audio';
  }
  return 'Video';
}

function getPreviewAspectRatio(request: FlashBoardGenerationRequest): string {
  if (request.outputType === 'audio' || request.service === 'elevenlabs' || request.service === 'suno') {
    return '2.4 / 1';
  }

  const [width, height] = (request.aspectRatio ?? '16:9').split(':').map((part) => Number(part));
  if (width > 0 && height > 0) {
    return `${width} / ${height}`;
  }

  return request.outputType === 'image' ? '1 / 1' : '16 / 9';
}

function getGeneratedPreviewUrl(mediaFile: MediaFile | undefined): string | undefined {
  if (!mediaFile) {
    return undefined;
  }

  if (mediaFile.thumbnailUrl) {
    return mediaFile.thumbnailUrl;
  }

  return mediaFile.type === 'image' ? mediaFile.url : undefined;
}

function getMetaLabel(request: FlashBoardGenerationRequest): string {
  const parts = [getServiceLabel(request)];

  if (request.duration && getOutputLabel(request) !== 'Audio') {
    parts.push(`${request.duration}s`);
  }
  if (request.aspectRatio && getOutputLabel(request) !== 'Audio') {
    parts.push(request.aspectRatio);
  }
  if (request.imageSize) {
    parts.push(request.imageSize);
  }

  return parts.join(' · ');
}

function getMediaPanelTarget(mediaFileId: string): HTMLElement | null {
  if (typeof document === 'undefined' || typeof CSS === 'undefined') {
    return null;
  }

  return document.querySelector<HTMLElement>(`[data-media-panel-anim-id="${CSS.escape(mediaFileId)}"]`);
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function waitForAnimation(animation: Animation): Promise<void> {
  return animation.finished.then(() => undefined, () => undefined);
}

async function animateCardToMediaTarget(source: HTMLElement, mediaFileId: string): Promise<void> {
  const target = getMediaPanelTarget(mediaFileId);
  if (!target || typeof document === 'undefined' || prefersReducedMotion()) {
    target?.classList.add('media-ai-generation-target-pulse');
    window.setTimeout(() => target?.classList.remove('media-ai-generation-target-pulse'), MEDIA_QUEUE_FLY_MS);
    return;
  }

  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

  const sourceRect = source.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  if (sourceRect.width < 1 || sourceRect.height < 1 || targetRect.width < 1 || targetRect.height < 1) {
    return;
  }

  const clone = source.cloneNode(true) as HTMLElement;
  clone.classList.add('media-ai-generation-card-fly-clone');
  clone.setAttribute('aria-hidden', 'true');
  clone.style.left = `${sourceRect.left}px`;
  clone.style.top = `${sourceRect.top}px`;
  clone.style.width = `${sourceRect.width}px`;
  clone.style.height = `${sourceRect.height}px`;
  document.body.appendChild(clone);
  source.classList.add('is-flying');

  const sourceCenterX = sourceRect.left + (sourceRect.width / 2);
  const sourceCenterY = sourceRect.top + (sourceRect.height / 2);
  const targetCenterX = targetRect.left + (targetRect.width / 2);
  const targetCenterY = targetRect.top + (targetRect.height / 2);
  const dx = targetCenterX - sourceCenterX;
  const dy = targetCenterY - sourceCenterY;
  const scale = Math.max(0.2, Math.min(0.82, Math.min(
    targetRect.width / sourceRect.width,
    targetRect.height / sourceRect.height
  )));
  const midScale = Math.max(scale + ((1 - scale) * 0.34), 0.62);
  const pulseTimer = window.setTimeout(() => {
    target.classList.add('media-ai-generation-target-pulse');
  }, MEDIA_QUEUE_FLY_MS * 0.62);

  try {
    const animation = clone.animate(
      [
        {
          opacity: 1,
          transform: 'translate3d(0, 0, 0) scale(1)',
        },
        {
          opacity: 0.96,
          transform: `translate3d(${dx * 0.58}px, ${dy * 0.18}px, 0) scale(${midScale})`,
          offset: 0.42,
        },
        {
          opacity: 0,
          transform: `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`,
        },
      ],
      {
        duration: MEDIA_QUEUE_FLY_MS,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'forwards',
      }
    );

    await waitForAnimation(animation);
  } finally {
    window.clearTimeout(pulseTimer);
    clone.remove();
    source.classList.remove('is-flying');
    window.setTimeout(() => target.classList.remove('media-ai-generation-target-pulse'), 700);
  }
}

export function MediaAIGenerationQueue() {
  const boards = useFlashBoardStore((state) => state.boards);
  const removeNode = useFlashBoardStore((state) => state.removeNode);
  const mediaFiles = useMediaStore((state) => state.files);
  const [now, setNow] = useState(() => Date.now());
  const [flyingNodeIds, setFlyingNodeIds] = useState<Set<string>>(() => new Set());
  const flyingNodeIdsRef = useRef<Set<string>>(new Set());

  const nodes = useMemo(() => boards
    .flatMap((board) => board.nodes)
    .filter((node) => (
      node.kind === 'generation'
      && node.request
      && VISIBLE_QUEUE_STATUSES.has(node.job?.status ?? '')
    ))
    .toSorted((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_VISIBLE_GENERATIONS), [boards]);

  const hasRunningGeneration = nodes.some((node) => {
    const status = node.job?.status;
    return status === 'queued' || status === 'processing';
  });

  useEffect(() => {
    if (!hasRunningGeneration) {
      return undefined;
    }

    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasRunningGeneration]);

  const handleCompletedLocate = useCallback(async (node: FlashBoardNode, source: HTMLElement) => {
    const mediaFileId = node.result?.mediaFileId;
    if (node.job?.status !== 'completed' || !mediaFileId || flyingNodeIdsRef.current.has(node.id)) {
      return;
    }

    flyingNodeIdsRef.current.add(node.id);
    setFlyingNodeIds((current) => new Set(current).add(node.id));
    try {
      await animateCardToMediaTarget(source, mediaFileId);
      removeNode(node.id);
    } finally {
      flyingNodeIdsRef.current.delete(node.id);
      setFlyingNodeIds((current) => {
        const next = new Set(current);
        next.delete(node.id);
        return next;
      });
    }
  }, [removeNode]);

  if (nodes.length === 0) {
    return null;
  }

  return (
    <div className="media-ai-generation-queue" aria-label="AI generation queue">
      {nodes.map((node) => {
        const request = node.request;
        if (!request) {
          return null;
        }

        const status = node.job?.status;
        const progress = typeof node.job?.progress === 'number'
          ? Math.max(0, Math.min(1, node.job.progress))
          : null;
        const generatedMedia = node.result?.mediaFileId
          ? mediaFiles.find((file) => file.id === node.result?.mediaFileId)
          : undefined;
        const generatedPreviewUrl = status === 'completed'
          ? getGeneratedPreviewUrl(generatedMedia)
          : undefined;
        const startedAt = node.job?.startedAt;
        const completedAt = node.job?.completedAt;
        const hasGenerationTimer = (status === 'processing' || status === 'completed') && Boolean(startedAt);
        const queueTimerLabel = formatElapsedRange(node.createdAt, hasGenerationTimer && startedAt ? startedAt : now);
        const generationTimerLabel = hasGenerationTimer && startedAt
          ? formatElapsedRange(startedAt, completedAt ?? now)
          : null;
        const progressLabel = progress !== null ? `${Math.round(progress * 100)}%` : null;
        const canFlyToMedia = status === 'completed' && Boolean(node.result?.mediaFileId);
        const canDismiss = status === 'failed' || status === 'canceled' || (status === 'completed' && !canFlyToMedia);
        const cardClassName = [
          'media-ai-generation-card',
          status ?? 'pending',
          canFlyToMedia ? 'can-locate' : '',
          flyingNodeIds.has(node.id) ? 'is-flying' : '',
        ].filter(Boolean).join(' ');
        const handleClick = (event: MouseEvent<HTMLDivElement>) => {
          if (canFlyToMedia) {
            void handleCompletedLocate(node, event.currentTarget);
          }
        };
        const handleMouseEnter = (event: MouseEvent<HTMLDivElement>) => {
          if (canFlyToMedia) {
            void handleCompletedLocate(node, event.currentTarget);
          }
        };
        const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
          if (!canFlyToMedia || (event.key !== 'Enter' && event.key !== ' ')) {
            return;
          }

          event.preventDefault();
          void handleCompletedLocate(node, event.currentTarget);
        };

        return (
          <div
            key={node.id}
            className={cardClassName}
            onClick={canFlyToMedia ? handleClick : undefined}
            onMouseEnter={canFlyToMedia ? handleMouseEnter : undefined}
            onKeyDown={canFlyToMedia ? handleKeyDown : undefined}
            role={canFlyToMedia ? 'button' : undefined}
            tabIndex={canFlyToMedia ? 0 : undefined}
            title={canFlyToMedia ? 'Show generated media in Media panel' : undefined}
          >
            <div
              className={`media-ai-generation-preview ${generatedPreviewUrl ? 'has-thumbnail' : ''}`}
              style={{ aspectRatio: getPreviewAspectRatio(request) }}
            >
              {generatedPreviewUrl ? (
                <img src={generatedPreviewUrl} alt="" draggable={false} />
              ) : null}
              <span>{getOutputLabel(request)}</span>
              {(status === 'queued' || status === 'processing') && (
                <span className="media-ai-generation-pulse" aria-hidden="true" />
              )}
            </div>
            <div className="media-ai-generation-body">
              <div className="media-ai-generation-status-row">
                <span className={`media-ai-generation-status ${status ?? 'pending'}`}>
                  {getStatusLabel(status)}
                </span>
                <div
                  className={`media-ai-generation-timers ${generationTimerLabel ? 'has-generation' : 'pending-only'}`}
                  aria-label={generationTimerLabel
                    ? `Generation time ${generationTimerLabel}, queue time ${queueTimerLabel}`
                    : `Queue time ${queueTimerLabel}`}
                >
                  {generationTimerLabel ? (
                    <span className="media-ai-generation-time media-ai-generation-time-generation" title="Generation time">
                      {generationTimerLabel}
                    </span>
                  ) : null}
                  <span className="media-ai-generation-time media-ai-generation-time-pending" title="Queue time">
                    {generationTimerLabel ? `queued ${queueTimerLabel}` : queueTimerLabel}
                  </span>
                </div>
              </div>
              <div className="media-ai-generation-prompt" title={request.prompt}>
                {request.prompt || 'Untitled generation'}
              </div>
              <div className="media-ai-generation-meta">
                {getMetaLabel(request)}
              </div>
              {progress !== null && (
                <div className="media-ai-generation-progress" aria-label={`Generation progress ${progressLabel}`}>
                  <span style={{ width: progressLabel ?? '0%' }} />
                </div>
              )}
              {status === 'failed' && node.job?.error && (
                <div className="media-ai-generation-error" title={node.job.error}>
                  {node.job.error}
                </div>
              )}
            </div>
            {canDismiss && (
              <button
                className="media-ai-generation-dismiss"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  removeNode(node.id);
                }}
                title="Dismiss generation"
              >
                &times;
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
