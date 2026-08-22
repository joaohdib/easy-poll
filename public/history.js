'use strict';

const HISTORY_TIMEZONE = 'America/Sao_Paulo';
const LAST_GROUP_STORAGE_KEY = 'easyPoll.lastGroupId';
const SEARCH_DEBOUNCE_MS = 350;

const elements = {
  groupSelect: document.querySelector('#history-group-select'),
  summary: document.querySelector('#history-summary'),
  storedCount: document.querySelector('#history-stored-count'),
  lastSync: document.querySelector('#history-last-sync'),
  oldest: document.querySelector('#history-oldest'),
  syncFeedback: document.querySelector('#history-sync-feedback'),
  syncNewer: document.querySelector('#history-sync-newer'),
  syncOlder: document.querySelector('#history-sync-older'),
  cancelSync: document.querySelector('#history-cancel-sync'),
  browser: document.querySelector('#history-browser'),
  listTitle: document.querySelector('#history-list-title'),
  pageSize: document.querySelector('#history-page-size'),
  search: document.querySelector('#history-search'),
  from: document.querySelector('#history-from'),
  to: document.querySelector('#history-to'),
  clearFilters: document.querySelector('#history-clear-filters'),
  listStatus: document.querySelector('#history-list-status'),
  list: document.querySelector('#history-list'),
  pagination: document.querySelector('#history-pagination'),
  previous: document.querySelector('#history-previous'),
  next: document.querySelector('#history-next'),
  pageLabel: document.querySelector('#history-page-label'),
  detailDialog: document.querySelector('#history-detail-dialog'),
  detailTitle: document.querySelector('#history-detail-title'),
  detailContent: document.querySelector('#history-detail-content'),
  detailClose: document.querySelector('#history-detail-close'),
  toast: document.querySelector('#history-toast')
};

const state = {
  groups: [],
  groupId: '',
  page: 1,
  pagination: null,
  searchTimer: null,
  listController: null,
  detailController: null,
  syncDirection: null,
  toastTimer: null
};

const numberFormatter = new Intl.NumberFormat('pt-BR');
const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: HISTORY_TIMEZONE,
  dateStyle: 'short',
  timeStyle: 'short'
});
const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: HISTORY_TIMEZONE,
  dateStyle: 'short'
});

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function plural(value, singular, pluralForm) {
  return `${numberFormatter.format(value)} ${value === 1 ? singular : pluralForm}`;
}

function formatTimestamp(timestamp, dateOnly = false) {
  if (!timestamp) return 'não disponível';
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return 'não disponível';
  return (dateOnly ? dateFormatter : dateTimeFormatter).format(date);
}

function readLastGroupId() {
  try {
    return localStorage.getItem(LAST_GROUP_STORAGE_KEY) || '';
  } catch (_error) {
    return '';
  }
}

function rememberGroupId(groupId) {
  try {
    localStorage.setItem(LAST_GROUP_STORAGE_KEY, groupId);
  } catch (_error) {
    // O seletor continua funcional quando localStorage estiver indisponível.
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
    // A mensagem abaixo cobre respostas inválidas sem expor detalhes internos.
  }
  if (!response.ok) throw new Error(payload?.error || 'Não foi possível concluir a solicitação.');
  return payload;
}

function showToast(message, error = false) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', error);
  elements.toast.hidden = false;
  state.toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 4_500);
}

function selectedGroup() {
  return state.groups.find(({ id }) => id === state.groupId) || null;
}

function renderGroupOptions() {
  const options = [makeElement('option', '', state.groups.length
    ? 'Selecione um grupo'
    : 'Nenhum grupo armazenado')];
  options[0].value = '';
  state.groups.forEach((group) => {
    const option = makeElement(
      'option',
      '',
      `${group.name} — ${plural(group.pollCount, 'enquete', 'enquetes')}`
    );
    option.value = group.id;
    options.push(option);
  });
  elements.groupSelect.replaceChildren(...options);
  elements.groupSelect.value = state.groupId;
}

async function loadLocalGroups() {
  const payload = await fetchJson('/api/local/groups');
  state.groups = Array.isArray(payload.groups) ? payload.groups : [];
  const requestedGroupId = new URLSearchParams(location.search).get('groupId') || '';
  const candidate = state.groupId || requestedGroupId || readLastGroupId();
  state.groupId = state.groups.some(({ id }) => id === candidate) ? candidate : '';
  renderGroupOptions();
  if (state.groupId) await selectGroup(state.groupId, true);
  else renderNoGroup();
}

async function refreshLocalGroupMetadata() {
  const payload = await fetchJson('/api/local/groups');
  state.groups = Array.isArray(payload.groups) ? payload.groups : [];
  renderGroupOptions();
  renderStoredCount();
}

