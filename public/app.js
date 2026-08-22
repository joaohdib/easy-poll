'use strict';

const MAX_POLL_OPTIONS = 12;
const MAX_HISTORY_MESSAGES = 500_000;
const STORAGE_KEYS = Object.freeze({
  lastGroupId: 'easyPoll.lastGroupId',
  favoriteGroups: 'easyPoll.favoriteGroups'
});
const state = {
  status: null,
  statusRequestId: 0,
  qrVisible: false,
  sending: false,
  disconnecting: false,
  toastTimer: null,
  memberGroupId: null,
  members: [],
  selectedMemberIds: new Set(),
  memberLoadId: 0,
  photoLoadId: 0,
  photoObserver: null,
  photoQueue: [],
  activePhotoLoads: 0,
  groups: [],
  favoriteGroupIds: new Set(),
  scanningPolls: false,
  pollScanRequestId: 0,
  pollScanResult: null,
  historyGroupId: null,
  historyPreparing: false,
  incrementalSyncDirection: null,
  syncStatusRequestId: 0,
  historyStatusRequestId: 0,
  historyPollTimer: null
};

const elements = {
  statusBadge: document.querySelector('#status-badge'),
  disconnectWhatsApp: document.querySelector('#disconnect-whatsapp'),
  connectionHint: document.querySelector('#connection-hint'),
  qrPanel: document.querySelector('#qr-panel'),
  qrCode: document.querySelector('#qr-code'),
  pollFields: document.querySelector('#poll-fields'),
  group: document.querySelector('#group'),
  groupSearch: document.querySelector('#group-search'),
  groupList: document.querySelector('#group-list'),
  groupEmpty: document.querySelector('#group-empty'),
  groupHelp: document.querySelector('#group-help'),
  refreshGroups: document.querySelector('#refresh-groups'),
  form: document.querySelector('#poll-form'),
  question: document.querySelector('#question'),
  optionsList: document.querySelector('#options-list'),
  optionCount: document.querySelector('#option-count'),
  addOption: document.querySelector('#add-option'),
  bulkOptions: document.querySelector('#bulk-options'),
  useMembers: document.querySelector('#use-members'),
  allowMultiple: document.querySelector('#allow-multiple'),
  submit: document.querySelector('#submit-button'),
  submitLabel: document.querySelector('#submit-button .button-label'),
  spinner: document.querySelector('#submit-button .spinner'),
  clearForm: document.querySelector('#clear-form'),
  bulkDialog: document.querySelector('#bulk-dialog'),
  bulkForm: document.querySelector('#bulk-form'),
  bulkText: document.querySelector('#bulk-text'),
  bulkMode: document.querySelector('#bulk-mode'),
  bulkFeedback: document.querySelector('#bulk-feedback'),
  closeBulkDialog: document.querySelector('#close-bulk-dialog'),
  cancelBulk: document.querySelector('#cancel-bulk'),
  memberDialog: document.querySelector('#member-dialog'),
  closeMemberDialog: document.querySelector('#close-member-dialog'),
  memberLoading: document.querySelector('#member-loading'),
  memberPicker: document.querySelector('#member-picker'),
  memberSearch: document.querySelector('#member-search'),
  memberSelectedCount: document.querySelector('#member-selected-count'),
  memberLimitMessage: document.querySelector('#member-limit-message'),
  memberList: document.querySelector('#member-list'),
  memberEmpty: document.querySelector('#member-empty'),
  randomMembers: document.querySelector('#random-members'),
  clearMembers: document.querySelector('#clear-members'),
  cancelMembers: document.querySelector('#cancel-members'),
  applyMembers: document.querySelector('#apply-members'),
  historyFields: document.querySelector('#history-fields'),
  historyGroupName: document.querySelector('#history-group-name'),
  historyLimit: document.querySelector('#history-limit'),
  historyPresets: [...document.querySelectorAll('.history-preset')],
  prepareHistory: document.querySelector('#prepare-history'),
  prepareHistoryLabel: document.querySelector('#prepare-history .button-label'),
  prepareHistorySpinner: document.querySelector('#prepare-history .spinner'),
  cancelHistory: document.querySelector('#cancel-history'),
  historyPrepareMetric: document.querySelector('#history-prepare-metric strong'),
  historyPrepareDetail: document.querySelector('#history-prepare-detail'),
  syncMessagesProcessed: document.querySelector('#sync-messages-processed'),
  syncOldestTimestamp: document.querySelector('#sync-oldest-timestamp'),
  syncLastAt: document.querySelector('#sync-last-at'),
  syncDetail: document.querySelector('#sync-detail'),
  syncNewer: document.querySelector('#sync-newer'),
  syncNewerLabel: document.querySelector('#sync-newer .button-label'),
  syncNewerSpinner: document.querySelector('#sync-newer .spinner'),
  syncOlder: document.querySelector('#sync-older'),
  syncOlderLabel: document.querySelector('#sync-older .button-label'),
  syncOlderSpinner: document.querySelector('#sync-older .spinner'),
  cancelSync: document.querySelector('#cancel-sync'),
  scanPolls: document.querySelector('#scan-polls'),
  scanPollsLabel: document.querySelector('#scan-polls .button-label'),
  scanPollsSpinner: document.querySelector('#scan-polls .spinner'),
  historyStatus: document.querySelector('#history-status'),
  historyResults: document.querySelector('#history-results'),
  historySummary: document.querySelector('#history-summary'),
  viewStats: document.querySelector('#view-stats'),
  historyPolls: document.querySelector('#history-polls'),
  toggleRawJson: document.querySelector('#toggle-raw-json'),
  historyRawJson: document.querySelector('#history-raw-json'),
  toast: document.querySelector('#toast')
};

const statusCopy = {
  disconnected: ['Desconectado', 'O WhatsApp está offline. Reinicie o servidor para reconectar.'],
  waiting_qr: ['Aguardando QR Code', 'Escaneie o código abaixo para conectar sua conta.'],
  connecting: ['Conectando', 'Preparando sua sessão do WhatsApp Web…'],
  connected: ['Conectado', 'Sua conta está pronta para enviar uma enquete.'],
  auth_failure: ['Falha na autenticação', 'Não foi possível autenticar. Reinicie o servidor e tente novamente.']
};

