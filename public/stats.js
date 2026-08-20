'use strict';

const elements = {
  loading: document.querySelector('#stats-loading'),
  empty: document.querySelector('#stats-empty'),
  content: document.querySelector('#stats-content'),
  groupName: document.querySelector('#stats-group-name'),
  summary: document.querySelector('#stats-summary'),
  peopleCards: document.querySelector('#people-cards'),
  ranking: document.querySelector('#participation-ranking'),
  rankingDenominator: document.querySelector('#ranking-denominator'),
  pollCards: document.querySelector('#poll-cards')
};

function formatPercent(value) {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value || 0)}%`;
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

function renderSummary(summary) {
  const items = [
    [summary.pollsFound, 'enquetes encontradas'],
    [summary.eligiblePolls, 'com dados de votação'],
    [summary.totalParticipations, 'participações'],
    [summary.identifiedParticipants, 'participantes identificados']
  ];
  elements.summary.replaceChildren(...items.map(([value, label]) => {
    const item = makeElement('div', 'summary-stat');
    item.append(makeElement('strong', '', value), makeElement('span', '', label));
    return item;
  }));
}

function renderPersonCard({ icon, title, member, value, description, accent }) {
  const card = makeElement('article', `card person-stat-card ${accent || ''}`);
  const heading = makeElement('div', 'person-stat-heading');
  heading.append(makeElement('span', 'person-stat-icon', icon), makeElement('h3', '', title));
  card.appendChild(heading);
  if (!member) {
    card.append(
      makeElement('strong', 'insufficient', 'Dados insuficientes'),
      makeElement('p', 'person-stat-description', description)
    );
    return card;
  }
  card.append(
    makeElement('strong', 'person-stat-name', member.name),
    makeElement('span', 'person-stat-value', value),
    makeElement('p', 'person-stat-description', description)
  );
  return card;
}

function renderPeople(stats) {
  const eligible = stats.summary.eligiblePolls;
  const cards = [
    {
      icon: '🏆', title: 'Mais participativo', member: stats.mostActive, accent: 'winner',
      value: stats.mostActive ? formatPercent(stats.mostActive.participationRate) : '',
      description: stats.mostActive
        ? `${stats.mostActive.pollsParticipated} de ${eligible} enquetes com dados de votos`
        : 'Nenhum participante foi identificado.'
    },
    {
      icon: '😴', title: 'Menos participativo', member: stats.leastActive,
      value: stats.leastActive ? formatPercent(stats.leastActive.participationRate) : '',
      description: stats.leastActive
        ? `${stats.leastActive.pollsParticipated} de ${eligible} enquetes com dados de votos`
        : 'Nenhum participante foi identificado.'
    },
    {
      icon: '⚡', title: 'Mais rápido para votar', member: stats.fastestVoter, accent: 'speed',
      value: stats.fastestVoter ? `Média: ${formatDuration(stats.fastestVoter.averageVoteDelaySeconds)}` : '',
      description: stats.fastestVoter
        ? `Baseado em ${stats.fastestVoter.validTimingSamples} enquetes com timestamps válidos`
        : `São necessárias ${stats.minimumBehaviorSample} enquetes com timestamps válidos.`
    },
    {
      icon: '🤝', title: 'Mais alinhado com o grupo', member: stats.mostAligned, accent: 'aligned',
      value: stats.mostAligned ? formatPercent(stats.mostAligned.alignedRate) : '',
      description: stats.mostAligned
        ? `Escolheu uma opção vencedora em ${stats.mostAligned.alignedPolls} de ${stats.mostAligned.pollsParticipated} enquetes participadas`
        : `São necessárias ${stats.minimumBehaviorSample} enquetes participadas.`
    },
    {
      icon: '🧨', title: 'Mais “do contra”', member: stats.mostContrarian, accent: 'contrarian',
      value: stats.mostContrarian ? formatPercent(stats.mostContrarian.contrarianRate) : '',
      description: stats.mostContrarian
        ? `Escolheu apenas opções derrotadas em ${stats.mostContrarian.contrarianPolls} de ${stats.mostContrarian.pollsParticipated} enquetes participadas`
        : `São necessárias ${stats.minimumBehaviorSample} enquetes participadas.`
    }
  ];
  elements.peopleCards.replaceChildren(...cards.map(renderPersonCard));
}

function renderRanking(stats) {
  elements.rankingDenominator.textContent = `${stats.summary.eligiblePolls} enquetes com dados de votos`;
  if (!stats.participationRanking.length) {
    elements.ranking.replaceChildren(makeElement('li', 'ranking-empty', 'Nenhum participante identificado.'));
    return;
  }
  elements.ranking.replaceChildren(...stats.participationRanking.map((member, index) => {
    const row = makeElement('li', 'ranking-row');
    const position = makeElement('span', 'ranking-position', `${index + 1}`);
    const identity = makeElement('div', 'ranking-identity');
    identity.append(makeElement('strong', '', member.name), makeElement('small', '', `${member.pollsParticipated} / ${stats.summary.eligiblePolls}`));
    const progress = makeElement('div', 'ranking-progress');
    const bar = makeElement('span', 'ranking-progress-bar');
    bar.style.width = `${Math.max(0, Math.min(100, member.participationRate))}%`;
    progress.appendChild(bar);
    row.append(position, identity, progress, makeElement('strong', 'ranking-rate', formatPercent(member.participationRate)));
    return row;
  }));
}

function pollCard(icon, title, poll, type) {
  const card = makeElement('article', 'card poll-stat-card');
  const heading = makeElement('div', 'person-stat-heading');
  heading.append(makeElement('span', 'person-stat-icon', icon), makeElement('h3', '', title));
  card.appendChild(heading);
  if (!poll) {
    card.append(makeElement('strong', 'insufficient', 'Dados insuficientes'));
    const rule = type === 'closest'
      ? 'É preciso haver ao menos 3 participantes e 2 opções votadas.'
      : 'Nenhuma enquete com dados de votos foi encontrada.';
    card.append(makeElement('p', 'person-stat-description', rule));
    return card;
  }
  card.append(makeElement('strong', 'poll-stat-question', `“${poll.question}”`));
  if (type === 'highest') {
    card.append(
      makeElement('span', 'poll-stat-main-value', `${poll.participantCount} ${poll.participantCount === 1 ? 'participante' : 'participantes'}`),
      makeElement('p', 'person-stat-description', `${poll.optionCount} ${poll.optionCount === 1 ? 'opção' : 'opções'}`)
    );
  } else {
    const results = makeElement('div', 'closest-results');
    poll.leaders.forEach((option) => {
      const row = makeElement('div', 'closest-result-row');
      row.append(makeElement('span', '', option.name), makeElement('strong', '', option.voteCount));
      results.appendChild(row);
    });
    card.append(results, makeElement('p', 'poll-difference', `Diferença: ${poll.difference} ${poll.difference === 1 ? 'voto' : 'votos'}`));
  }
  return card;
}

function renderStats(stats) {
  elements.groupName.textContent = stats.summary.group?.name || 'Grupo sem nome';
  renderSummary(stats.summary);
  renderPeople(stats);
  renderRanking(stats);
  elements.pollCards.replaceChildren(
    pollCard('🔥', 'Maior participação', stats.highestParticipationPoll, 'highest'),
    pollCard('⚔️', 'Enquete mais disputada', stats.closestPoll, 'closest')
  );
  elements.content.hidden = false;
}

async function loadStats() {
  try {
    const response = await fetch('/api/stats', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    elements.loading.hidden = true;
    if (!response.ok || !data.hasAnalysis) {
      elements.groupName.textContent = 'Nenhuma análise disponível';
      elements.empty.hidden = false;
      return;
    }
    renderStats(data.stats);
  } catch (_error) {
    elements.loading.hidden = true;
    elements.groupName.textContent = 'Servidor indisponível';
    elements.empty.querySelector('h2').textContent = 'Não foi possível carregar as estatísticas.';
    elements.empty.querySelector('p').textContent = 'Confira se o EasyPoll está em execução e tente novamente.';
    elements.empty.hidden = false;
  }
}

loadStats();
