import { AlertTriangle, DatabaseZap } from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { DeleteAllDataDialog } from '../components/settings/DeleteAllDataDialog';
import { PrivacyNotice } from '../components/settings/PrivacyNotice';
import { StorageOverview } from '../components/settings/StorageOverview';
import { StoredGroupCard } from '../components/settings/StoredGroupCard';
import { Toast } from '../components/Toast';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { usePageMetadata } from '../hooks/usePageMetadata';
import { useSettingsStorage } from '../hooks/useSettingsStorage';
import { useToast } from '../hooks/useToast';
import { errorMessage } from '../utils/format';

export function SettingsPage() {
  usePageMetadata('Configurações — EasyPoll', 'Gerencie os dados armazenados localmente pelo EasyPoll.');
  const storage = useSettingsStorage();
  const { toast, showToast } = useToast();

  async function deleteGroup(groupId: string, groupName: string) {
    try {
      await storage.deleteGroup(groupId);
      showToast(`Dados locais de ${groupName} removidos.`);
    } catch (error) {
      showToast(errorMessage(error, 'Não foi possível limpar os dados deste grupo.'), true);
      throw error;
    }
  }

  async function deleteAll() {
    try {
      await storage.deleteAll();
      showToast('Todos os dados locais do EasyPoll foram removidos.');
    } catch (error) {
      showToast(errorMessage(error, 'Não foi possível limpar os dados locais.'), true);
      throw error;
    }
  }

  return <AppShell
    current="settings"
    eyebrow="Controle local"
    title="Configurações"
    subtitle="Gerencie os dados armazenados localmente pelo EasyPoll."
    footer="Limpar dados locais nunca altera mensagens, enquetes, grupos ou sua sessão no WhatsApp."
  >
    {storage.state === 'loading' && <SettingsSkeleton />}
    {storage.state === 'error' && <section className="card settings-load-error" role="alert"><DatabaseZap aria-hidden="true" /><h2>Não foi possível carregar os dados locais.</h2><p>Confira se o EasyPoll está em execução e tente novamente.</p><Button variant="secondary" onClick={() => void storage.refresh()}>Tentar novamente</Button></section>}
    {storage.state === 'ready' && storage.summary && <>
      <StorageOverview summary={storage.summary} />
      <section className="card settings-groups" aria-labelledby="settings-groups-title">
        <div className="section-heading"><div><p className="step">Detalhes por grupo</p><h2 id="settings-groups-title">Grupos armazenados</h2><p className="section-description">Contagens e intervalo de sincronização disponíveis neste computador.</p></div></div>
        {storage.summary.groups.length === 0
          ? <div className="settings-empty"><DatabaseZap aria-hidden="true" /><strong>Nenhum dado local armazenado.</strong><span>O EasyPoll começará a preencher este espaço quando você analisar ou sincronizar um grupo.</span></div>
          : <div className="settings-group-list">{storage.summary.groups.map((group) => <StoredGroupCard key={group.id} group={group} onDelete={() => deleteGroup(group.id, group.name)} />)}</div>}
      </section>
      <PrivacyNotice />
      <section className="card settings-danger" aria-labelledby="settings-danger-title"><div><AlertTriangle aria-hidden="true" /><div><p className="step">Zona de perigo</p><h2 id="settings-danger-title">Limpar todos os dados locais</h2><p>Remove os dados de domínio do EasyPoll. O arquivo SQLite, o schema, as migrations, sua sessão WhatsApp e as preferências do navegador permanecem intactos.</p></div></div><DeleteAllDataDialog onConfirm={deleteAll} /></section>
    </>}
    <Toast toast={toast} />
  </AppShell>;
}

function SettingsSkeleton() {
  return <div className="settings-skeleton" role="status" aria-label="Carregando dados locais"><section className="card"><Skeleton className="h-4 w-28" /><Skeleton className="mt-3 h-8 w-52" /><Skeleton className="mt-8 h-24 w-full" /><div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <Skeleton className="h-16" key={index} />)}</div></section><section className="card"><Skeleton className="h-7 w-48" /><Skeleton className="mt-6 h-28 w-full" /><Skeleton className="mt-3 h-28 w-full" /></section></div>;
}
