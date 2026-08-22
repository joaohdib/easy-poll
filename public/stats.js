'use strict';

const elements = {
  loading: document.querySelector('#stats-loading'),
  empty: document.querySelector('#stats-empty'),
  content: document.querySelector('#stats-content'),
  groupName: document.querySelector('#stats-group-name'),
  summary: document.querySelector('#stats-summary'),
  participationCards: document.querySelector('#participation-cards'),
  behaviorCards: document.querySelector('#behavior-cards'),
  speedCards: document.querySelector('#speed-cards'),
  connectionCards: document.querySelector('#connection-cards'),
  affinityRankings: document.querySelector('#affinity-rankings'),
  ranking: document.querySelector('#participation-ranking'),
  rankingDenominator: document.querySelector('#ranking-denominator'),
  timestampBasis: document.querySelector('#timestamp-basis'),
  pollCards: document.querySelector('#poll-cards'),
  activityCards: document.querySelector('#activity-cards'),
  groupSelect: document.querySelector('#stats-group-select'),
  localData: document.querySelector('#stats-local-data'),
  syncLink: document.querySelector('#stats-sync-link')
};

const LAST_GROUP_STORAGE_KEY = 'easyPoll.lastGroupId';
let statsRequestId = 0;

const numberFormatter = new Intl.NumberFormat('pt-BR');
const percentFormatter = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1
});

