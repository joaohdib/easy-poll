import type { SyncDirection } from '../../types/api';
import { SyncControls } from './SyncControls';

interface HistorySyncControlsProps {
  cancelPending: boolean;
  disabled: boolean;
  direction: SyncDirection | null;
  error: boolean;
  feedback: string;
  onCancel: () => void;
  onSync: (direction: SyncDirection) => void;
}

export function HistorySyncControls({ cancelPending, disabled, direction, error, feedback, onCancel, onSync }: HistorySyncControlsProps) {
  return <><p className={`history-page-feedback${error ? ' error' : ''}`} role="status" aria-live="polite">{feedback}</p><SyncControls className="history-page-sync-actions" direction={direction} disabled={disabled} cancelPending={cancelPending} newerIdleLabel="Sincronizar novidades" newerLoadingLabel="Sincronizando..." olderIdleLabel="Buscar histórico mais antigo" olderLoadingLabel="Buscando..." onCancel={onCancel} onSync={onSync} /></>;
}
