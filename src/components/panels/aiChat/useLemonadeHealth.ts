import { useEffect, useState } from 'react';
import type { AIProvider } from '../../../stores/settingsStore';
import { checkLemonadeHealth, type LemonadeModelInfo } from '../../../services/lemonadeProvider';

export function useLemonadeHealth(
  aiProvider: AIProvider,
  lemonadeEndpoint: string,
): {
  lemonadeModels: LemonadeModelInfo[];
  lemonadeStatus: 'online' | 'offline' | 'checking';
} {
  const [lemonadeStatus, setLemonadeStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [lemonadeModels, setLemonadeModels] = useState<LemonadeModelInfo[]>([]);

  useEffect(() => {
    if (aiProvider !== 'lemonade') {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setLemonadeStatus('checking');
      }
    });

    void checkLemonadeHealth(lemonadeEndpoint).then((health) => {
      if (cancelled) {
        return;
      }

      setLemonadeModels(health.models);
      setLemonadeStatus(health.available ? 'online' : 'offline');
    });

    return () => {
      cancelled = true;
    };
  }, [aiProvider, lemonadeEndpoint]);

  return {
    lemonadeModels,
    lemonadeStatus,
  };
}
