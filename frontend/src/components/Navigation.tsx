interface NavigationProps { current: 'create' | 'history' | 'stats' }

export function Navigation({ current }: NavigationProps) {
  const links = [
    { key: 'create' as const, href: '/', label: 'Criar enquete' },
    { key: 'history' as const, href: '/history', label: 'Histórico' },
    { key: 'stats' as const, href: '/stats', label: 'Estatísticas' }
  ];
  return (
    <nav className="app-nav" aria-label="Navegação principal">
      {links.map((link) => (
        <a key={link.key} className={current === link.key ? 'active' : undefined}
          href={link.href} aria-current={current === link.key ? 'page' : undefined}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}
