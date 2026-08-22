import type { Group, GroupSyncStatus, HistoryPreparationStatus, PollScanResult, SyncDirection } from '../../types/api';
import { PollScanView } from '../history/PollScanView';
import { SyncControls } from './SyncControls';

const MAX_HISTORY_MESSAGES = 500_000;
const HISTORY_PRESETS = [100, 500, 1_000, 500_000];

interface CreateHistoryToolsProps {
  connected: boolean;
  historyLimit: number;
  historyPreparation: HistoryPreparationStatus | null;
  historyPreparing: boolean;
  rawVisible: boolean;
  scanResult: PollScanResult | null;
  scanStatus: { text: string; error: boolean } | null;
  scanning: boolean;
  selectedGroup: Group | null;
  syncDetail: string;
  syncDirection: SyncDirection | null;
  syncStatus: GroupSyncStatus | null;
  onCancelHistory: () => void;
  onCancelSync: () => void;
  onHistoryLimitChange: (limit: number) => void;
  onPrepareHistory: () => void;
  onScan: () => void;
  onSync: (direction: SyncDirection) => void;
  onToggleRaw: () => void;
}

export function CreateHistoryTools(props: CreateHistoryToolsProps) {
  const busy = props.historyPreparing || Boolean(props.syncDirection) || props.scanning;
  const preparationCount = props.historyPreparation?.messagesAvailable ?? '—';
  const preparationDetail = getPreparationDetail(props.historyPreparation, preparationCount, Boolean(props.selectedGroup));
  return <section className="card history-card" aria-labelledby="history-title"><div className="section-heading"><div><p className="step">Enquetes anteriores</p><h2 id="history-title">Analisar histórico disponível</h2></div><span className="experimental-badge">Experimental</span></div><p className="history-description">Analisa somente as mensagens que o WhatsApp Web disponibilizar para esta sessão. Enquetes muito antigas podem não estar acessíveis.</p><a className="button secondary stats-link local-stats-entry" href="/stats">Ver estatísticas locais</a><fieldset className="history-fields" disabled={!props.connected}><div className="history-current-group"><span>Grupo atual</span><strong>{props.selectedGroup?.name || 'Selecione um grupo acima'}</strong></div><div className="history-sync-panel"><div className="history-prepare-heading"><div><strong>Histórico local</strong><small>Sincronize apenas o delta conhecido pelo banco local.</small></div></div><dl className="history-sync-metrics"><div><dt>Mensagens conhecidas</dt><dd>{props.syncStatus?.messagesProcessed.toLocaleString('pt-BR') ?? '—'}</dd></div><div><dt>Disponível localmente desde</dt><dd>{formatSyncTimestamp(props.syncStatus?.oldestProcessedTimestamp ?? null)}</dd></div><div><dt>Última sincronização</dt><dd>{formatSyncTimestamp(props.syncStatus?.lastSyncAt ?? null, true)}</dd></div></dl><p className="history-prepare-detail" role="status" aria-live="polite">{props.syncDetail}</p><SyncControls className="history-sync-actions" direction={props.syncDirection} disabled={busy || !props.selectedGroup} newerIdleLabel="Sincronizar novidades" newerLoadingLabel="Procurando novidades…" olderIdleLabel="Buscar histórico mais antigo" olderLoadingLabel="Buscando histórico anterior…" onCancel={props.onCancelSync} onSync={props.onSync} /></div><div className="history-prepare-panel"><div className="history-prepare-heading"><div><strong>Histórico do grupo</strong><small>O WhatsApp Web ainda pode estar sincronizando mensagens deste grupo.</small></div><span className="experimental-badge">Experimental</span></div><div className="history-prepare-metric" aria-live="polite"><strong>{preparationCount}</strong><span>mensagens disponíveis</span></div><p className="history-prepare-detail">{preparationDetail}</p><div className="history-prepare-actions"><button className="button secondary" type="button" disabled={busy || !props.selectedGroup} onClick={props.onPrepareHistory}><span className="button-label">{props.historyPreparing ? 'Carregando mensagens antigas…' : 'Preparar histórico'}</span>{props.historyPreparing && <span className="spinner dark" />}</button>{props.historyPreparing && <button className="button history-cancel-button" type="button" onClick={props.onCancelHistory}>Cancelar</button>}</div></div><div className="field history-limit-field"><label htmlFor="history-limit">Mensagens a analisar</label><div className="history-presets" aria-label="Limites de mensagens">{HISTORY_PRESETS.map((limit) => <button key={limit} className={`button secondary history-preset${limit === props.historyLimit ? ' active' : ''}`} type="button" disabled={busy} onClick={() => props.onHistoryLimitChange(limit)}>{limit === 500_000 ? '500 mil' : limit}</button>)}</div><input id="history-limit" type="number" min={1} max={MAX_HISTORY_MESSAGES} step={1} value={props.historyLimit} disabled={busy} onChange={(event) => props.onHistoryLimitChange(Number(event.target.value))} /><small>Limite máximo nesta etapa experimental: 500.000 mensagens.</small></div><button className="button primary history-scan-button" type="button" disabled={busy || !props.selectedGroup} onClick={props.onScan}><span className="button-label">{props.scanning ? 'Analisando histórico disponível…' : 'Analisar enquetes'}</span>{props.scanning && <span className="spinner" />}</button></fieldset>{props.scanStatus && <p className={`history-status${props.scanStatus.error ? ' error' : ''}`} role="status" aria-live="polite">{props.scanStatus.text}</p>}{props.scanResult && <PollScanView result={props.scanResult} rawVisible={props.rawVisible} onToggleRaw={props.onToggleRaw} />}</section>;
}

function formatSyncTimestamp(timestamp: number | null, includeTime = false): string {
  if (!Number.isFinite(Number(timestamp))) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', ...(includeTime ? { timeStyle: 'short' } : {}) }).format(new Date(Number(timestamp) * 1000));
}

function getPreparationDetail(preparation: HistoryPreparationStatus | null, count: number | string, hasGroup: boolean): string {
  if (!preparation) return hasGroup ? 'Medindo mensagens disponíveis nesta sessão…' : 'Selecione um grupo para medir o histórico disponível nesta sessão.';
  if (preparation.status === 'preparing') return `⟳ ${preparation.detail || 'Buscando mensagens anteriores…'} Tentativa ${preparation.attempts || 0}.`;
  return ({
    completed: `✓ Preparação concluída. ${count} mensagens disponíveis nesta sessão.`,
    stabilized: `✓ Histórico estabilizado por agora. ${count} mensagens disponíveis nesta sessão.`,
    cancelled: `Preparação cancelada. ${count} mensagens continuam disponíveis nesta sessão.`,
    timeout: `Tempo limite atingido. ${count} mensagens disponíveis nesta sessão.`,
    error: preparation.error || 'Não foi possível preparar mais histórico.'
  }[preparation.status] || preparation.detail);
}