function readStoredValue(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch (_error) {
    return fallback;
  }
}

function writeStoredValue(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_error) {
    // A interface continua funcional quando o armazenamento estiver indisponível.
  }
}

function loadFavoriteGroups() {
  try {
    const parsed = JSON.parse(readStoredValue(STORAGE_KEYS.favoriteGroups, '[]'));
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []);
  } catch (_error) {
    return new Set();
  }
}

state.favoriteGroupIds = loadFavoriteGroups();

function addOption(value = '') {
  if (elements.optionsList.children.length >= MAX_POLL_OPTIONS) {
    showToast('Uma enquete pode ter no máximo 12 opções.', true);
    return;
  }

  const index = elements.optionsList.children.length + 1;
  const row = document.createElement('div');
  row.className = 'option-row';
  row.innerHTML = `
    <input class="poll-option" maxlength="100" placeholder="Opção ${index}" aria-label="Opção ${index}" required>
    <button class="remove-option" type="button" aria-label="Remover opção ${index}">×</button>
  `;
  row.querySelector('input').value = value;
  row.querySelector('button').addEventListener('click', () => {
    if (elements.optionsList.children.length <= 2) return;
    row.remove();
    syncOptions();
  });
  elements.optionsList.appendChild(row);
  syncOptions();
}

function syncOptions() {
  const rows = [...elements.optionsList.children];
  rows.forEach((row, index) => {
    const number = index + 1;
    const input = row.querySelector('input');
    const remove = row.querySelector('button');
    input.placeholder = `Opção ${number}`;
    input.setAttribute('aria-label', `Opção ${number}`);
    remove.setAttribute('aria-label', `Remover opção ${number}`);
    remove.disabled = rows.length <= 2;
  });
  elements.optionCount.textContent = `${rows.length} ${rows.length === 1 ? 'opção' : 'opções'}`;
  elements.addOption.disabled = rows.length >= MAX_POLL_OPTIONS;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a solicitação.');
  return data;
}

async function updateStatus() {
  const requestId = ++state.statusRequestId;
  try {
    const data = await fetchJson('/api/status');
    if (requestId !== state.statusRequestId) return;

    const changedToConnected = state.status !== 'connected' && data.status === 'connected';
    state.status = data.status;
    const copy = statusCopy[data.status] || statusCopy.disconnected;
    elements.statusBadge.className = `status-badge ${data.status}`;
    elements.statusBadge.innerHTML = `<span class="status-dot"></span><span>${copy[0]}</span>`;
    elements.connectionHint.textContent = data.error || copy[1];
    elements.pollFields.disabled = data.status !== 'connected';
    elements.historyFields.disabled = data.status !== 'connected';
    elements.disconnectWhatsApp.hidden = data.status !== 'connected';
    syncPollHistoryGroup();

    if (data.status === 'waiting_qr' && data.hasQrCode) await updateQrCode(requestId);
    else hideQrCode();
    if (changedToConnected) await loadGroups();
  } catch (_error) {
    if (requestId !== state.statusRequestId) return;
    state.status = 'disconnected';
    elements.statusBadge.className = 'status-badge disconnected';
    elements.statusBadge.innerHTML = '<span class="status-dot"></span><span>Servidor offline</span>';
    elements.connectionHint.textContent = 'Não foi possível acessar o servidor local.';
    elements.pollFields.disabled = true;
    elements.historyFields.disabled = true;
    elements.disconnectWhatsApp.hidden = true;
    hideQrCode();
  }
}

async function updateQrCode(requestId) {
  try {
    const { dataUrl } = await fetchJson('/api/qr');
    if (requestId !== state.statusRequestId || state.status !== 'waiting_qr') return;
    elements.qrCode.src = dataUrl;
    elements.qrPanel.hidden = false;
    state.qrVisible = true;
  } catch (_error) {
    hideQrCode();
  }
}

function hideQrCode() {
  elements.qrPanel.hidden = true;
  elements.qrCode.removeAttribute('src');
  state.qrVisible = false;
}

function clearLoadedGroups() {
  clearHistoryPollTimer();
  state.historyStatusRequestId += 1;
  state.historyGroupId = null;
  setHistoryPreparing(false);
  state.groups = [];
  elements.group.innerHTML = '<option value="">Conecte o WhatsApp primeiro</option>';
  elements.groupList.innerHTML = '';
  elements.groupSearch.value = '';
  elements.groupEmpty.hidden = true;
  elements.groupHelp.textContent = 'Os grupos aparecem quando a conexão estiver pronta.';
  resetMemberPicker();
  resetPollHistory();
}

async function disconnectWhatsApp() {
  if (state.disconnecting || state.status !== 'connected') return;
  const confirmed = window.confirm(
    'Desconectar o WhatsApp deste computador? Será necessário escanear um novo QR Code para conectar novamente.'
  );
  if (!confirmed) return;

  state.disconnecting = true;
  elements.disconnectWhatsApp.disabled = true;
  elements.disconnectWhatsApp.textContent = 'Desconectando…';
  try {
    const data = await fetchJson('/api/whatsapp/logout', { method: 'POST' });
    state.status = data.status?.status || 'connecting';
    elements.pollFields.disabled = true;
    elements.disconnectWhatsApp.hidden = true;
    clearLoadedGroups();
    showToast(data.message || 'WhatsApp desconectado com sucesso.');
    await updateStatus();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    state.disconnecting = false;
    elements.disconnectWhatsApp.disabled = false;
    elements.disconnectWhatsApp.textContent = 'Desconectar';
  }
}

function sortedGroups() {
  return [...state.groups].sort((a, b) => {
    const favoriteDifference = Number(state.favoriteGroupIds.has(b.id)) - Number(state.favoriteGroupIds.has(a.id));
    return favoriteDifference || a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
  });
}

