import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type { FlashBoardStoreState } from './types';
import { createDefaultFlashBoardComposer } from './defaults';
import { createBoardSlice, type BoardSliceActions } from './slices/boardSlice';
import { createNodeSlice, type NodeSliceActions } from './slices/nodeSlice';
import { createUiSlice, type UiSliceActions } from './slices/uiSlice';

export type FlashBoardStore = FlashBoardStoreState & BoardSliceActions & NodeSliceActions & UiSliceActions;

export const useFlashBoardStore = create<FlashBoardStore>()(
  subscribeWithSelector((set, get) => ({
    activeBoardId: null,
    boards: [],
    selectedNodeIds: [],
    viewMode: 'board' as const,
    composer: createDefaultFlashBoardComposer(),
    hoveredComposerReference: null,

    ...createBoardSlice(set, get),
    ...createNodeSlice(set, get),
    ...createUiSlice(set),
  }))
);

export * from './types';
export * from './selectors';
export * from './defaults';
