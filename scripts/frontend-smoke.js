'use strict';

const path = require('node:path');
const express = require('express');
const puppeteer = require('puppeteer');

async function main() {
  const app = express();
  const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
  const group = { id: 'smoke-group@g.us', name: 'Grupo Smoke' };
  const member = {
    id: 'ana@c.us', name: 'Ana', pollsParticipated: 1, participationRate: 100,
    alignedPolls: 1, alignedRate: 100, contrarianPolls: 0, contrarianRate: 0,
    behaviorPolls: 1, unpredictability: 0, lastPlacePolls: 0,
    lastPlaceEligiblePolls: 1, lastPlaceRate: 0, validTimingSamples: 0,
    averageVoteDelaySeconds: null
  };
  app.get('/api/status', (_request, response) => response.json({
    status: 'connected', connected: true, hasQrCode: false, error: null
  }));
  app.get('/api/groups', (_request, response) => response.json({ groups: [group] }));
  app.get('/api/groups/:groupId/members', (_request, response) => response.json({
    members: [{ id: 'ana@c.us', name: 'Ana', numberHint: '**1234', profilePicUrl: null }],
    totalMembers: 1
  }));
  app.get('/api/groups/:groupId/members/:memberId/profile-picture', (_request, response) => response.json({
    profilePicUrl: null
  }));
  app.get('/api/local/groups', (_request, response) => response.json({
    groups: [{ ...group, pollCount: 1, lastSyncAt: 1_700_000_300 }]
  }));
  app.get('/api/groups/:groupId/sync-status', (request, response) => response.json({
    groupId: request.params.groupId, messagesProcessed: 12,
    oldestProcessedTimestamp: 1_700_000_000,
    newestProcessedTimestamp: 1_700_000_300, lastSyncAt: 1_700_000_300
  }));
  app.get('/api/groups/:groupId/history/status', (request, response) => response.json({
    status: 'completed', groupId: request.params.groupId, messagesAvailable: 12,
    initialMessagesAvailable: 12, attempts: 0, noGrowthAttempts: 0, target: 1_000,
    strategy: 'smoke', detail: 'Disponível', startedAt: '', updatedAt: '',
    finishedAt: '', error: null
  }));
  app.get('/api/groups/:groupId/history/poll-smoke', (request, response) => response.json({
    messageId: 'poll-smoke', groupId: request.params.groupId, question: 'Qual opção?',
    createdAt: 1_700_000_000, allowMultipleAnswers: true,
    creator: { id: 'creator@c.us', displayName: 'Criador' },
    votesSnapshotAvailable: true, votesSnapshotAt: 1_700_000_300,
    participantCount: 1, selectionCount: 2,
    options: [
      { id: 1, text: 'A', position: 0, selectionCount: 1 },
      { id: 2, text: 'B', position: 1, selectionCount: 1 }
    ],
    participants: [{
      id: 'ana@c.us', displayName: 'Ana', votedAt: 1_700_000_100,
      selectedOptions: [{ id: 1, text: 'A', position: 0 }, { id: 2, text: 'B', position: 1 }]
    }]
  }));
  app.get('/api/groups/:groupId/history', (_request, response) => response.json({
    items: [{
      messageId: 'poll-smoke', question: 'Qual opção?', createdAt: 1_700_000_000,
      creator: { id: 'creator@c.us', displayName: 'Criador' },
      allowMultipleAnswers: true, optionCount: 2, votesSnapshotAvailable: true,
      participantCount: 1, selectionCount: 2
    }],
    pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 }
  }));
  app.get('/api/groups/:groupId/stats', (request, response) => response.json({
    localData: {
      groupId: request.params.groupId, messagesProcessed: 12,
      oldestProcessedTimestamp: 1_700_000_000,
      newestProcessedTimestamp: 1_700_000_300, lastSyncAt: 1_700_000_300
    },
    stats: {
      summary: {
        group, pollsFound: 1, eligiblePolls: 1, totalParticipations: 1,
        identifiedParticipants: 1, validTimestampVotes: 0, timedPolls: 0,
        identifiedCreators: 1, pollsWithIdentifiedCreator: 1
      },
      mostActive: member, leastActive: member, participationRanking: [member],
      fastestVoter: null, mostAligned: member, mostContrarian: null,
      mostUnpredictable: null, unluckiestMember: null, firstVoter: null,
      lastVoter: null, eligibleMembers: [member], pairs: [], similarityRanking: [],
      oppositionRanking: [], mostSimilarPair: null, mostOppositePair: null,
      mostActiveDay: null, primeTime: null,
      topPollCreator: { id: 'creator@c.us', name: 'Criador', pollsCreated: 1, percentage: 100 },
      leastPollCreator: null, onlyOneIdentifiedCreator: true, creatorRanking: [],
      pollsWithIdentifiedCreator: 1,
      highestParticipationPoll: {
        id: 'poll-smoke', question: 'Qual opção?', timestamp: 1_700_000_000,
        optionCount: 2, participantCount: 1,
        optionResults: [{ name: 'A', voteCount: 1 }, { name: 'B', voteCount: 1 }]
      },
      closestPoll: null, minimumBehaviorSample: 3, minimumExtendedSample: 5,
      minimumPairSample: 5, minimumBehaviorParticipationRate: 20,
      statsTimezone: 'America/Sao_Paulo'
    }
  }));
  app.use('/api', (_request, response) => response.status(404).json({ error: 'Endpoint não encontrado.' }));
  app.use(express.static(frontendDist));
  app.get(/^(?!\/api(?:\/|$)).*/, (_request, response) => {
    response.sendFile(path.join(frontendDist, 'index.html'));
  });

  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  let browser;
  try {
    const { port } = server.address();
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    const browserErrors = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('requestfailed', (request) => browserErrors.push(
      `${request.url()}: ${request.failure()?.errorText || 'request failed'}`
    ));

    const expected = [
      [`/?groupId=${encodeURIComponent(group.id)}`, 'EasyPoll'],
      [`/history?groupId=${encodeURIComponent(group.id)}`, 'Histórico'],
      [`/stats?groupId=${encodeURIComponent(group.id)}`, 'EasyPoll Stats']
    ];
    for (const [route, heading] of expected) {
      const response = await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'networkidle0' });
      if (response?.status() !== 200) throw new Error(`${route} retornou ${response?.status()}.`);
      await page.waitForSelector('h1');
      const renderedHeading = await page.$eval('h1', (element) => element.textContent);
      if (renderedHeading !== heading) throw new Error(`${route} renderizou “${renderedHeading}”.`);
      console.log(`[smoke] ${route} -> 200 + React (${heading})`);
      if (heading === 'EasyPoll') {
        await page.waitForSelector('.group-row.selected');
        const optionCount = await page.$$eval('.poll-option', (elements) => elements.length);
        if (optionCount !== 2) throw new Error('O formulário principal não preservou duas opções iniciais.');
        await page.click('.favorite-button');
        if (!await page.$('.favorite-button.active')) throw new Error('O favorito de grupo não foi preservado pela extração.');
        await page.type('.group-search input', 'ausente');
        await page.waitForSelector('.group-empty');
        await page.$eval('.group-search input', (input) => {
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const optionActions = await page.$$('.option-actions button');
        await optionActions[1].click();
        await page.waitForSelector('.bulk-dialog[open]');
        await page.type('#bulk-text', 'Minecraft\nValorant\nGartic');
        await page.click('.bulk-dialog .dialog-primary');
        await page.waitForFunction(() => document.querySelectorAll('.poll-option').length === 3);
        const memberAction = (await page.$$('.option-actions button'))[2];
        await memberAction.click();
        await page.waitForSelector('.member-dialog[open] .member-card');
        await page.click('.member-card');
        page.once('dialog', (dialog) => void dialog.accept());
        await page.click('.member-dialog .dialog-primary');
        await page.waitForFunction(() => document.querySelector('.poll-option')?.value === 'Ana');
        await page.click('.checkbox-row input');
        const multipleAnswers = await page.$eval('.checkbox-row input', (input) => input.checked);
        if (!multipleAnswers) throw new Error('A opção de múltiplas respostas não pôde ser alterada.');
      }
      if (heading === 'Histórico') {
        await page.waitForSelector('.history-page-poll');
        await page.click('.history-detail-button');
        await page.waitForSelector('.history-detail-dialog[open] .history-participant');
      }
      if (heading === 'EasyPoll Stats') {
        await page.waitForSelector('.stats-summary');
        const summaryCount = await page.$$eval('.summary-stat', (elements) => elements.length);
        if (summaryCount !== 6) throw new Error('Stats não renderizou os seis itens de resumo.');
      }
    }

    const apiResponse = await fetch(`http://127.0.0.1:${port}/api/does-not-exist`);
    if (apiResponse.status !== 404 || !apiResponse.headers.get('content-type')?.includes('application/json')) {
      throw new Error('/api/does-not-exist não preservou o 404 JSON.');
    }
    console.log('[smoke] /api/does-not-exist -> 404 JSON');
    if (browserErrors.length) throw new Error(`Erros no browser:\n${browserErrors.join('\n')}`);
    console.log('[smoke] sem erros de console, página ou assets');
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