function renderGroups() {
  const query = normalizeSearch(elements.groupSearch.value);
  const visibleGroups = sortedGroups().filter((group) => normalizeSearch(group.name).includes(query));
  elements.groupList.innerHTML = '';

  visibleGroups.forEach((group) => {
    const row = document.createElement('div');
    const selected = elements.group.value === group.id;
    row.className = `group-row${selected ? ' selected' : ''}`;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(selected));

    const choose = document.createElement('button');
    choose.className = 'group-choice';
    choose.type = 'button';
    choose.innerHTML = '<span class="group-indicator" aria-hidden="true"></span><span class="group-name"></span>';
    choose.querySelector('.group-name').textContent = group.name;
    choose.addEventListener('click', () => selectGroup(group.id));

    const favorite = document.createElement('button');
    const isFavorite = state.favoriteGroupIds.has(group.id);
    favorite.className = `favorite-button${isFavorite ? ' active' : ''}`;
    favorite.type = 'button';
    favorite.textContent = isFavorite ? '★' : '☆';
    favorite.setAttribute('aria-label', `${isFavorite ? 'Desfavoritar' : 'Favoritar'} ${group.name}`);
    favorite.setAttribute('aria-pressed', String(isFavorite));
    favorite.addEventListener('click', () => toggleFavoriteGroup(group.id));

    row.append(choose, favorite);
    elements.groupList.appendChild(row);
  });

  elements.groupEmpty.hidden = visibleGroups.length > 0;
}

function selectGroup(groupId, persist = true) {
  if (!state.groups.some((group) => group.id === groupId)) return;
  const changed = elements.group.value !== groupId;
  elements.group.value = groupId;
  if (persist) writeStoredValue(STORAGE_KEYS.lastGroupId, groupId);
  if (changed) elements.group.dispatchEvent(new Event('change'));
  renderGroups();
}

function syncPollHistoryGroup() {
  const group = state.groups.find((candidate) => candidate.id === elements.group.value);
  const syncRunning = Boolean(state.incrementalSyncDirection);
  elements.historyGroupName.textContent = group?.name || 'Selecione um grupo acima';
  elements.scanPolls.disabled = state.scanningPolls || state.historyPreparing || syncRunning
    || state.status !== 'connected' || !group;
  elements.prepareHistory.disabled = state.historyPreparing || state.scanningPolls || syncRunning
    || state.status !== 'connected' || !group;
  elements.syncNewer.disabled = syncRunning || state.historyPreparing || state.scanningPolls
    || state.status !== 'connected' || !group;
  elements.syncOlder.disabled = syncRunning || state.historyPreparing || state.scanningPolls
    || state.status !== 'connected' || !group;
}

function formatSyncTimestamp(timestamp, includeTime = false) {
  if (!Number.isFinite(Number(timestamp))) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    ...(includeTime ? { timeStyle: 'short' } : {})
  }).format(new Date(Number(timestamp) * 1000));
}

function renderSyncStatus(data) {
  elements.syncMessagesProcessed.textContent = Number(data.messagesProcessed || 0).toLocaleString('pt-BR');
  elements.syncOldestTimestamp.textContent = formatSyncTimestamp(data.oldestProcessedTimestamp);
  elements.syncLastAt.textContent = formatSyncTimestamp(data.lastSyncAt, true);
  if (!data.messagesProcessed) {
    elements.syncDetail.textContent = 'Nenhum histórico local encontrado. Use “Analisar enquetes” para fazer a importação inicial.';
  } else if (!state.incrementalSyncDirection) {
    elements.syncDetail.textContent = `${Number(data.messagesProcessed).toLocaleString('pt-BR')} IDs de mensagens armazenados sem conteúdo de conversas.`;
  }
}

async function loadSyncStatus(groupId) {
  if (!groupId) return;
  const requestId = ++state.syncStatusRequestId;
  try {
    const data = await fetchJson(`/api/groups/${encodeURIComponent(groupId)}/sync-status`);
    if (requestId !== state.syncStatusRequestId || elements.group.value !== groupId) return;
    renderSyncStatus(data);
  } catch (error) {
    if (requestId === state.syncStatusRequestId && elements.group.value === groupId) {
      elements.syncDetail.textContent = error.message;
    }
  }
}

function setIncrementalSyncing(direction) {
  state.incrementalSyncDirection = direction;
  elements.syncNewerLabel.textContent = direction === 'newer'
    ? 'Procurando novidades…'
    : 'Sincronizar novidades';
  elements.syncOlderLabel.textContent = direction === 'older'
    ? 'Buscando histórico anterior…'
    : 'Buscar histórico mais antigo';
  elements.syncNewerSpinner.hidden = direction !== 'newer';
  elements.syncOlderSpinner.hidden = direction !== 'older';
  elements.cancelSync.hidden = !direction;
  elements.historyLimit.disabled = Boolean(direction) || state.historyPreparing || state.scanningPolls;
  elements.historyPresets.forEach((button) => {
    button.disabled = Boolean(direction) || state.historyPreparing || state.scanningPolls;
  });
  syncPollHistoryGroup();
}

function renderIncrementalSyncResult(result) {
  if (result.cancelled) return 'Sincronização cancelada. Nenhuma alteração parcial foi persistida.';
  if (result.timedOut) return 'O limite de tempo foi atingido. Nenhuma alteração parcial foi persistida.';
  if (result.boundaryNotFound) {
    return 'Não foi possível encontrar a fronteira do histórico local dentro do limite incremental de 5.000 mensagens. Use o scan manual como fallback.';
  }
  if (result.direction === 'newer') {
    if (!result.newMessages) {
      return `✓ Tudo atualizado. Nenhuma mensagem nova encontrada. ${result.pollsFound} enquete(s) recente(s) reconciliada(s).`;
    }
    return `✓ Sincronização concluída. ${result.newMessages.toLocaleString('pt-BR')} mensagens novas e ${result.pollsFound.toLocaleString('pt-BR')} enquete(s) encontrada(s).`;
  }
  if (!result.newMessages && result.reachedAvailableHistoryStart) {
    return 'Nenhuma mensagem anterior adicional foi disponibilizada pelo WhatsApp Web nesta sessão.';
  }
  return `✓ Histórico expandido. ${result.newMessages.toLocaleString('pt-BR')} mensagens anteriores adicionadas.`;
}

