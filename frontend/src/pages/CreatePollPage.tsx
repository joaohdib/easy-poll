import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api } from '../api/easypollApi';
import { BrandMark } from '../components/BrandMark';
import { MemberAvatar } from '../components/MemberAvatar';
import { Navigation } from '../components/Navigation';
import { Toast } from '../components/Toast';
import { useToast } from '../hooks/useToast';
import { usePageMetadata } from '../hooks/usePageMetadata';
import type {
  ConnectionStatusName, Group, GroupSyncStatus, HistoryPreparationStatus,
  IncrementalSyncResult, Member, PollScanPoll, PollScanResult, SyncDirection
} from '../types/api';
import { errorMessage, normalizeSearch } from '../utils/format';
import { readFavoriteGroups, readStoredValue, STORAGE_KEYS, writeStoredValue } from '../utils/storage';

const MAX_POLL_OPTIONS = 12;
const MAX_HISTORY_MESSAGES = 500_000;
const HISTORY_PRESETS = [100, 500, 1_000, 500_000];
const statusCopy: Record<ConnectionStatusName, [string, string]> = {
  disconnected: ['Desconectado', 'O WhatsApp está offline. Reinicie o servidor para reconectar.'],
  waiting_qr: ['Aguardando QR Code', 'Escaneie o código abaixo para conectar sua conta.'],
  connecting: ['Conectando', 'Preparando sua sessão do WhatsApp Web…'],
  connected: ['Conectado', 'Sua conta está pronta para enviar uma enquete.'],
  auth_failure: ['Falha na autenticação', 'Não foi possível autenticar. Reinicie o servidor e tente novamente.']
};