function formatPercent(value) {
  return `${percentFormatter.format(value || 0)}%`;
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours}h ${minutes}min`;
  if (minutes) return `${minutes}min ${remainder}s`;
  return `${remainder}s`;
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function plural(value, singular, pluralForm) {
  return `${numberFormatter.format(value)} ${value === 1 ? singular : pluralForm}`;
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
    // A seleção ainda funciona quando o armazenamento estiver indisponível.
  }
}

function formatLocalTimestamp(timestamp) {
  if (!timestamp) return 'nunca';
  const date = new Date(timestamp * 1000);
  return Number.isNaN(date.getTime()) ? 'indisponível' : date.toLocaleString('pt-BR');
}

function renderSummary(summary) {
  const items = [
    [summary.pollsFound, 'enquetes encontradas'],
    [summary.eligiblePolls, 'com dados de votação'],
    [summary.totalParticipations, 'participações'],
    [summary.identifiedParticipants, 'participantes identificados'],
    [summary.validTimestampVotes, 'votos com horário válido'],
    [summary.identifiedCreators, `criadores · ${summary.pollsWithIdentifiedCreator}/${summary.pollsFound} enquetes com autor`]
  ];
  elements.summary.replaceChildren(...items.map(([value, label]) => {
    const item = makeElement('div', 'summary-stat');
    item.append(makeElement('strong', '', numberFormatter.format(value)), makeElement('span', '', label));
    return item;
  }));
}

function renderStatCard({ icon, title, name, value, description, explanation, accent, emptyTitle }) {
  const card = makeElement('article', `card stat-card ${accent || ''}`);
  const heading = makeElement('div', 'person-stat-heading');
  heading.append(makeElement('span', 'person-stat-icon', icon), makeElement('h3', '', title));
  if (explanation) {
    const info = makeElement('span', 'stat-info', '?');
    info.title = explanation;
    info.tabIndex = 0;
    info.setAttribute('role', 'img');
    info.setAttribute('aria-label', explanation);
    heading.appendChild(info);
  }
  card.appendChild(heading);
  if (!name) {
    card.append(
      makeElement('strong', 'insufficient', emptyTitle || 'Dados insuficientes'),
      makeElement('p', 'person-stat-description', description)
    );
    return card;
  }
  card.append(
    makeElement('strong', 'person-stat-name', name),
    makeElement('span', 'person-stat-value', value),
    makeElement('p', 'person-stat-description', description)
  );
  return card;
}

function renderParticipation(stats) {
  const eligible = stats.summary.eligiblePolls;
  elements.participationCards.replaceChildren(
    renderStatCard({
      icon: '🏆', title: 'Mais participativo', name: stats.mostActive?.name, accent: 'winner',
      value: stats.mostActive ? formatPercent(stats.mostActive.participationRate) : '',
      description: stats.mostActive
        ? `${stats.mostActive.pollsParticipated} de ${eligible} enquetes com dados de votos`
        : 'Nenhum participante foi identificado.'
    }),
    renderStatCard({
      icon: '😴', title: 'Menos participativo', name: stats.leastActive?.name,
      value: stats.leastActive ? formatPercent(stats.leastActive.participationRate) : '',
      description: stats.leastActive
        ? `${stats.leastActive.pollsParticipated} de ${eligible} enquetes com dados de votos`
        : 'Nenhum participante foi identificado.'
    })
  );
}

function renderBehavior(stats) {
  const unpredictable = stats.mostUnpredictable;
  const unlucky = stats.unluckiestMember;
  const participationRule = `É preciso participar de pelo menos ${formatPercent(stats.minimumBehaviorParticipationRate)} das enquetes`;
  elements.behaviorCards.replaceChildren(
    renderStatCard({
      icon: '🤝', title: 'Mais alinhado', name: stats.mostAligned?.name, accent: 'aligned',
      value: stats.mostAligned ? formatPercent(stats.mostAligned.alignedRate) : '',
      description: stats.mostAligned
        ? `Acompanhou uma opção vencedora em ${stats.mostAligned.alignedPolls} de ${stats.mostAligned.behaviorPolls} enquetes.`
        : `${participationRule} e ter ${stats.minimumBehaviorSample} resultados elegíveis.`
    }),
    renderStatCard({
      icon: '🧨', title: 'Mais “do contra”', name: stats.mostContrarian?.name, accent: 'contrarian',
      value: stats.mostContrarian ? formatPercent(stats.mostContrarian.contrarianRate) : '',
      description: stats.mostContrarian
        ? `Não escolheu nenhuma vencedora em ${stats.mostContrarian.contrarianPolls} de ${stats.mostContrarian.behaviorPolls} enquetes.`
        : `${participationRule} e ter ${stats.minimumBehaviorSample} resultados elegíveis.`
    }),
    renderStatCard({
      icon: '🎲', title: 'Mais imprevisível', name: unpredictable?.name, accent: 'unpredictable',
      value: unpredictable
        ? `${formatPercent(unpredictable.alignedRate)} × ${formatPercent(unpredictable.contrarianRate)}` : '',
      description: unpredictable
        ? `Alinhado × do contra. Base: ${plural(unpredictable.behaviorPolls, 'enquete', 'enquetes')}.`
        : `${participationRule} e ter ${stats.minimumExtendedSample} resultados elegíveis.`,
      explanation: 'Alterna mais entre acompanhar e contrariar o resultado das enquetes.'
    }),
    renderStatCard({
      icon: '💀', title: 'Azarado oficial', name: unlucky?.name, accent: 'unlucky',
      value: unlucky ? formatPercent(unlucky.lastPlaceRate) : '',
      description: unlucky
        ? `Escolheu uma última colocada em ${unlucky.lastPlacePolls} de ${unlucky.lastPlaceEligiblePolls} enquetes.`
        : `${participationRule} e ter ${stats.minimumExtendedSample} resultados elegíveis.`,
      explanation: 'Mais frequentemente escolhe pelo menos uma opção que termina em último.'
    })
  );
}

function timingNames(result) {
  return result?.leaders?.map((leader) => leader.name).join(' · ') || '';
}

function renderSpeed(stats) {
  const first = stats.firstVoter;
  const last = stats.lastVoter;
  elements.timestampBasis.textContent = stats.summary.validTimestampVotes
    ? `Baseado em ${plural(stats.summary.validTimestampVotes, 'voto com horário disponível', 'votos com horário disponível')}.`
    : 'Nenhum voto possui horário válido disponível.';
  elements.speedCards.replaceChildren(
    renderStatCard({
      icon: '⚡', title: 'Mais rápido para votar', name: stats.fastestVoter?.name, accent: 'speed',
      value: stats.fastestVoter ? `Média: ${formatDuration(stats.fastestVoter.averageVoteDelaySeconds)}` : '',
      description: stats.fastestVoter
        ? `Baseado em ${stats.fastestVoter.validTimingSamples} enquetes com criação e voto válidos.`
        : `São necessárias ${stats.minimumBehaviorSample} enquetes com timestamps válidos.`
    }),
    renderStatCard({
      icon: '🚀', title: 'Primeiro a votar', name: timingNames(first), accent: 'first',
      value: first ? plural(first.count, 'vez', 'vezes') : '',
      description: first
        ? `${first.count} de ${first.eligiblePolls} enquetes elegíveis. Empates exatos creditam todos.`
        : 'Nenhuma enquete possui timestamp de voto válido disponível.'
    }),
    renderStatCard({
      icon: '🐢', title: 'Último a chegar', name: timingNames(last), accent: 'last',
      value: last ? plural(last.count, 'vez', 'vezes') : '',
      description: last
        ? `${last.count} de ${last.eligiblePolls} enquetes elegíveis. É o último voto entre os recuperados.`
        : 'Nenhuma enquete possui timestamp de voto válido disponível.'
    })
  );
}

function renderConnections(stats) {
  const pair = stats.mostOppositePair;
  elements.connectionCards.replaceChildren(renderStatCard({
    icon: '⚔️', title: 'Dupla mais oposta',
    name: pair?.members.map((member) => member.name).join(' × '),
    value: pair ? formatPercent(pair.oppositionRate) : '',
    description: pair
      ? `${plural(pair.pollsTogether, 'enquete em comum', 'enquetes em comum')}; a oposição é o inverso da sincronia média.`
      : `Não há pares em que ambos participaram de mais de ${formatPercent(stats.minimumBehaviorParticipationRate)} das enquetes e possuem ${stats.minimumPairSample} enquetes em comum.`,
    explanation: `Resultado do primeiro lugar no ranking de oposição. Compara todas as opções escolhidas por Jaccard; ambos precisam participar de mais de ${formatPercent(stats.minimumBehaviorParticipationRate)} das enquetes.`,
    accent: 'opposite'
  }));

  elements.affinityRankings.replaceChildren(
    renderAffinityRanking({
      icon: '🤝',
      title: 'Mais sincronizados',
      ranking: stats.similarityRanking,
      scoreKey: 'similarityRate',
      scoreLabel: 'de sincronia',
      accent: 'similarity'
    }),
    renderAffinityRanking({
      icon: '⚔️',
      title: 'Mais opostos',
      ranking: stats.oppositionRanking,
      scoreKey: 'oppositionRate',
      scoreLabel: 'de oposição',
      accent: 'opposition'
    })
  );
}

function renderAffinityRanking({ icon, title, ranking, scoreKey, scoreLabel, accent }) {
  const panel = makeElement('article', `card affinity-ranking ${accent}`);
  const heading = makeElement('div', 'affinity-heading');
  heading.append(makeElement('span', 'person-stat-icon', icon), makeElement('h3', '', title));
  panel.appendChild(heading);

  if (!ranking?.length) {
    panel.append(
      makeElement('strong', 'affinity-empty-title', 'Ainda não há duplas elegíveis para este ranking.'),
      makeElement('p', 'affinity-empty-copy', 'Cada participante precisa ter votado em mais de 20% das enquetes analisadas e a dupla precisa ter pelo menos 5 enquetes em comum.')
    );
    return panel;
  }

  const list = makeElement('ol', 'affinity-list');
  ranking.forEach((pair, index) => {
    const item = makeElement('li', `affinity-row${index >= 5 ? ' affinity-extra' : ''}`);
    const identity = makeElement('div', 'affinity-identity');
    identity.append(
      makeElement('strong', '', pair.members.map((member) => member.name).join(' + ')),
      makeElement('small', '', plural(pair.pollsTogether, 'enquete em comum', 'enquetes em comum'))
    );
    const score = makeElement('div', 'affinity-score');
    score.append(
      makeElement('strong', '', formatPercent(pair[scoreKey])),
      makeElement('small', '', scoreLabel)
    );
    const track = makeElement('span', 'affinity-track');
    const fill = makeElement('span', 'affinity-fill');
    fill.style.width = `${Math.max(0, Math.min(100, pair[scoreKey]))}%`;
    track.appendChild(fill);
    item.append(makeElement('span', 'affinity-position', `#${index + 1}`), identity, score, track);
    list.appendChild(item);
  });
  panel.appendChild(list);

  if (ranking.length > 5) {
    const toggle = makeElement('button', 'affinity-toggle', 'Ver ranking completo');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', () => {
      const expanded = panel.classList.toggle('expanded');
      toggle.textContent = expanded ? 'Mostrar somente Top 5' : 'Ver ranking completo';
      toggle.setAttribute('aria-expanded', String(expanded));
    });
    panel.appendChild(toggle);
  }
  return panel;
}

