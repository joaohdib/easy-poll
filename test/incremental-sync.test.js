'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createDatabase } = require('../src/db/database');
const { runMigrations } = require('../src/db/migrate');
const { createPollsRouter } = require('../src/routes/polls.routes');
const {
  HistoryService,
  NEWER_SYNC_INITIAL_LIMIT,
  NEWER_SYNC_MAX_LIMIT,
  OLDER_SYNC_DEFAULT_LIMIT
} = require('../src/services/history.service');
const { PersistenceService } = require('../src/services/persistence.service');

const GROUP = { id: 'group@g.us', name: 'Grupo' };

function message(id, timestamp, overrides = {}) {
  return {
    id,
    type: 'chat',
    timestamp,
    body: `conteúdo privado de ${id}`,
    caption: `legenda privada de ${id}`,
    ...overrides
  };
}

function metadata(id, timestamp, type = 'chat') {
  return { id, groupId: GROUP.id, type, timestamp };
}

function createHarness(whatsappOverrides = {}) {
  const connection = createDatabase(':memory:');
  runMigrations(connection.db);
  const persistence = new PersistenceService(connection.db, () => 1_800_000_000);
  const whatsapp = {
    onConnectionLost(listener) { this.connectionLost = listener; },
    ensureConnected() {},
    async fetchGroupMessages(_groupId, _limit) { return { group: GROUP, messages: [] }; },
    async hydratePollMessageIds() {},
    async getGroupMembers() { return { members: [] }; },
    getOwnIdentity() { return { id: null, name: null }; },
    async getPollVotesForScan() { return []; },
    async findGroup() { return GROUP; },
    async ensureGroupHistoryAnchor() { return true; },
    async loadEarlierGroupMessages() { return { loadedMessages: 0, messages: [] }; },
    async loadEarlierGroupMessagePage() { return { loadedMessages: 0, messages: [] }; },
    ...whatsappOverrides
  };
  return {
    connection,
    persistence,
    whatsapp,
    history: new HistoryService(whatsapp, persistence)
  };
}

function seed(persistence, messages, polls = []) {
  persistence.persistScan({ group: GROUP, polls, processedMessages: messages });
}

function pollSnapshot(selectedOptionId = '0', votesAvailable = true) {
  return {
    messageId: 'poll-1',
    question: 'Escolha',
    timestamp: 100,
    creatorId: 'creator@c.us',
    creatorName: 'Criador',
    options: [
      { text: 'A', position: 0, whatsappLocalId: '0' },
      { text: 'B', position: 1, whatsappLocalId: '1' }
    ],
    allowMultipleAnswers: false,
    votes: votesAvailable ? [{
      voterId: 'voter@c.us', voterName: 'Votante', selectedOptionIds: [selectedOptionId],
      selectedOptions: [selectedOptionId === '0' ? 'A' : 'B'], timestamp: 200
    }] : [],
    votesAvailable
  };
}

function pollMessage() {
  return message('poll-1', 100, {
    type: 'poll_creation',
    pollName: 'Escolha',
    author: 'creator@c.us',
    pollOptions: [{ name: 'A', localId: 0 }, { name: 'B', localId: 1 }],
    allowMultipleAnswers: false
  });
}

test('repository finds known IDs in chunks and exposes exact oldest/newest status', () => {
  const { connection, persistence } = createHarness();
  try {
    const stored = Array.from({ length: 600 }, (_, index) => metadata(`id-${index}`, 100 + index));
    seed(persistence, stored);
    const queried = ['missing-a', ...stored.map(({ id }) => id), 'missing-b'];
    const found = persistence.findProcessedIds(queried);

    assert.equal(found.size, 600);
    assert.equal(found.has('id-0'), true);
    assert.equal(found.has('missing-a'), false);
    assert.equal(persistence.getOldestProcessedMessage(GROUP.id).messageId, 'id-0');
    assert.equal(persistence.getNewestProcessedMessage(GROUP.id).messageId, 'id-599');
    assert.deepEqual(persistence.getGroupSyncStatus(GROUP.id), {
      groupId: GROUP.id,
      messagesProcessed: 600,
      oldestProcessedTimestamp: 100,
      newestProcessedTimestamp: 699,
      lastSyncAt: 1_800_000_000
    });
  } finally {
    connection.closeDatabase();
  }
});

