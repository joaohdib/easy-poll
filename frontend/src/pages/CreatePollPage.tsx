import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/easypollApi';
import { WhatsAppGroupSelector } from '../components/groups/WhatsAppGroupSelector';
import { AppShell } from '../components/layout/AppShell';
import { PollComposer } from '../components/polls/PollComposer';
import { CreateHistoryTools } from '../components/sync/CreateHistoryTools';
import { Toast } from '../components/Toast';
import { WhatsAppStatus } from '../components/whatsapp/WhatsAppStatus';
import { usePageMetadata } from '../hooks/usePageMetadata';
import { useToast } from '../hooks/useToast';
import { useWhatsAppGroups } from '../hooks/useWhatsAppGroups';
import { useWhatsAppStatus } from '../hooks/useWhatsAppStatus';
import type {
  GroupSyncStatus, HistoryPreparationStatus, IncrementalSyncResult,
  PollScanResult, SyncDirection
} from '../types/api';
import { errorMessage } from '../utils/format';
import { STORAGE_KEYS, writeStoredValue } from '../utils/storage';

const MAX_HISTORY_MESSAGES = 500_000;

export function CreatePollPage() {
  usePageMetadata('EasyPoll — Enquetes no WhatsApp', 'EasyPoll — enquetes rápidas para seus grupos do WhatsApp.');
  const { toast, showToast } = useToast();
  const whatsapp = useWhatsAppStatus();
  const syncDirectionValue = useRef<SyncDirection | null>(null);
  const historyPreparingValue = useRef(false);
  const cancelWorkFor = useCallback((targetGroupId: string) => {
    if (!targetGroupId) return;
    if (syncDirectionValue.current) void api.cancelSync(targetGroupId).catch(() => undefined);
    if (historyPreparingValue.current) void api.cancelHistoryPreparation(targetGroupId).catch(() => undefined);
  }, []);
  const groupPicker = useWhatsAppGroups(whatsapp.connected, showToast, cancelWorkFor);
  const [historyLimit, setHistoryLimit] = useState(1_000);
  const [historyPreparing, setHistoryPreparing] = useState(false);
  const [historyPreparation, setHistoryPreparation] = useState<HistoryPreparationStatus | null>(null);
  const [syncDirection, setSyncDirection] = useState<SyncDirection | null>(null);
  const [syncStatus, setSyncStatus] = useState<GroupSyncStatus | null>(null);
  const [syncDetail, setSyncDetail] = useState('Selecione um grupo para consultar o histórico local.');
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [scanResult, setScanResult] = useState<PollScanResult | null>(null);
  const [rawVisible, setRawVisible] = useState(false);
  const groupValue = useRef(groupPicker.groupId);
  const historyStatusRequest = useRef(0);
  const syncStatusRequest = useRef(0);
  const scanRequest = useRef(0);
  const historyTimer = useRef<number | null>(null);
  groupValue.current = groupPicker.groupId;
  syncDirectionValue.current = syncDirection;
  historyPreparingValue.current = historyPreparing;

  const loadSyncStatus = useCallback(async (targetGroupId: string) => {
    const requestId = ++syncStatusRequest.current;
    try {
      const data = await api.syncStatus(targetGroupId);
      if (requestId !== syncStatusRequest.current || groupValue.current !== targetGroupId) return;
      setSyncStatus(data);
      setSyncDetail(data.messagesProcessed
        ? `${data.messagesProcessed.toLocaleString('pt-BR')} IDs de mensagens armazenados sem conteúdo de conversas.`
        : 'Nenhum histórico local encontrado. Use “Analisar enquetes” para fazer a importação inicial.');
    } catch (error) {
      if (requestId === syncStatusRequest.current && groupValue.current === targetGroupId) setSyncDetail(errorMessage(error));
    }
  }, []);

  const pollHistoryPreparation = useCallback(async (targetGroupId: string, sameRequest = false) => {
    const requestId = sameRequest ? historyStatusRequest.current : ++historyStatusRequest.current;
    try {
      const data = await api.historyPreparationStatus(targetGroupId);
      if (requestId !== historyStatusRequest.current || groupValue.current !== targetGroupId) return;
      setHistoryPreparation(data);
      setHistoryPreparing(data.status === 'preparing');
      if (data.status === 'preparing') {
        if (historyTimer.current !== null) window.clearTimeout(historyTimer.current);
        historyTimer.current = window.setTimeout(() => void pollHistoryPreparation(targetGroupId, true), 1_500);
      }
    } catch (error) {
      if (requestId === historyStatusRequest.current && groupValue.current === targetGroupId) {
        setHistoryPreparing(false);
        setHistoryPreparation((previous) => previous ? { ...previous, status: 'error', error: errorMessage(error) } : null);
      }
    }
  }, []);

  useEffect(() => {
    if (historyTimer.current !== null) window.clearTimeout(historyTimer.current);
    historyStatusRequest.current += 1;
    syncStatusRequest.current += 1;
    scanRequest.current += 1;
    setHistoryPreparation(null);
    setHistoryPreparing(false);
    setSyncStatus(null);
    setSyncDirection(null);
    setScanResult(null);
    setScanStatus(null);
    setRawVisible(false);
    if (!groupPicker.groupId) {
      setSyncDetail('Selecione um grupo para consultar o histórico local.');
      return;
    }
    writeStoredValue(STORAGE_KEYS.lastGroupId, groupPicker.groupId);
    setSyncDetail('Consultando histórico local…');
    void loadSyncStatus(groupPicker.groupId);
    if (whatsapp.connected) void pollHistoryPreparation(groupPicker.groupId);
  }, [groupPicker.groupId, loadSyncStatus, pollHistoryPreparation]);

  useEffect(() => {
    if (whatsapp.connected && groupValue.current) void pollHistoryPreparation(groupValue.current);
  }, [whatsapp.connected, pollHistoryPreparation]);

  useEffect(() => () => {
    if (historyTimer.current !== null) window.clearTimeout(historyTimer.current);
  }, []);

  function selectGroup(nextGroupId: string) {
    if (groupPicker.groupId && groupPicker.groupId !== nextGroupId) cancelWorkFor(groupPicker.groupId);
    groupPicker.setGroupId(nextGroupId);
  }

  async function disconnectWhatsApp() {
    if (whatsapp.disconnecting || !whatsapp.connected || !window.confirm('Desconectar o WhatsApp deste computador? Será necessário escanear um novo QR Code para conectar novamente.')) return;
    cancelWorkFor(groupPicker.groupId);
    try {
      const message = await whatsapp.logout();
      groupPicker.reset();
      showToast(message);
    } catch (error) {
      showToast(errorMessage(error), true);
    }
  }

  async function runSync(direction: SyncDirection) {
    if (!groupPicker.groupId || syncDirection) return;
    const target = groupPicker.groupId;
    setSyncDirection(direction);
    setSyncDetail(direction === 'newer' ? '⟳ Procurando novidades…' : '⟳ Buscando histórico anterior…');
    try {
      const data = await api.sync(target, direction, direction === 'older' ? 1_000 : undefined);
      if (groupValue.current !== target) return;
      setSyncDetail(incrementalResultCopy(data));
      await loadSyncStatus(target);
    } catch (error) {
      if (groupValue.current === target) {
        const message = errorMessage(error);
        setSyncDetail(message);
        showToast(message, true);
      }
    } finally {
      if (groupValue.current === target) setSyncDirection(null);
    }
  }

  async function cancelSync() {
    if (!groupPicker.groupId) return;
    try {
      await api.cancelSync(groupPicker.groupId);
      setSyncDetail('Cancelamento solicitado…');
    } catch (error) {
      showToast(errorMessage(error), true);
    }
  }

  async function prepareHistory() {
    if (!groupPicker.groupId || historyPreparing) return;
    if (!validHistoryLimit(historyLimit)) {
      showToast('Informe um alvo inteiro entre 1 e 500.000 mensagens.', true);
      return;
    }
    const target = groupPicker.groupId;
    const requestId = ++historyStatusRequest.current;
    setHistoryPreparing(true);
    setHistoryPreparation(null);
    try {
      const data = await api.prepareHistory(target, historyLimit);
      if (requestId !== historyStatusRequest.current || groupValue.current !== target) return;
      setHistoryPreparation(data);
      setHistoryPreparing(data.status === 'preparing');
      if (historyTimer.current !== null) window.clearTimeout(historyTimer.current);
      historyTimer.current = window.setTimeout(() => void pollHistoryPreparation(target, true), 1_000);
    } catch (error) {
      if (groupValue.current === target) setHistoryPreparing(false);
      showToast(errorMessage(error), true);
    }
  }

  async function cancelHistory() {
    if (!groupPicker.groupId) return;
    const target = groupPicker.groupId;
    if (historyTimer.current !== null) window.clearTimeout(historyTimer.current);
    try {
      await api.cancelHistoryPreparation(target);
      await pollHistoryPreparation(target);
    } catch (error) {
      showToast(errorMessage(error), true);
    }
  }

  async function scanPolls() {
    if (!groupPicker.groupId || scanning) return;
    if (!validHistoryLimit(historyLimit)) {
      showToast('Informe um limite inteiro entre 1 e 500.000 mensagens.', true);
      return;
    }
    const target = groupPicker.groupId;
    const requestId = ++scanRequest.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10 * 60 * 1_000);
    setScanning(true);
    setScanResult(null);
    setScanStatus({ text: 'Analisando histórico disponível… Isso pode levar alguns minutos.', error: false });
    try {
      const data = await api.scanPolls(target, historyLimit, controller.signal);
      if (requestId !== scanRequest.current || groupValue.current !== target) return;
      setScanStatus(null);
      setScanResult(data);
    } catch (error) {
      if (requestId !== scanRequest.current) return;
      setScanStatus({ error: true, text: error instanceof DOMException && error.name === 'AbortError'
        ? 'A análise ultrapassou 10 minutos. Ela pode ainda estar terminando no servidor; aguarde antes de tentar novamente.'
        : errorMessage(error) });
    } finally {
      window.clearTimeout(timeout);
      if (requestId === scanRequest.current) setScanning(false);
    }
  }

  const groupSelector = <WhatsAppGroupSelector connected={whatsapp.connected} favorites={groupPicker.favorites} groupId={groupPicker.groupId} groups={groupPicker.groups} help={groupPicker.help} loading={groupPicker.loading} search={groupPicker.search} visibleGroups={groupPicker.visibleGroups} onChange={selectGroup} onRefresh={() => void groupPicker.load()} onSearchChange={groupPicker.setSearch} onToggleFavorite={groupPicker.toggleFavorite} />;

  return <AppShell current="create" eyebrow="Enquetes no WhatsApp" title="EasyPoll" subtitle="Enquetes rápidas para seus grupos." footer="Funciona localmente e envia apenas mediante sua confirmação."><WhatsAppStatus status={whatsapp.status} hint={whatsapp.hint} qrDataUrl={whatsapp.qrDataUrl} disconnecting={whatsapp.disconnecting} onDisconnect={() => void disconnectWhatsApp()} /><PollComposer connected={whatsapp.connected} groupId={groupPicker.groupId} selectedGroup={groupPicker.selectedGroup} groupSelector={groupSelector} showToast={showToast} /><CreateHistoryTools connected={whatsapp.connected} selectedGroup={groupPicker.selectedGroup} syncStatus={syncStatus} syncDetail={syncDetail} syncDirection={syncDirection} historyPreparation={historyPreparation} historyPreparing={historyPreparing} historyLimit={historyLimit} scanning={scanning} scanStatus={scanStatus} scanResult={scanResult} rawVisible={rawVisible} onSync={(direction) => void runSync(direction)} onCancelSync={() => void cancelSync()} onPrepareHistory={() => void prepareHistory()} onCancelHistory={() => void cancelHistory()} onHistoryLimitChange={setHistoryLimit} onScan={() => void scanPolls()} onToggleRaw={() => setRawVisible((value) => !value)} /><Toast toast={toast} /></AppShell>;
}

