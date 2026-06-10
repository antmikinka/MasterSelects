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

    const update = () => {
      const rect = element.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width || DEFAULT_GRAPH_WIDTH));
      const height = getResponsiveGraphHeight(width, compact);
      setSize({
        width,
        height,
      });
    };

    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [compact, ref]);

  return size;
}