test('newer sync persists only unknown IDs, is idempotent and uses IDs when timestamps tie', async () => {
  const recent = [
    message('A', 100), message('B', 100), message('C', 101),
    message('D', 102), message('E', 103)
  ];
  const { connection, persistence, history } = createHarness({
    async fetchGroupMessages() { return { group: GROUP, messages: recent }; }
  });
  try {
    seed(persistence, [metadata('A', 100), metadata('C', 101)]);
    const first = await history.syncNewerMessages(GROUP.id);
    const second = await history.syncNewerMessages(GROUP.id);

    assert.equal(first.newMessages, 3);
    assert.equal(first.messagesPersisted, 3);
    assert.equal(first.reachedBoundary, true);
    assert.equal(second.newMessages, 0);
    assert.equal(second.messagesPersisted, 0);
    assert.equal(persistence.getGroupSyncStatus(GROUP.id).messagesProcessed, 5);
    assert.equal(persistence.findProcessedIds(['A', 'B']).size, 2);
    const columns = connection.sqlite.prepare('PRAGMA table_info(processed_messages)').all();
    assert.deepEqual(columns.map(({ name }) => name), [
      'message_id', 'group_id', 'message_type', 'message_timestamp'
    ]);
  } finally {
    connection.closeDatabase();
  }
});

test('newer sync grows its window until the newest known ID is reached', async () => {
  const limits = [];
  const { connection, persistence, history } = createHarness({
    async fetchGroupMessages(_groupId, limit) {
      limits.push(limit);
      return {
        group: GROUP,
        messages: limit <= 3
          ? [message('F', 6), message('G', 7), message('H', 8)]
          : [message('B', 2), message('C', 3), message('D', 4), message('E', 5),
              message('F', 6), message('G', 7), message('H', 8)]
      };
    }
  });
  history.newerSyncInitialLimit = 3;
  history.newerSyncMaxLimit = 12;
  try {
    seed(persistence, [metadata('A', 1), metadata('B', 2)]);
    const result = await history.syncNewerMessages(GROUP.id);

    assert.deepEqual(limits, [3, 6]);
    assert.equal(result.newMessages, 6);
    assert.equal(result.messagesLoaded, 7);
    assert.equal(persistence.getGroupSyncStatus(GROUP.id).messagesProcessed, 8);
  } finally {
    connection.closeDatabase();
  }
});

test('newer sync reports the safety limit without persisting an incomplete delta', async () => {
  const limits = [];
  const { connection, persistence, history } = createHarness({
    async fetchGroupMessages(_groupId, limit) {
      limits.push(limit);
      return {
        group: GROUP,
        messages: Array.from({ length: limit }, (_, index) => message(`new-${index}`, 100 + index))
      };
    }
  });
  history.newerSyncInitialLimit = 2;
  history.newerSyncMaxLimit = 4;
  try {
    seed(persistence, [metadata('known', 1)]);
    const result = await history.syncNewerMessages(GROUP.id);

    assert.deepEqual(limits, [2, 4]);
    assert.equal(result.boundaryNotFound, true);
    assert.equal(result.reachedBoundary, false);
    assert.equal(result.messagesPersisted, 0);
    assert.equal(persistence.getGroupSyncStatus(GROUP.id).messagesProcessed, 1);
  } finally {
    connection.closeDatabase();
  }
});

