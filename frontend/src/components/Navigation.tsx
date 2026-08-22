import { BarChart3, Clock3, PlusCircle, Settings2 } from 'lucide-react';

interface NavigationProps {
  current: 'create' | 'history' | 'stats' | 'settings';
  onNavigate?: () => void;
}

export function Navigation({ current, onNavigate }: NavigationProps) {
  const links = [
    { key: 'create' as const, href: '/', label: 'Criar enquete', icon: PlusCircle },
    { key: 'history' as const, href: '/history', label: 'Histórico', icon: Clock3 },
    { key: 'stats' as const, href: '/stats', label: 'Estatísticas', icon: BarChart3 },
    { key: 'settings' as const, href: '/settings', label: 'Configurações', icon: Settings2 }
  ];
  return (
    <nav className="app-nav" aria-label="Navegação principal">
      {links.map((link) => {
        const Icon = link.icon;
        return <a key={link.key} className={current === link.key ? 'active' : undefined}
          href={link.href} aria-current={current === link.key ? 'page' : undefined} onClick={onNavigate}>
          <Icon aria-hidden="true" /><span>{link.label}</span>
        </a>;
      })}
    </nav>
  );
}
