import { CreatePollPage } from './pages/CreatePollPage';
import { HistoryPage } from './pages/HistoryPage';
import { StatsPage } from './pages/StatsPage';

export function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/history') return <HistoryPage />;
  if (path === '/stats') return <StatsPage />;
  return <CreatePollPage />;
}