function renderNoGroup() {
  elements.summary.hidden = true;
  elements.browser.hidden = true;
  elements.syncNewer.disabled = true;
  elements.syncOlder.disabled = true;
  elements.syncFeedback.textContent = state.groups.length
    ? 'Selecione um grupo para abrir o histórico local.'
    : 'Nenhum grupo foi armazenado ainda. Analise ou sincronize um grupo na página principal.';
}

async function selectGroup(groupId, persist = true) {
  state.listController?.abort();
  state.detailController?.abort();
  state.groupId = groupId;
  state.page = 1;
  elements.groupSelect.value = groupId;
  if (!groupId) {
    history.replaceState(null, '', '/history');
    renderNoGroup();
    return;
  }
  if (persist) rememberGroupId(groupId);
  history.replaceState(null, '', `/history?groupId=${encodeURIComponent(groupId)}`);
  elements.summary.hidden = false;
  elements.browser.hidden = false;
  elements.syncNewer.disabled = false;
  elements.syncOlder.disabled = false;
  elements.listTitle.textContent = selectedGroup()?.name || 'Histórico do grupo';
  renderStoredCount();
  elements.syncFeedback.textContent = 'Histórico carregado somente do SQLite local.';
  await Promise.all([loadSyncStatus(), loadHistory()]);
}

function renderStoredCount() {
  const group = selectedGroup();
  elements.storedCount.textContent = group ? numberFormatter.format(group.pollCount) : '—';
}

async function loadSyncStatus() {
  if (!state.groupId) return;
  try {
    const status = await fetchJson(
      `/api/groups/${encodeURIComponent(state.groupId)}/sync-status`
    );
    elements.lastSync.textContent = formatTimestamp(status.lastSyncAt);
    elements.oldest.textContent = formatTimestamp(status.oldestProcessedTimestamp, true);
  } catch (_error) {
    elements.lastSync.textContent = 'não disponível';
    elements.oldest.textContent = 'não disponível';
  }
}

function hasActiveFilters() {
  return Boolean(elements.search.value.trim() || elements.from.value || elements.to.value);
}

function buildHistoryUrl() {
  const parameters = new URLSearchParams({
    page: String(state.page),
    pageSize: elements.pageSize.value
  });
  const search = elements.search.value.trim();
  if (search) parameters.set('search', search);
  if (elements.from.value) parameters.set('from', elements.from.value);
  if (elements.to.value) parameters.set('to', elements.to.value);
  return `/api/groups/${encodeURIComponent(state.groupId)}/history?${parameters}`;
}

async function loadHistory() {
  if (!state.groupId) return;
  state.listController?.abort();
  const controller = new AbortController();
  state.listController = controller;
  elements.list.hidden = true;
  elements.pagination.hidden = true;
  elements.listStatus.hidden = false;
  elements.listStatus.classList.remove('error');
  elements.listStatus.textContent = 'Carregando histórico...';
  elements.clearFilters.hidden = !hasActiveFilters();
  try {
    const result = await fetchJson(buildHistoryUrl(), { signal: controller.signal });
    if (controller.signal.aborted) return;
    state.pagination = result.pagination;
    renderHistoryItems(result.items);
    renderPagination(result.pagination);
  } catch (error) {
    if (error.name === 'AbortError') return;
    renderListError();
  } finally {
    if (state.listController === controller) state.listController = null;
  }
}

function renderHistoryItems(items) {
  if (!items.length) {
    elements.list.hidden = true;
    elements.listStatus.hidden = false;
    elements.listStatus.textContent = hasActiveFilters()
      ? 'Nenhuma enquete encontrada para esses filtros.'
      : 'Nenhuma enquete armazenada neste grupo. Analise ou sincronize o histórico para começar.';
    return;
  }
  elements.listStatus.hidden = true;
  elements.list.hidden = false;
  elements.list.replaceChildren(...items.map(renderPollCard));
}

function renderPollCard(poll) {
  const card = makeElement('article', 'history-page-poll');
  const copy = makeElement('div');
  copy.appendChild(makeElement('h3', '', poll.question));
  const meta = makeElement('div', 'history-page-poll-meta');
  meta.append(
    makeElement('span', '', formatTimestamp(poll.createdAt)),
    makeElement('span', '', poll.creator
      ? `Criada por ${poll.creator.displayName}`
      : 'Autor não disponível'),
    makeElement('span', '', poll.allowMultipleAnswers
      ? 'Múltiplas respostas'
      : 'Resposta única')
  );
  copy.appendChild(meta);
  const counts = makeElement('div', 'history-page-poll-counts');
  counts.appendChild(makeElement(
    'span',
    '',
    plural(poll.optionCount, 'opção', 'opções')
  ));
  if (poll.votesSnapshotAvailable) {
    counts.append(
      makeElement('span', '', plural(poll.participantCount, 'participante', 'participantes')),
      makeElement('span', '', plural(poll.selectionCount, 'seleção', 'seleções'))
    );
  } else {
    counts.appendChild(makeElement(
      'span',
      'unavailable',
      'Dados de votação ainda não disponíveis'
    ));
  }
  copy.appendChild(counts);

  const button = makeElement('button', 'button secondary history-detail-button', 'Ver detalhes');
  button.type = 'button';
  button.addEventListener('click', () => openDetail(poll.messageId));
  card.append(copy, button);
  return card;
}

