import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  GuidedPoint,
  GuidedRuntimeEvent,
  GuidedScheduledAction,
  GuidedSerializableTargetResolution,
  GuidedSessionPlan,
  GuidedSessionSnapshot,
  GuidedSessionStatus,
  GuidedTargetRef,
  GuidedTargetResolution,
} from '../services/guidedActions/types';
import { getGuidedTargetKey } from '../services/guidedActions/targetRegistry';

export interface GuidedCursorState {
  visible: boolean;
  position: GuidedPoint | null;
  clicking: boolean;
}

export interface GuidedCalloutState {
  title: string;
  body?: string;
  target?: GuidedTargetRef;
}

export interface GuidedHighlightState {
  id: string;
  target: GuidedTargetRef;
  tone: 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
  createdAt: number;
  durationMs?: number;
}

export interface GuidedPreviewPathState {
  id: string;
  points: GuidedPoint[];
  closed: boolean;
  createdAt: number;
  durationMs?: number;
}

export interface GuidedDiagnosticEntry {
  id: string;
  sessionId: string;
  message: string;
  data?: Record<string, unknown>;
  createdAt: number;
}

interface GuidedActionStoreState {
  activeSession: GuidedSessionSnapshot | null;
  currentStep: GuidedScheduledAction | null;
  cursor: GuidedCursorState;
  spotlight: GuidedTargetRef | null;
  callout: GuidedCalloutState | null;
  highlights: GuidedHighlightState[];
  previewPaths: GuidedPreviewPathState[];
  targetResolutions: Record<string, GuidedSerializableTargetResolution>;
  diagnostics: GuidedDiagnosticEntry[];
  eventLog: GuidedRuntimeEvent[];

  startSession: (session: GuidedSessionSnapshot) => void;
  setCurrentStep: (step: GuidedScheduledAction | null) => void;
  completeCurrentStep: () => void;
  setCursor: (cursor: Partial<GuidedCursorState>) => void;
  setSpotlight: (target: GuidedTargetRef | null) => void;
  setCallout: (callout: GuidedCalloutState | null) => void;
  addHighlight: (highlight: Omit<GuidedHighlightState, 'id' | 'createdAt'>) => string;
  clearHighlights: () => void;
  addPreviewPath: (path: Omit<GuidedPreviewPathState, 'id' | 'createdAt'>) => string;
  clearPreviewPaths: () => void;
  recordTargetResolution: (resolution: GuidedTargetResolution) => void;
  appendDiagnostic: (sessionId: string, message: string, data?: Record<string, unknown>) => void;
  appendEvent: (event: GuidedRuntimeEvent) => void;
  markSessionCancelling: (sessionId: string) => void;
  finishSession: (sessionId: string, status: Exclude<GuidedSessionStatus, 'idle' | 'running' | 'cancelling'>, error?: string) => void;
  clearSession: () => void;
}

const INITIAL_CURSOR: GuidedCursorState = {
  visible: false,
  position: null,
  clicking: false,
};

export const useGuidedActionStore = create<GuidedActionStoreState>()(
  subscribeWithSelector((set, get) => ({
    activeSession: null,
    currentStep: null,
    cursor: INITIAL_CURSOR,
    spotlight: null,
    callout: null,
    highlights: [],
    previewPaths: [],
    targetResolutions: {},
    diagnostics: [],
    eventLog: [],

    startSession: (session) => {
      set({
        activeSession: session,
        currentStep: null,
        cursor: INITIAL_CURSOR,
        spotlight: null,
        callout: null,
        highlights: [],
        previewPaths: [],
        targetResolutions: {},
        diagnostics: [],
        eventLog: [{ type: 'session-started', sessionId: session.id }],
      });
    },

    setCurrentStep: (step) => {
      set({ currentStep: step });
    },

    completeCurrentStep: () => {
      set({ currentStep: null, cursor: { ...get().cursor, clicking: false } });
    },

    setCursor: (cursor) => {
      set((state) => ({
        cursor: {
          ...state.cursor,
          ...cursor,
        },
      }));
    },

    setSpotlight: (target) => {
      set({ spotlight: target });
    },

    setCallout: (callout) => {
      set({ callout });
    },

    addHighlight: (highlight) => {
      const id = `guided-highlight-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      set((state) => ({
        highlights: [
          ...state.highlights,
          {
            ...highlight,
            id,
            createdAt: Date.now(),
          },
        ],
      }));
      return id;
    },

    clearHighlights: () => {
      set({ highlights: [] });
    },

    addPreviewPath: (path) => {
      const id = `guided-preview-path-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      set((state) => ({
        previewPaths: [
          ...state.previewPaths,
          {
            ...path,
            id,
            createdAt: Date.now(),
          },
        ],
      }));
      return id;
    },

    clearPreviewPaths: () => {
      set({ previewPaths: [] });
    },

    recordTargetResolution: (resolution) => {
      const serializable = stripElementFromResolution(resolution);
      set((state) => ({
        targetResolutions: {
          ...state.targetResolutions,
          [getGuidedTargetKey(resolution.target)]: serializable,
        },
      }));
    },

    appendDiagnostic: (sessionId, message, data) => {
      const entry: GuidedDiagnosticEntry = {
        id: `guided-diagnostic-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        sessionId,
        message,
        data,
        createdAt: Date.now(),
      };
      set((state) => ({
        diagnostics: [...state.diagnostics.slice(-99), entry],
      }));
    },

    appendEvent: (event) => {
      set((state) => ({
        eventLog: [...state.eventLog.slice(-199), event],
      }));
    },

    markSessionCancelling: (sessionId) => {
      set((state) => {
        if (!state.activeSession || state.activeSession.id !== sessionId) {
          return {};
        }
        return {
          activeSession: {
            ...state.activeSession,
            status: 'cancelling',
          },
        };
      });
    },

    finishSession: (sessionId, status, error) => {
      set((state) => {
        if (!state.activeSession || state.activeSession.id !== sessionId) {
          return {};
        }

        const finishedSession: GuidedSessionSnapshot = {
          ...state.activeSession,
          status,
          error,
          finishedAt: Date.now(),
        };

        return {
          activeSession: finishedSession,
          currentStep: null,
          cursor: INITIAL_CURSOR,
          spotlight: null,
          callout: null,
        };
      });
    },

    clearSession: () => {
      set({
        activeSession: null,
        currentStep: null,
        cursor: INITIAL_CURSOR,
        spotlight: null,
        callout: null,
        highlights: [],
        previewPaths: [],
        targetResolutions: {},
      });
    },
  })),
);

export type GuidedActionStoreApi = typeof useGuidedActionStore;
export type { GuidedSessionPlan };

function stripElementFromResolution(
  resolution: GuidedTargetResolution,
): GuidedSerializableTargetResolution {
  if (resolution.status === 'missing') {
    return resolution;
  }

  return {
    status: resolution.status,
    target: resolution.target,
    rect: resolution.rect,
    point: resolution.point,
    center: resolution.center,
  };
}