async function runIncrementalSync(direction) {
  const groupId = elements.group.value;
  if (!groupId || state.incrementalSyncDirection) return;
  setIncrementalSyncing(direction);
  elements.syncDetail.textContent = direction === 'newer'
    ? '⟳ Procurando novidades…'
    : '⟳ Buscando histórico anterior…';
  try {
    const data = await fetchJson(
      `/api/groups/${encodeURIComponent(groupId)}/sync/${direction}`,
      direction === 'older'
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: 1000 })
          }
        : { method: 'POST' }
    );
    if (elements.group.value !== groupId) return;
    elements.syncDetail.textContent = renderIncrementalSyncResult(data);
    await loadSyncStatus(groupId);
  } catch (error) {
    if (elements.group.value === groupId) {
      elements.syncDetail.textContent = error.message;
      showToast(error.message, true);
    }
  } finally {
    if (elements.group.value === groupId) setIncrementalSyncing(null);
  }
}

async function cancelIncrementalSync(groupId = elements.group.value) {
  if (!groupId) return;
  try {
    await fetchJson(`/api/groups/${encodeURIComponent(groupId)}/sync`, { method: 'DELETE' });
    if (elements.group.value === groupId) elements.syncDetail.textContent = 'Cancelamento solicitado…';
  } catch (error) {
    if (elements.group.value === groupId) showToast(error.message, true);
  }
}

function clearHistoryPollTimer() {
  if (state.historyPollTimer) clearTimeout(state.historyPollTimer);
  state.historyPollTimer = null;
}

function setHistoryPreparing(preparing) {
  state.historyPreparing = preparing;
  elements.prepareHistoryLabel.textContent = preparing ? 'Carregando mensagens antigas…' : 'Preparar histórico';
  elements.prepareHistorySpinner.hidden = !preparing;
  elements.cancelHistory.hidden = !preparing;
  elements.historyLimit.disabled = preparing || state.scanningPolls || Boolean(state.incrementalSyncDirection);
  elements.historyPresets.forEach((button) => {
    button.disabled = preparing || state.scanningPolls || Boolean(state.incrementalSyncDirection);
  });
  syncPollHistoryGroup();
}

function renderHistoryPreparation(data) {
  if (!data || data.groupId !== elements.group.value) return;
  const count = Number.isInteger(data.messagesAvailable) ? data.messagesAvailable : '—';
  elements.historyPrepareMetric.textContent = String(count);
  const terminalCopy = {
    completed: `✓ Preparação concluída. ${count} mensagens disponíveis nesta sessão.`,
    stabilized: `✓ Histórico estabilizado por agora. ${count} mensagens disponíveis nesta sessão.`,
    cancelled: `Preparação cancelada. ${count} mensagens continuam disponíveis nesta sessão.`,
    timeout: `Tempo limite atingido. ${count} mensagens disponíveis nesta sessão.`,
    error: data.error || 'Não foi possível preparar mais histórico.'
  };
  elements.historyPrepareDetail.textContent = data.status === 'preparing'
    ? `⟳ ${data.detail || 'Buscando mensagens anteriores…'} Tentativa ${data.attempts || 0}.`
    : terminalCopy[data.status] || data.detail || 'Histórico disponível nesta sessão.';
  setHistoryPreparing(data.status === 'preparing');
}

async function loadHistoryPreparationStatus(groupId, poll = false) {
  if (!groupId || state.status !== 'connected') return;
  const requestId = poll ? state.historyStatusRequestId : ++state.historyStatusRequestId;
  try {
    const data = await fetchJson(`/api/groups/${encodeURIComponent(groupId)}/history/status`);
    if (requestId !== state.historyStatusRequestId || elements.group.value !== groupId) return;
    renderHistoryPreparation(data);
    if (data.status === 'preparing') {
      clearHistoryPollTimer();
      state.historyPollTimer = setTimeout(() => loadHistoryPreparationStatus(groupId, true), 1500);
    }
  } catch (error) {
    if (requestId !== state.historyStatusRequestId || elements.group.value !== groupId) return;
    setHistoryPreparing(false);
    elements.historyPrepareDetail.textContent = error.message;
  }
}

