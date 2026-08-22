import { useEffect, useRef, useState } from 'react';
import { api } from '../api/easypollApi';
import type { PersistedStatsResult } from '../types/api';

export function useStats(groupId: string) {
  const [loaded, setLoaded] = useState<{ groupId: string; result: PersistedStatsResult } | null>(null);
  const [loading, setLoading] = useState(Boolean(groupId));
  const [error, setError] = useState<unknown>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    controller.current?.abort();
    if (!groupId) {
      setLoaded(null);
      setLoading(false);
      setError(null);
      return;
    }
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setLoaded(null);
    setError(null);
    void api.stats(groupId, request.signal).then((data) => {
      if (!request.signal.aborted) setLoaded({ groupId, result: data });
    }).catch((requestError: unknown) => {
      if (!(requestError instanceof DOMException && requestError.name === 'AbortError')) setError(requestError);
    }).finally(() => {
      if (controller.current === request) {
        controller.current = null;
        setLoading(false);
      }
    });
    return () => request.abort();
  }, [groupId]);

  useEffect(() => () => controller.current?.abort(), []);
  return { error, loading, result: loaded?.groupId === groupId ? loaded.result : null };
}
