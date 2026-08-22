'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const express = require('express');
const puppeteer = require('puppeteer');
const QRCode = require('qrcode');

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
  let destructiveSettingsRequests = 0;
  let connectionMode = 'connected';
  const mockQrDataUrl = await QRCode.toDataURL('easypoll-phase-12-visual-mock');
  app.get('/api/status', (_request, response) => response.json({
    status: connectionMode, connected: connectionMode === 'connected',
    hasQrCode: connectionMode === 'waiting_qr', error: null
  }));
  app.get('/api/qr', (_request, response) => response.json({ dataUrl: mockQrDataUrl }));
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
  app.get('/api/settings/storage', (_request, response) => response.json({
    database: { fileName: 'easypoll.db', relativePath: 'data/easypoll.db', sizeBytes: 15_518_924 },
    totals: { groups: 1, polls: 1, participations: 1, selections: 2, processedMessages: 12 },
    groups: [{
      id: group.id, name: group.name, polls: 1, participations: 1,
      selections: 2, processedMessages: 12, lastSyncAt: 1_700_000_300,
      oldestProcessedTimestamp: 1_700_000_000,
      newestProcessedTimestamp: 1_700_000_300
    }]
  }));
  app.delete('/api/settings/groups/:groupId/data', (_request, response) => {
    destructiveSettingsRequests += 1;
    response.json({ deleted: true });
  });
  app.delete('/api/settings/data', (_request, response) => {
    destructiveSettingsRequests += 1;
    response.json({ deleted: true });
  });
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
      [`/?groupId=${encodeURIComponent(group.id)}`, 'Criar enquete'],
      [`/history?groupId=${encodeURIComponent(group.id)}`, 'Histórico'],
      [`/stats?groupId=${encodeURIComponent(group.id)}`, 'Estatísticas'],
      ['/settings', 'Configurações']
    ];
    for (const [route, heading] of expected) {
      console.log(`[smoke] abrindo ${route}`);
      const response = await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'domcontentloaded', timeout: 10_000 });
      if (response?.status() !== 200) throw new Error(`${route} retornou ${response?.status()}.`);
      await page.waitForSelector('h1');
      const renderedHeading = await page.$eval('h1', (element) => element.textContent);
      if (renderedHeading !== heading) throw new Error(`${route} renderizou “${renderedHeading}”.`);
      console.log(`[smoke] ${route} -> 200 + React (${heading})`);
      if (heading === 'Criar enquete') {
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
      if (heading === 'Estatísticas') {
        await page.waitForSelector('.stats-summary');
        const summaryCount = await page.$$eval('.summary-stat', (elements) => elements.length);
        if (summaryCount !== 6) throw new Error('Stats não renderizou os seis itens de resumo.');
        const statCardCount = await page.$$eval('.stat-card', (elements) => elements.length);
        const pairRankingCount = await page.$$eval('.affinity-ranking', (elements) => elements.length);
        if (statCardCount !== 16 || pairRankingCount !== 2) {
          throw new Error(`Stats perdeu conteúdo visual: ${statCardCount} cards e ${pairRankingCount} rankings de pares.`);
        }
      }
      if (heading === 'Configurações') {
        await page.waitForSelector('.settings-storage');
        await page.waitForSelector('.settings-group-card');
        const settingsNavActive = await page.$eval(
          '.app-sidebar .app-nav a[href="/settings"]',
          (element) => element.classList.contains('active') && element.getAttribute('aria-current') === 'page'
        );
        if (!settingsNavActive) throw new Error('Configurações não ficou ativa na navegação.');

        await page.click('.settings-group-card button');
        await page.waitForSelector('.settings-dialog[open]');
        if (destructiveSettingsRequests !== 0) throw new Error('Abrir o diálogo de grupo fez uma chamada destrutiva.');
        await page.click('.settings-dialog[open] .settings-dialog-actions button:first-child');
        await page.waitForSelector('.settings-dialog[open]', { hidden: true });

        await page.click('.settings-danger > button');
        await page.waitForSelector('#delete-all-confirmation');
        const initiallyDisabled = await page.$eval(
          '.settings-dialog[open] .settings-dialog-actions button:last-child',
          (button) => button.disabled
        );
        if (!initiallyDisabled) throw new Error('Limpar tudo iniciou habilitado sem a frase de confirmação.');
        await page.type('#delete-all-confirmation', 'LIMPAR TUDO');
        const enabledAfterPhrase = await page.$eval(
          '.settings-dialog[open] .settings-dialog-actions button:last-child',
          (button) => !button.disabled
        );
        if (!enabledAfterPhrase) throw new Error('A frase de confirmação não habilitou a ação protegida.');
        await page.click('.settings-dialog[open] .settings-dialog-actions button:first-child');
        if (destructiveSettingsRequests !== 0) throw new Error('Cancelar um diálogo fez uma chamada destrutiva.');
      }
    }

    const settingsViewports = [
      { name: 'desktop-1440x900', width: 1440, height: 900 },
      { name: 'tablet-768x1024', width: 768, height: 1024 },
      { name: 'mobile-390x844', width: 390, height: 844 }
    ];
    for (const viewport of settingsViewports) {
      await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
      await page.goto(`http://127.0.0.1:${port}/settings`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.settings-group-card');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      if (overflow) throw new Error(`/settings possui overflow horizontal em ${viewport.name}.`);
      await page.click('.settings-danger > button');
      const dialogFits = await page.$eval('.settings-dialog[open]', (dialog) => {
        const bounds = dialog.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= window.innerWidth
          && bounds.top >= 0 && bounds.bottom <= window.innerHeight;
      });
      if (!dialogFits) throw new Error(`Diálogo de /settings saiu da tela em ${viewport.name}.`);
      await page.keyboard.press('Escape');
      console.log(`[smoke] /settings ${viewport.name} responsivo e sem overflow`);
    }

    if (process.env.EASYPOLL_VISUAL === '1') {
      const screenshotDir = path.join(__dirname, '..', 'docs', 'screenshots', 'phase-13');
      await fs.mkdir(screenshotDir, { recursive: true });
      const viewports = [
        { name: 'desktop-1440x900', width: 1440, height: 900 },
        { name: 'notebook-1280x800', width: 1280, height: 800 },
        { name: 'tablet-768x1024', width: 768, height: 1024 },
        { name: 'mobile-390x844', width: 390, height: 844 }
      ];
      const visualRoutes = [
        { name: 'create', path: `/?groupId=${encodeURIComponent(group.id)}` },
        { name: 'history', path: `/history?groupId=${encodeURIComponent(group.id)}` },
        { name: 'stats', path: `/stats?groupId=${encodeURIComponent(group.id)}` },
        { name: 'settings', path: '/settings' }
      ];
      for (const viewport of viewports) {
        await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
        for (const route of visualRoutes) {
          await page.goto(`http://127.0.0.1:${port}${route.path}`, { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('h1');
          await new Promise((resolve) => setTimeout(resolve, 250));
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
          if (overflow) throw new Error(`${route.path} possui overflow horizontal em ${viewport.name}.`);
          const target = path.join(screenshotDir, `${route.name}-${viewport.name}.png`);
          await page.screenshot({ path: target, fullPage: true });
          console.log(`[visual] ${route.path} ${viewport.name} sem overflow`);
        }
      }

      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
      await page.goto(`http://127.0.0.1:${port}/?groupId=${encodeURIComponent(group.id)}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.group-row.selected');
      await page.click('.mobile-menu-button');
      await page.waitForSelector('.mobile-menu-sheet[data-state="open"]');
      await page.screenshot({ path: path.join(screenshotDir, 'mobile-navigation-390x844.png'), fullPage: false });
      await page.keyboard.press('Escape');
      const memberAction = (await page.$$('.option-actions button'))[2];
      await memberAction.click();
      await page.waitForSelector('.member-dialog[open] .member-card');
      await page.screenshot({ path: path.join(screenshotDir, 'member-selector-mobile-390x844.png'), fullPage: false });
      await page.keyboard.press('Escape');

      await page.goto(`http://127.0.0.1:${port}/history?groupId=${encodeURIComponent(group.id)}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.history-page-poll');
      await page.click('.history-detail-button');
      await page.waitForSelector('.history-detail-dialog[open] .history-participant');
      await page.screenshot({ path: path.join(screenshotDir, 'poll-details-mobile-390x844.png'), fullPage: false });

      connectionMode = 'waiting_qr';
      await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.qr-panel img');
      await page.screenshot({ path: path.join(screenshotDir, 'qr-state-notebook-1280x800.png'), fullPage: false });
      connectionMode = 'connected';
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