function validHistoryLimit(limit: number): boolean {
  return Number.isInteger(limit) && limit >= 1 && limit <= MAX_HISTORY_MESSAGES;
}

function incrementalResultCopy(result: IncrementalSyncResult): string {
  if (result.cancelled) return 'Sincronização cancelada. Nenhuma alteração parcial foi persistida.';
  if (result.timedOut) return 'O limite de tempo foi atingido. Nenhuma alteração parcial foi persistida.';
  if (result.boundaryNotFound) return 'Não foi possível encontrar a fronteira do histórico local dentro do limite incremental de 5.000 mensagens. Use o scan manual como fallback.';
  if (result.direction === 'newer') {
    if (!result.newMessages) return `✓ Tudo atualizado. Nenhuma mensagem nova encontrada. ${result.pollsFound} enquete(s) recente(s) reconciliada(s).`;
    return `✓ Sincronização concluída. ${result.newMessages.toLocaleString('pt-BR')} mensagens novas e ${result.pollsFound.toLocaleString('pt-BR')} enquete(s) encontrada(s).`;
  }
  if (!result.newMessages && result.reachedAvailableHistoryStart) return 'Nenhuma mensagem anterior adicional foi disponibilizada pelo WhatsApp Web nesta sessão.';
  return `✓ Histórico expandido. ${result.newMessages.toLocaleString('pt-BR')} mensagens anteriores adicionadas.`;
}