async function prepareGroupHistory() {
  const groupId = elements.group.value;
  const target = Number(elements.historyLimit.value);
  if (!groupId || state.historyPreparing) return;
  if (!Number.isInteger(target) || target < 1 || target > MAX_HISTORY_MESSAGES) {
    return showToast('Informe um alvo inteiro entre 1 e 500.000 mensagens.', true);
  }
  const requestId = ++state.historyStatusRequestId;
  setHistoryPreparing(true);
  elements.historyPrepareDetail.textContent = '⟳ Iniciando a preparação do histórico…';
  try {
    const data = await fetchJson(`/api/groups/${encodeURIComponent(groupId)}/history/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target })
    });
    if (requestId !== state.historyStatusRequestId || elements.group.value !== groupId) return;
    renderHistoryPreparation(data);
    clearHistoryPollTimer();
    state.historyPollTimer = setTimeout(() => loadHistoryPreparationStatus(groupId, true), 1000);
  } catch (error) {
    if (requestId !== state.historyStatusRequestId) return;
    setHistoryPreparing(false);
    elements.historyPrepareDetail.textContent = error.message;
    showToast(error.message, true);
  }
}

async function cancelGroupHistory(groupId = elements.group.value) {
  if (!groupId) return;
  clearHistoryPollTimer();
  try {
    await fetchJson(`/api/groups/${encodeURIComponent(groupId)}/history/prepare`, { method: 'DELETE' });
  } catch (error) {
    if (elements.group.value === groupId) showToast(error.message, true);
  }
  if (elements.group.value === groupId) await loadHistoryPreparationStatus(groupId);
}

async function switchHistoryGroup() {
  const previousGroupId = state.historyGroupId;
  const nextGroupId = elements.group.value;
  if (state.incrementalSyncDirection && previousGroupId && previousGroupId !== nextGroupId) {
    await cancelIncrementalSync(previousGroupId);
  }
  if (state.historyPreparing && previousGroupId && previousGroupId !== nextGroupId) {
    await cancelGroupHistory(previousGroupId);
  }
  clearHistoryPollTimer();
  state.historyStatusRequestId += 1;
  state.historyGroupId = nextGroupId || null;
  state.syncStatusRequestId += 1;
  setIncrementalSyncing(null);
  elements.syncMessagesProcessed.textContent = '—';
  elements.syncOldestTimestamp.textContent = '—';
  elements.syncLastAt.textContent = '—';
  elements.syncDetail.textContent = nextGroupId
    ? 'Consultando histórico local…'
    : 'Selecione um grupo para consultar o histórico local.';
  setHistoryPreparing(false);
  elements.historyPrepareMetric.textContent = '—';
  elements.historyPrepareDetail.textContent = nextGroupId
    ? 'Medindo mensagens disponíveis nesta sessão…'
    : 'Selecione um grupo para medir o histórico disponível nesta sessão.';
  resetPollHistory();
  if (nextGroupId) await loadSyncStatus(nextGroupId);
  if (nextGroupId && state.status === 'connected') await loadHistoryPreparationStatus(nextGroupId);
}

function resetPollHistory() {
  state.pollScanRequestId += 1;
  state.pollScanResult = null;
  elements.historyStatus.hidden = true;
  elements.historyStatus.className = 'history-status';
  elements.historyResults.hidden = true;
  elements.historySummary.replaceChildren();
  elements.historyPolls.replaceChildren();
  elements.historyRawJson.hidden = true;
  elements.historyRawJson.textContent = '';
  elements.toggleRawJson.textContent = 'Ver JSON bruto';
  elements.toggleRawJson.setAttribute('aria-expanded', 'false');
  syncPollHistoryGroup();
}

function setPollScanning(scanning) {
  state.scanningPolls = scanning;
  elements.scanPollsLabel.textContent = scanning ? 'Analisando histórico disponível…' : 'Analisar enquetes';
  elements.scanPollsSpinner.hidden = !scanning;
  elements.historyLimit.disabled = scanning || state.historyPreparing || Boolean(state.incrementalSyncDirection);
  elements.historyPresets.forEach((button) => {
    button.disabled = scanning || state.historyPreparing || Boolean(state.incrementalSyncDirection);
  });
  syncPollHistoryGroup();
}

function setHistoryLimit(limit) {
  elements.historyLimit.value = String(limit);
  elements.historyPresets.forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.limit) === Number(limit));
  });
}

function formatPollDate(timestamp) {
  if (!Number.isFinite(Number(timestamp))) return 'Data indisponível';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(Number(timestamp) * 1000));
}

function appendSummaryItem(value, label) {
  const item = document.createElement('div');
  const strong = document.createElement('strong');
  const span = document.createElement('span');
  strong.textContent = String(value);
  span.textContent = label;
  item.append(strong, span);
  elements.historySummary.appendChild(item);
}

function displayPerson(name, id) {
  return name || id || 'Pessoa não identificada';
}

function renderPollCard(poll) {
  const card = document.createElement('article');
  card.className = 'history-poll';

  const title = document.createElement('h3');
  title.textContent = poll.question || 'Enquete sem pergunta disponível';
  const meta = document.createElement('div');
  meta.className = 'history-meta';
  const author = displayPerson(
    poll.creatorName || poll.authorName,
    poll.creatorId || poll.authorId
  );
  [
    formatPollDate(poll.timestamp),
    `Autor: ${author}`,
    `${poll.options.length} ${poll.options.length === 1 ? 'opção' : 'opções'}`,
    `${poll.voteCount} ${poll.voteCount === 1 ? 'voto' : 'votos'}`
  ].forEach((value) => {
    const span = document.createElement('span');
    span.textContent = value;
    meta.appendChild(span);
  });
  card.append(title, meta);

  if (poll.options.length) {
    const options = document.createElement('ul');
    options.className = 'history-options';
    poll.options.forEach((name) => {
      const item = document.createElement('li');
      item.textContent = name;
      options.appendChild(item);
    });
    card.appendChild(options);
  }

  if (poll.votesAvailable) {
    const votesTitle = document.createElement('p');
    votesTitle.className = 'history-votes-title';
    votesTitle.textContent = 'Votos';
    card.appendChild(votesTitle);
    if (poll.votes.length) {
      const votes = document.createElement('ul');
      votes.className = 'history-votes';
      poll.votes.forEach((vote) => {
        const item = document.createElement('li');
        const selections = vote.selectedOptions.length
          ? vote.selectedOptions.join(', ')
          : 'nenhuma opção selecionada';
        item.textContent = `${displayPerson(vote.voterName, vote.voterId)} → ${selections}`;
        if (vote.timestamp) item.title = formatPollDate(vote.timestamp);
        votes.appendChild(item);
      });
      card.appendChild(votes);
    } else {
      const empty = document.createElement('p');
      empty.className = 'history-warning';
      empty.textContent = 'Nenhum voto foi disponibilizado para esta enquete.';
      card.appendChild(empty);
    }
  } else {
    const warning = document.createElement('p');
    warning.className = 'history-warning';
    warning.textContent = `⚠ Não foi possível recuperar os votos desta enquete${poll.votesError ? `: ${poll.votesError}` : '.'}`;
    card.appendChild(warning);
  }
  return card;
}

function renderPollScan(data) {
  state.pollScanResult = data;
  elements.historySummary.replaceChildren();
  appendSummaryItem(data.messagesScanned, 'mensagens analisadas');
  appendSummaryItem(data.pollsFound, 'enquetes encontradas');
  appendSummaryItem(data.pollsWithVotesAvailable, 'com votos disponíveis');
  elements.historyPolls.replaceChildren();
  if (data.polls.length) data.polls.forEach((poll) => elements.historyPolls.appendChild(renderPollCard(poll)));
  else {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = 'Nenhuma enquete apareceu nas mensagens disponibilizadas. Isso não significa necessariamente que o grupo nunca teve enquetes.';
    elements.historyPolls.appendChild(empty);
  }
  elements.historyRawJson.textContent = JSON.stringify(data, null, 2);
  elements.viewStats.href = `/stats?groupId=${encodeURIComponent(data.group.id)}`;
  elements.historyResults.hidden = false;
}

async function scanPreviousPolls() {
  if (state.scanningPolls) return;
  const groupId = elements.group.value;
  const limit = Number(elements.historyLimit.value);
  if (!groupId) return showToast('Selecione um grupo primeiro.', true);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_MESSAGES) {
    return showToast('Informe um limite inteiro entre 1 e 500.000 mensagens.', true);
  }

  setHistoryLimit(limit);
  setPollScanning(true);
  const requestId = ++state.pollScanRequestId;
  elements.historyResults.hidden = true;
  elements.historyStatus.textContent = 'Analisando histórico disponível… Isso pode levar alguns minutos.';
  elements.historyStatus.className = 'history-status';
  elements.historyStatus.hidden = false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000);
  try {
    const data = await fetchJson(`/api/groups/${encodeURIComponent(groupId)}/polls/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit }),
      signal: controller.signal
    });
    if (requestId !== state.pollScanRequestId || elements.group.value !== groupId) return;
    elements.historyStatus.hidden = true;
    renderPollScan(data);
  } catch (error) {
    if (requestId !== state.pollScanRequestId) return;
    elements.historyStatus.textContent = error.name === 'AbortError'
      ? 'A análise ultrapassou 10 minutos. Ela pode ainda estar terminando no servidor; aguarde antes de tentar novamente.'
      : error.message;
    elements.historyStatus.className = 'history-status error';
    elements.historyStatus.hidden = false;
  } finally {
    clearTimeout(timeout);
    setPollScanning(false);
  }
}

