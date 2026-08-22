import { useEffect, useRef, useState } from 'react';
import { api } from '../api/easypollApi';
import type { Member } from '../types/api';

let activeLoads = 0;
const queuedLoads: Array<() => void> = [];
function drainQueue(): void {
  while (activeLoads < 3 && queuedLoads.length) queuedLoads.shift()?.();
}
function schedule(task: () => Promise<void>): () => void {
  let cancelled = false;
  const run = () => {
    if (cancelled) { drainQueue(); return; }
    activeLoads += 1;
    task().finally(() => {
      activeLoads -= 1;
      drainQueue();
    });
  };
  if (activeLoads < 3) run(); else queuedLoads.push(run);
  return () => { cancelled = true; };
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words.at(-1)?.[0]}` : words[0]?.[0] || '?')
    .toLocaleUpperCase('pt-BR');
}

export function MemberAvatar({ groupId, member }: { groupId: string; member: Member }) {
  const wrapper = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    let cancelQueued: (() => void) | undefined;
    let controller: AbortController | undefined;
    let timeout: number | undefined;
    const load = () => {
      cancelQueued = schedule(async () => {
        controller = new AbortController();
        timeout = window.setTimeout(() => controller?.abort(), 6_500);
        try {
          const result = await api.profilePicture(groupId, member.id, controller.signal);
          if (result.profilePicUrl) setUrl(result.profilePicUrl);
        } catch { /* initials remain on privacy, timeout and network failures */ }
        finally { if (timeout !== undefined) window.clearTimeout(timeout); }
      });
    };
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        load();
      }, { rootMargin: '120px' });
      observer.observe(element);
      return () => { observer.disconnect(); cancelQueued?.(); controller?.abort(); };
    }
    load();
    return () => { cancelQueued?.(); controller?.abort(); };
  }, [groupId, member.id]);
  return (
    <span ref={wrapper} className="member-avatar" aria-hidden="true">
      {url ? <img alt="" loading="lazy" referrerPolicy="no-referrer" src={url} /> : initials(member.name)}
    </span>
  );
}
