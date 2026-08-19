'use strict';

const state = {
  status: null,
  statusRequestId: 0,
  qrVisible: false,
  sending: false,
  toastTimer: null
};
const elements = {
  statusBadge: document.querySelector('#status-badge'),
  connectionHint: document.querySelector('#connection-hint'),
  qrPanel: document.querySelector('#qr-panel'),
  qrCode: document.querySelector('#qr-code'),
  pollFields: document.querySelector('#poll-fields'),
  group: document.querySelector('#group'),
  groupHelp: document.querySelector('#group-help'),
  refreshGroups: document.querySelector('#refresh-groups'),
  form: document.querySelector('#poll-form'),
  question: document.querySelector('#question'),
  optionsList: document.querySelector('#options-list'),
  optionCount: document.querySelector('#option-count'),
  addOption: document.querySelector('#add-option'),
  useMembers: document.querySelector('#use-members'),
  allowMultiple: document.querySelector('#allow-multiple'),
  submit: document.querySelector('#submit-button'),
  submitLabel: document.querySelector('#submit-button .button-label'),
  spinner: document.querySelector('#submit-button .spinner'),
  toast: document.querySelector('#toast')
};

const statusCopy = {
  disconnected: ['Desconectado', 'O WhatsApp está offline. Reinicie o servidor para reconectar.'],
  waiting_qr: ['Aguardando QR Code', 'Escaneie o código abaixo para conectar sua conta.'],
  connecting: ['Conectando', 'Preparando sua sessão do WhatsApp Web…'],
  connected: ['Conectado', 'Sua conta está pronta para enviar uma enquete.'],
  auth_failure: ['Falha na autenticação', 'Não foi possível autenticar. Reinicie o servidor e tente novamente.']
};

function addOption(value = '') {
  if (elements.optionsList.children.length >= 12) {
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
  elements.addOption.disabled = rows.length >= 12;
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

async function loadGroups() {
  if (state.status !== 'connected') return showToast('WhatsApp ainda não está conectado.', true);
  elements.refreshGroups.disabled = true;
  elements.groupHelp.textContent = 'Buscando grupos…';
  try {
    const { groups } = await fetchJson('/api/groups');
    elements.group.innerHTML = '<option value="">Selecione um grupo</option>';
    groups.forEach(({ id, name }) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = name;
      elements.group.appendChild(option);
    });
    elements.groupHelp.textContent = groups.length
      ? `${groups.length} ${groups.length === 1 ? 'grupo encontrado' : 'grupos encontrados'}.`
      : 'Nenhum grupo foi encontrado nesta conta.';
  } catch (error) {
    elements.groupHelp.textContent = error.message;
    showToast(error.message, true);
  } finally {
    elements.refreshGroups.disabled = false;
  }
}

async function useGroupMembers() {
  const groupId = elements.group.value;
  if (!groupId) return showToast('Selecione um grupo primeiro.', true);

  elements.useMembers.disabled = true;
  const originalLabel = elements.useMembers.textContent;
  elements.useMembers.textContent = 'Buscando membros…';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const { members, totalMembers } = await fetchJson(
      `/api/groups/${encodeURIComponent(groupId)}/members`,
      { signal: controller.signal }
    );
    if (!members.length) throw new Error('Nenhum membro foi encontrado nesse grupo.');

    elements.optionsList.innerHTML = '';
    members.forEach((member) => addOption(member));
    while (elements.optionsList.children.length < 2) addOption();
    syncOptions();

    const limitedText = totalMembers > members.length
      ? `${members.length} dos ${totalMembers} membros foram adicionados.`
      : `${members.length} ${members.length === 1 ? 'membro foi adicionado' : 'membros foram adicionados'}.`;
    showToast(limitedText);
  } catch (error) {
    showToast(
      error.name === 'AbortError'
        ? 'A busca demorou demais. Tente novamente em alguns segundos.'
        : error.message,
      true
    );
  } finally {
    clearTimeout(timeout);
    elements.useMembers.disabled = false;
    elements.useMembers.textContent = originalLabel;
  }
}

function setSending(sending) {
  state.sending = sending;
  elements.submit.disabled = sending;
  elements.submitLabel.textContent = sending ? 'Enviando…' : 'Enviar enquete';
  elements.spinner.hidden = !sending;
}

async function sendPoll(event) {
  event.preventDefault();
  if (state.sending || !elements.form.reportValidity()) return;
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
    showToast(data.message || 'Enquete enviada com sucesso.');
    elements.question.value = '';
    [...document.querySelectorAll('.poll-option')].forEach((input) => { input.value = ''; });
    elements.allowMultiple.checked = false;
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
elements.useMembers.addEventListener('click', useGroupMembers);
elements.refreshGroups.addEventListener('click', loadGroups);
elements.form.addEventListener('submit', sendPoll);

addOption();
addOption();
updateStatus();
setInterval(updateStatus, 2500);
