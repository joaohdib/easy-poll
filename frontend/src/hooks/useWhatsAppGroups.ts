import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/easypollApi';
import type { Group } from '../types/api';
import { errorMessage, normalizeSearch } from '../utils/format';
import { readFavoriteGroups, readStoredValue, STORAGE_KEYS, writeStoredValue } from '../utils/storage';

export function useWhatsAppGroups(
  connected: boolean,
  showToast: (message: string, error?: boolean) => void,
  onAutomaticGroupChange?: (previousGroupId: string) => void
) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [help, setHelp] = useState('Os grupos aparecem quando a conexão estiver pronta.');
  const [search, setSearch] = useState('');
  const [groupId, setGroupId] = useState('');
  const [favorites, setFavorites] = useState(readFavoriteGroups);
  const connectedValue = useRef(connected);
  const groupValue = useRef(groupId);
  const previouslyConnected = useRef(false);
  connectedValue.current = connected;
  groupValue.current = groupId;

  const load = useCallback(async () => {
    if (!connectedValue.current) {
      showToast('WhatsApp ainda não está conectado.', true);
      return;
    }
    setLoading(true);
    setHelp('Buscando grupos…');
    try {
      const data = await api.groups();
      setGroups(data.groups);
      const requested = new URLSearchParams(window.location.search).get('groupId') || '';
      const stored = readStoredValue(STORAGE_KEYS.lastGroupId);
      const preferred = [groupValue.current, requested, stored].find((candidate) =>
        data.groups.some((group) => group.id === candidate)
      ) || '';
      if (groupValue.current && groupValue.current !== preferred) onAutomaticGroupChange?.(groupValue.current);
      setGroupId(preferred);
      setHelp(data.groups.length
        ? `${data.groups.length} ${data.groups.length === 1 ? 'grupo encontrado' : 'grupos encontrados'}. Favoritos aparecem primeiro.`
        : 'Nenhum grupo foi encontrado nesta conta.');
    } catch (error) {
      const message = errorMessage(error);
      setHelp(message);
      showToast(message, true);
    } finally {
      setLoading(false);
    }
  }, [onAutomaticGroupChange, showToast]);

  useEffect(() => {
    if (connected && !previouslyConnected.current) void load();
    previouslyConnected.current = connected;
  }, [connected, load]);

  const sortedGroups = useMemo(() => [...groups].sort((a, b) => {
    const favoriteDifference = Number(favorites.has(b.id)) - Number(favorites.has(a.id));
    return favoriteDifference || a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
  }), [favorites, groups]);
  const visibleGroups = useMemo(() => {
    const query = normalizeSearch(search);
    return sortedGroups.filter((group) => normalizeSearch(group.name).includes(query));
  }, [search, sortedGroups]);

  function toggleFavorite(target: string) {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(target)) next.delete(target);
      else next.add(target);
      writeStoredValue(STORAGE_KEYS.favoriteGroups, JSON.stringify([...next]));
      return next;
    });
  }

  function reset() {
    setGroups([]);
    setGroupId('');
    setSearch('');
  }

  return {
    favorites, groupId, groups, help, load, loading, reset, search,
    selectedGroup: groups.find((group) => group.id === groupId) ?? null,
    setGroupId, setSearch, toggleFavorite, visibleGroups
  };
}
