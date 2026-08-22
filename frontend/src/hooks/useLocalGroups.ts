import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/easypollApi';
import type { LocalGroup } from '../types/api';
import { readStoredValue, STORAGE_KEYS } from '../utils/storage';

interface UseLocalGroupsOptions { selectFirst?: boolean }

export function useLocalGroups({ selectFirst = false }: UseLocalGroupsOptions = {}) {
  const [groups, setGroups] = useState<LocalGroup[]>([]);
  const [groupId, setGroupId] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<unknown>(null);
  const controller = useRef<AbortController | null>(null);

  const loadGroups = useCallback(async (preserveCurrent = false) => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setError(null);
    try {
      const payload = await api.localGroups(request.signal);
      if (request.signal.aborted) return payload.groups;
      setGroups(payload.groups);
      setState('ready');
      if (!preserveCurrent) {
        const requested = new URLSearchParams(window.location.search).get('groupId') || '';
        const stored = readStoredValue(STORAGE_KEYS.lastGroupId);
        const preferred = [requested, stored].find((candidate) =>
          payload.groups.some((group) => group.id === candidate)
        );
        setGroupId(preferred || (selectFirst ? payload.groups[0]?.id || '' : ''));
      }
      return payload.groups;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError') && !preserveCurrent) {
        setState('error');
        setError(error);
      }
      throw error;
    } finally {
      if (controller.current === request) controller.current = null;
    }
  }, [selectFirst]);

  useEffect(() => {
    void loadGroups().catch(() => undefined);
    return () => controller.current?.abort();
  }, [loadGroups]);

  return { error, groups, groupId, setGroupId, state, loadGroups };
}