function formatSyncTimestamp(timestamp: number | null, includeTime = false): string {
  if (!Number.isFinite(Number(timestamp))) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', dateStyle: 'short', ...(includeTime ? { timeStyle: 'short' } : {})
  }).format(new Date(Number(timestamp) * 1000));
}
function formatPollDate(timestamp: number | null): string {
  if (!Number.isFinite(Number(timestamp))) return 'Data indisponível';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    .format(new Date(Number(timestamp) * 1000));
}
function displayPerson(name?: string | null, id?: string | null): string {
  return name || id || 'Pessoa não identificada';
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
function parseBulkOptions(raw: string): string[] {
  const value = raw.trim();
  if (!value) return [];
  return (/\r?\n/.test(value) ? value.split(/\r?\n/) : value.includes(';') ? value.split(';') : value.split(','))
    .map((option) => option.trim()).filter(Boolean);
}
function uniqueMemberNames(members: Member[]): string[] {
  const used = new Set<string>();
  return members.map((member) => {
    const base = (member.name || 'Participante').trim().slice(0, 94) || 'Participante';
    let name = base;
    let suffix = 2;
    while (used.has(normalizeSearch(name))) name = `${base} (${suffix++})`.slice(0, 100);
    used.add(normalizeSearch(name));
    return name;
  });
}

export function CreatePollPage() {
  usePageMetadata('EasyPoll — Enquetes no WhatsApp', 'EasyPoll — enquetes rápidas para seus grupos do WhatsApp.');
  const [status, setStatus] = useState<ConnectionStatusName>('connecting');
  const [statusHint, setStatusHint] = useState(statusCopy.connecting[1]);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupHelp, setGroupHelp] = useState('Os grupos aparecem quando a conexão estiver pronta.');
  const [groupSearch, setGroupSearch] = useState('');
  const [groupId, setGroupId] = useState('');
  const [favorites, setFavorites] = useState(readFavoriteGroups);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [sending, setSending] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkMode, setBulkMode] = useState<'replace' | 'append'>('replace');
  const [bulkFeedback, setBulkFeedback] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [membersGroupId, setMembersGroupId] = useState('');
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
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
  const { toast, showToast } = useToast();
  const bulkDialog = useRef<HTMLDialogElement>(null);
  const memberDialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const questionInput = useRef<HTMLInputElement>(null);
  const statusRequest = useRef(0);
  const statusValue = useRef(status);
  const groupValue = useRef(groupId);
  const historyStatusRequest = useRef(0);
  const syncStatusRequest = useRef(0);
  const scanRequest = useRef(0);
  const historyTimer = useRef<number | null>(null);
  const previousGroup = useRef('');
  const syncDirectionValue = useRef<SyncDirection | null>(null);
  const historyPreparingValue = useRef(false);
  statusValue.current = status;
  groupValue.current = groupId;
  syncDirectionValue.current = syncDirection;
  historyPreparingValue.current = historyPreparing;

  const selectedGroup = groups.find((group) => group.id === groupId) ?? null;
  const busy = historyPreparing || Boolean(syncDirection) || scanning;
  const connected = status === 'connected';
  const sortedGroups = useMemo(() => [...groups].sort((a, b) => {
    const favoriteDifference = Number(favorites.has(b.id)) - Number(favorites.has(a.id));
    return favoriteDifference || a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
  }), [favorites, groups]);
  const visibleGroups = useMemo(() => {
    const query = normalizeSearch(groupSearch);
    return sortedGroups.filter((group) => normalizeSearch(group.name).includes(query));
  }, [groupSearch, sortedGroups]);
  const visibleMembers = useMemo(() => {
    const query = normalizeSearch(memberSearch);
    return members.filter((member) => normalizeSearch(member.name).includes(query));
  }, [memberSearch, members]);
  const filledOptions = options.map((option) => option.trim()).filter(Boolean);

  const loadGroups = useCallback(async () => {
    if (statusValue.current !== 'connected') { showToast('WhatsApp ainda não está conectado.', true); return; }
    setGroupsLoading(true);
    setGroupHelp('Buscando grupos…');
    try {
      const data = await api.groups();
      setGroups(data.groups);
      const requested = new URLSearchParams(window.location.search).get('groupId') || '';
      const stored = readStoredValue(STORAGE_KEYS.lastGroupId);
      const current = groupValue.current;
      const preferred = [current, requested, stored].find((candidate) => data.groups.some((group) => group.id === candidate)) || '';
      setGroupId(preferred);
      setGroupHelp(data.groups.length
        ? `${data.groups.length} ${data.groups.length === 1 ? 'grupo encontrado' : 'grupos encontrados'}. Favoritos aparecem primeiro.`
        : 'Nenhum grupo foi encontrado nesta conta.');
    } catch (error) {
      const message = errorMessage(error);
      setGroupHelp(message); showToast(message, true);
    } finally { setGroupsLoading(false); }
  }, [showToast]);

  const updateStatus = useCallback(async () => {
    const requestId = ++statusRequest.current;
    try {
      const data = await api.status();
      if (requestId !== statusRequest.current) return;
      const changedToConnected = statusValue.current !== 'connected' && data.status === 'connected';
      statusValue.current = data.status;
      setStatus(data.status);
      setStatusHint(data.error || statusCopy[data.status][1]);
      if (data.status === 'waiting_qr' && data.hasQrCode) {
        try {
          const qr = await api.qr();
          if (requestId === statusRequest.current && statusValue.current === 'waiting_qr') setQrDataUrl(qr.dataUrl);
        } catch { setQrDataUrl(null); }
      } else setQrDataUrl(null);
      if (changedToConnected) void loadGroups();
    } catch {
      if (requestId !== statusRequest.current) return;
      statusValue.current = 'disconnected';
      setStatus('disconnected'); setStatusHint('Não foi possível acessar o servidor local.'); setQrDataUrl(null);
    }
  }, [loadGroups]);

  useEffect(() => {
    void updateStatus();
    const interval = window.setInterval(() => void updateStatus(), 2_500);
    return () => { window.clearInterval(interval); statusRequest.current += 1; };
  }, [updateStatus]);

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
      setHistoryPreparation(data); setHistoryPreparing(data.status === 'preparing');
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
    const priorGroup = previousGroup.current;
    if (priorGroup && priorGroup !== groupId) {
      if (syncDirectionValue.current) void api.cancelSync(priorGroup).catch(() => undefined);
      if (historyPreparingValue.current) void api.cancelHistoryPreparation(priorGroup).catch(() => undefined);
    }
    previousGroup.current = groupId;
    if (historyTimer.current !== null) window.clearTimeout(historyTimer.current);
    historyStatusRequest.current += 1; syncStatusRequest.current += 1; scanRequest.current += 1;
    memberDialog.current?.close();
    setMembers([]); setMembersGroupId(''); setSelectedMemberIds(new Set()); setMemberSearch('');
    setHistoryPreparation(null); setHistoryPreparing(false); setSyncStatus(null); setSyncDirection(null);
    setScanResult(null); setScanStatus(null); setRawVisible(false);
    if (!groupId) { setSyncDetail('Selecione um grupo para consultar o histórico local.'); return; }
    writeStoredValue(STORAGE_KEYS.lastGroupId, groupId);
    setSyncDetail('Consultando histórico local…');
    void loadSyncStatus(groupId);
    if (statusValue.current === 'connected') void pollHistoryPreparation(groupId);
  }, [groupId, loadSyncStatus, pollHistoryPreparation]);

  useEffect(() => {
    if (connected && groupValue.current) void pollHistoryPreparation(groupValue.current);
  }, [connected, pollHistoryPreparation]);

  useEffect(() => () => { if (historyTimer.current !== null) window.clearTimeout(historyTimer.current); }, []);

  async function disconnectWhatsApp() {
    if (disconnecting || !connected || !window.confirm('Desconectar o WhatsApp deste computador? Será necessário escanear um novo QR Code para conectar novamente.')) return;
    setDisconnecting(true);
    try {
      const data = await api.logout();
      setGroups([]); setGroupId(''); setGroupSearch('');
      showToast(data.message || 'WhatsApp desconectado com sucesso.');
      await updateStatus();
    } catch (error) { showToast(errorMessage(error), true); }
    finally { setDisconnecting(false); }
  }
  function selectGroup(nextGroupId: string) { setGroupId(nextGroupId); }
  function toggleFavorite(target: string) {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(target)) next.delete(target); else next.add(target);
      writeStoredValue(STORAGE_KEYS.favoriteGroups, JSON.stringify([...next]));
      return next;
    });
  }
  function updateOption(index: number, value: string) { setOptions((current) => current.map((item, i) => i === index ? value : item)); }
  function addOption(value = '') {
    if (options.length >= MAX_POLL_OPTIONS) { showToast('Uma enquete pode ter no máximo 12 opções.', true); return; }
    setOptions((current) => [...current, value]);
  }
  function removeOption(index: number) { if (options.length > 2) setOptions((current) => current.filter((_, i) => i !== index)); }
  function clearForm() {
    if ((question.trim() || filledOptions.length) && !window.confirm('Limpar a pergunta e todas as opções? O grupo selecionado será mantido.')) return;
    setQuestion(''); setOptions(['', '']); setAllowMultiple(false); questionInput.current?.focus();
  }
  async function sendPoll(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    if (!groupId) { showToast('Selecione um grupo.', true); return; }
    if (!form.current?.reportValidity()) return;
    setSending(true);
    try {
      const data = await api.sendPoll({ groupId, question, options, allowMultipleAnswers: allowMultiple });
      showToast(selectedGroup ? `✓ Enquete enviada para ${selectedGroup.name}` : data.message || '✓ Enquete enviada com sucesso.');
    } catch (error) { showToast(errorMessage(error), true); }
    finally { setSending(false); }
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter' || bulkDialog.current?.open || memberDialog.current?.open) return;
      event.preventDefault();
      if (!(connected && groupId && question.trim() && filledOptions.length >= 2)) {
        showToast('Preencha grupo, pergunta e pelo menos duas opções antes de enviar.', true); return;
      }
      form.current?.requestSubmit();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [connected, filledOptions.length, groupId, question, showToast]);

  function openBulkDialog() {
    setBulkText(''); setBulkFeedback(''); setBulkMode('replace'); bulkDialog.current?.showModal();
  }
  function importBulk(event: FormEvent) {
    event.preventDefault();
    const imported = parseBulkOptions(bulkText);
    const combined = [...(bulkMode === 'append' ? filledOptions : []), ...imported];
    const normalized = combined.map((option) => option.toLocaleLowerCase('pt-BR'));
    const duplicate = combined.find((_, index) => normalized.indexOf(normalized[index]) !== index);
    if (!imported.length) { setBulkFeedback('Cole pelo menos uma opção válida.'); return; }
    if (duplicate) { setBulkFeedback(`A opção “${duplicate}” está duplicada. Remova a repetição para continuar.`); return; }
    if (combined.length > MAX_POLL_OPTIONS) { setBulkFeedback(`Foram encontradas ${combined.length} opções, mas o WhatsApp permite no máximo 12. Remova algumas antes de continuar.`); return; }
    if (combined.some((option) => option.length > 100)) { setBulkFeedback('Cada opção deve ter no máximo 100 caracteres.'); return; }
    setOptions([...combined, ...Array(Math.max(0, 2 - combined.length)).fill('')]);
    bulkDialog.current?.close();
    showToast(`${imported.length} ${imported.length === 1 ? 'opção importada' : 'opções importadas'} com sucesso.`);
  }

  async function openMembers() {
    if (!groupId) { showToast('Selecione um grupo primeiro.', true); return; }
    memberDialog.current?.showModal();
    if (membersGroupId === groupId && members.length) return;
    setMembersLoading(true); setMembersGroupId(groupId); setMembers([]); setSelectedMemberIds(new Set());
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const data = await api.members(groupId, controller.signal);
      if (!data.members.length) throw new Error('Nenhum membro foi encontrado nesse grupo.');
      setMembers([...data.members].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
      if (data.totalMembers > data.members.length) showToast('Alguns membros não puderam ser identificados.', true);
    } catch (error) {
      memberDialog.current?.close(); setMembersGroupId('');
      showToast(error instanceof DOMException && error.name === 'AbortError'
        ? 'Não foi possível carregar os membros a tempo. Tente novamente.' : errorMessage(error, 'Não foi possível carregar os membros.'), true);
    } finally { window.clearTimeout(timeout); setMembersLoading(false); }
  }
  function toggleMember(memberId: string) {
    setSelectedMemberIds((current) => {
      const next = new Set(current);
      if (next.has(memberId)) next.delete(memberId);
      else if (next.size < MAX_POLL_OPTIONS) next.add(memberId);
      else showToast('Você pode selecionar no máximo 12 membros.', true);
      return next;
    });
  }
  function selectRandomMembers() {
    const shuffled = [...members];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
    }
    setSelectedMemberIds(new Set(shuffled.slice(0, MAX_POLL_OPTIONS).map((member) => member.id)));
  }
  function applyMembers() {
    const selected = members.filter((member) => selectedMemberIds.has(member.id));
    if (!selected.length) return;
    if (filledOptions.length && !window.confirm('As opções preenchidas serão substituídas pelos membros selecionados. Continuar?')) return;
    const names = uniqueMemberNames(selected);
    setOptions([...names, ...Array(Math.max(0, 2 - names.length)).fill('')]);
    memberDialog.current?.close();
    showToast(`${selected.length} ${selected.length === 1 ? 'membro adicionado' : 'membros adicionados'} às opções. Revise antes de enviar.`);
  }

  async function runSync(direction: SyncDirection) {
    if (!groupId || syncDirection) return;
    const target = groupId;
    setSyncDirection(direction);
    setSyncDetail(direction === 'newer' ? '⟳ Procurando novidades…' : '⟳ Buscando histórico anterior…');
    try {
      const data = await api.sync(target, direction, direction === 'older' ? 1_000 : undefined);
      if (groupValue.current !== target) return;
      setSyncDetail(incrementalResultCopy(data)); await loadSyncStatus(target);
    } catch (error) {
      if (groupValue.current === target) { const message = errorMessage(error); setSyncDetail(message); showToast(message, true); }
    } finally { if (groupValue.current === target) setSyncDirection(null); }
  }
  async function cancelSync() {
    if (!groupId) return;
    try { await api.cancelSync(groupId); setSyncDetail('Cancelamento solicitado…'); }
    catch (error) { showToast(errorMessage(error), true); }
  }
  async function prepareHistory() {
    if (!groupId || historyPreparing) return;
    if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > MAX_HISTORY_MESSAGES) {
      showToast('Informe um alvo inteiro entre 1 e 500.000 mensagens.', true); return;
    }
    const requestId = ++historyStatusRequest.current;
    setHistoryPreparing(true); setHistoryPreparation(null);
    try {
      const data = await api.prepareHistory(groupId, historyLimit);
      if (requestId !== historyStatusRequest.current || groupValue.current !== groupId) return;
      setHistoryPreparation(data); setHistoryPreparing(data.status === 'preparing');
      if (historyTimer.current !== null) window.clearTimeout(historyTimer.current);
      historyTimer.current = window.setTimeout(() => void pollHistoryPreparation(groupId, true), 1_000);
    } catch (error) { setHistoryPreparing(false); showToast(errorMessage(error), true); }
  }
  async function cancelHistory() {
    if (!groupId) return;
    if (historyTimer.current !== null) window.clearTimeout(historyTimer.current);
    try { await api.cancelHistoryPreparation(groupId); await pollHistoryPreparation(groupId); }
    catch (error) { showToast(errorMessage(error), true); }
  }
  async function scanPolls() {
    if (!groupId || scanning) return;
    if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > MAX_HISTORY_MESSAGES) {
      showToast('Informe um limite inteiro entre 1 e 500.000 mensagens.', true); return;
    }
    const target = groupId;
    const requestId = ++scanRequest.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10 * 60 * 1_000);
    setScanning(true); setScanResult(null); setScanStatus({ text: 'Analisando histórico disponível… Isso pode levar alguns minutos.', error: false });
    try {
      const data = await api.scanPolls(target, historyLimit, controller.signal);
      if (requestId !== scanRequest.current || groupValue.current !== target) return;
      setScanStatus(null); setScanResult(data);
    } catch (error) {
      if (requestId !== scanRequest.current) return;
      setScanStatus({ error: true, text: error instanceof DOMException && error.name === 'AbortError'
        ? 'A análise ultrapassou 10 minutos. Ela pode ainda estar terminando no servidor; aguarde antes de tentar novamente.'
        : errorMessage(error) });
    } finally { window.clearTimeout(timeout); if (requestId === scanRequest.current) setScanning(false); }
  }

  const preparationCount = historyPreparation?.messagesAvailable ?? '—';
  const preparationDetail = historyPreparation
    ? historyPreparation.status === 'preparing'
      ? `⟳ ${historyPreparation.detail || 'Buscando mensagens anteriores…'} Tentativa ${historyPreparation.attempts || 0}.`
      : ({
          completed: `✓ Preparação concluída. ${preparationCount} mensagens disponíveis nesta sessão.`,
          stabilized: `✓ Histórico estabilizado por agora. ${preparationCount} mensagens disponíveis nesta sessão.`,
          cancelled: `Preparação cancelada. ${preparationCount} mensagens continuam disponíveis nesta sessão.`,
          timeout: `Tempo limite atingido. ${preparationCount} mensagens disponíveis nesta sessão.`,
          error: historyPreparation.error || 'Não foi possível preparar mais histórico.'
        }[historyPreparation.status] || historyPreparation.detail)
    : groupId ? 'Medindo mensagens disponíveis nesta sessão…' : 'Selecione um grupo para medir o histórico disponível nesta sessão.';

  return (
    <main className="shell">
      <header className="hero"><BrandMark /><div><p className="eyebrow">Enquetes no WhatsApp</p><h1>EasyPoll</h1><p>Enquetes rápidas para seus grupos.</p></div></header>
      <Navigation current="create" />
      <section className="status-card card" aria-labelledby="status-title">
        <div className="section-heading"><div><p className="step">Conexão</p><h2 id="status-title">Status do WhatsApp</h2></div>
          <div className="status-actions"><div className={`status-badge ${status}`}><span className="status-dot" /><span>{status === 'disconnected' && statusHint.includes('servidor local') ? 'Servidor offline' : statusCopy[status][0]}</span></div>
            {connected && <button className="disconnect-button" type="button" disabled={disconnecting} onClick={() => void disconnectWhatsApp()}>{disconnecting ? 'Desconectando…' : 'Desconectar'}</button>}</div></div>
        {status === 'waiting_qr' && qrDataUrl && <div className="qr-panel"><div className="qr-frame"><img src={qrDataUrl} alt="QR Code para conectar ao WhatsApp" /></div><div><h3>Escaneie com seu celular</h3><ol><li>Abra o WhatsApp no celular.</li><li>Vá em <strong>Configurações → Aparelhos conectados</strong>.</li><li>Toque em <strong>Conectar um aparelho</strong>.</li></ol></div></div>}
        <p className="connection-hint">{statusHint}</p>
      </section>

      <form ref={form} className="card poll-card" onSubmit={(event) => void sendPoll(event)}>
        <div className="section-heading"><div><p className="step">Nova enquete</p><h2>Configure sua enquete</h2></div></div>
        <fieldset disabled={!connected}>
          <div className="field group-field"><label htmlFor="group">Grupo</label>
            <select id="group" className="sr-only" name="groupId" required tabIndex={-1} aria-hidden="true" value={groupId} onChange={(event) => selectGroup(event.target.value)}><option value="">{connected ? 'Selecione um grupo' : 'Conecte o WhatsApp primeiro'}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
            <div className="group-picker"><div className="group-toolbar"><label className="group-search"><span className="sr-only">Buscar grupo</span><input type="search" placeholder="Buscar grupo..." autoComplete="off" value={groupSearch} onChange={(event) => setGroupSearch(event.target.value)} /></label>
              <button className="button secondary refresh-button" type="button" aria-label="Atualizar grupos" disabled={groupsLoading} onClick={() => void loadGroups()}><span aria-hidden="true">↻</span><span>Atualizar</span></button></div>
              <div className="group-list" role="listbox" aria-label="Grupos do WhatsApp">{visibleGroups.map((group) => { const selected = group.id === groupId; const favorite = favorites.has(group.id); return <div key={group.id} className={`group-row${selected ? ' selected' : ''}`} role="option" aria-selected={selected}><button className="group-choice" type="button" onClick={() => selectGroup(group.id)}><span className="group-indicator" aria-hidden="true" /><span className="group-name">{group.name}</span></button><button className={`favorite-button${favorite ? ' active' : ''}`} type="button" aria-label={`${favorite ? 'Desfavoritar' : 'Favoritar'} ${group.name}`} aria-pressed={favorite} onClick={() => toggleFavorite(group.id)}>{favorite ? '★' : '☆'}</button></div>; })}</div>
              {!visibleGroups.length && <p className="group-empty">Nenhum grupo encontrado nessa busca.</p>}</div><small>{groupHelp}</small></div>
          <div className="field"><label htmlFor="question">Pergunta</label><input ref={questionInput} id="question" maxLength={255} placeholder="Ex.: Qual jogo vamos jogar hoje?" required value={question} onChange={(event) => setQuestion(event.target.value)} /></div>
          <div className="field"><div className="label-row"><label>Opções</label><span>{options.length} opções</span></div><div className="options-list">{options.map((option, index) => <div className="option-row" key={index}><input className="poll-option" maxLength={100} placeholder={`Opção ${index + 1}`} aria-label={`Opção ${index + 1}`} required value={option} onChange={(event) => updateOption(index, event.target.value)} /><button className="remove-option" type="button" aria-label={`Remover opção ${index + 1}`} disabled={options.length <= 2} onClick={() => removeOption(index)}>×</button></div>)}</div>
            <div className="option-actions"><button className="button ghost" type="button" disabled={options.length >= MAX_POLL_OPTIONS} onClick={() => addOption()}>＋ Adicionar opção</button><button className="button ghost" type="button" onClick={openBulkDialog}>▤ Colar várias opções</button><button className="button ghost" type="button" disabled={membersLoading} onClick={() => void openMembers()}>{membersLoading ? 'Carregando membros…' : '♙ Selecionar membros'}</button></div></div>
          <label className="checkbox-row"><input type="checkbox" checked={allowMultiple} onChange={(event) => setAllowMultiple(event.target.checked)} /><span className="fake-checkbox" aria-hidden="true" /><span><strong>Permitir múltiplas respostas</strong><small>Participantes poderão selecionar mais de uma opção.</small></span></label>
          <button className="button primary" type="submit" disabled={sending}><span className="button-label">{sending ? 'Enviando…' : 'Enviar enquete'}</span>{sending && <span className="spinner" />}</button>
          <button className="button clear-form" type="button" onClick={clearForm}>Limpar formulário</button>
        </fieldset>
      </form>

      <section className="card history-card" aria-labelledby="history-title">
        <div className="section-heading"><div><p className="step">Enquetes anteriores</p><h2 id="history-title">Analisar histórico disponível</h2></div><span className="experimental-badge">Experimental</span></div>
        <p className="history-description">Analisa somente as mensagens que o WhatsApp Web disponibilizar para esta sessão. Enquetes muito antigas podem não estar acessíveis.</p>
        <a className="button secondary stats-link local-stats-entry" href="/stats">Ver estatísticas locais</a>
        <fieldset className="history-fields" disabled={!connected}>
          <div className="history-current-group"><span>Grupo atual</span><strong>{selectedGroup?.name || 'Selecione um grupo acima'}</strong></div>
          <div className="history-sync-panel"><div className="history-prepare-heading"><div><strong>Histórico local</strong><small>Sincronize apenas o delta conhecido pelo banco local.</small></div></div>
            <dl className="history-sync-metrics"><div><dt>Mensagens conhecidas</dt><dd>{syncStatus?.messagesProcessed.toLocaleString('pt-BR') ?? '—'}</dd></div><div><dt>Disponível localmente desde</dt><dd>{formatSyncTimestamp(syncStatus?.oldestProcessedTimestamp ?? null)}</dd></div><div><dt>Última sincronização</dt><dd>{formatSyncTimestamp(syncStatus?.lastSyncAt ?? null, true)}</dd></div></dl>
            <p className="history-prepare-detail" role="status" aria-live="polite">{syncDetail}</p><div className="history-sync-actions"><button className="button secondary" type="button" disabled={busy || !selectedGroup} onClick={() => void runSync('newer')}><span className="button-label">{syncDirection === 'newer' ? 'Procurando novidades…' : 'Sincronizar novidades'}</span>{syncDirection === 'newer' && <span className="spinner dark" />}</button><button className="button secondary" type="button" disabled={busy || !selectedGroup} onClick={() => void runSync('older')}><span className="button-label">{syncDirection === 'older' ? 'Buscando histórico anterior…' : 'Buscar histórico mais antigo'}</span>{syncDirection === 'older' && <span className="spinner dark" />}</button>{syncDirection && <button className="button history-cancel-button" type="button" onClick={() => void cancelSync()}>Cancelar</button>}</div></div>
          <div className="history-prepare-panel"><div className="history-prepare-heading"><div><strong>Histórico do grupo</strong><small>O WhatsApp Web ainda pode estar sincronizando mensagens deste grupo.</small></div><span className="experimental-badge">Experimental</span></div><div className="history-prepare-metric" aria-live="polite"><strong>{preparationCount}</strong><span>mensagens disponíveis</span></div><p className="history-prepare-detail">{preparationDetail}</p><div className="history-prepare-actions"><button className="button secondary" type="button" disabled={busy || !selectedGroup} onClick={() => void prepareHistory()}><span className="button-label">{historyPreparing ? 'Carregando mensagens antigas…' : 'Preparar histórico'}</span>{historyPreparing && <span className="spinner dark" />}</button>{historyPreparing && <button className="button history-cancel-button" type="button" onClick={() => void cancelHistory()}>Cancelar</button>}</div></div>
          <div className="field history-limit-field"><label htmlFor="history-limit">Mensagens a analisar</label><div className="history-presets" aria-label="Limites de mensagens">{HISTORY_PRESETS.map((limit) => <button key={limit} className={`button secondary history-preset${limit === historyLimit ? ' active' : ''}`} type="button" disabled={busy} onClick={() => setHistoryLimit(limit)}>{limit === 500_000 ? '500 mil' : limit}</button>)}</div><input id="history-limit" type="number" min={1} max={MAX_HISTORY_MESSAGES} step={1} value={historyLimit} disabled={busy} onChange={(event) => setHistoryLimit(Number(event.target.value))} /><small>Limite máximo nesta etapa experimental: 500.000 mensagens.</small></div>
          <button className="button primary history-scan-button" type="button" disabled={busy || !selectedGroup} onClick={() => void scanPolls()}><span className="button-label">{scanning ? 'Analisando histórico disponível…' : 'Analisar enquetes'}</span>{scanning && <span className="spinner" />}</button>
        </fieldset>
        {scanStatus && <p className={`history-status${scanStatus.error ? ' error' : ''}`} role="status" aria-live="polite">{scanStatus.text}</p>}
        {scanResult && <PollScanView result={scanResult} rawVisible={rawVisible} onToggleRaw={() => setRawVisible((value) => !value)} />}
      </section>

      <dialog ref={bulkDialog} className="app-dialog bulk-dialog" aria-labelledby="bulk-dialog-title" onClick={(event) => { if (event.target === bulkDialog.current) bulkDialog.current.close(); }}><form method="dialog" className="dialog-shell" onSubmit={importBulk}><div className="dialog-header"><div><p className="step">Atalho de produtividade</p><h2 id="bulk-dialog-title">Colar várias opções</h2></div><button className="dialog-close" type="button" aria-label="Fechar" onClick={() => bulkDialog.current?.close()}>×</button></div><p className="dialog-description">Use uma opção por linha. Em uma única linha, vírgulas e ponto e vírgulas também são aceitos.</p><label className="bulk-text-label" htmlFor="bulk-text">Opções</label><textarea id="bulk-text" rows={8} placeholder={'Minecraft\nValorant\nGartic\nStop'} value={bulkText} onChange={(event) => setBulkText(event.target.value)} />{filledOptions.length > 0 && <fieldset className="bulk-mode"><legend>Já existem opções preenchidas</legend><label><input type="radio" name="bulkMode" value="replace" checked={bulkMode === 'replace'} onChange={() => setBulkMode('replace')} /> Substituir opções atuais</label><label><input type="radio" name="bulkMode" value="append" checked={bulkMode === 'append'} onChange={() => setBulkMode('append')} /> Adicionar às opções atuais</label></fieldset>}{bulkFeedback && <p className="bulk-feedback" role="alert">{bulkFeedback}</p>}<div className="dialog-actions"><button className="button secondary" type="button" onClick={() => bulkDialog.current?.close()}>Cancelar</button><button className="button primary dialog-primary" type="submit">Importar opções</button></div></form></dialog>

      <dialog ref={memberDialog} className="app-dialog member-dialog" aria-labelledby="member-dialog-title" onClick={(event) => { if (event.target === memberDialog.current) memberDialog.current.close(); }}><div className="member-dialog-shell"><div className="member-dialog-header"><div><p className="step">Opções da enquete</p><h2 id="member-dialog-title">Selecionar membros</h2></div><button className="dialog-close" type="button" aria-label="Fechar" onClick={() => memberDialog.current?.close()}>×</button></div>{membersLoading ? <div className="member-loading">Carregando membros…</div> : <div><div className="member-toolbar"><label className="member-search"><span className="sr-only">Buscar por nome</span><input type="search" placeholder="Buscar por nome…" autoComplete="off" value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} /></label><strong className="selection-count">{selectedMemberIds.size}/12 selecionados</strong></div><div className="member-quick-actions"><button className="button secondary small-button" type="button" onClick={selectRandomMembers}>Selecionar 12 aleatórios</button><button className="button ghost small-button" type="button" disabled={!selectedMemberIds.size} onClick={() => setSelectedMemberIds(new Set())}>Limpar seleção</button></div>{selectedMemberIds.size >= MAX_POLL_OPTIONS && <p className="member-limit-message" role="status">O limite de 12 membros foi atingido.</p>}<div className="member-list" role="list">{visibleMembers.map((member) => { const selected = selectedMemberIds.has(member.id); return <label key={member.id} className={`member-card${selected ? ' selected' : ''}`} role="checkbox" tabIndex={0} aria-checked={selected} onClick={(event) => { event.preventDefault(); toggleMember(member.id); }} onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); toggleMember(member.id); } }}><MemberAvatar groupId={groupId} member={member} /><span className="member-copy"><strong>{member.name}</strong><small>{member.numberHint || 'Identificador indisponível'}</small></span><input type="checkbox" tabIndex={-1} checked={selected} readOnly /><span className="member-check" aria-hidden="true">✓</span></label>; })}</div>{!visibleMembers.length && <p className="member-empty">Nenhum membro encontrado nessa busca.</p>}</div>}<div className="member-dialog-actions"><button className="button secondary" type="button" onClick={() => memberDialog.current?.close()}>Cancelar</button><button className="button primary dialog-primary" type="button" disabled={!selectedMemberIds.size} onClick={applyMembers}>Usar selecionados</button></div></div></dialog>
      <Toast toast={toast} />
      <footer>Funciona localmente e envia apenas mediante sua confirmação.</footer>
    </main>
  );
}

