import type { ReactNode } from 'react';
import { BrandMark } from '../BrandMark';
import { Navigation } from '../Navigation';

type PageName = 'create' | 'history' | 'stats';

interface AppShellProps {
  children: ReactNode;
  current: PageName;
  eyebrow: string;
  footer: string;
  subtitle: string;
  title: string;
}

const shellClasses: Record<PageName, string> = {
  create: 'shell',
  history: 'history-page-shell',
  stats: 'stats-shell'
};

export function AppShell({ children, current, eyebrow, footer, subtitle, title }: AppShellProps) {
  const history = current === 'history';
  const stats = current === 'stats';
  return (
    <main className={shellClasses[current]}>
      {stats && <a className="stats-back" href="/">← Voltar para EasyPoll</a>}
      <header className={current === 'create' ? 'hero' : `stats-hero${history ? ' history-page-hero' : ''}`}>
        <BrandMark variant={current === 'create' ? 'poll' : current} />
        <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{subtitle}</p></div>
      </header>
      <Navigation current={current} />
      {children}
      <footer>{footer}</footer>
    </main>
  );
}