function renderRanking(stats) {
  elements.rankingDenominator.textContent = `${stats.summary.eligiblePolls} enquetes com dados de votos`;
  if (!stats.participationRanking.length) {
    elements.ranking.replaceChildren(makeElement('li', 'ranking-empty', 'Nenhum participante identificado.'));
    return;
  }
  elements.ranking.replaceChildren(...stats.participationRanking.map((member, index) => {
    const row = makeElement('li', 'ranking-row');
    const identity = makeElement('div', 'ranking-identity');
    identity.append(makeElement('strong', '', member.name), makeElement('small', '', `${member.pollsParticipated} / ${stats.summary.eligiblePolls}`));
    const progress = makeElement('div', 'ranking-progress');
    const bar = makeElement('span', 'ranking-progress-bar');
    bar.style.width = `${Math.max(0, Math.min(100, member.participationRate))}%`;
    progress.appendChild(bar);
    row.append(
      makeElement('span', 'ranking-position', `${index + 1}`), identity, progress,
      makeElement('strong', 'ranking-rate', formatPercent(member.participationRate))
    );
    return row;
  }));
}

function pollCard(icon, title, poll, type) {
  const card = makeElement('article', 'card stat-card poll-stat-card');
  const heading = makeElement('div', 'person-stat-heading');
  heading.append(makeElement('span', 'person-stat-icon', icon), makeElement('h3', '', title));
  card.appendChild(heading);
  if (!poll) {
    card.append(makeElement('strong', 'insufficient', 'Dados insuficientes'));
    card.append(makeElement('p', 'person-stat-description', type === 'closest'
      ? 'É preciso haver ao menos 3 participantes e 2 opções votadas.'
      : 'Nenhuma enquete com dados de votos foi encontrada.'));
    return card;
  }
  card.append(makeElement('strong', 'poll-stat-question', `“${poll.question}”`));
  if (type === 'highest') {
    card.append(
      makeElement('span', 'poll-stat-main-value', plural(poll.participantCount, 'participante', 'participantes')),
      makeElement('p', 'person-stat-description', plural(poll.optionCount, 'opção', 'opções'))
    );
  } else {
    const results = makeElement('div', 'closest-results');
    poll.leaders.forEach((option) => {
      const row = makeElement('div', 'closest-result-row');
      row.append(makeElement('span', '', option.name), makeElement('strong', '', option.voteCount));
      results.appendChild(row);
    });
    card.append(results, makeElement('p', 'poll-difference', `Diferença: ${plural(poll.difference, 'voto', 'votos')}`));
  }
  return card;
}