test('newer sync reconciles a known poll and preserves votes when recovery later fails', async () => {
  let selectedId = 1;
  let votesFail = false;
  const { connection, persistence, history } = createHarness({
    async fetchGroupMessages() {
      return { group: GROUP, messages: [pollMessage(), message('new-message', 101)] };
    },
    async getGroupMembers() {
      return { members: [
        { id: 'creator@c.us', name: 'Criador' }, { id: 'voter@c.us', name: 'Votante' }
      ] };
    },
    async getPollVotesForScan() {
      if (votesFail) throw new Error('votes unavailable');
      return [{
        voterId: 'voter@c.us', selectedOptionIds: [selectedId],
        selectedOptions: [selectedId === 0 ? 'A' : 'B'], timestamp: 300
      }];
    }
  });
  try {
    seed(persistence, [metadata('poll-1', 100, 'poll_creation')], [pollSnapshot('0')]);
    const updated = await history.syncNewerMessages(GROUP.id);
    let saved = persistence.polls.findByMessageId('poll-1');
    assert.equal(updated.pollsFound, 1);
    assert.equal(connection.sqlite.prepare('SELECT COUNT(*) AS count FROM polls').get().count, 1);
    assert.equal(saved.votes[0].optionId, saved.options[1].id);

    votesFail = true;
    selectedId = 0;
    await history.syncNewerMessages(GROUP.id);
    saved = persistence.polls.findByMessageId('poll-1');
    assert.equal(saved.votes[0].optionId, saved.options[1].id);
  } finally {
    connection.closeDatabase();
  }
});

test('older sync uses the persisted oldest ID as anchor and handles overlap', async () => {
  const anchors = [];
  const pages = [
    [message('B', 2), message('C', 3)],
    [message('A', 1), message('B', 2)]
  ];
  const { connection, persistence, history } = createHarness({
    async ensureGroupHistoryAnchor(_groupId, messageId) {
      anchors.push(messageId);
      return true;
    },
    async loadEarlierGroupMessagePage() {
      const messages = pages.shift() || [];
      return { loadedMessages: messages.length, messages };
    }
  });
  try {
    seed(persistence, [metadata('C', 3), metadata('D', 4), metadata('E', 5)]);
    const first = await history.syncOlderMessages(GROUP.id, 1);
    const second = await history.syncOlderMessages(GROUP.id, 1);

    assert.deepEqual(anchors, ['C', 'B']);
    assert.equal(first.newMessages, 1);
    assert.equal(first.knownMessages, 1);
    assert.equal(second.newMessages, 1);
    assert.equal(persistence.getGroupSyncStatus(GROUP.id).oldestProcessedTimestamp, 1);
    assert.equal(persistence.getGroupSyncStatus(GROUP.id).newestProcessedTimestamp, 5);
  } finally {
    connection.closeDatabase();
  }
});

test('older sync counts only new IDs toward its limit and reports the available-session start', async () => {
  const pages = [
    [message('D', 4), message('E', 5)],
    [message('B', 2), message('C', 3), message('D', 4)],
    [message('A', 1), message('B', 2)],
    []
  ];
  const { connection, persistence, history } = createHarness({
    async loadEarlierGroupMessagePage() {
      const messages = pages.shift() || [];
      return { loadedMessages: messages.length, messages };
    }
  });
  try {
    seed(persistence, [metadata('D', 4), metadata('E', 5)]);
    const result = await history.syncOlderMessages(GROUP.id, 3);
    const atStart = await history.syncOlderMessages(GROUP.id, 3);

    assert.equal(result.newMessages, 3);
    assert.equal(result.messagesLoaded, 7);
    assert.equal(persistence.getGroupSyncStatus(GROUP.id).messagesProcessed, 5);
    assert.equal(atStart.newMessages, 0);
    assert.equal(atStart.reachedAvailableHistoryStart, true);
  } finally {
    connection.closeDatabase();
  }
});

test('history operations reject concurrency while a newer sync is running', async () => {
  let releaseFetch;
  const fetchStarted = new Promise((resolve) => { releaseFetch = resolve; });
  let continueFetch;
  const blockedFetch = new Promise((resolve) => { continueFetch = resolve; });
  const { connection, persistence, history } = createHarness({
    async fetchGroupMessages() {
      releaseFetch();
      await blockedFetch;
      return { group: GROUP, messages: [message('known', 1)] };
    }
  });
  try {
    seed(persistence, [metadata('known', 1)]);
    const first = history.syncNewerMessages(GROUP.id);
    await fetchStarted;
    await assert.rejects(
      history.syncOlderMessages(GROUP.id, 1),
      (error) => error.code === 'INCREMENTAL_SYNC_BUSY'
    );
    await assert.rejects(
      history.scanGroupPolls(GROUP.id, 1),
      (error) => error.code === 'INCREMENTAL_SYNC_BUSY'
    );
    continueFetch();
    await first;
  } finally {
    connection.closeDatabase();
  }
});