function renderPagination(pagination) {
  if (!pagination.totalPages) {
    elements.pagination.hidden = true;
    return;
  }
  elements.pagination.hidden = false;
  elements.previous.disabled = pagination.page <= 1;
  elements.next.disabled = pagination.page >= pagination.totalPages;
  elements.pageLabel.textContent = `Página ${pagination.page} de ${pagination.totalPages}`;
}

function renderListError() {
  elements.list.hidden = true;
  elements.listStatus.hidden = false;
  elements.listStatus.classList.add('error');
  elements.listStatus.textContent = 'Não foi possível carregar o histórico local.';
  const retry = makeElement('button', 'button secondary', 'Tentar novamente');
  retry.type = 'button';
  retry.addEventListener('click', loadHistory);
  elements.listStatus.appendChild(retry);
}

async function openDetail(messageId) {
  state.detailController?.abort();
  const controller = new AbortController();
  state.detailController = controller;
  elements.detailTitle.textContent = 'Carregando...';
  elements.detailContent.replaceChildren(
    makeElement('p', 'history-detail-loading', 'Carregando detalhes...')
  );
  if (!elements.detailDialog.open) elements.detailDialog.showModal();
  try {
    const detail = await fetchJson(
      `/api/groups/${encodeURIComponent(state.groupId)}/history/${encodeURIComponent(messageId)}`,
      { signal: controller.signal }
    );
    if (controller.signal.aborted) return;
    renderDetail(detail);
  } catch (error) {
    if (error.name === 'AbortError') return;
    elements.detailTitle.textContent = 'Detalhes indisponíveis';
    elements.detailContent.replaceChildren(makeElement(
      'p', 'history-detail-notice', 'Não foi possível carregar os detalhes desta enquete.'
    ));
  } finally {
    if (state.detailController === controller) state.detailController = null;
  }
}

function renderDetail(detail) {
  elements.detailTitle.textContent = detail.question;
  const fragment = document.createDocumentFragment();
  const meta = makeElement('p', 'history-detail-meta');
  meta.append(
    makeElement('span', '', formatTimestamp(detail.createdAt)),
    makeElement('span', '', detail.creator
      ? `Criada por ${detail.creator.displayName}`
      : 'Autor não disponível'),
    makeElement('span', '', detail.allowMultipleAnswers
      ? 'Múltiplas respostas permitidas'
      : 'Uma resposta por participante')
  );
  fragment.appendChild(meta);

  const optionSection = makeElement('section', 'history-detail-section');
  optionSection.appendChild(makeElement('h3', '', 'Opções'));
  const optionList = makeElement('ol', 'history-detail-options');
  detail.options.forEach((option) => {
    const item = makeElement('li', 'history-detail-option');
    item.appendChild(makeElement('span', '', option.text));
    item.appendChild(makeElement(
      'strong',
      '',
      option.selectionCount === null
        ? 'contagem indisponível'
        : plural(option.selectionCount, 'seleção', 'seleções')
    ));
    optionList.appendChild(item);
  });
  optionSection.appendChild(optionList);
  fragment.appendChild(optionSection);

  const participantSection = makeElement('section', 'history-detail-section');
  participantSection.appendChild(makeElement('h3', '', 'Participantes'));
  if (detail.participants === null) {
    participantSection.appendChild(makeElement(
      'p',
      'history-detail-notice',
      'Os dados de votação desta enquete ainda não foram recuperados com sucesso. Sincronize ou analise o histórico novamente para tentar obter os votos.'
    ));
  } else if (!detail.participants.length) {
    participantSection.appendChild(makeElement(
      'p', 'history-detail-empty', 'Nenhum participante votou nesta enquete.'
    ));
  } else {
    const participantList = makeElement('ul', 'history-participants');
    detail.participants.forEach((participant) => {
      const item = makeElement('li', 'history-participant');
      item.append(
        makeElement('strong', '', participant.displayName),
        makeElement(
          'p',
          'history-participant-options',
          participant.selectedOptions.map(({ text }) => text).join(', ')
        )
      );
      if (participant.votedAt) {
        item.appendChild(makeElement(
          'small', 'history-participant-time', `Votou em ${formatTimestamp(participant.votedAt)}`
        ));
      }
      participantList.appendChild(item);
    });
    participantSection.appendChild(participantList);
  }
  fragment.appendChild(participantSection);
  elements.detailContent.replaceChildren(fragment);
}

