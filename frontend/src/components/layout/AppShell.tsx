import { Menu } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { BrandMark } from '../BrandMark';
import { Navigation } from '../Navigation';
import { Button } from '../ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '../ui/sheet';

type PageName = 'create' | 'history' | 'stats' | 'settings';

interface AppShellProps {
  children: ReactNode;
  current: PageName;
  eyebrow: string;
  footer: string;
  subtitle: string;
  title: string;
}

export function AppShell({ children, current, eyebrow, footer, subtitle, title }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="app-frame" data-page={current}>
      <aside className="app-sidebar">
        <SidebarBrand />
        <Navigation current={current} />
        <PrivacyNote />
      </aside>
      <header className="mobile-header">
        <SidebarBrand compact />
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild><Button className="mobile-menu-button" variant="secondary" size="icon" type="button" aria-label="Abrir menu"><Menu /></Button></SheetTrigger>
          <SheetContent side="left" className="mobile-menu-sheet">
            <SheetTitle className="sr-only">Navegação do EasyPoll</SheetTitle>
            <SidebarBrand />
            <Navigation current={current} onNavigate={() => setMenuOpen(false)} />
            <PrivacyNote />
          </SheetContent>
        </Sheet>
      </header>
      <main className="app-main">
        <div className="page-container">
          <header className="page-hero"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{subtitle}</p></header>
          {children}
          <footer>{footer}</footer>
        </div>
      </main>
    </div>
  );
}

function SidebarBrand({ compact = false }: { compact?: boolean }) {
  return <a className="sidebar-brand" href="/" aria-label="EasyPoll — página inicial"><BrandMark compact />{compact ? <strong>EasyPoll</strong> : <span><strong>EasyPoll</strong><small>Enquetes, do seu jeito.</small></span>}</a>;
}

function PrivacyNote() {
  return <div className="sidebar-note"><span className="sidebar-note-dot" />Local e privado<small>Seus dados ficam neste computador.</small></div>;
}
