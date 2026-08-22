import type { Member } from '../types/api';
import { normalizeSearch } from './format';

export const MAX_POLL_OPTIONS = 12;

export function parseBulkOptions(raw: string): string[] {
  const value = raw.trim();
  if (!value) return [];
  return (/\r?\n/.test(value) ? value.split(/\r?\n/) : value.includes(';') ? value.split(';') : value.split(','))
    .map((option) => option.trim()).filter(Boolean);
}

export function uniqueMemberNames(members: Member[]): string[] {
  const used = new Set<string>();
  return members.map((member) => {
    const base = (member.name || 'Participante').trim().slice(0, 94) || 'Participante';
    let name = base;
    let suffix = 2;
    while (used.has(normalizeSearch(name))) name = `${base} (${suffix++})`.slice(0, 100);
    used.add(normalizeSearch(name));
    return name;
  });
}