function PollScanView({ result, rawVisible, onToggleRaw }: { result: PollScanResult; rawVisible: boolean; onToggleRaw: () => void }) {
  return <div><div className="history-summary"><Summary value={result.messagesScanned} label="mensagens analisadas" /><Summary value={result.pollsFound} label="enquetes encontradas" /><Summary value={result.pollsWithVotesAvailable} label="com votos disponíveis" /></div><a className="button primary stats-link" href={`/stats?groupId=${encodeURIComponent(result.group.id)}`}>Ver estatísticas</a><div className="history-polls">{result.polls.length ? result.polls.map((poll, index) => <PollScanCard key={poll.messageId || index} poll={poll} />) : <p className="history-empty">Nenhuma enquete apareceu nas mensagens disponibilizadas. Isso não significa necessariamente que o grupo nunca teve enquetes.</p>}</div><button className="button secondary raw-json-button" type="button" aria-expanded={rawVisible} onClick={onToggleRaw}>{rawVisible ? 'Ocultar JSON bruto' : 'Ver JSON bruto'}</button>{rawVisible && <pre className="history-raw-json">{JSON.stringify(result, null, 2)}</pre>}</div>;
}
function Summary({ value, label }: { value: number; label: string }) { return <div><strong>{value}</strong><span>{label}</span></div>; }
function PollScanCard({ poll }: { poll: PollScanPoll }) {
  const author = displayPerson(poll.creatorName || poll.authorName, poll.creatorId || poll.authorId);
  return <article className="history-poll"><h3>{poll.question || 'Enquete sem pergunta disponível'}</h3><div className="history-meta"><span>{formatPollDate(poll.timestamp)}</span><span>Autor: {author}</span><span>{poll.options.length} {poll.options.length === 1 ? 'opção' : 'opções'}</span><span>{poll.voteCount} {poll.voteCount === 1 ? 'voto' : 'votos'}</span></div>{poll.options.length > 0 && <ul className="history-options">{poll.options.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}</ul>}{poll.votesAvailable ? <><p className="history-votes-title">Votos</p>{poll.votes.length ? <ul className="history-votes">{poll.votes.map((vote, index) => <li key={`${vote.voterId}-${index}`} title={vote.timestamp ? formatPollDate(vote.timestamp) : undefined}>{displayPerson(vote.voterName, vote.voterId)} → {vote.selectedOptions.length ? vote.selectedOptions.join(', ') : 'nenhuma opção selecionada'}</li>)}</ul> : <p className="history-warning">Nenhum voto foi disponibilizado para esta enquete.</p>}</> : <p className="history-warning">⚠ Não foi possível recuperar os votos desta enquete{poll.votesError ? `: ${poll.votesError}` : '.'}</p>}</article>;
}
