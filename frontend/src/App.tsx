import { CreatePollPage } from './pages/CreatePollPage';
import { HistoryPage } from './pages/HistoryPage';
import { StatsPage } from './pages/StatsPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/history') return <HistoryPage />;
  if (path === '/stats') return <StatsPage />;
  if (path === '/settings') return <SettingsPage />;
  return <CreatePollPage />;
}