function renderPolls(stats) {
  const top = stats.topPollCreator;
  const least = stats.leastPollCreator;
  elements.pollCards.replaceChildren(
    pollCard('🔥', 'Maior participação', stats.highestParticipationPoll, 'highest'),
    pollCard('⚔️', 'Enquete mais disputada', stats.closestPoll, 'closest'),
    renderStatCard({
      icon: '📝', title: 'Mestre das enquetes', name: top?.name, accent: 'creator',
      value: top ? plural(top.pollsCreated, 'enquete', 'enquetes') : '',
      description: top
        ? `${formatPercent(top.percentage)} das enquetes com autor identificado.`
        : 'Não foi possível identificar autores neste histórico.'
    }),
    renderStatCard({
      icon: '💤', title: 'Criador mais raro', name: least?.name,
      value: least ? plural(least.pollsCreated, 'enquete', 'enquetes') : '',
      description: least
        ? 'Quem criou menos enquetes entre os criadores identificados.'
        : stats.onlyOneIdentifiedCreator
          ? 'Só foi identificado um criador de enquetes neste histórico.'
          : 'Não foi possível identificar autores suficientes.',
      emptyTitle: stats.onlyOneIdentifiedCreator ? 'Um único criador' : 'Dados insuficientes'
    })
  );
}

