import type { SyncDirection } from '../../types/api';

interface SyncControlsProps {
  cancelPending?: boolean;
  className: string;
  direction: SyncDirection | null;
  disabled: boolean;
  newerIdleLabel: string;
  newerLoadingLabel: string;
  olderIdleLabel: string;
  olderLoadingLabel: string;
  onCancel: () => void;
  onSync: (direction: SyncDirection) => void;
}

export function SyncControls({ cancelPending = false, className, direction, disabled, newerIdleLabel, newerLoadingLabel, olderIdleLabel, olderLoadingLabel, onCancel, onSync }: SyncControlsProps) {
  return <div className={className}><button className="button secondary" type="button" disabled={disabled || Boolean(direction)} onClick={() => onSync('newer')}><span className="button-label">{direction === 'newer' ? newerLoadingLabel : newerIdleLabel}</span>{direction === 'newer' && <span className="spinner dark" />}</button><button className="button secondary" type="button" disabled={disabled || Boolean(direction)} onClick={() => onSync('older')}><span className="button-label">{direction === 'older' ? olderLoadingLabel : olderIdleLabel}</span>{direction === 'older' && <span className="spinner dark" />}</button>{direction && <button className="button history-cancel-button" type="button" disabled={cancelPending} onClick={onCancel}>Cancelar</button>}</div>;
}