function setSyncState(direction) {
  state.syncDirection = direction;
  elements.groupSelect.disabled = Boolean(direction);
  elements.syncNewer.disabled = Boolean(direction) || !state.groupId;
  elements.syncOlder.disabled = Boolean(direction) || !state.groupId;
  elements.cancelSync.hidden = !direction;
  elements.syncNewer.querySelector('.spinner').hidden = direction !== 'newer';
  elements.syncOlder.querySelector('.spinner').hidden = direction !== 'older';
  elements.syncNewer.querySelector('.button-label').textContent = direction === 'newer'
    ? 'Sincronizando...'
    : 'Sincronizar novidades';
  elements.syncOlder.querySelector('.button-label').textContent = direction === 'older'
    ? 'Buscando...'
    : 'Buscar histórico mais antigo';
}

async function runSync(direction) {
  if (!state.groupId || state.syncDirection) return;
  const groupId = state.groupId;
  setSyncState(direction);
  elements.syncFeedback.classList.remove('error');
  elements.syncFeedback.textContent = direction === 'newer'
    ? 'Sincronizando mensagens mais recentes...'
    : 'Buscando mensagens mais antigas disponíveis...';
  try {
    const result = await fetchJson(
      `/api/groups/${encodeURIComponent(groupId)}/sync/${direction}`,
      { method: 'POST' }
    );
    if (groupId !== state.groupId) return;
    if (direction === 'newer') state.page = 1;
    const summary = `${plural(result.newMessages, 'nova mensagem processada', 'novas mensagens processadas')}; ${plural(result.pollsFound, 'enquete encontrada', 'enquetes encontradas')}.`;
    elements.syncFeedback.textContent = result.cancelled ? 'Sincronização cancelada.' : `✓ ${summary}`;
    showToast(result.cancelled ? 'Sincronização cancelada.' : summary);
    await Promise.all([loadSyncStatus(), loadHistory(), refreshLocalGroupMetadata()]);
  } catch (error) {
    if (groupId !== state.groupId) return;
    elements.syncFeedback.classList.add('error');
    elements.syncFeedback.textContent = error.message;
    showToast(error.message, true);
  } finally {
    if (groupId === state.groupId) setSyncState(null);
  }
}

async function cancelSync() {
  if (!state.groupId || !state.syncDirection) return;
  elements.cancelSync.disabled = true;
  try {
    await fetchJson(`/api/groups/${encodeURIComponent(state.groupId)}/sync`, {
      method: 'DELETE'
    });
    elements.syncFeedback.textContent = 'Cancelamento solicitado...';
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.cancelSync.disabled = false;
  }
}

function resetPageAndLoad() {
  state.page = 1;
  loadHistory();
}

elements.groupSelect.addEventListener('change', () => selectGroup(elements.groupSelect.value));
elements.search.addEventListener('input', () => {
  clearTimeout(state.searchTimer);
  elements.clearFilters.hidden = !hasActiveFilters();
  state.searchTimer = setTimeout(resetPageAndLoad, SEARCH_DEBOUNCE_MS);
});
elements.from.addEventListener('change', resetPageAndLoad);
elements.to.addEventListener('change', resetPageAndLoad);
elements.pageSize.addEventListener('change', resetPageAndLoad);
elements.clearFilters.addEventListener('click', () => {
  clearTimeout(state.searchTimer);
  elements.search.value = '';
  elements.from.value = '';
  elements.to.value = '';
  elements.clearFilters.hidden = true;
  resetPageAndLoad();
});
elements.previous.addEventListener('click', () => {
  if (state.page <= 1) return;
  state.page -= 1;
  loadHistory();
  elements.browser.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
elements.next.addEventListener('click', () => {
  if (!state.pagination || state.page >= state.pagination.totalPages) return;
  state.page += 1;
  loadHistory();
  elements.browser.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
elements.detailClose.addEventListener('click', () => elements.detailDialog.close());
elements.detailDialog.addEventListener('close', () => state.detailController?.abort());
elements.detailDialog.addEventListener('click', (event) => {
  if (event.target === elements.detailDialog) elements.detailDialog.close();
});
elements.syncNewer.addEventListener('click', () => runSync('newer'));
elements.syncOlder.addEventListener('click', () => runSync('older'));
elements.cancelSync.addEventListener('click', cancelSync);

loadLocalGroups().catch(() => {
  elements.groupSelect.replaceChildren(makeElement('option', '', 'Não foi possível carregar os grupos'));
  elements.syncFeedback.classList.add('error');
  elements.syncFeedback.textContent = 'Não foi possível carregar os grupos armazenados localmente.';
});
