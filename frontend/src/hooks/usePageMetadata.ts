import { useEffect } from 'react';

export function usePageMetadata(title: string, description: string): void {
  useEffect(() => {
    document.title = title;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (meta) meta.content = description;
  }, [description, title]);
}