test('incremental sync requires an existing local baseline', async () => {
  const { connection, history } = createHarness();
  try {
    await assert.rejects(
      history.syncNewerMessages(GROUP.id),
      (error) => error.code === 'SYNC_BASELINE_REQUIRED' && /importação inicial/.test(error.message)
    );
    await assert.rejects(
      history.syncOlderMessages(GROUP.id, 1),
      (error) => error.code === 'SYNC_BASELINE_REQUIRED'
    );
  } finally {
    connection.closeDatabase();
  }
});

test('cancelling older sync stops the loop and does not persist a partial page', async () => {
  let pageStarted;
  const started = new Promise((resolve) => { pageStarted = resolve; });
  let releasePage;
  const blockedPage = new Promise((resolve) => { releasePage = resolve; });
  const { connection, persistence, history } = createHarness({
    async loadEarlierGroupMessagePage() {
      pageStarted();
      await blockedPage;
      return { loadedMessages: 1, messages: [message('A', 1)] };
    }
  });
  try {
    seed(persistence, [metadata('B', 2)]);
    const operation = history.syncOlderMessages(GROUP.id, 1);
    await started;
    assert.deepEqual(history.cancelIncrementalSync(GROUP.id), {
      groupId: GROUP.id, direction: 'older', cancelRequested: true
    });
    releasePage();
    const result = await operation;

    assert.equal(result.cancelled, true);
    assert.equal(result.messagesPersisted, 0);
    assert.equal(persistence.getGroupSyncStatus(GROUP.id).messagesProcessed, 1);
  } finally {
    connection.closeDatabase();
  }
});

test('incremental endpoints expose status/newer/older and validate older limits', async () => {
  const calls = [];
  const history = {
    getGroupSyncStatus(groupId) {
      calls.push(['status', groupId]);
      return { groupId, messagesProcessed: 3, oldestProcessedTimestamp: 1, newestProcessedTimestamp: 3, lastSyncAt: 4 };
    },
    async syncNewerMessages(groupId) {
      calls.push(['newer', groupId]);
      return { direction: 'newer', newMessages: 0 };
    },
    async syncOlderMessages(groupId, limit) {
      calls.push(['older', groupId, limit]);
      return { direction: 'older', newMessages: limit };
    },
    cancelIncrementalSync(groupId) {
      calls.push(['cancel', groupId]);
      return { groupId, cancelRequested: true };
    }
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createPollsRouter({}, history, { latestPollScan: null }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/groups/group%40g.us`;

  try {
    const status = await fetch(`${base}/sync-status`);
    const newer = await fetch(`${base}/sync/newer`, { method: 'POST' });
    const older = await fetch(`${base}/sync/older`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limit: 500 })
    });
    const invalid = await fetch(`${base}/sync/older`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limit: 5001 })
    });
    const cancelled = await fetch(`${base}/sync`, { method: 'DELETE' });

    assert.equal(status.status, 200);
    assert.equal(newer.status, 200);
    assert.equal(older.status, 200);
    assert.equal(invalid.status, 400);
    assert.equal(cancelled.status, 200);
    assert.deepEqual(calls, [
      ['status', GROUP.id], ['newer', GROUP.id], ['older', GROUP.id, 500], ['cancel', GROUP.id]
    ]);
    assert.equal((await status.json()).messagesProcessed, 3);
    assert.equal((await older.json()).newMessages, 500);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('incremental constants keep common work bounded', () => {
  assert.equal(NEWER_SYNC_INITIAL_LIMIT, 250);
  assert.equal(NEWER_SYNC_MAX_LIMIT, 5000);
  assert.equal(OLDER_SYNC_DEFAULT_LIMIT, 1000);
});