function toggleRawPollJson() {
  const willShow = elements.historyRawJson.hidden;
  elements.historyRawJson.hidden = !willShow;
  elements.toggleRawJson.textContent = willShow ? 'Ocultar JSON bruto' : 'Ver JSON bruto';
  elements.toggleRawJson.setAttribute('aria-expanded', String(willShow));
}

function toggleFavoriteGroup(groupId) {
  if (state.favoriteGroupIds.has(groupId)) state.favoriteGroupIds.delete(groupId);
  else state.favoriteGroupIds.add(groupId);
  writeStoredValue(STORAGE_KEYS.favoriteGroups, JSON.stringify([...state.favoriteGroupIds]));
  renderGroups();
}

async function loadGroups() {
  if (state.status !== 'connected') return showToast('WhatsApp ainda não está conectado.', true);
  elements.refreshGroups.disabled = true;
  elements.groupHelp.textContent = 'Buscando grupos…';
  try {
    const { groups } = await fetchJson('/api/groups');
    const selectedBeforeReload = elements.group.value;
    state.groups = groups;
    elements.group.innerHTML = '<option value="">Selecione um grupo</option>';
    groups.forEach(({ id, name }) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = name;
      elements.group.appendChild(option);
    });
    const lastGroupId = readStoredValue(STORAGE_KEYS.lastGroupId, '');
    const preferredGroupId = groups.some((group) => group.id === selectedBeforeReload)
      ? selectedBeforeReload
      : lastGroupId;
    if (groups.some((group) => group.id === preferredGroupId)) selectGroup(preferredGroupId, false);
    else renderGroups();
    elements.groupHelp.textContent = groups.length
      ? `${groups.length} ${groups.length === 1 ? 'grupo encontrado' : 'grupos encontrados'}. Favoritos aparecem primeiro.`
      : 'Nenhum grupo foi encontrado nesta conta.';
  } catch (error) {
    elements.groupHelp.textContent = error.message;
    showToast(error.message, true);
  } finally {
    elements.refreshGroups.disabled = false;
  }
}

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

function memberInitials(name) {
  const words = String(name || '?').trim().split(/\s+/).filter(Boolean);
  const initials = words.length > 1
    ? `${words[0][0]}${words[words.length - 1][0]}`
    : words[0]?.[0] || '?';
  return initials.toLocaleUpperCase('pt-BR');
}

function resetMemberPicker() {
  state.memberLoadId += 1;
  state.photoLoadId += 1;
  state.memberGroupId = null;
  state.members = [];
  state.selectedMemberIds.clear();
  state.photoQueue = [];
  state.photoObserver?.disconnect();
  state.photoObserver = null;
  elements.memberSearch.value = '';
  elements.memberList.innerHTML = '';
  if (elements.memberDialog.open) elements.memberDialog.close();
}

function updateMemberSelectionUi() {
  const count = state.selectedMemberIds.size;
  elements.memberSelectedCount.textContent = `${count}/12 selecionados`;
  elements.memberLimitMessage.hidden = count < MAX_POLL_OPTIONS;
  elements.applyMembers.disabled = count === 0;
  elements.clearMembers.disabled = count === 0;
  elements.memberList.querySelectorAll('.member-card').forEach((card) => {
    const selected = state.selectedMemberIds.has(card.dataset.memberId);
    card.classList.toggle('selected', selected);
    card.setAttribute('aria-checked', String(selected));
    card.querySelector('input').checked = selected;
  });
}

function toggleMember(memberId) {
  if (state.selectedMemberIds.has(memberId)) {
    state.selectedMemberIds.delete(memberId);
  } else if (state.selectedMemberIds.size < MAX_POLL_OPTIONS) {
    state.selectedMemberIds.add(memberId);
  } else {
    showToast('Você pode selecionar no máximo 12 membros.', true);
  }
  updateMemberSelectionUi();
}

function queueProfilePicture(card, member) {
  const task = { card, member, loadId: state.photoLoadId };
  if ('IntersectionObserver' in window) {
    state.photoObserver ??= new IntersectionObserver((entries) => {
      entries.filter((entry) => entry.isIntersecting).forEach((entry) => {
        state.photoObserver.unobserve(entry.target);
        state.photoQueue.push(entry.target._photoTask);
        runPhotoQueue();
      });
    }, { root: elements.memberList, rootMargin: '120px' });
    card._photoTask = task;
    state.photoObserver.observe(card);
  } else {
    state.photoQueue.push(task);
    runPhotoQueue();
  }
}

async function loadProfilePicture({ card, member, loadId }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const groupId = state.memberGroupId;
    const { profilePicUrl } = await fetchJson(
      `/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(member.id)}/profile-picture`,
      { signal: controller.signal }
    );
    if (loadId !== state.photoLoadId || !profilePicUrl || !card.isConnected) return;

    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('load', () => {
      if (loadId === state.photoLoadId) card.querySelector('.member-avatar')?.replaceChildren(image);
    }, { once: true });
    image.addEventListener('error', () => image.remove(), { once: true });
    image.src = profilePicUrl;
  } catch (_error) {
    // O avatar com iniciais permanece em falhas, timeout ou restrições de privacidade.
  } finally {
    clearTimeout(timeout);
  }
}

