import { useLayoutEffect, useState } from 'react';

import {
  DEFAULT_GRAPH_WIDTH,
  getResponsiveGraphHeight,
} from './graphMath';

export function useEqualizerGraphSize(ref: { current: HTMLElement | null }, compact: boolean) {
  const [size, setSize] = useState({
    width: DEFAULT_GRAPH_WIDTH,
    height: getResponsiveGraphHeight(DEFAULT_GRAPH_WIDTH, compact),
  });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    // The canvas fills the stage's content box, so measure that (clientWidth /
    // contentRect) instead of the border box; bail out on unchanged sizes so
    // the initial ResizeObserver callback does not trigger a redundant render.
    const update = (measuredWidth: number) => {
      const width = Math.max(1, Math.round(measuredWidth || DEFAULT_GRAPH_WIDTH));
      const height = getResponsiveGraphHeight(width, compact);
      setSize(current => (
        current.width === width && current.height === height ? current : { width, height }
      ));
    };

    update(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') {
      const handleResize = () => update(element.clientWidth);
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }

    const observer = new ResizeObserver(entries => {
      update(entries[0]?.contentRect.width ?? element.clientWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [compact, ref]);

  return size;
}
