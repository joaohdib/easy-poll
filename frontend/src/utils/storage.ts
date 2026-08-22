export const STORAGE_KEYS = {
  lastGroupId: 'easyPoll.lastGroupId',
  favoriteGroups: 'easyPoll.favoriteGroups'
} as const;

export function readStoredValue(key: string, fallback = ''): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

export function writeStoredValue(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* UI remains functional */ }
}

export function readFavoriteGroups(): Set<string> {
  try {
    const value: unknown = JSON.parse(readStoredValue(STORAGE_KEYS.favoriteGroups, '[]'));
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  } catch { return new Set(); }
}