function runPhotoQueue() {
  while (state.activePhotoLoads < 3 && state.photoQueue.length) {
    const task = state.photoQueue.shift();
    if (task.loadId !== state.photoLoadId) continue;
    state.activePhotoLoads += 1;
    loadProfilePicture(task).finally(() => {
      state.activePhotoLoads -= 1;
      runPhotoQueue();
    });
  }
}

function renderMembers() {
  state.photoLoadId += 1;
  state.photoQueue = [];
  state.photoObserver?.disconnect();
  state.photoObserver = null;
  elements.memberList.innerHTML = '';
  const query = normalizeSearch(elements.memberSearch.value);
  const visibleMembers = state.members.filter((member) => normalizeSearch(member.name).includes(query));

  visibleMembers.forEach((member) => {
    const card = document.createElement('label');
    card.className = 'member-card';
    card.dataset.memberId = member.id;
    card.setAttribute('role', 'checkbox');
    card.tabIndex = 0;
    card.innerHTML = `
      <span class="member-avatar" aria-hidden="true"></span>
      <span class="member-copy"><strong></strong><small></small></span>
      <input type="checkbox" tabindex="-1">
      <span class="member-check" aria-hidden="true">✓</span>
    `;
    card.querySelector('.member-avatar').textContent = memberInitials(member.name);
    card.querySelector('.member-copy strong').textContent = member.name;
    card.querySelector('.member-copy small').textContent = member.numberHint || 'Identificador indisponível';
    card.addEventListener('click', (event) => {
      event.preventDefault();
      toggleMember(member.id);
    });
    card.addEventListener('keydown', (event) => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      toggleMember(member.id);
    });
    elements.memberList.appendChild(card);
    queueProfilePicture(card, member);
  });

  elements.memberEmpty.hidden = visibleMembers.length > 0;
  updateMemberSelectionUi();
}

async function useGroupMembers() {
  const groupId = elements.group.value;
  if (!groupId) return showToast('Selecione um grupo primeiro.', true);

  elements.memberDialog.showModal();
  if (state.memberGroupId === groupId && state.members.length) {
    elements.memberLoading.hidden = true;
    elements.memberPicker.hidden = false;
    renderMembers();
    elements.memberSearch.focus();
    return;
  }

  elements.useMembers.disabled = true;
  const originalLabel = elements.useMembers.textContent;
  elements.useMembers.textContent = 'Carregando membros…';
  elements.memberLoading.hidden = false;
  elements.memberPicker.hidden = true;
  elements.applyMembers.disabled = true;
  state.memberGroupId = groupId;
  state.members = [];
  state.selectedMemberIds.clear();
  const loadId = ++state.memberLoadId;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const { members, totalMembers } = await fetchJson(
      `/api/groups/${encodeURIComponent(groupId)}/members`,
      { signal: controller.signal }
    );
    if (loadId !== state.memberLoadId) return;
    if (!members.length) throw new Error('Nenhum membro foi encontrado nesse grupo.');
    state.members = members.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    elements.memberLoading.hidden = true;
    elements.memberPicker.hidden = false;
    renderMembers();
    elements.memberSearch.focus();
    if (totalMembers > members.length) showToast('Alguns membros não puderam ser identificados.', true);
  } catch (error) {
    if (loadId !== state.memberLoadId) return;
    elements.memberDialog.close();
    state.memberGroupId = null;
    showToast(
      error.name === 'AbortError'
        ? 'Não foi possível carregar os membros a tempo. Tente novamente.'
        : error.message || 'Não foi possível carregar os membros. Tente novamente.',
      true
    );
  } finally {
    clearTimeout(timeout);
    elements.useMembers.disabled = false;
    elements.useMembers.textContent = originalLabel;
  }
}

function selectRandomMembers() {
  const shuffled = [...state.members];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  state.selectedMemberIds = new Set(shuffled.slice(0, MAX_POLL_OPTIONS).map((member) => member.id));
  updateMemberSelectionUi();
}

function uniqueMemberNames(members) {
  const used = new Set();
  return members.map((member) => {
    const base = String(member.name || 'Participante').trim().slice(0, 94) || 'Participante';
    let name = base;
    let suffix = 2;
    while (used.has(normalizeSearch(name))) {
      name = `${base} (${suffix})`.slice(0, 100);
      suffix += 1;
    }
    used.add(normalizeSearch(name));
    return name;
  });
}

function applySelectedMembers() {
  const selected = state.members.filter((member) => state.selectedMemberIds.has(member.id));
  if (!selected.length) return;
  const existingValues = [...elements.optionsList.querySelectorAll('.poll-option')]
    .map((input) => input.value.trim())
    .filter(Boolean);
  if (existingValues.length && !window.confirm('As opções preenchidas serão substituídas pelos membros selecionados. Continuar?')) return;

  elements.optionsList.innerHTML = '';
  uniqueMemberNames(selected).forEach((name) => addOption(name));
  while (elements.optionsList.children.length < 2) addOption();
  syncOptions();
  elements.memberDialog.close();
  showToast(`${selected.length} ${selected.length === 1 ? 'membro adicionado' : 'membros adicionados'} às opções. Revise antes de enviar.`);
}

function filledOptions() {
  return [...elements.optionsList.querySelectorAll('.poll-option')]
    .map((input) => input.value.trim())
    .filter(Boolean);
}

function parseBulkOptions(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return [];
  const parts = /\r?\n/.test(value)
    ? value.split(/\r?\n/)
    : value.includes(';')
      ? value.split(';')
      : value.split(',');
  return parts.map((option) => option.trim()).filter(Boolean);
}

function openBulkDialog() {
  elements.bulkText.value = '';
  elements.bulkFeedback.hidden = true;
  elements.bulkFeedback.textContent = '';
  elements.bulkMode.hidden = filledOptions().length === 0;
  elements.bulkDialog.showModal();
  elements.bulkText.focus();
}

