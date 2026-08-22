import { Database, HardDrive } from 'lucide-react';
import type { SettingsStorageSummary } from '../../types/api';
import { formatBytes, numberFormatter } from '../../utils/format';

export function StorageOverview({ summary }: { summary: SettingsStorageSummary }) {
  const metrics = [
    [summary.totals.groups, 'grupos'],
    [summary.totals.polls, 'enquetes'],
    [summary.totals.participations, 'participações'],
    [summary.totals.selections, 'seleções registradas'],
    [summary.totals.processedMessages, 'mensagens indexadas']
  ] as const;

  return <section className="card settings-storage" aria-labelledby="settings-storage-title">
    <div className="section-heading">
      <div><p className="step">Neste dispositivo</p><h2 id="settings-storage-title">Dados locais</h2><p className="section-description">Uma visão resumida do que o EasyPoll mantém no SQLite.</p></div>
      <HardDrive aria-hidden="true" />
    </div>
    <div className="settings-database">
      <Database aria-hidden="true" />
      <div><span>Banco EasyPoll</span><strong>{formatBytes(summary.database.sizeBytes)}</strong><small>{summary.database.relativePath} · armazenado somente neste dispositivo</small></div>
    </div>
    <div className="settings-metrics">
      {metrics.map(([value, label]) => <div key={label}><strong>{numberFormatter.format(value)}</strong><span>{label}</span></div>)}
    </div>
  </section>;
}