function distributionRows(items) {
  const wrapper = makeElement('div', 'distribution');
  const max = Math.max(1, ...items.map((item) => item.count));
  items.forEach((item) => {
    const row = makeElement('div', 'distribution-row');
    const track = makeElement('span', 'distribution-track');
    const fill = makeElement('span', 'distribution-fill');
    fill.style.width = `${(item.count / max) * 100}%`;
    track.appendChild(fill);
    row.append(
      makeElement('span', 'distribution-label', item.shortLabel || item.label),
      track,
      makeElement('strong', 'distribution-value', numberFormatter.format(item.count))
    );
    wrapper.appendChild(row);
  });
  return wrapper;
}

function activityCard(icon, title, result, items, value, description) {
  const card = renderStatCard({ icon, title, name: result?.name, value, description, accent: 'activity' });
  if (result && items?.length) card.appendChild(distributionRows(items));
  return card;
}

function renderActivity(stats) {
  const day = stats.mostActiveDay;
  const prime = stats.primeTime;
  elements.activityCards.replaceChildren(
    activityCard(
      '📅', 'Dia mais ativo', day ? { name: day.name[0].toLocaleUpperCase('pt-BR') + day.name.slice(1) } : null,
      day?.distribution,
      day ? plural(day.count, 'participação', 'participações') : '',
      day ? `${formatPercent(day.percentage)} de toda a atividade com horário disponível.`
        : 'Nenhum voto possui timestamp válido disponível.'
    ),
    activityCard(
      '🕐', 'Horário nobre', prime ? { name: prime.rangeLabel } : null,
      prime?.topHours.map((hour) => ({ ...hour, shortLabel: hour.label })),
      prime ? plural(prime.count, 'participação', 'participações') : '',
      prime ? 'Faixa de uma hora com mais participações recuperadas.'
        : 'Nenhum voto possui timestamp válido disponível.'
    )
  );
}

function renderStats(stats) {
  elements.groupName.textContent = stats.summary.group?.name || 'Grupo sem nome';
  renderSummary(stats.summary);
  renderParticipation(stats);
  renderRanking(stats);
  renderBehavior(stats);
  renderSpeed(stats);
  renderConnections(stats);
  renderPolls(stats);
  renderActivity(stats);
  elements.content.hidden = false;
}

function showEmpty(title, detail) {
  elements.empty.querySelector('h2').textContent = title;
  elements.empty.querySelector('p').textContent = detail;
  elements.empty.hidden = false;
  elements.content.hidden = true;
}