function importBulkOptions(event) {
  event.preventDefault();
  const imported = parseBulkOptions(elements.bulkText.value);
  const mode = new FormData(elements.bulkForm).get('bulkMode') || 'replace';
  const existing = mode === 'append' ? filledOptions() : [];
  const combined = [...existing, ...imported];
  const normalized = combined.map((option) => option.toLocaleLowerCase('pt-BR'));
  const duplicate = combined.find((_option, index) => normalized.indexOf(normalized[index]) !== index);

  if (!imported.length) return showBulkFeedback('Cole pelo menos uma opção válida.');
  if (duplicate) return showBulkFeedback(`A opção “${duplicate}” está duplicada. Remova a repetição para continuar.`);
  if (combined.length > MAX_POLL_OPTIONS) {
    return showBulkFeedback(`Foram encontradas ${combined.length} opções, mas o WhatsApp permite no máximo 12. Remova algumas antes de continuar.`);
  }
  if (combined.some((option) => option.length > 100)) {
    return showBulkFeedback('Cada opção deve ter no máximo 100 caracteres.');
  }

  elements.optionsList.innerHTML = '';
  combined.forEach((option) => addOption(option));
  while (elements.optionsList.children.length < 2) addOption();
  syncOptions();
  elements.bulkDialog.close();
  showToast(`${imported.length} ${imported.length === 1 ? 'opção importada' : 'opções importadas'} com sucesso.`);
}

function showBulkFeedback(message) {
  elements.bulkFeedback.textContent = message;
  elements.bulkFeedback.hidden = false;
}

function clearForm() {
  const hasContent = Boolean(elements.question.value.trim() || filledOptions().length);
  if (hasContent && !window.confirm('Limpar a pergunta e todas as opções? O grupo selecionado será mantido.')) return;
  elements.question.value = '';
  elements.optionsList.innerHTML = '';
  addOption();
  addOption();
  elements.allowMultiple.checked = false;
  elements.question.focus();
}

function validPollDraft() {
  return state.status === 'connected'
    && Boolean(elements.group.value)
    && Boolean(elements.question.value.trim())
    && filledOptions().length >= 2;
}

function setSending(sending) {
  state.sending = sending;
  elements.submit.disabled = sending;
  elements.submitLabel.textContent = sending ? 'Enviando…' : 'Enviar enquete';
  elements.spinner.hidden = !sending;
}

async function sendPoll(event) {
  event.preventDefault();
  if (state.sending) return;
  if (!elements.group.value) return showToast('Selecione um grupo.', true);
  if (!elements.form.reportValidity()) return;
  setSending(true);
  try {
    const payload = {
      groupId: elements.group.value,
      question: elements.question.value,
      options: [...document.querySelectorAll('.poll-option')].map((input) => input.value),
      allowMultipleAnswers: elements.allowMultiple.checked
    };
    const data = await fetchJson('/api/polls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const groupName = state.groups.find((group) => group.id === elements.group.value)?.name;
    showToast(groupName ? `✓ Enquete enviada para ${groupName}` : data.message || '✓ Enquete enviada com sucesso.');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setSending(false);
  }
}

function showToast(message, isError = false) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast${isError ? ' error' : ''}`;
  elements.toast.hidden = false;
  state.toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 4500);
}

elements.addOption.addEventListener('click', () => addOption());
elements.disconnectWhatsApp.addEventListener('click', disconnectWhatsApp);
elements.bulkOptions.addEventListener('click', openBulkDialog);
elements.useMembers.addEventListener('click', useGroupMembers);
elements.refreshGroups.addEventListener('click', loadGroups);
elements.form.addEventListener('submit', sendPoll);
elements.group.addEventListener('change', () => {
  if (elements.group.value) writeStoredValue(STORAGE_KEYS.lastGroupId, elements.group.value);
  resetMemberPicker();
  switchHistoryGroup();
});
elements.groupSearch.addEventListener('input', renderGroups);
elements.clearForm.addEventListener('click', clearForm);
elements.bulkForm.addEventListener('submit', importBulkOptions);
[elements.closeBulkDialog, elements.cancelBulk].forEach((button) => {
  button.addEventListener('click', () => elements.bulkDialog.close());
});
elements.bulkDialog.addEventListener('click', (event) => {
  if (event.target === elements.bulkDialog) elements.bulkDialog.close();
});
elements.memberSearch.addEventListener('input', renderMembers);
elements.randomMembers.addEventListener('click', selectRandomMembers);
elements.clearMembers.addEventListener('click', () => {
  state.selectedMemberIds.clear();
  updateMemberSelectionUi();
});
elements.applyMembers.addEventListener('click', applySelectedMembers);
[elements.closeMemberDialog, elements.cancelMembers].forEach((button) => {
  button.addEventListener('click', () => elements.memberDialog.close());
});
elements.memberDialog.addEventListener('click', (event) => {
  if (event.target === elements.memberDialog) elements.memberDialog.close();
});
elements.historyPresets.forEach((button) => {
  button.addEventListener('click', () => setHistoryLimit(Number(button.dataset.limit)));
});
elements.historyLimit.addEventListener('input', () => setHistoryLimit(elements.historyLimit.value));
elements.scanPolls.addEventListener('click', scanPreviousPolls);
elements.prepareHistory.addEventListener('click', prepareGroupHistory);
elements.cancelHistory.addEventListener('click', () => cancelGroupHistory());
elements.syncNewer.addEventListener('click', () => runIncrementalSync('newer'));
elements.syncOlder.addEventListener('click', () => runIncrementalSync('older'));
elements.cancelSync.addEventListener('click', () => cancelIncrementalSync());
elements.toggleRawJson.addEventListener('click', toggleRawPollJson);
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter' || elements.bulkDialog.open || elements.memberDialog.open) return;
  event.preventDefault();
  if (!validPollDraft()) return showToast('Preencha grupo, pergunta e pelo menos duas opções antes de enviar.', true);
  elements.form.requestSubmit();
});

addOption();
addOption();
syncPollHistoryGroup();
updateStatus();
setInterval(updateStatus, 2500);