async function loadStats(groupId) {
  const requestId = ++statsRequestId;
  elements.loading.hidden = false;
  elements.empty.hidden = true;
  elements.content.hidden = true;
  try {
    const response = await fetch(`/api/groups/${encodeURIComponent(groupId)}/stats`, {
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (requestId !== statsRequestId) return;
    elements.loading.hidden = true;
    if (!response.ok || !data.stats) {
      elements.groupName.textContent = 'Dados locais indisponíveis';
      showEmpty(
        'Não foi possível carregar as estatísticas.',
        data.error || 'Confira se o EasyPoll está em execução e tente novamente.'
      );
      return;
    }
    elements.localData.textContent = `Última sincronização: ${formatLocalTimestamp(data.localData?.lastSyncAt)} · ${plural(data.localData?.messagesProcessed || 0, 'mensagem processada', 'mensagens processadas')}`;
    if (data.stats.summary.pollsFound === 0) {
      elements.groupName.textContent = data.stats.summary.group?.name || 'Grupo sem nome';
      showEmpty(
        'Ainda não há enquetes importadas para este grupo.',
        'Sincronize ou analise o histórico primeiro.'
      );
      return;
    }
    renderStats(data.stats);
  } catch (_error) {
    if (requestId !== statsRequestId) return;
    elements.loading.hidden = true;
    elements.groupName.textContent = 'Servidor indisponível';
    showEmpty(
      'Não foi possível carregar as estatísticas.',
      'Confira se o EasyPoll está em execução e tente novamente.'
    );
  }
}

async function initializeStats() {
  try {
    const response = await fetch('/api/local/groups', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Não foi possível listar os grupos locais.');
    const groups = Array.isArray(data.groups) ? data.groups : [];
    elements.groupSelect.replaceChildren(...groups.map((group) => {
      const option = makeElement(
        'option',
        '',
        `${group.name} (${plural(group.pollCount || 0, 'enquete', 'enquetes')})`
      );
      option.value = group.id;
      return option;
    }));

    if (!groups.length) {
      elements.groupSelect.replaceChildren(makeElement('option', '', 'Nenhum grupo armazenado'));
      elements.groupSelect.disabled = true;
      elements.loading.hidden = true;
      elements.groupName.textContent = 'Nenhum dado local disponível';
      elements.localData.textContent = 'Nenhum grupo foi importado para o SQLite.';
      showEmpty(
        'Ainda não há grupos armazenados.',
        'Conecte o WhatsApp e importe ou sincronize o histórico de um grupo primeiro.'
      );
      return;
    }

    const requestedGroupId = new URLSearchParams(window.location.search).get('groupId') || '';
    const preferredGroupId = [requestedGroupId, readLastGroupId()]
      .find((candidate) => groups.some((group) => group.id === candidate)) || groups[0].id;
    elements.groupSelect.value = preferredGroupId;
    rememberGroupId(preferredGroupId);
    elements.syncLink.href = `/?groupId=${encodeURIComponent(preferredGroupId)}`;
    await loadStats(preferredGroupId);
  } catch (error) {
    elements.loading.hidden = true;
    elements.groupName.textContent = 'Servidor indisponível';
    elements.localData.textContent = 'Os grupos locais não puderam ser carregados.';
    showEmpty(
      'Não foi possível carregar as estatísticas.',
      error.message || 'Confira se o EasyPoll está em execução e tente novamente.'
    );
  }
}

elements.groupSelect.addEventListener('change', () => {
  const groupId = elements.groupSelect.value;
  if (!groupId) return;
  rememberGroupId(groupId);
  elements.syncLink.href = `/?groupId=${encodeURIComponent(groupId)}`;
  const url = new URL(window.location.href);
  url.searchParams.set('groupId', groupId);
  window.history.replaceState(null, '', url);
  loadStats(groupId);
});

initializeStats();
